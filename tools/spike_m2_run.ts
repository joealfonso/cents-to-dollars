// M2.1 measurement spike (specs/M2.md 4.5), step 2: measure in installed Google Chrome.
//
//   node tools/spike_m2_fixtures.ts           # once, writes fixtures/spike/ (gitignored)
//   node tools/spike_m2_run.ts [substring]    # all fixtures, or only names containing substring
//
// Writes results/m2_spike.json and results/m2_spike.md. Not part of `npm run test:browser` or `npm test`.
// It starts its own Vite dev server on port 5181 (in this process, closed at the end) and, for each
// file, a fresh Chrome via Playwright's chromium.launchServer({ channel: 'chrome' }) so the browser
// PID is known and no memory carries over between files. The page is spike/m2-file.html.
// In a sandboxed shell, binding the port fails with EPERM; run it with the sandbox off.
//
// Memory: `ps -A -o pid=,ppid=,rss=` is sampled about every 50 ms (start to start, never faster);
// the Chrome process tree is every descendant of the launched browser PID. Reported: peak RSS of the
// page's renderer process (it hosts the page and its dedicated Worker) and of the summed tree, each
// also as peak minus a pre-load baseline taken while the page sat idle with the Worker started.

import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const PORT = 5181;
const INTERVAL_MS = 50;
const SETTLE_MS = 2500;
const BASELINE_MS = 1500;
const TAIL_MS = 750;
const BUDGET_MEM_BYTES = 1e9; // placeholder "1 GB" (OPEN Q2), taken as 10^9 bytes
const BUDGET_ANALYSIS_MS = 60_000; // placeholder "analysis under 60 s" (OPEN Q2)
const MB = 1e6;

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Proc { pid: number; ppid: number; rss: number; kind: string }
interface Sample { t: number; tree: number; procs: Proc[] }

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

