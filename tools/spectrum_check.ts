// Spectrogram correctness on steady sine fixtures: peak frequency (parabolic interpolation) and
// peak level in dBFS against the known frequency and amplitude. Writes results/spectrum_check.json.
//   node tools/spectrum_check.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { readWav } from './wav.ts';
import { Spectrum } from '../src/dsp/spectrum.ts';

const man = JSON.parse(readFileSync('fixtures/synthetic/manifest.json', 'utf8'));
const rows: unknown[] = [];
for (const e of man.entries) {
  if (e.set !== 'tone_sine_48k' && e.set !== 'tone_sine_44k') continue;
  const wav = readWav(`fixtures/synthetic/${e.file}`);
  const spec = new Spectrum(2048, wav.sampleRate);
  const mid = Math.floor(wav.samples.length / 2) - 1024;
  spec.compute(wav.samples, mid);
  const peak = spec.peakHz(50, 4000);
  const k = Math.round((peak * 2048) / wav.sampleRate);
  let best = k;
  for (const j of [k - 1, k + 1]) if (spec.power[j] > spec.power[best]) best = j;
  rows.push({
    id: e.id,
    f0: e.f0,
    peakHz: peak,
    errCents: 1200 * Math.log2(peak / e.f0),
    peakDbfs: spec.dbfs(best),
    expectedDbfs: 20 * Math.log10(man.amp),
  });
}
writeFileSync('results/spectrum_check.json', JSON.stringify(rows));
console.log(`spectrum_check: ${rows.length} tones`);
