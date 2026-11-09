// M2.1 measurement spike (specs/M2.md 4.5), step 2: measure in installed Google Chrome.
//
//   node tools/spike_m2_fixtures.ts           # once, writes fixtures/spike/ (gitignored)
//   node tools/spike_m2_run.ts [substring]    # all fixtures, or only names containing substring
//
// Writes results/m2_spike.json and results/m2_spike.md. Not part of `npm run test:browser` or `npm test`.
// It starts its own Vite dev server on port 5181 (in this process, closed in finally) and, for each
// file, a fresh Chrome via Playwright's chromium.launchServer({ channel: 'chrome' }) so the browser
// PID is known and no memory carries over between files. The page is spike/m2-file.html.
// In a sandboxed shell, binding the port fails with EPERM; run it with the sandbox off.
//
// Memory, three measures:
//  - Renderer physical footprint (phys_footprint, what Activity Monitor calls Memory; includes
//    compressed and swapped pages): `vmmap -summary <pid>` "Physical footprint (peak)" read once after
//    the run, which is the kernel's lifetime peak for that process (no sampling gaps), plus
//    `footprint -j` sampled about every 200 ms for a timeline and an idle baseline. The fits verdict
//    uses the vmmap lifetime peak (sampled footprint peak if vmmap failed).
//  - RSS of the renderer and of the whole Chrome tree (every descendant of the launched browser PID),
//    from `ps -A -o pid=,ppid=,rss=` about every 50 ms. Kept as a second column.
// The renderer is the page's renderer process; it hosts the page and its dedicated Worker.

import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const PORT = 5181;
const PS_INTERVAL_MS = 50;
const FP_INTERVAL_MS = 200;
const SETTLE_MS = 2500;
const BASELINE_MS = 4000; // footprint of 3 renderers takes 300 to 500 ms per sample after launch
const MIN_BASELINE_PS = 10;
const MIN_BASELINE_FP = 5;
const TAIL_MS = 1000;
const BUDGET_MEM_BYTES = 1e9; // placeholder "1 GB" (OPEN Q2), taken as 10^9 bytes
const BUDGET_ANALYSIS_MS = 60_000; // placeholder "analysis under 60 s" (OPEN Q2)
// Timeout per file: 5 x an expected time of (audio at real-time factor 10) + 10 s.
const timeoutMs = (durationS: number) => 5 * (durationS * 100 + 10_000);
const MB = 1e6;

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

interface Proc { pid: number; ppid: number; rss: number; kind: string }
interface Sample { t: number; tree: number; procs: Proc[] }
interface FpSample { t: number; byPid: Record<number, number> }

function kindOf(cmd: string, isRoot: boolean): string {
  if (isRoot) return 'browser';
  const m = /--type=([\w-]+)/.exec(cmd);
  if (!m) return 'other';
  if (m[1] === 'utility') return `utility:${/--utility-sub-type=([\w.]+)/.exec(cmd)?.[1] ?? '?'}`;
  return m[1];
}

// Command lines are only fetched for PIDs not seen before (ps with command= is several times slower).
const kindCache = new Map<number, string>();

async function snapshot(root: number, t0: number): Promise<Sample> {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,rss='], { maxBuffer: 1 << 24 });
  const t = performance.now() - t0;
  const all = new Map<number, { ppid: number; rss: number }>();
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)/.exec(line);
    if (m) all.set(+m[1], { ppid: +m[2], rss: +m[3] * 1024 });
  }
  const inTree = new Set<number>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, p] of all) if (!inTree.has(pid) && inTree.has(p.ppid)) { inTree.add(pid); grew = true; }
  }
  const fresh = [...inTree].filter((pid) => all.has(pid) && !kindCache.has(pid));
  if (fresh.length) {
    const { stdout: cmds } = await run('ps', ['-ww', '-o', 'pid=,command=', '-p', fresh.join(',')], { maxBuffer: 1 << 24 }).catch(() => ({ stdout: '' }));
    for (const line of cmds.split('\n')) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m) kindCache.set(+m[1], kindOf(m[2], +m[1] === root));
    }
  }
  const procs: Proc[] = [];
  let tree = 0;
  for (const pid of inTree) {
    const p = all.get(pid);
    if (!p) continue;
    procs.push({ pid, ppid: p.ppid, rss: p.rss, kind: kindCache.get(pid) ?? 'other' });
    tree += p.rss;
  }
  return { t, tree, procs };
}