class Sampler {
  samples: Sample[] = [];
  private on = false;
  private loop: Promise<void> = Promise.resolve();
  private root: number;
  private t0: number;
  constructor(root: number, t0: number) { this.root = root; this.t0 = t0; }
  start(): void {
    this.on = true;
    this.loop = (async () => {
      while (this.on) {
        const t = performance.now();
        try { this.samples.push(await snapshot(this.root, this.t0)); } catch { /* ps failed once; keep going */ }
        await sleep(Math.max(0, INTERVAL_MS - (performance.now() - t)));
      }
    })();
  }
  async stop(): Promise<void> { this.on = false; await this.loop; }
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

interface Fixture { file: string; format: string; durationS: number; channels: number; sampleRate: number; bytes: number; encoder: string }

async function measure(fx: Fixture, baseURL: string): Promise<Record<string, unknown>> {
  const server = await chromium.launchServer({ channel: 'chrome', headless: true });
  const pid = server.process().pid;
  if (!pid) throw new Error('no browser pid');
  const browser = await chromium.connect(server.wsEndpoint());
  const out: Record<string, unknown> = { name: basename(fx.file), ...fx, chrome: browser.version() };
  const t0 = performance.now();
  const sampler = new Sampler(pid, t0);
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('crash', () => errors.push('page crashed'));
    await page.goto(`${baseURL}/spike/m2-file.html`);
    await page.waitForFunction(() => (window as unknown as { __spikeReady: () => boolean }).__spikeReady());
    await page.waitForLoadState('networkidle');
    sampler.start();
    await sleep(SETTLE_MS + BASELINE_MS);
    const tLoad = performance.now() - t0;
    const base = sampler.samples.filter((s) => s.t >= tLoad - BASELINE_MS && s.t < tLoad);
    const settle = sampler.samples.filter((s) => s.t < tLoad - BASELINE_MS);
    await page.setInputFiles('#file', resolve(fx.file));
    const res = await page.evaluate(() => (window as unknown as { __spikeRun: () => Promise<unknown> }).__spikeRun());
    const tDone = performance.now() - t0;
    await sleep(TAIL_MS);
    await sampler.stop();
    const after = sampler.samples.filter((s) => s.t >= tLoad);
    // The page renderer is the renderer whose RSS peaked highest during the run (one page is open;
    // Chrome may also keep a spare renderer).
    const rendererPids = [...new Set(after.flatMap((s) => s.procs.filter((p) => p.kind === 'renderer').map((p) => p.pid)))];
    const peakOf = (pidX: number, ss: Sample[]) => Math.max(0, ...ss.map((s) => s.procs.find((p) => p.pid === pidX)?.rss ?? 0));
    const rPid = rendererPids.sort((a, b) => peakOf(b, after) - peakOf(a, after))[0];
    const rssOf = (s: Sample) => s.procs.find((p) => p.pid === rPid)?.rss ?? 0;
    const rBase = mean(base.map(rssOf));
    const treeBase = mean(base.map((s) => s.tree));
    const rPeak = Math.max(...after.map(rssOf));
    const treePeak = Math.max(...after.map((s) => s.tree));
    const intervals = after.slice(1).map((s, i) => s.t - after[i].t);
    const atDone = after.reduce((best, s) => (Math.abs(s.t - tDone) < Math.abs(best.t - tDone) ? s : best), after[0]);
    const peakByKind: Record<string, number> = {};
    for (const s of after) for (const p of s.procs) peakByKind[`${p.kind}`] = Math.max(peakByKind[p.kind] ?? 0, p.rss);
    Object.assign(out, {
      ok: true,
      result: res,
      memory: {
        rendererPid: rPid,
        rendererBaselineBytes: Math.round(rBase),
        rendererPeakBytes: rPeak,
        rendererPeakMinusBaselineBytes: Math.round(rPeak - rBase),
        rendererAtDoneBytes: rssOf(atDone),
        treeBaselineBytes: Math.round(treeBase),
        treePeakBytes: treePeak,
        treePeakMinusBaselineBytes: Math.round(treePeak - treeBase),
        treeProcessCountAtPeak: after.find((s) => s.tree === treePeak)?.procs.length,
        peakRssByProcessKind: peakByKind,
        baselineSamples: base.length,
        settleSamplesTreeMB: settle.map((s) => +(s.tree / MB).toFixed(1)),
        runSamples: after.length,
        meanSampleIntervalMs: +mean(intervals).toFixed(1),
        maxSampleIntervalMs: +Math.max(...intervals).toFixed(1),
        timelineMs_treeMB_rendererMB: after.map((s) => [Math.round(s.t - tLoad), +(s.tree / MB).toFixed(1), +(rssOf(s) / MB).toFixed(1)]),
      },
    });
    await page.evaluate(() => (window as unknown as { __spikeRelease: () => Promise<unknown> }).__spikeRelease());
  } catch (err) {
    await sampler.stop();
    Object.assign(out, { ok: false, error: String(err), samples: sampler.samples.length });
  }
  if (errors.length) out.pageErrors = errors;
  await browser.close().catch(() => {});
  await server.close();
  return out;
}

function tryCmd(cmd: string, args: string[]): string | null {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return null; }
}

const filter = process.argv[2] ?? '';
const manifest = JSON.parse(readFileSync('fixtures/spike/manifest.json', 'utf8')) as { seed: number; files: Fixture[]; skipped: unknown[] };
const fixtures = manifest.files.filter((f) => basename(f.file).includes(filter));

const vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: PORT, strictPort: true }, logLevel: 'warn' });
await vite.listen();
const baseURL = `http://127.0.0.1:${PORT}`;
const runs: Record<string, unknown>[] = [];
try {
  for (const fx of fixtures) {
    process.stdout.write(`${basename(fx.file)} ... `);
    const r = await measure(fx, baseURL);
    runs.push(r);
    const w = r.result as { decodeMs: number; worker: { analysisMs: number } } | undefined;
    const m = r.memory as { rendererPeakBytes: number; treePeakBytes: number } | undefined;
    console.log(r.ok && w && m
      ? `decode ${w.decodeMs.toFixed(0)} ms, analysis ${(w.worker.analysisMs / 1000).toFixed(2)} s, renderer peak ${(m.rendererPeakBytes / MB).toFixed(0)} MB, tree peak ${(m.treePeakBytes / MB).toFixed(0)} MB`
      : `FAILED: ${String(r.error)}`);
  }
} finally {
  await vite.close();
}

