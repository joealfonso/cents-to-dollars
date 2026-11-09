// Whole-take analysis of a mono signal (specs/M2.md 4.2 items 5 and 6, 4.4). Shared by the browser Worker
// and the Node runner (tools/run_ts.ts take), so it stays free of DOM and Node APIs (F-29).
//
// Pitch is exactly the `cont` path of `tools/run_ts.ts track`: FrameAnalyzer frames every hop from sample 0
// (the same loop as FrameAnalyzer.run, with spectrum and candidates on), decoded by the continuity tracker
// with lag Infinity. decodeAll(frames, { lag: Infinity }) is a loop of ContinuityTracker.push over the frames
// followed by flush; this module runs that same loop as frames are produced, so the decoded F0 is identical
// while only the current voiced run's candidates are held, not every frame of the take.
//
// Spectrum: FrameAnalyzer.analyzeAt computes the frame's power spectrum into analyzer.spec.power (for the
// band energies) and leaves it there; bins 0 to floor(4000 N / fs) are copied from it, so there is no
// second FFT pass and src/dsp is unchanged. All per-frame output is in flat typed arrays.
//
// Vibrato over time (MEASUREMENT.md new section 12): spans of VIB_WINDOW_S starting every VIB_STEP_S, each
// passed to analyzeVibrato unchanged. No averaging across spans.

import { FrameAnalyzer } from '../dsp/analyzer.ts';
import { ContinuityTracker } from '../dsp/continuity.ts';
import { analyzeVibrato, type ContourFrame } from '../dsp/vibrato.ts';
import { TakeError } from './errors.ts';

export const VIB_WINDOW_S = 2.5;
export const VIB_STEP_S = 0.5;
export const SPECTRUM_MAX_HZ = 4000;

export type TakeStatus = 'ok' | 'too-short' | 'no-pitch';
export interface VibratoWindow { t0: number; t1: number; rateHz: number | null; extentCents: number | null }
export interface TakeResult {
  status: TakeStatus;
  sampleRate: number; hop: number; frameCount: number;
  t: Float64Array; start: Float64Array; voiced: Uint8Array;
  f0: Float64Array;
  aperiodicity: Float32Array; rmsDb: Float32Array; eSf: Float32Array; eRef: Float32Array;
  specBins: number; spectrum: Float32Array;
  vibrato: VibratoWindow[];
}
export interface AnalyseOptions { onProgress?: (fraction: number) => void; shouldStop?: () => boolean }

/** Share of the progress range given to the frame loop; the rest covers the vibrato spans. */
const FRAMES_SHARE = 0.97;
const STOP_CHECK_FRAMES = 256;

/**
 * Progress values are non-decreasing and stay below 1: completion is signalled by the return value,
 * so a caller can keep 100% for its Done state (F-18).
 */