const fpFile = join(os.tmpdir(), `spike_m2_fp_${process.pid}.json`);
async function footprintOf(pids: number[], t0: number): Promise<FpSample> {
  await run('footprint', ['-j', fpFile, '--noCategories', ...pids.map(String)], { maxBuffer: 1 << 24 });
  const t = performance.now() - t0;
  const j = JSON.parse(readFileSync(fpFile, 'utf8')) as { processes: { pid: number; footprint: number }[] };
  const byPid: Record<number, number> = {};
  for (const p of j.processes) byPid[p.pid] = p.footprint;
  return { t, byPid };
}

async function vmmapPeak(pid: number): Promise<{ footprintBytes: number; peakBytes: number } | { error: string }> {
  try {
    const { stdout } = await run('vmmap', ['-summary', String(pid)], { maxBuffer: 1 << 26 });
    const unit = (v: string, u: string) => +v * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[u] ?? 1);
    const cur = /Physical footprint:\s+([\d.]+)([KMG])/.exec(stdout);
    const peak = /Physical footprint \(peak\):\s+([\d.]+)([KMG])/.exec(stdout);
    if (!cur || !peak) return { error: 'vmmap output had no Physical footprint lines' };
    return { footprintBytes: Math.round(unit(cur[1], cur[2])), peakBytes: Math.round(unit(peak[1], peak[2])) };
  } catch (err) {
    return { error: String(err).split('\n')[0] };
  }
}

class Sampler {
  ps: Sample[] = [];
  fp: FpSample[] = [];
  fpErrors = 0;
  private on = false;
  private loops: Promise<void>[] = [];
  private root: number;
  private t0: number;
  constructor(root: number, t0: number) { this.root = root; this.t0 = t0; }
  renderers(): number[] {
    const last = this.ps[this.ps.length - 1];
    return last ? last.procs.filter((p) => p.kind === 'renderer').map((p) => p.pid) : [];
  }
  start(): void {
    this.on = true;
    this.loops.push((async () => {
      while (this.on) {
        const t = performance.now();
        try { this.ps.push(await snapshot(this.root, this.t0)); } catch { /* ps failed once; keep going */ }
        await sleep(Math.max(0, PS_INTERVAL_MS - (performance.now() - t)));
      }
    })());
    this.loops.push((async () => {
      while (this.on) {
        const t = performance.now();
        const pids = this.renderers();
        if (pids.length) {
          try { this.fp.push(await footprintOf(pids, this.t0)); } catch { this.fpErrors++; }
        }
        await sleep(Math.max(0, FP_INTERVAL_MS - (performance.now() - t)));
      }
    })());
  }
  async stop(): Promise<void> { this.on = false; await Promise.all(this.loops); }
}

interface Fixture { file: string; format: string; durationS: number; channels: number; sampleRate: number; bytes: number; encoder: string }

class BaselineError extends Error {}

