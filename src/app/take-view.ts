// Pure helpers for the take figure stack and Recording analysis (M2-DESIGN.md 2.1 to 2.3, 3.2 to 3.4).
// No DOM, so Node tests can import them.

import { MINUS } from './readout.ts';

/** FILE_VIEW_DEFAULT_S (M2-DESIGN.md 3.4, D5): the default visible span. Display choice, value OPEN (D5),
 *  not validated. 20 s is 2.5 s doubled three times, so the zoom steps land on the narrowest span. */
export const FILE_VIEW_DEFAULT_S = 20;

/** A pointer drag longer than this many CSS px is a span selection (M2-DESIGN.md 2.2), not a click. */
export const DRAG_PX = 4;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "m:ss.ss" for durations (file strip, 3.2). */
export function fmtDuration(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  const m = Math.floor(cs / 6000);
  const rest = cs - m * 6000;
  return `${m}:${pad2(Math.floor(rest / 100))}.${pad2(rest % 100)}`;
}

/** "m:ss.s" for the time axis and the view bar (2.1). */
export function fmtClock(s: number): string {
  const ds = Math.max(0, Math.round(s * 10));
  const m = Math.floor(ds / 600);
  const rest = ds - m * 600;
  return `${m}:${pad2(Math.floor(rest / 10))}.${rest % 10}`;
}

/** A limit in seconds as words: 600 -> "10 minutes", 90 -> "1 minute 30 seconds", 45 -> "45 seconds". */
export function fmtLimit(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  const mins = m ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '';
  const secs = r ? `${r} ${r === 1 ? 'second' : 'seconds'}` : '';
  return [mins, secs].filter(Boolean).join(' ') || '0 seconds';
}

/** Bytes as decimal megabytes with `d` decimals, rounded down so a limit is never overstated. */
export function fmtMB(bytes: number, d = 0): string {
  const f = 10 ** d;
  return (Math.floor((bytes / 1e6) * f) / f).toFixed(d);
}

/** Signed fixed decimals with a real minus sign. */
export const fx = (x: number, d: number) => x.toFixed(d).replace(/^-/, MINUS);

/** "1 cent", "12 cents". */
export const centsWord = (n: number) => `${n} ${n === 1 ? 'cent' : 'cents'}`;

/**
 * Index of the frame whose time is nearest x. Frame times are not strictly increasing (each includes its own
 * YIN lag, src/take/analyse.ts), but every frame's time lies within N / 2 samples of its buffer's middle, so
 * the search scans the hops around the estimate from `start`.
 */
export function frameNear(t: ArrayLike<number>, x: number, sampleRate: number, hop: number, N: number): number {
  const n = t.length;
  if (!n) return -1;
  const guess = Math.round((x * sampleRate - N / 2) / hop);
  const reach = Math.ceil(N / 2 / hop) + 1;
  const lo = Math.max(0, Math.min(n - 1, guess - reach)), hi = Math.max(0, Math.min(n - 1, guess + reach));
  let best = lo, bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const d = Math.abs(t[i] - x);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export interface Span { v0: number; v1: number }

/** Smallest visible span: one vibrato window, or the whole take when it is shorter. */
export const minSpan = (duration: number, vibWindowS: number) => Math.min(duration, vibWindowS);

/** 3.4: the whole take if it is at most `defaultS`, else `defaultS` from the first voiced frame. */
export function defaultSpan(duration: number, firstVoicedT: number | null, defaultS = FILE_VIEW_DEFAULT_S): Span {
  if (duration <= defaultS) return { v0: 0, v1: duration };
  return clampSpan(firstVoicedT ?? 0, (firstVoicedT ?? 0) + defaultS, duration);
}

/** Keeps the span length (up to the duration) and moves it inside [0, duration]. */
export function clampSpan(v0: number, v1: number, duration: number): Span {
  const len = Math.min(duration, Math.max(0, v1 - v0));
  let a = v0;
  if (a + len > duration) a = duration - len;
  if (a < 0) a = 0;
  return { v0: a, v1: a + len };
}

/** Halves (factor 0.5) or doubles (2) the span around `center`, between minLen and the whole take. */
export function zoomSpan(s: Span, factor: number, center: number, duration: number, minLen: number): Span {
  const len = s.v1 - s.v0;
  const next = Math.max(minLen, Math.min(duration, len * factor));
  const frac = len > 0 ? Math.max(0, Math.min(1, (center - s.v0) / len)) : 0.5;
  const v0 = center - frac * next;
  return clampSpan(v0, v0 + next, duration);
}

/** Moves the span so that t is inside it, with t at the edge it crossed (2.2). Unchanged if t is visible. */
export function panToInclude(s: Span, t: number, duration: number): Span {
  const len = s.v1 - s.v0;
  if (t < s.v0) return clampSpan(t, t + len, duration);
  if (t > s.v1) return clampSpan(t - len, t, duration);
  return s;
}

/** Cents from the nearest equal-tempered note, in [-50, +50), from cents above A4 (centsSeries). NaN stays NaN. */
export function deviationOf(centsAboveA4: number): number {
  if (!Number.isFinite(centsAboveA4)) return NaN;
  let d = centsAboveA4 - 100 * Math.round(centsAboveA4 / 100);
  if (d >= 50) d -= 100;
  if (d < -50) d += 100;
  return d;
}

/**
 * Pitch axis (2.1 Fig. 1): semitones relative to A4 that cover every voiced F0 of the take, padded by one
 * semitone each side and widened to at least `minSemis`, so an octave slip stretches the axis and stays visible.
 * Returns null when no frame is voiced.
 */
export function pitchAxis(f0: ArrayLike<number>, a4: number, minSemis = 6): { lo: number; hi: number } | null {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < f0.length; i++) {
    const f = f0[i];
    if (f > 0) { if (f < min) min = f; if (f > max) max = f; }
  }
  if (!(min <= max)) return null;
  let lo = Math.floor(12 * Math.log2(min / a4)) - 1;
  let hi = Math.ceil(12 * Math.log2(max / a4)) + 1;
  while (hi - lo < minSemis) { lo--; if (hi - lo < minSemis) hi++; }
  return { lo, hi };
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Note name of the semitone `s` above A4 ("A4" for 0, "C5" for 3). */
export function semitoneName(s: number): { name: string; natural: boolean } {
  const midi = 69 + s;
  const pc = ((midi % 12) + 12) % 12;
  return { name: `${NAMES[pc]}${Math.floor(midi / 12) - 1}`, natural: !NAMES[pc].includes('#') };
}

/** Tick values from a 1, 2, 5 series that cover [a, b] with roughly `count` steps. */
export function niceTicks(a: number, b: number, count: number): number[] {
  if (!(b > a)) return [a];
  const raw = (b - a) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Time-axis tick step in seconds, from 0.1 s up to minutes, for about `count` ticks across `len` seconds. */
export function timeStep(len: number, count: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const raw = len / Math.max(1, count);
  return steps.find((s) => s >= raw) ?? 600;
}

export interface WindowLike { t0: number; t1: number }
/**
 * Readings at cursor, vibrato (3.2): among the windows that contain t, the one whose middle is nearest t.
 * -1 when no window covers t.
 */
export function windowAt(windows: readonly WindowLike[], t: number): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (t < w.t0 || t > w.t1) continue;
    const d = Math.abs((w.t0 + w.t1) / 2 - t);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