export function analyseTake(mono: Float64Array, sampleRate: number, opts: AnalyseOptions = {}): TakeResult {
  const { onProgress, shouldStop } = opts;
  const an = new FrameAnalyzer({ sampleRate });
  const N = an.N, hop = an.hop;
  const frameCount = mono.length >= N ? Math.floor((mono.length - N) / hop) + 1 : 0;
  // Bins 0 .. floor(4000 N / fs), clamped to the N/2 + 1 bins a real FFT has: below 8 kHz the Nyquist
  // frequency is under 4 kHz, so the spectrum then stops at fs / 2 (only the Node runner can get there; the
  // browser path analyses at 44.1 or 48 kHz).
  const specBins = Math.min(N / 2 + 1, Math.floor((SPECTRUM_MAX_HZ * N) / sampleRate) + 1);

  const t = new Float64Array(frameCount);
  const start = new Float64Array(frameCount);
  const voiced = new Uint8Array(frameCount);
  const f0 = new Float64Array(frameCount);
  const aperiodicity = new Float32Array(frameCount);
  const rmsDb = new Float32Array(frameCount);
  const eSf = new Float32Array(frameCount);
  const eRef = new Float32Array(frameCount);
  const spectrum = new Float32Array(frameCount * specBins);

  const ct = new ContinuityTracker<number>({ lag: Infinity });
  const progressEvery = Math.max(1, Math.floor(frameCount / 200));
  let last = -1;
  const report = (p: number) => {
    if (onProgress && p > last) { last = p; onProgress(p); }
  };
  report(0);

  const power = an.spec.power;
  for (let i = 0, s = 0; i < frameCount; i++, s += hop) {
    if (shouldStop && i % STOP_CHECK_FRAMES === 0 && shouldStop()) throw new TakeError('cancelled', 'analysis stopped');
    const fr = an.analyzeAt(mono, s, s, true, true);
    t[i] = fr.t;
    start[i] = fr.start;
    voiced[i] = fr.voiced ? 1 : 0;
    aperiodicity[i] = fr.aperiodicity;
    rmsDb[i] = fr.rmsDb;
    eSf[i] = fr.eSf;
    eRef[i] = fr.eRef;
    const row = i * specBins;
    for (let k = 0; k < specBins; k++) spectrum[row + k] = power[k];
    for (const d of ct.push(fr, i)) f0[d.frame] = d.f0;
    if (i % progressEvery === 0) report((FRAMES_SHARE * i) / frameCount);
  }
  for (const d of ct.flush()) f0[d.frame] = d.f0;

  let anyPitch = false;
  for (let i = 0; i < frameCount && !anyPitch; i++) anyPitch = f0[i] > 0;
  const status: TakeStatus = frameCount === 0 ? 'too-short' : anyPitch ? 'ok' : 'no-pitch';

  report(FRAMES_SHARE);
  const vibrato = status === 'ok' ? vibratoSpans(t, f0, mono.length / sampleRate, shouldStop) : [];
  report(0.99);

  return { status, sampleRate, hop, frameCount, t, start, voiced, f0, aperiodicity, rmsDb, eSf, eRef, specBins, spectrum, vibrato };
}

/**
 * Spans [t0, t0 + VIB_WINDOW_S) with t0 = k VIB_STEP_S, for every span that ends within the take.
 * A span holds the contiguous frames from the first with t >= t0 up to (not including) the first after it
 * with t >= t1. (Frame times are not strictly increasing, since each frame's time includes its own lag.)
 */
export function vibratoSpans(t: Float64Array, f0: Float64Array, durationS: number, shouldStop?: () => boolean): VibratoWindow[] {
  const n = t.length;
  const contour: ContourFrame[] = new Array(n);
  for (let i = 0; i < n; i++) contour[i] = { t: t[i], f0: f0[i] };
  const out: VibratoWindow[] = [];
  let a = 0;
  for (let k = 0; ; k++) {
    const t0 = k * VIB_STEP_S;
    const t1 = t0 + VIB_WINDOW_S;
    if (t1 > durationS + 1e-9) break;
    if (shouldStop && shouldStop()) throw new TakeError('cancelled', 'analysis stopped');
    while (a < n && t[a] < t0) a++;
    let b = a;
    while (b < n && t[b] < t1) b++;
    const v = b > a ? analyzeVibrato(contour.slice(a, b)) : null;
    out.push({ t0, t1, rateHz: v ? v.rateHz : null, extentCents: v ? v.extentCents : null });
  }
  return out;
}

/** Every typed-array buffer in the result, for transfer to another thread (each array owns its buffer). */
export function takeTransferables(r: TakeResult): ArrayBuffer[] {
  const arrays = [r.t, r.start, r.voiced, r.f0, r.aperiodicity, r.rmsDb, r.eSf, r.eRef, r.spectrum];
  const set = new Set<ArrayBuffer>();
  for (const x of arrays) set.add(x.buffer as ArrayBuffer);
  return [...set];
}
