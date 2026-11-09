// Offline runner for the browser tracker code.
//   node tools/run_ts.ts track <in.wav|dir> <out_dir> [yin|cont]   -> <out_dir>/<name>.json frames
//     yin  = plain YIN threshold pick (the M1 tracker; what the live view shows)
//     cont = YIN + continuity over the whole take (default; post-take analysis)
//   node tools/run_ts.ts vibrato <frames.json> [...]        -> prints vibrato JSON per file
//   node tools/run_ts.ts take <in.wav|dir> <out_dir>         -> <out_dir>/<name>.json (V-02): the shared take module
//     (src/take: parseWav then analyseTake), with per-frame t, start, voiced, f0, aperiodicity and the vibrato spans
// Frames JSON format (shared with py/reference.py): { method, sampleRate, hop, t: [], f0: [] } with f0 = 0 when unvoiced.

import { readdirSync, statSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readWav } from './wav.ts';
import { FrameAnalyzer } from '../src/dsp/analyzer.ts';
import { analyzeVibrato } from '../src/dsp/vibrato.ts';
import { decodeAll } from '../src/dsp/continuity.ts';
import { parseWav } from '../src/take/wav.ts';
import { analyseTake } from '../src/take/analyse.ts';

const [cmd, ...args] = process.argv.slice(2);

function listWavs(p: string): string[] {
  if (statSync(p).isDirectory()) {
    return readdirSync(p, { recursive: true })
      .map(String)
      .filter((f) => f.toLowerCase().endsWith('.wav'))
      .map((f) => join(p, f))
      .sort();
  }
  return [p];
}

if (cmd === 'track') {
  const [input, outDir, mode = 'cont'] = args;
  if (!['yin', 'cont'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  mkdirSync(outDir, { recursive: true });
  let totalAudio = 0, totalMs = 0;
  for (const f of listWavs(input)) {
    const wav = readWav(f);
    const an = new FrameAnalyzer({ sampleRate: wav.sampleRate });
    const t0 = performance.now();
    const frames = an.run(wav.samples, true);
    const f0 = mode === 'yin' ? frames.map((x) => (x.voiced ? x.f0 : 0)) : decodeAll(frames, { lag: Infinity }).map((d) => d.f0);
    totalMs += performance.now() - t0;
    totalAudio += wav.samples.length / wav.sampleRate;
    let eSf = 0, eRef = 0;
    for (const fr of frames) if (fr.voiced) { eSf += fr.eSf; eRef += fr.eRef; }
    const out = {
      method: `ts-${mode}`,
      file: f,
      sampleRate: wav.sampleRate,
      hop: an.hop,
      t: frames.map((x) => +x.t.toFixed(6)),
      f0: f0.map((v) => +v.toFixed(5)),
      aperiodicity: frames.map((x) => +x.aperiodicity.toFixed(4)),
      sfRatioDb: eSf > 0 && eRef > 0 ? 10 * Math.log10(eSf / eRef) : null,
    };
    writeFileSync(join(outDir, basename(f).replace(/\.wav$/i, '.json')), JSON.stringify(out));
  }
  console.log(JSON.stringify({ audioSeconds: +totalAudio.toFixed(2), computeMs: +totalMs.toFixed(1), realtimeFactor: +(totalAudio * 1000 / totalMs).toFixed(1) }));
} else if (cmd === 'vibrato') {
  const res: Record<string, unknown> = {};
  for (const p of args) {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const frames = j.t.map((t: number, i: number) => ({ t, f0: j.f0[i] }));
    res[p] = analyzeVibrato(frames);
  }
  console.log(JSON.stringify(res));
} else if (cmd === 'take') {
  const [input, outDir] = args;
  if (!input || !outDir) throw new Error('usage: node tools/run_ts.ts take <wav|dir> <out_dir>');
  mkdirSync(outDir, { recursive: true });
  let totalAudio = 0, totalMs = 0;
  const errors: { file: string; code: string; message: string }[] = [];
  for (const f of listWavs(input)) {
    let wav: ReturnType<typeof parseWav>, r: ReturnType<typeof analyseTake>, t0: number;
    try {
      wav = parseWav(readFileSync(f));
      t0 = performance.now();
      r = analyseTake(wav.samples, wav.sampleRate);
    } catch (err) {
      // One bad or too-long file is recorded and skipped; the rest of the directory still runs.
      const e = { file: f, code: (err as { code?: string }).code ?? 'error', message: String(err) };
      errors.push(e);
      writeFileSync(join(outDir, basename(f).replace(/\.wav$/i, '.json')), JSON.stringify({ method: 'ts-take', file: f, error: e }));
      continue;
    }
    totalMs += performance.now() - t0;
    totalAudio += wav.samples.length / wav.sampleRate;
    const out = {
      method: 'ts-take',
      file: f,
      status: r.status,
      sampleRate: r.sampleRate,
      channels: wav.channels,
      hop: r.hop,
      frameCount: r.frameCount,
      durationS: wav.samples.length / wav.sampleRate,
      t: Array.from(r.t, (x) => +x.toFixed(6)),
      start: Array.from(r.start),
      voiced: Array.from(r.voiced),
      f0: Array.from(r.f0, (v) => +v.toFixed(5)),
      aperiodicity: Array.from(r.aperiodicity, (x) => +x.toFixed(4)),
      vibrato: r.vibrato,
    };
    writeFileSync(join(outDir, basename(f).replace(/\.wav$/i, '.json')), JSON.stringify(out));
  }
  console.log(JSON.stringify({ audioSeconds: +totalAudio.toFixed(2), computeMs: +totalMs.toFixed(1), realtimeFactor: +(totalAudio * 1000 / totalMs).toFixed(1), errors }));
} else {
  console.error('usage: node tools/run_ts.ts track <wav|dir> <outdir> | vibrato <frames.json...> | take <wav|dir> <outdir>');
  process.exit(2);
}