async function attempt(fx: Fixture, baseURL: string): Promise<Record<string, unknown>> {
  const server = await chromium.launchServer({ channel: 'chrome', headless: true });
  const pid = server.process().pid;
  if (!pid) { await server.close(); throw new Error('no browser pid'); }
  const browser = await chromium.connect(server.wsEndpoint());
  const out: Record<string, unknown> = { name: basename(fx.file), ...fx, chrome: browser.version(), timeoutMs: timeoutMs(fx.durationS) };
  const t0 = performance.now();
  const sampler = new Sampler(pid, t0);
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    let crashed: (e: Error) => void = () => {};
    const crash = new Promise<never>((_, reject) => { crashed = reject; });
    crash.catch(() => {});
    page.on('crash', () => { errors.push('page crashed'); crashed(new Error('renderer crashed (possibly out of memory)')); });
    await page.goto(`${baseURL}/spike/m2-file.html`);
    await page.waitForFunction(() => (window as unknown as { __spikeReady: () => boolean }).__spikeReady());
    await page.waitForLoadState('networkidle');
    sampler.start();
    await sleep(SETTLE_MS + BASELINE_MS);
    const tLoad = performance.now() - t0;
    const inBase = (t: number) => t >= tLoad - BASELINE_MS && t < tLoad;
    const basePs = sampler.ps.filter((s) => inBase(s.t));
    const baseFp = sampler.fp.filter((s) => inBase(s.t));
    if (basePs.length < MIN_BASELINE_PS || baseFp.length < MIN_BASELINE_FP) {
      throw new BaselineError(`baseline window had ${basePs.length} ps samples (need ${MIN_BASELINE_PS}) and ${baseFp.length} footprint samples (need ${MIN_BASELINE_FP})`);
    }
    await page.setInputFiles('#file', resolve(fx.file));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs(fx.durationS)} ms`)), timeoutMs(fx.durationS)); });
    const evaluated = page.evaluate(() => (window as unknown as { __spikeRun: () => Promise<unknown> }).__spikeRun());
    evaluated.catch(() => {});
    const res = await Promise.race([evaluated, timeout, crash]).finally(() => clearTimeout(timer));
    const tDone = performance.now() - t0;
    await sleep(TAIL_MS);
    await sampler.stop();
    const after = sampler.ps.filter((s) => s.t >= tLoad);
    const fpAfter = sampler.fp.filter((s) => s.t >= tLoad);
    // The page renderer is the renderer whose sampled footprint peaked highest during the run (one page
    // is open; Chrome may also keep a spare renderer).
    const rendererPids = [...new Set(after.flatMap((s) => s.procs.filter((p) => p.kind === 'renderer').map((p) => p.pid)))];
    const fpPeakOf = (x: number) => Math.max(0, ...fpAfter.map((s) => s.byPid[x] ?? 0));
    const rPid = [...rendererPids].sort((a, b) => fpPeakOf(b) - fpPeakOf(a))[0];
    const vm = await vmmapPeak(rPid);
    const rssOf = (s: Sample) => s.procs.find((p) => p.pid === rPid)?.rss ?? 0;
    const fpOf = (s: FpSample) => s.byPid[rPid] ?? 0;
    const baseFpR = baseFp.filter((s) => rPid in s.byPid);
    const basePsR = basePs.filter((s) => s.procs.some((p) => p.pid === rPid));
    if (baseFpR.length < MIN_BASELINE_FP || basePsR.length < MIN_BASELINE_PS) {
      throw new BaselineError(`page renderer ${rPid} was in ${basePsR.length} baseline ps samples and ${baseFpR.length} baseline footprint samples`);
    }
    const fpBase = mean(baseFpR.map(fpOf));
    const rBase = mean(basePsR.map(rssOf));
    const treeBase = mean(basePs.map((s) => s.tree));
    const fpPeak = fpPeakOf(rPid);
    const rPeak = Math.max(...after.map(rssOf));
    const treePeak = Math.max(...after.map((s) => s.tree));
    const lifetimePeak = 'peakBytes' in vm ? vm.peakBytes : null;
    const verdictBytes = lifetimePeak ?? fpPeak;
    const ints = (ss: { t: number }[]) => ss.slice(1).map((s, i) => s.t - ss[i].t);
    const peakByKind: Record<string, number> = {};
    for (const s of after) for (const p of s.procs) peakByKind[p.kind] = Math.max(peakByKind[p.kind] ?? 0, p.rss);
    Object.assign(out, {
      ok: true,
      result: res,
      memory: {
        rendererPid: rPid,
        rendererPidsSeen: rendererPids,
        footprint: {
          vmmapLifetimePeakBytes: lifetimePeak,
          vmmapAtEndBytes: 'footprintBytes' in vm ? vm.footprintBytes : null,
          vmmapError: 'error' in vm ? vm.error : null,
          sampledBaselineBytes: Math.round(fpBase),
          sampledPeakBytes: fpPeak,
          sampledPeakMinusBaselineBytes: Math.round(fpPeak - fpBase),
          baselineSamples: baseFpR.length,
          runSamples: fpAfter.length,
          errors: sampler.fpErrors,
          meanSampleIntervalMs: +mean(ints(fpAfter)).toFixed(1),
          maxSampleIntervalMs: +Math.max(...ints(fpAfter)).toFixed(1),
        },
        rss: {
          rendererBaselineBytes: Math.round(rBase),
          rendererPeakBytes: rPeak,
          rendererPeakMinusBaselineBytes: Math.round(rPeak - rBase),
          treeBaselineBytes: Math.round(treeBase),
          treePeakBytes: treePeak,
          treePeakMinusBaselineBytes: Math.round(treePeak - treeBase),
          peakRssByProcessKind: peakByKind,
          baselineSamples: basePsR.length,
          runSamples: after.length,
          meanSampleIntervalMs: +mean(ints(after)).toFixed(1),
          maxSampleIntervalMs: +Math.max(...ints(after)).toFixed(1),
        },
        verdictBytes,
        verdictSource: lifetimePeak !== null ? 'vmmap lifetime peak footprint of the renderer' : 'sampled footprint peak of the renderer (vmmap failed)',
        resultReturnedAtMs: Math.round(tDone - tLoad),
        timelineMs_rendererFootprintMB: fpAfter.map((s) => [Math.round(s.t - tLoad), +(fpOf(s) / MB).toFixed(1)]),
        timelineMs_treeRssMB_rendererRssMB: after.map((s) => [Math.round(s.t - tLoad), +(s.tree / MB).toFixed(1), +(rssOf(s) / MB).toFixed(1)]),
      },
    });
    await page.evaluate(() => (window as unknown as { __spikeRelease: () => boolean }).__spikeRelease());
  } catch (err) {
    await sampler.stop();
    if (err instanceof BaselineError) {
      await browser.close().catch(() => {});
      await server.close();
      throw err;
    }
    Object.assign(out, { ok: false, error: String(err).split('\n')[0], psSamples: sampler.ps.length, footprintSamples: sampler.fp.length });
  }
  if (errors.length) out.pageErrors = errors;
  await browser.close().catch(() => {});
  await server.close();
  return out;
}

async function measure(fx: Fixture, baseURL: string): Promise<Record<string, unknown>> {
  try {
    return await attempt(fx, baseURL);
  } catch (err) {
    if (!(err instanceof BaselineError)) return { name: basename(fx.file), ...fx, ok: false, error: String(err).split('\n')[0] };
    console.log(`\n  BASELINE TOO SHORT: ${err.message}; retrying once with a fresh Chrome`);
    try {
      const r = await attempt(fx, baseURL);
      r.retriedAfter = err.message;
      return r;
    } catch (err2) {
      return { name: basename(fx.file), ...fx, ok: false, error: `failed: ${String(err2).split('\n')[0]} (after retry; first: ${err.message})` };
    }
  }
}

function tryCmd(cmd: string, args: string[]): string | null {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return null; }
}

function machineMemory(): Record<string, unknown> {
  const mp = tryCmd('memory_pressure', []);
  const free = mp ? /System-wide memory free percentage:\s*(\d+)%/.exec(mp)?.[1] : undefined;
  return {
    at: new Date().toISOString(),
    memoryPressureFreePercent: free !== undefined ? +free : null,
    swapUsage: tryCmd('sysctl', ['-n', 'vm.swapusage']),
  };
}

const filter = process.argv[2] ?? '';
const manifest = JSON.parse(readFileSync('fixtures/spike/manifest.json', 'utf8')) as { seed: number; files: Fixture[]; skipped: unknown[] };
const fixtures = manifest.files.filter((f) => basename(f.file).includes(filter));

const memStart = machineMemory();
const runs: Record<string, unknown>[] = [];
const vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false }, logLevel: 'warn' });
// hmr: false, so edits by other sessions in this checkout cannot reload the spike page mid-run.
try {
  await vite.listen();
  const baseURL = `http://127.0.0.1:${PORT}`;
  for (const fx of fixtures) {
    process.stdout.write(`${basename(fx.file)} ... `);
    const r = await measure(fx, baseURL);
    runs.push(r);
    const w = r.result as { decodeMs: number; worker: { analysisMs: number } } | undefined;
    const m = r.memory as { verdictBytes: number; rss: { rendererPeakBytes: number } } | undefined;
    console.log(r.ok && w && m
      ? `decode ${w.decodeMs.toFixed(0)} ms, analysis ${(w.worker.analysisMs / 1000).toFixed(2)} s, renderer footprint peak ${(m.verdictBytes / MB).toFixed(0)} MB, renderer RSS peak ${(m.rss.rendererPeakBytes / MB).toFixed(0)} MB`
      : `FAILED: ${String(r.error)}`);
  }
} finally {
  await vite.close();
}
const memEnd = machineMemory();

