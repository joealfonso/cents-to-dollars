// M2.1 measurement spike (specs/M2.md 4.5), step 1: fixtures.
//   node tools/spike_m2_fixtures.ts
// Writes fixtures/spike/ (gitignored): synthetic sung-like takes of 60, 300 and 600 s at 48 kHz,
// mono and stereo, as 16-bit PCM WAV, MP3 (lame) and M4A/AAC (afconvert), plus manifest.json.
// A missing encoder is recorded in the manifest as skipped, never faked.
// Signal: harmonic tone (10 partials) with 5.5 Hz vibrato, a new note every 1.2 to 3 s, gaps of
// 0.15 to 0.6 s holding breath noise (unvoiced), short consonant-like noise bursts. Seeded PRNG,
// so every run writes the same samples. Stereo: the right channel has its own harmonic weights,
// gain, noise and a 0.4 ms delay, so the two channels differ.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SR = 48000;
const DURATIONS = [60, 300, 600];
const SEED = 20261108;
const OUT = 'fixtures/spike';

function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Seg { start: number; end: number; f0: number; voiced: boolean }

function plan(totalS: number, rnd: () => number): Seg[] {
  const notes = [196, 220, 246.94, 261.63, 293.66, 329.63, 349.23, 392, 440, 493.88];
  const segs: Seg[] = [];
  let t = 0.3;
  while (t < totalS) {
    const dur = 1.2 + rnd() * 1.8;
    segs.push({ start: t, end: Math.min(totalS, t + dur), f0: notes[Math.floor(rnd() * notes.length)], voiced: true });
    t += dur + 0.15 + rnd() * 0.45;
  }
  return segs;
}

function render(totalS: number, segs: Seg[], harm: number[], gain: number, delayS: number, noiseSeed: number): Float32Array {
  const n = Math.round(totalS * SR);
  const x = new Float32Array(n);
  const rnd = mulberry32(noiseSeed);
  // Breath noise everywhere (about -50 dBFS), louder in gaps.
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * 0.003;
  for (const s of segs) {
    const i0 = Math.max(0, Math.round((s.start + delayS) * SR));
    const i1 = Math.min(n, Math.round((s.end + delayS) * SR));
    // Consonant-like noise burst of 40 ms just before the note.
    for (let i = Math.max(0, i0 - 1920); i < i0; i++) x[i] += (rnd() * 2 - 1) * 0.05;
    const phases = new Float64Array(harm.length);
    const vibPhase0 = rnd() * 2 * Math.PI;
    for (let i = i0; i < i1; i++) {
      const tt = (i - i0) / SR;
      const onset = Math.min(1, tt / 0.6); // vibrato grows in over 0.6 s
      const cents = 50 * onset * Math.sin(2 * Math.PI * 5.5 * tt + vibPhase0);
      const f = s.f0 * Math.pow(2, cents / 1200);
      const env = Math.min(1, (i - i0) / 960, (i1 - i) / 960); // 20 ms attack and release
      let v = 0;
      for (let k = 0; k < harm.length; k++) {
        const fk = f * (k + 1);
        if (fk >= SR / 2) break;
        phases[k] += (2 * Math.PI * fk) / SR;
        if (phases[k] > 2 * Math.PI) phases[k] -= 2 * Math.PI;
        v += harm[k] * Math.sin(phases[k]);
      }
      x[i] += gain * env * v;
    }
  }
  return x;
}

function writeWav16(path: string, chans: Float32Array[], n: number): void {
  const ch = chans.length;
  const b = Buffer.alloc(44 + n * ch * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * ch * 2, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    b.writeInt16LE(Math.round(v * 32767), o); o += 2;
  }
  writeFileSync(path, b);
}

function has(bin: string): boolean {
  try { execFileSync('/usr/bin/which', [bin], { stdio: 'ignore' }); return true; } catch { return false; }
}

mkdirSync(OUT, { recursive: true });
const maxS = Math.max(...DURATIONS);
const segs = plan(maxS, mulberry32(SEED));
const hL = [1, 0.7, 0.5, 0.35, 0.3, 0.2, 0.12, 0.08, 0.05, 0.03];
const hR = [0.8, 0.9, 0.3, 0.45, 0.15, 0.25, 0.06, 0.1, 0.03, 0.04];
const L = render(maxS, segs, hL.map((v) => v * 0.25), 1, 0, SEED + 1);
const R = render(maxS, segs, hR.map((v) => v * 0.25), 0.7, 0.0004, SEED + 2);

const lame = has('lame'), afconvert = has('afconvert');
const files: Record<string, unknown>[] = [];
const skipped: Record<string, unknown>[] = [];
for (const d of DURATIONS) {
  const n = d * SR;
  for (const ch of [1, 2]) {
    const base = `syn_${d}s_${ch === 1 ? 'mono' : 'stereo'}`;
    const wav = join(OUT, `${base}.wav`);
    writeWav16(wav, ch === 1 ? [L] : [L, R], n);
    files.push({ file: wav, format: 'wav', durationS: d, channels: ch, sampleRate: SR, bytes: statSync(wav).size, encoder: '16-bit PCM, written by tools/spike_m2_fixtures.ts' });
    const mp3 = join(OUT, `${base}.mp3`);
    if (lame) {
      const a = ['--quiet', '-b', '192', '-m', ch === 1 ? 'm' : 'j', wav, mp3];
      execFileSync('lame', a);
      files.push({ file: mp3, format: 'mp3', durationS: d, channels: ch, sampleRate: SR, bytes: statSync(mp3).size, encoder: `lame ${a.join(' ')}` });
    } else skipped.push({ file: mp3, reason: 'lame not found' });
    const m4a = join(OUT, `${base}.m4a`);
    if (afconvert) {
      const a = ['-f', 'm4af', '-d', 'aac ', '-b', ch === 1 ? '128000' : '192000', wav, m4a];
      execFileSync('afconvert', a);
      files.push({ file: m4a, format: 'm4a', durationS: d, channels: ch, sampleRate: SR, bytes: statSync(m4a).size, encoder: `afconvert ${a.join(' ')}` });
    } else skipped.push({ file: m4a, reason: 'afconvert not found' });
    console.log(`wrote ${base}.*`);
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ seed: SEED, sampleRate: SR, notes: segs.length, files, skipped }, null, 2));
console.log(JSON.stringify({ files: files.length, skipped }));