const pwVersion = (JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')) as { version: string }).version;
const report = {
  spec: 'specs/M2.md 4.5 (M2.1 task 1, measurement spike)',
  generatedAt: new Date().toISOString(),
  command: `node tools/spike_m2_run.ts${filter ? ` ${filter}` : ''}`,
  browser: { name: 'Google Chrome (installed, Playwright channel "chrome")', version: (runs[0]?.chrome as string) ?? null, headless: true, playwright: pwVersion },
  machine: {
    cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length, ramBytes: os.totalmem(),
    os: `macOS ${tryCmd('sw_vers', ['-productVersion']) ?? '?'} (Darwin ${os.release()})`, arch: os.arch(),
    hwModel: tryCmd('sysctl', ['-n', 'hw.model']), node: process.version,
  },
  methods: {
    fixtures: `tools/spike_m2_fixtures.ts, seed ${manifest.seed}: synthetic harmonic tone, 5.5 Hz vibrato, note changes, unvoiced gaps with noise; stereo right channel differs (harmonic weights, gain, noise, 0.4 ms delay). Encoder per file in runs[].encoder.`,
    fileInput: 'Playwright setInputFiles on <input type=file>, then File.arrayBuffer() in the page.',
    decode: 'decodeAudioData on an OfflineAudioContext(1, 1, 48000). decodeMs = decodeAudioData call only; readMs = File.arrayBuffer().',
    transfer: 'AudioBuffer.getChannelData arrays posted to a module Worker as transferables (copy fallback reported in result.transferMode).',
    mix: 'In the Worker: arithmetic mean of all channels per sample into a Float64Array (as tools/wav.ts). Timed separately as worker.mixMs.',
    analysis: 'In the Worker: new FrameAnalyzer({ sampleRate }).run(mono, true) then decodeAll(frames, { lag: Infinity }), the cont path of tools/run_ts.ts. analysisMs = run + decodeAll (same span run_ts.ts times). realTimeFactor = audio seconds / analysis seconds.',
    retained: 'After analysis the Worker keeps the mono mix, frames and decoded path alive until the tail of sampling ends, as a result screen would.',
    memory: `ps RSS of the launched Chrome process tree (descendants of the launchServer PID), sampled at about ${INTERVAL_MS} ms (start to start; slower when ps itself takes longer, see memory.meanSampleIntervalMs). Baseline = mean over ${BASELINE_MS} ms with the page loaded and the Worker started, after a ${SETTLE_MS} ms settle, before the file is set. Peak over the run plus ${TAIL_MS} ms tail. Renderer = the renderer process with the highest peak (hosts the page and its Worker).`,
    memoryCaveats: [
      'RSS is resident pages only. On macOS, memory that is compressed or swapped is not in RSS, and shared pages are counted in every process that maps them, so the tree sum can double-count shared memory. Activity Monitor shows phys_footprint, which can differ.',
      'Sampling at about 50 ms (see meanSampleIntervalMs and maxSampleIntervalMs per run) can miss short spikes between samples.',
      'Garbage collection timing changes the peak: freed buffers may stay resident until the next GC.',
      'Headless Chrome on an otherwise busy machine; a headed tab adds compositor and GPU memory not measured here.',
      'One run per file per invocation. Compare separate invocations for run-to-run variance.',
    ],
    budgets: { peakTabMemoryBytes: BUDGET_MEM_BYTES, analysisMs: BUDGET_ANALYSIS_MS, note: 'Placeholders from specs/M2.md 4.5 (OPEN Q2). Memory fit judged on the renderer peak RSS; the tree peak is shown too.' },
  },
  skippedFixtures: manifest.skipped,
  runs,
};
mkdirSync('results', { recursive: true });
writeFileSync('results/m2_spike.json', JSON.stringify(report, null, 1));

const yes = (b: boolean) => (b ? 'yes' : 'NO');
const rows = runs.map((r) => {
  if (!r.ok) return `| ${String(r.name)} | FAILED: ${String(r.error).split('\n')[0]} | | | | | | | | |`;
  const w = r.result as { readMs: number; decodeMs: number; transferMode: string; worker: { mixMs: number; analysisMs: number; samples: number } };
  const m = r.memory as { rendererPeakBytes: number; rendererPeakMinusBaselineBytes: number; treePeakBytes: number; treePeakMinusBaselineBytes: number };
  const audioS = w.worker.samples / 48000;
  const rtf = audioS / (w.worker.analysisMs / 1000);
  const memOk = m.rendererPeakBytes < BUDGET_MEM_BYTES, treeOk = m.treePeakBytes < BUDGET_MEM_BYTES;
  const timeOk = w.worker.analysisMs < BUDGET_ANALYSIS_MS;
  return `| ${String(r.name)} | ${(Number(r.bytes) / MB).toFixed(1)} | ${w.decodeMs.toFixed(0)} | ${w.worker.mixMs.toFixed(0)} | ${(w.worker.analysisMs / 1000).toFixed(2)} | ${rtf.toFixed(1)} | ${(m.rendererPeakBytes / MB).toFixed(0)} (+${(m.rendererPeakMinusBaselineBytes / MB).toFixed(0)}) | ${(m.treePeakBytes / MB).toFixed(0)} (+${(m.treePeakMinusBaselineBytes / MB).toFixed(0)}) | ${yes(memOk)}${memOk && !treeOk ? ' (tree: NO)' : ''} | ${yes(timeOk)} |`;
});
const r0 = runs.find((r) => r.ok)?.result as { transferMode?: string } | undefined;
const md = `# M2.1 measurement spike (specs/M2.md 4.5)

Generated by \`${report.command}\` at ${report.generatedAt}. Numbers are copied from \`results/m2_spike.json\` by the runner, not by hand. One run per file.

- Browser: ${report.browser.name} ${report.browser.version}, headless, Playwright ${pwVersion}
- Machine: ${report.machine.cpu} (${report.machine.hwModel ?? 'model unknown'}), ${report.machine.logicalCores} cores, ${(os.totalmem() / 2 ** 30).toFixed(0)} GiB RAM, ${report.machine.os}
- Decode: \`decodeAudioData\` on \`OfflineAudioContext(1, 1, 48000)\`. Transfer to Worker: ${r0?.transferMode ?? 'n/a'}.
- Analysis: \`FrameAnalyzer.run(mono, true)\` then \`decodeAll(frames, { lag: Infinity })\` in a module Worker, timed as one span. RTF = audio seconds / analysis seconds.
- Memory: \`ps\` RSS sampled about every ${INTERVAL_MS} ms. "Renderer" is the page's renderer process (page plus Worker); "tree" is every process under the launched Chrome. Shown as peak (+ peak minus idle baseline), MB = 10^6 bytes.
- Budgets (placeholders, OPEN Q2): peak tab memory under 1 GB (taken as 10^9 bytes, judged on the renderer peak), analysis under 60 s.

| File | Size MB | Decode ms | Mix ms | Analysis s | RTF | Renderer peak MB (+delta) | Tree peak MB (+delta) | Memory fits | Analysis fits |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Skipped fixtures: ${manifest.skipped.length ? JSON.stringify(manifest.skipped) : 'none'}.

Caveats on memory: ${report.methods.memoryCaveats.join(' ')}
`;
writeFileSync('results/m2_spike.md', md);
console.log('wrote results/m2_spike.json and results/m2_spike.md');