const pwVersion = (JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')) as { version: string }).version;
const report = {
  spec: 'specs/M2.md 4.5 (M2.1 task 1, measurement spike)',
  generatedAt: new Date().toISOString(),
  command: `node tools/spike_m2_run.ts${filter ? ` ${filter}` : ''}`,
  browser: { name: 'Google Chrome (installed, Playwright channel "chrome")', version: (runs.find((r) => r.chrome)?.chrome as string) ?? null, headless: true, playwright: pwVersion },
  machine: {
    cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length, ramBytes: os.totalmem(),
    os: `macOS ${tryCmd('sw_vers', ['-productVersion']) ?? '?'} (Darwin ${os.release()})`, arch: os.arch(),
    hwModel: tryCmd('sysctl', ['-n', 'hw.model']), node: process.version,
    memoryAtStart: memStart, memoryAtEnd: memEnd,
  },
  methods: {
    fixtures: `tools/spike_m2_fixtures.ts, seed ${manifest.seed}: synthetic harmonic tone, 5.5 Hz vibrato, note changes, unvoiced gaps with noise; stereo right channel differs (harmonic weights, gain, noise, 0.4 ms delay). Encoder per file in runs[].encoder.`,
    fileInput: 'Playwright setInputFiles on <input type=file>, then File.arrayBuffer() in the page.',
    decode: 'decodeAudioData on an OfflineAudioContext(1, 1, 48000). decodeMs = decodeAudioData call only; readMs = File.arrayBuffer(). The ArrayBuffer and AudioBuffer references are dropped after the channels are posted.',
    transfer: 'AudioBuffer.getChannelData arrays posted to a module Worker as transferables (copy fallback reported in result.transferMode).',
    mix: 'Worker onmessage: arithmetic mean of all channels per sample into a Float64Array (as tools/wav.ts), timed as worker.mixMs. Analysis is queued with setTimeout(analyse, 0, mono, ...), so the event and its channel arrays are unreachable before analysis starts.',
    analysis: 'Worker: new FrameAnalyzer({ sampleRate }).run(mono, true) then decodeAll(frames, { lag: Infinity }), the cont path of tools/run_ts.ts. analysisMs = run + decodeAll (same span run_ts.ts times). realTimeFactor = audio seconds / analysis seconds.',
    spectrumColumns: 'Worker, after analysis and timed separately (spectrumColumnsMs): FrameAnalyzer.run does not keep per-frame spectra, so a second pass calls Spectrum.compute (src/dsp/spectrum.ts unchanged, via FrameAnalyzer.spec) at each frame start and copies bins 0..floor(4000 * N / sampleRate) into one Float32Array per frame (171 bins at 48 kHz with N 2048; runs[].result.worker.binsPerColumn).',
    realisticHold: 'Worker posts { frames, f0, columns } to the page by structured clone (postCloneMs = the synchronous postMessage call). frames = one object per frame with t, start, voiced, aperiodicity, rmsDb, eSf, eRef (specs/M2.md 4.2 item 6, no YIN candidate arrays); f0 = decoded whole-take f0 as a Float64Array; columns = the spectrum columns. The worker drops its references after posting; the page holds the clone until the tail of sampling ends, then releases it.',
    memory: `Renderer phys_footprint: vmmap -summary "Physical footprint (peak)" read once after the tail (kernel lifetime peak of the process; it includes page load), and footprint -j sampled about every ${FP_INTERVAL_MS} ms for the baseline and timeline. RSS from ps about every ${PS_INTERVAL_MS} ms for the renderer and the whole tree (descendants of the launchServer PID). Baseline = mean over ${BASELINE_MS} ms with the page loaded and the Worker started, after a ${SETTLE_MS} ms settle, before the file is set; a file whose baseline window has fewer than ${MIN_BASELINE_PS} ps or ${MIN_BASELINE_FP} footprint samples fails and is retried once with a fresh Chrome. Peak window: run plus ${TAIL_MS} ms tail while the page holds the result.`,
    memoryCaveats: [
      'phys_footprint counts the renderer only; GPU, browser and utility processes are in the RSS tree column, not in the verdict.',
      'The vmmap lifetime peak has no sampling gaps, but vmmap output is rounded to 0.1 MB and the number includes everything since the renderer started.',
      'RSS leaves out compressed and swapped pages and double-counts shared pages in the tree sum.',
      'Garbage collection timing changes the peak: freed buffers may stay resident until the next GC.',
      'Headless Chrome; a headed tab adds compositor and GPU memory not measured here.',
      'One run per file. Earlier runs, archived in results/_archive/m2_spike_v1/, varied from run to run, and the machine was shared with another session.',
    ],
    timeouts: 'Per file: 5 x (durationS / 10 + 10 s). A timeout, renderer crash, worker error or page error marks the file failed; that Chrome is closed and the run continues.',
    budgets: { peakTabMemoryBytes: BUDGET_MEM_BYTES, analysisMs: BUDGET_ANALYSIS_MS, note: 'Placeholders from specs/M2.md 4.5 (OPEN Q2). Memory fit judged on the renderer physical footprint lifetime peak (vmmap). RSS columns are shown too.' },
  },
  skippedFixtures: manifest.skipped,
  runs,
};
mkdirSync('results', { recursive: true });
writeFileSync('results/m2_spike.json', JSON.stringify(report, null, 1));

interface W { readMs: number; decodeMs: number; transferMode: string; worker: { mixMs: number; analysisMs: number; spectrumColumnsMs: number; postCloneMs: number; samples: number } }
interface M {
  verdictBytes: number; verdictSource: string;
  footprint: { vmmapLifetimePeakBytes: number | null; sampledPeakBytes: number; sampledPeakMinusBaselineBytes: number };
  rss: { rendererPeakBytes: number; rendererPeakMinusBaselineBytes: number; treePeakBytes: number; treePeakMinusBaselineBytes: number };
}
const yes = (b: boolean) => (b ? 'yes' : 'NO');
const mb = (b: number) => (b / MB).toFixed(0);
const rows = runs.map((r) => {
  if (!r.ok) return `| ${String(r.name)} | failed: ${String(r.error)} | | | | | | | | | | | |`;
  const w = r.result as W;
  const m = r.memory as M;
  const audioS = w.worker.samples / 48000;
  const rtf = audioS / (w.worker.analysisMs / 1000);
  const memOk = m.verdictBytes < BUDGET_MEM_BYTES;
  const timeOk = w.worker.analysisMs < BUDGET_ANALYSIS_MS;
  const life = m.footprint.vmmapLifetimePeakBytes;
  return `| ${String(r.name)} | ${(Number(r.bytes) / MB).toFixed(1)} | ${w.decodeMs.toFixed(0)} | ${w.worker.mixMs.toFixed(0)} | ${(w.worker.analysisMs / 1000).toFixed(2)} | ${rtf.toFixed(1)} | ${w.worker.spectrumColumnsMs.toFixed(0)} | ${w.worker.postCloneMs.toFixed(0)} | ${life !== null ? mb(life) : 'n/a'} | ${mb(m.footprint.sampledPeakBytes)} (+${mb(m.footprint.sampledPeakMinusBaselineBytes)}) | ${mb(m.rss.rendererPeakBytes)} (+${mb(m.rss.rendererPeakMinusBaselineBytes)}) | ${mb(m.rss.treePeakBytes)} (+${mb(m.rss.treePeakMinusBaselineBytes)}) | ${yes(memOk)}${life === null ? ' (sampled)' : ''} | ${yes(timeOk)} |`;
});
const r0 = runs.find((r) => r.ok)?.result as { transferMode?: string } | undefined;
const failed = runs.filter((r) => !r.ok).map((r) => `${String(r.name)}: ${String(r.error)}`);
const retried = runs.filter((r) => r.retriedAfter).map((r) => `${String(r.name)} (${String(r.retriedAfter)})`);
const memLine = (x: Record<string, unknown>) => `${x.memoryPressureFreePercent ?? '?'}% free (memory_pressure), swap ${x.swapUsage ?? '?'}`;
const md = `# M2.1 measurement spike (specs/M2.md 4.5)

Generated by \`${report.command}\` at ${report.generatedAt}. Every number in this note is written by the runner from \`results/m2_spike.json\`. One run per file.

- Browser: ${report.browser.name} ${report.browser.version}, headless, Playwright ${pwVersion}
- Machine: ${report.machine.cpu} (${report.machine.hwModel ?? 'model unknown'}), ${report.machine.logicalCores} cores, ${(os.totalmem() / 2 ** 30).toFixed(0)} GiB RAM, ${report.machine.os}
- Machine memory at start: ${memLine(memStart)}. At end: ${memLine(memEnd)}.
- Decode: \`decodeAudioData\` on \`OfflineAudioContext(1, 1, 48000)\`. Transfer to Worker: ${r0?.transferMode ?? 'n/a'}.
- Analysis: mix in the Worker's message handler, then \`FrameAnalyzer.run(mono, true)\` and \`decodeAll(frames, { lag: Infinity })\` in a later task, timed as one span. RTF = audio seconds / analysis seconds. Spectrum columns (0 to 4 kHz, one Float32Array per frame) and the structured-clone post are timed separately.
- Realistic hold: the page receives { frames, f0, spectrum columns } by structured clone and holds it while memory is sampled.
- Memory: "Footprint peak" is the renderer's lifetime physical footprint peak from \`vmmap -summary\` (renderer = page plus Worker). "Footprint sampled" is \`footprint\` about every ${FP_INTERVAL_MS} ms. RSS columns are from \`ps\` about every ${PS_INTERVAL_MS} ms; "tree" is every process under the launched Chrome. Shown as peak (+ peak minus idle baseline), MB = 10^6 bytes.
- Budgets (placeholders, OPEN Q2): peak tab memory under 1 GB (taken as 10^9 bytes, judged on the renderer footprint peak from vmmap), analysis under 60 s.

| File | Size MB | Decode ms | Mix ms | Analysis s | RTF | Spectrum cols ms | Post clone ms | Footprint peak MB | Footprint sampled MB (+delta) | Renderer RSS MB (+delta) | Tree RSS MB (+delta) | Memory fits | Analysis fits |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Failed files: ${failed.length ? failed.join('; ') : 'none'}.
Baseline retries: ${retried.length ? retried.join('; ') : 'none'}.
Skipped fixtures: ${manifest.skipped.length ? JSON.stringify(manifest.skipped) : 'none'}.

Caveats on memory: ${report.methods.memoryCaveats.join(' ')}
`;
writeFileSync('results/m2_spike.md', md);
console.log('wrote results/m2_spike.json and results/m2_spike.md');
