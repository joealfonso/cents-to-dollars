// M1.1 tuning on Vocadito. dev = tracks 1-20 (choose parameters here), test = 21-40 (evaluate once).
//   node tools/continuity_sweep.ts <dev|test|all> '<json list of configs>'
// Prints per config: RPA vs annotation, octave-error frames (up/down), agreement with Praat within 10 c.
import { readFileSync } from 'node:fs';
import { readWav } from './wav.ts';
import { FrameAnalyzer, type Frame } from '../src/dsp/analyzer.ts';
import { decodeAll, type ContinuityConfig } from '../src/dsp/continuity.ts';

const [split, cfgJson] = process.argv.slice(2);
const configs: (Partial<ContinuityConfig> | null)[] = JSON.parse(cfgJson);
const ids = Array.from({ length: 40 }, (_, i) => i + 1).filter((i) => (split === 'dev' ? i <= 20 : split === 'test' ? i > 20 : true));
const data = ids.map((i) => {
  const w = readWav(`datasets/vocadito/Audio/vocadito_${i}.wav`);
  const frames = new FrameAnalyzer({ sampleRate: w.sampleRate }).run(w.samples, false);
  const ref = readFileSync(`datasets/vocadito/Annotations/F0/vocadito_${i}_f0.csv`, 'utf8').trim().split('\n').map((l) => l.split(',').map(Number));
  const pr = JSON.parse(readFileSync(`results/vocadito/praat/vocadito_${i}.json`, 'utf8'));
  return { i, frames, ref, pt: pr.t as number[], pf: pr.f0 as number[] };
});

function nearest(ts: number[], t: number, j: number): number {
  while (j + 1 < ts.length && Math.abs(ts[j + 1] - t) <= Math.abs(ts[j] - t)) j++;
  return j;
}

for (const cfg of configs) {
  let refV = 0, hit = 0, up = 0, down = 0, joint = 0, w10 = 0;
  const perTrack: string[] = [];
  for (const d of data) {
    const f0 = cfg ? decodeAll<Frame>(d.frames, cfg).map((x) => x.f0) : d.frames.map((x) => (x.voiced ? x.f0 : 0));
    const t = d.frames.map((x) => x.t);
    let j = 0, tUp = 0, tDown = 0;
    for (let k = 0; k < t.length; k++) {
      j = nearest(d.ref.map((r) => r[0]), t[k], j);
      const rf = d.ref[j][1];
      if (rf > 0) {
        refV++;
        if (f0[k] > 0) {
          const e = 1200 * Math.log2(f0[k] / rf);
          if (Math.abs(e) <= 50) hit++;
          if (e > 600) { up++; tUp++; }
          if (e < -600) { down++; tDown++; }
        }
      }
    }
    // Praat agreement: same rule as py/score.py (nearest tracker frame within 3 ms, both voiced).
    let a = 0;
    for (let k = 0; k < d.pt.length; k++) {
      a = nearest(t, d.pt[k], a);
      if (Math.abs(t[a] - d.pt[k]) > 0.003 || !(d.pf[k] > 0) || !(f0[a] > 0)) continue;
      joint++;
      if (Math.abs(1200 * Math.log2(f0[a] / d.pf[k])) <= 10) w10++;
    }
    if (tUp + tDown > 20) perTrack.push(`${d.i}:+${tUp}/-${tDown}`);
  }
  console.log(`${split} ${JSON.stringify(cfg)} RPA=${(hit / refV).toFixed(4)} octUp=${up} octDown=${down} praat10=${(w10 / joint).toFixed(4)} [${perTrack.join(' ')}]`);
}
