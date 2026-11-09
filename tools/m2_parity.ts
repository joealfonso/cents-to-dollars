// M2.1 parity, Node side (specs/M2.md 4.6 F-01 to F-03, V-01). Run by validate.sh after the `track` step.
//   node tools/m2_parity.ts            -> results/m2_parity.json (score.py copies it to summary.json m2.parity)
//
// V-01 set: fixtures/synthetic/manifest.json "v01_parity" (first file of each M1 tone and vibrato set plus
// every fmt_* format variant) and five Vocadito tracks: 2, 21, 30, 34 (named in the spec) and 37, the clean
// one (highest whole-take Raw Pitch Accuracy of the 40 tracks, 0.990, and continuity still changes 14 of
// its frames, so the decoder is exercised).
//
// Runner side, two references:
//  - "runner": the calls `run_ts.ts track <file> <out> cont` makes, in this process and unrounded:
//    readWav (tools/wav.ts), FrameAnalyzer.run(samples, true), decodeAll(frames, { lag: Infinity }).
//    Gives start and plain-YIN voiced per frame, which the track JSON does not store.
//  - "track JSON": the file that `run_ts.ts track ... cont` wrote earlier in validate.sh (results/ts/ or
//    results/vocadito/ts/): frame count, t (6 decimals) and f0 (5 decimals, at most about 2e-4 c of rounding).
// Module side: parseWav (src/take/wav.ts) then analyseTake (src/take/analyse.ts).
// Every check is exact except F-03's tolerance of 0.001 c; failures are counted, never tolerated.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readWav } from './wav.ts';
import { FrameAnalyzer } from '../src/dsp/analyzer.ts';
import { decodeAll } from '../src/dsp/continuity.ts';
import { parseWav } from '../src/take/wav.ts';
import { analyseTake } from '../src/take/analyse.ts';

const TOL_CENTS = 0.001;
const VOCADITO = [2, 21, 30, 34, 37].map((n) => `vocadito_${n}`);
const CLEAN = 'vocadito_37';

const man = JSON.parse(readFileSync('fixtures/synthetic/manifest.json', 'utf8')) as { v01_parity: string[]; entries: { id: string; file: string }[] };
const byId = new Map(man.entries.map((e) => [e.id, e]));
const files: { name: string; path: string; json: string }[] = [
  ...man.v01_parity.map((id) => ({ name: id, path: join('fixtures/synthetic', byId.get(id)!.file), json: join('results/ts', `${id}.json`) })),
  ...VOCADITO.map((n) => ({ name: n, path: join('datasets/vocadito/Audio', `${n}.wav`), json: join('results/vocadito/ts', `${n}.json`) })),
];

const cents = (a: number, b: number) => Math.abs(1200 * Math.log2(a / b));

interface Row {
  name: string; sampleRate: number; channels: number; samples: number;
  f01: { pass: boolean; rateMatch: boolean; channelsMatch: boolean; lengthMatch: boolean; sampleMismatches: number };
  f02: { pass: boolean; frames: number; runnerFrames: number; trackJsonFrames: number | null; startMismatches: number; voicedMismatches: number; tMismatchesVsTrackJson: number | null };
  f03: { pass: boolean; voicedFrames: number; outsideTol: number; voicingMismatches: number; maxAbsCents: number; exactEqual: number;
    vsTrackJson: { outsideTol: number; voicingMismatches: number; maxAbsCents: number } | null };
}

const rows: Row[] = [];
for (const f of files) {
  const ref = readWav(f.path);
  const mine = parseWav(readFileSync(f.path));
  let sampleMismatches = 0;
  const n = Math.min(ref.samples.length, mine.samples.length);
  for (let i = 0; i < n; i++) if (!Object.is(ref.samples[i], mine.samples[i])) sampleMismatches++;
  const f01 = {
    rateMatch: ref.sampleRate === mine.sampleRate, channelsMatch: ref.channels === mine.channels,
    lengthMatch: ref.samples.length === mine.samples.length, sampleMismatches,
  };

  // Runner, exactly the cont path of run_ts.ts track.
  const an = new FrameAnalyzer({ sampleRate: ref.sampleRate });
  const frames = an.run(ref.samples, true);
  const rf0 = decodeAll(frames, { lag: Infinity }).map((d) => d.f0);
  const track = existsSync(f.json) ? (JSON.parse(readFileSync(f.json, 'utf8')) as { t: number[]; f0: number[] }) : null;

  const r = analyseTake(mine.samples, mine.sampleRate);
  let startMis = 0, voicedMis = 0, tMis = 0;
  const m = Math.min(r.frameCount, frames.length);
  for (let i = 0; i < m; i++) {
    if (r.start[i] !== frames[i].start) startMis++;
    if ((r.voiced[i] === 1) !== frames[i].voiced) voicedMis++;
    if (track && i < track.t.length && +r.t[i].toFixed(6) !== track.t[i]) tMis++;
  }
  const f02 = {
    frames: r.frameCount, runnerFrames: frames.length, trackJsonFrames: track ? track.f0.length : null,
    startMismatches: startMis, voicedMismatches: voicedMis, tMismatchesVsTrackJson: track ? tMis : null,
  };

  const cmp = (other: ArrayLike<number>) => {
    let voiced = 0, outside = 0, vmis = 0, maxC = 0, exact = 0;
    const k = Math.min(r.frameCount, other.length);
    for (let i = 0; i < k; i++) {
      const a = r.f0[i], b = other[i];
      if (a === 0 && b === 0) continue;
      voiced++;
      if (a === 0 || b === 0) { vmis++; continue; }
      const c = cents(a, b);
      if (c > maxC) maxC = c;
      if (c > TOL_CENTS) outside++;
      if (a === b) exact++;
    }
    return { voiced, outside, vmis, maxC, exact };
  };
  const vr = cmp(rf0);
  const vj = track ? cmp(track.f0) : null;
  const f03 = {
    voicedFrames: vr.voiced, outsideTol: vr.outside, voicingMismatches: vr.vmis, maxAbsCents: vr.maxC, exactEqual: vr.exact,
    vsTrackJson: vj ? { outsideTol: vj.outside, voicingMismatches: vj.vmis, maxAbsCents: vj.maxC } : null,
  };
  rows.push({
    name: f.name, sampleRate: mine.sampleRate, channels: mine.channels, samples: mine.samples.length,
    f01: { pass: f01.rateMatch && f01.channelsMatch && f01.lengthMatch && sampleMismatches === 0, ...f01 },
    f02: {
      pass: r.frameCount === frames.length && f02.trackJsonFrames === frames.length && startMis === 0 && voicedMis === 0 && tMis === 0,
      ...f02,
    },
    f03: { pass: vr.outside === 0 && vr.vmis === 0 && !!vj && vj.outside === 0 && vj.vmis === 0, ...f03 },
  });
  process.stdout.write('.');
}
process.stdout.write('\n');

const sum = (k: (r: Row) => number) => rows.reduce((s, r) => s + k(r), 0);
const failing = (c: 'f01' | 'f02' | 'f03') => rows.filter((r) => !r[c].pass).map((r) => r.name);
const out = {
  spec: 'specs/M2.md 4.6 F-01 to F-03, 4.7 V-01',
  generatedAt: new Date().toISOString(),
  set: { files: rows.length, synthetic: man.v01_parity.length, vocadito: VOCADITO, vocaditoClean: CLEAN,
    vocaditoCleanReason: 'highest whole-take Raw Pitch Accuracy of the 40 Vocadito tracks (0.990); continuity changes 14 of its frames' },
  toleranceCents: TOL_CENTS,
  f01: { files: rows.length, failingFiles: failing('f01'), sampleMismatches: sum((r) => r.f01.sampleMismatches),
    samplesCompared: sum((r) => r.samples), verdict: failing('f01').length ? 'fail' : 'pass' },
  f02: { files: rows.length, failingFiles: failing('f02'), frames: sum((r) => r.f02.frames),
    startMismatches: sum((r) => r.f02.startMismatches), voicedMismatches: sum((r) => r.f02.voicedMismatches),
    tMismatchesVsTrackJson: sum((r) => r.f02.tMismatchesVsTrackJson ?? 0), verdict: failing('f02').length ? 'fail' : 'pass' },
  f03: { files: rows.length, failingFiles: failing('f03'), voicedFrames: sum((r) => r.f03.voicedFrames),
    framesOutsideTol: sum((r) => r.f03.outsideTol), voicingMismatches: sum((r) => r.f03.voicingMismatches),
    maxAbsCents: Math.max(...rows.map((r) => r.f03.maxAbsCents)), exactEqualFrames: sum((r) => r.f03.exactEqual),
    vsTrackJson: { framesOutsideTol: sum((r) => r.f03.vsTrackJson?.outsideTol ?? 0), voicingMismatches: sum((r) => r.f03.vsTrackJson?.voicingMismatches ?? 0),
      maxAbsCents: Math.max(...rows.map((r) => r.f03.vsTrackJson?.maxAbsCents ?? 0)), missingTrackJson: rows.filter((r) => !r.f03.vsTrackJson).map((r) => r.name) },
    verdict: failing('f03').length ? 'fail' : 'pass' },
  perFile: rows,
};
writeFileSync('results/m2_parity.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ files: rows.length, f01: out.f01.verdict, f02: out.f02.verdict, f03: out.f03.verdict,
  f03MaxAbsCents: out.f03.maxAbsCents, f03Outside: out.f03.framesOutsideTol, f03ExactEqual: `${out.f03.exactEqualFrames}/${out.f03.voicedFrames}` }));
