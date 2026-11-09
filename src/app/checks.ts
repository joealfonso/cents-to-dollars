// The Methods checks (DESIGN.md 3.4, 6.4, 7.5): calibration, loopback latency and the offline self-test.
// The math and the constants are copied from src/testpage/main.ts, which keeps its own copy for #/legacy;
// keep the two in step until #/legacy is removed.
//
// No DOM and no static import of src/audio/capture.ts, so Node tests can import this module. The runners take
// their audio pieces as arguments: `live` (src/app/live.ts), a requestAnimationFrame, and a fixture renderer.
// Each runner takes an AbortSignal and settles with an outcome; it never throws.
// - Calibration: the 5 s wait races the signal. On abort: cancelled, no numbers.
// - Loopback: the signal is checked before each tone, and an abort mid-tone stops the oscillator and removes
//   the waiter.
// - Self-test: checked between files only. An offline render cannot be stopped, so the file in flight finishes
//   and is discarded.
// A runner that started the microphone stops it when it settles, whatever the outcome.

import type { Live, LiveErrorKind } from './live.ts';
import type { LiveSession } from '../audio/capture.ts';
import type { WorkletFrame } from '../audio/tracker.worklet.ts';
import type { FixtureEntry } from '../audio/offline.ts';
import { centsBetween } from '../dsp/pitch.ts';
import { analyzeVibrato } from '../dsp/vibrato.ts';

// ---------------------------------------------------------------- constants (from the legacy main.ts)
export const CAL_MS = 5000;
export const CAL_MIN_FRAMES = 50;
export const CAL_HZ_MIN = 60;
export const CAL_HZ_MAX = 2000;
export const CAL_DEFAULT_HZ = 440;

export const LOOP_TONES = 10;
export const LOOP_HZ = 440;
export const LOOP_GAIN = 0.3;
/** Each tone is scheduled this far ahead of the context clock, and lasts this long. */
export const LOOP_LEAD_S = 0.3;
export const LOOP_TONE_S = 0.4;
export const LOOP_TIMEOUT_MS = 1500;
export const LOOP_GAP_MS = 600;
/** A frame counts as the tone when it is within this many cents of LOOP_HZ. */
export const LOOP_MATCH_CENTS = 50;

/** Steady-tone frames this close to either end of a file are skipped (fades). */
export const SELF_EDGE_S = 0.07;
/** An error above this many cents counts as an octave error. */
export const SELF_OCTAVE_CENTS = 600;
/** The latency fixture is a 440 Hz onset; its first frame within SELF_LAT_MATCH_CENTS counts. */
export const SELF_LAT_HZ = 440;
export const SELF_LAT_MATCH_CENTS = 50;
export const SELF_TONE_SETS = ['tone_sine_48k', 'tone_sine_44k'] as const;
export const SELF_VIB_SET = 'vib_sine_48k';
export const SELF_LAT_SET = 'latency';
export const SET_LABEL: Record<string, string> = {
  tone_sine_48k: 'Steady tones, 48 kHz',
  tone_sine_44k: 'Steady tones, 44.1 kHz',
  vib_sine_48k: 'Tones with vibrato',
  latency: 'Reaction time',
};

// ---------------------------------------------------------------- outcomes
export type Outcome<R> =
  | { kind: 'done'; result: R }
  /** Ran, but there is nothing to report (for example too few voiced frames). */
  | { kind: 'warning'; message: string }
  | { kind: 'cancelled' }
  /** The microphone did not start, or was lost while the check ran. */
  | { kind: 'mic'; error: LiveErrorKind; detail: string }
  | { kind: 'error'; reason: 'fixtures' | 'criteria' | 'other'; detail: string };

const CANCELLED = { kind: 'cancelled' } as const;

function describe(e: unknown): string {
  try { return String(e); } catch { return 'Unknown error'; }
}

/** Resolves true after `ms`, or false as soon as the signal aborts. */
export function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => { clearTimeout(timer); resolve(false); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The value of `p`, or ABORTED as soon as the signal aborts (p keeps running; live.stop() handles a late session). */
const ABORTED: unique symbol = Symbol('aborted');
function race<T>(p: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

function micOutcome(live: Live): Outcome<never> {
  const s = live.snapshot();
  return { kind: 'mic', error: s.error ?? 'ended', detail: s.detail };
}

/**
 * Opens the mic for a check, unless a session is already open (then it is used and left open).
 * Returns the session and whether this check opened it, ABORTED, or null when the start failed.
 */
async function openMic(live: Live, owner: 'calibration' | 'latency', signal: AbortSignal): Promise<{ s: LiveSession | null | typeof ABORTED; mine: boolean }> {
  const mine = live.status !== 'listening' && live.status !== 'requesting';
  const s = await race(live.start({ owner }), signal);
  return { s, mine };
}

async function closeMic(live: Live, mine: boolean) {
  if (!mine) return;
  await live.stop();
  live.reset();
}

// ---------------------------------------------------------------- calibration
export interface CalibrationResult {
  refHz: number;
  medianHz: number;
  /** Voiced frames in the 5 s window. */
  count: number;
  offsetCents: number;
  /** 95th percentile of |cents from the median| over those frames. */
  p95Cents: number;
  sampleRate: number;
}

/** "440", " 442.5 ", "442,5" to a number in 60..2000 Hz, else null. */
export function parseCalHz(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v >= CAL_HZ_MIN && v <= CAL_HZ_MAX ? v : null;
}

/** The legacy calibration math: median voiced F0, offset from the reference, P95 spread. Null below the frame minimum. */
export function calibrationStats(f0s: number[], refHz: number): Omit<CalibrationResult, 'sampleRate'> | { tooFew: number } {
  const f = f0s.filter((x) => x > 0).sort((a, b) => a - b);
  if (f.length < CAL_MIN_FRAMES) return { tooFew: f.length };
  const med = f[f.length >> 1];
  const c = f.map((x) => Math.abs(centsBetween(x, med))).sort((a, b) => a - b);
  return { refHz, medianHz: med, count: f.length, offsetCents: centsBetween(med, refHz), p95Cents: c[Math.floor(0.95 * c.length)] };
}

export async function runCalibration(opts: {
  live: Live;
  signal: AbortSignal;
  refHz: number;
  /** Whole seconds left, called once a second from CAL_MS / 1000 down to 1. */
  onProgress?: (secondsLeft: number) => void;
}): Promise<Outcome<CalibrationResult>> {
  const { live, signal, refHz } = opts;
  let mine = false;
  try {
    const open = await openMic(live, 'calibration', signal);
    mine = open.mine;
    if (open.s === ABORTED) return CANCELLED;
    const s = open.s;
    if (!s) return micOutcome(live);

    const t0 = s.ctx.currentTime;
    const f0s: number[] = [];
    const off = live.onFrame((f) => { if (f.voiced && f.f0 > 0 && f.t >= t0) f0s.push(f.f0); });
    try {
      const end = Date.now() + CAL_MS;
      for (;;) {
        const left = end - Date.now();
        if (left <= 0) break;
        opts.onProgress?.(Math.ceil(left / 1000));
        const step = left % 1000 || 1000;
        if (!(await wait(step, signal))) return CANCELLED;
        if (live.session !== s) return micOutcome(live);
      }
    } finally { off(); }

    const st = calibrationStats(f0s, refHz);
    if ('tooFew' in st) {
      return { kind: 'warning', message: `Too few voiced frames (${st.tooFew} of ${CAL_MIN_FRAMES} needed). Check that the reference is playing and loud enough.` };
    }
    return { kind: 'done', result: { ...st, sampleRate: s.ctx.sampleRate } };
  } catch (e) {
    return { kind: 'error', reason: 'other', detail: describe(e) };
  } finally {
    await closeMic(live, mine);
  }
}

// ---------------------------------------------------------------- loopback latency
export interface LoopbackResult {
  detected: number;
  of: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  sampleRate: number;
  /** Seconds, or undefined when the browser does not report it. */
  baseLatency: number | undefined;
  outputLatency: number | undefined;
}

/** Median (upper middle, as on the legacy page), min and max of the delays. */
export function loopbackStats(ms: number[]): { medianMs: number; minMs: number; maxMs: number } | null {
  if (!ms.length) return null;
  const s = [...ms].sort((a, b) => a - b);
  return { medianMs: s[s.length >> 1], minMs: s[0], maxMs: s[s.length - 1] };
}

export async function runLoopback(opts: {
  live: Live;
  signal: AbortSignal;
  /** 1-based tone number, before each tone. */
  onProgress?: (tone: number, of: number) => void;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
}): Promise<Outcome<LoopbackResult>> {
  const { live, signal } = opts;
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
  let mine = false;
  try {
    const open = await openMic(live, 'latency', signal);
    mine = open.mine;
    if (open.s === ABORTED) return CANCELLED;
    const s = open.s;
    if (!s) return micOutcome(live);
    const ctx = s.ctx;

    // Frames are handed to the waiter on the next animation frame, timed with the rAF timestamp: the time the
    // pitch would be drawn (MEASUREMENT.md, Loopback latency). The queue is capped while the tab is hidden.
    let undrawn: WorkletFrame[] = [];
    let waiter: ((f: WorkletFrame, drawnAt: number) => void) | null = null;
    const off = live.onFrame((f) => { undrawn.push(f); if (undrawn.length > 1000) undrawn.splice(0, undrawn.length - 1000); });
    let rafId = 0;
    const tick = (ts: number) => {
      rafId = raf(tick);
      const frames = undrawn;
      undrawn = [];
      for (const f of frames) waiter?.(f, ts);
    };
    rafId = raf(tick);

    const delays: number[] = [];
    let untimed = 0;
    try {
      for (let i = 0; i < LOOP_TONES; i++) {
        if (signal.aborted) return CANCELLED;
        if (live.session !== s) return micOutcome(live);
        opts.onProgress?.(i + 1, LOOP_TONES);
        const T = ctx.currentTime + LOOP_LEAD_S;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.frequency.value = LOOP_HZ;
        amp.gain.value = LOOP_GAIN;
        osc.connect(amp).connect(ctx.destination);
        osc.start(T);
        osc.stop(T + LOOP_TONE_S);
        const ts = ctx.getOutputTimestamp();
        // A zero or non-finite performanceTime means the browser has no output timing yet (Safari, a context that
        // has not started). The delay would be measured from the epoch, so this tone is skipped, not guessed.
        const usable = Number.isFinite(ts.performanceTime) && (ts.performanceTime as number) > 0;
        // performance-clock time at which sample T reaches the output device
        const outPerf = usable ? (ts.performanceTime as number) + (T - (ts.contextTime ?? 0)) * 1000 : 0;
        const silence = () => { try { osc.stop(); } catch { /* already stopped */ } try { osc.disconnect(); amp.disconnect(); } catch { /* gone */ } };

        const drawn = await new Promise<number | null | typeof ABORTED>((resolve) => {
          const done = (v: number | null | typeof ABORTED) => {
            clearTimeout(timer);
            waiter = null;
            signal.removeEventListener('abort', onAbort);
            resolve(v);
          };
          const onAbort = () => done(ABORTED);
          const timer = setTimeout(() => done(null), LOOP_TIMEOUT_MS);
          waiter = (f, drawnAt) => {
            if (f.voiced && Math.abs(centsBetween(f.f0, LOOP_HZ)) < LOOP_MATCH_CENTS && f.readyAt / ctx.sampleRate > T) done(drawnAt);
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
        if (drawn === ABORTED) { silence(); return CANCELLED; }
        if (!usable) untimed++;
        else if (drawn !== null && drawn - outPerf >= 0) delays.push(drawn - outPerf);
        if (!(await wait(LOOP_GAP_MS, signal))) { silence(); return CANCELLED; }
      }
    } finally {
      caf(rafId);
      waiter = null;
      off();
    }

    // The mic can end during the last tone; do not report a median for a session that is gone.
    if (live.session !== s) return micOutcome(live);
    if (untimed === LOOP_TONES) return { kind: 'warning', message: 'This browser did not report output timing, so latency could not be measured.' };
    const st = loopbackStats(delays);
    if (!st) return { kind: 'warning', message: 'No tone was heard. Turn the speaker volume up a little and try again.' };
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    return {
      kind: 'done',
      result: { detected: delays.length, of: LOOP_TONES, ...st, sampleRate: ctx.sampleRate, baseLatency: num(ctx.baseLatency), outputLatency: num(ctx.outputLatency) },
    };
  } catch (e) {
    return { kind: 'error', reason: 'other', detail: describe(e) };
  } finally {
    await closeMic(live, mine);
  }
}

// ---------------------------------------------------------------- self-test criteria (7.4)
export interface Thresholds {
  /** cents */ tone_median: number;
  /** cents */ tone_p95: number;
  /** count */ tone_octave: number;
  /** Hz */ vib_rate: number;
  /** fraction */ vib_extent_rel: number;
}
export const THRESHOLD_KEYS = ['tone_median', 'tone_p95', 'tone_octave', 'vib_rate', 'vib_extent_rel'] as const;

/** The thresholds if every expected key is a finite number, else null (no verdicts are shown then). */
export function validateThresholds(raw: unknown): Thresholds | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<Thresholds> = {};
  for (const k of THRESHOLD_KEYS) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out as Thresholds;
}

// ---------------------------------------------------------------- self-test
export interface ToneSetReport { frames: number; voiced: number; median: number; p95: number; max: number; octave: number }
export interface VibratoReport { cases: number; worstRateErrHz: number; worstExtentRelErr: number; failing: number }
/** Same shape as the legacy page's window.__selfTest, so automation reads either. */
export interface SelfTestReport {
  tone_sine_48k: ToneSetReport;
  tone_sine_44k: ToneSetReport;
  vibrato: VibratoReport;
  algorithmicLatencyMs: number;
  userAgent: string;
}
export type Verdict = 'pass' | 'fail';
export interface SelfTestResult {
  report: SelfTestReport;
  verdicts: { tone_sine_48k: Verdict; tone_sine_44k: Verdict; vibrato: Verdict };
}

export function truthAt(e: FixtureEntry, t: number): number {
  return e.extent === 0 ? e.f0 : e.f0 * Math.pow(2, (e.extent / 1200) * Math.sin(2 * Math.PI * e.rate * t));
}

export function pct(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** Pass when every number is within its threshold. A missing number (no voiced frames) fails. */
export function toneVerdict(r: ToneSetReport, th: Thresholds): Verdict {
  return r.median <= th.tone_median && r.p95 <= th.tone_p95 && r.octave <= th.tone_octave ? 'pass' : 'fail';
}

export function vibratoVerdict(r: VibratoReport): Verdict {
  return r.cases > 0 && r.failing === 0 ? 'pass' : 'fail';
}

export async function runSelfTest(opts: {
  signal: AbortSignal;
  thresholds: Thresholds | null;
  loadManifest: () => Promise<FixtureEntry[]>;
  render: (e: FixtureEntry) => Promise<WorkletFrame[]>;
  /** Before each file: 1-based file number, total files, and the set label. */
  onProgress?: (file: number, total: number, label: string) => void;
  userAgent?: string;
}): Promise<Outcome<SelfTestResult>> {
  const { signal, thresholds: th } = opts;
  if (!th) return { kind: 'error', reason: 'criteria', detail: 'One or more of tone_median, tone_p95, tone_octave, vib_rate, vib_extent_rel is missing or not a number.' };
  try {
    if (signal.aborted) return CANCELLED;
    const entries = await opts.loadManifest();
    const tones = SELF_TONE_SETS.map((set) => entries.filter((x) => x.set === set));
    const vib = entries.filter((x) => x.set === SELF_VIB_SET);
    const lat = entries.find((x) => x.set === SELF_LAT_SET);
    if (tones.some((f) => !f.length) || !vib.length || !lat || lat.onset_sample === undefined) {
      return { kind: 'error', reason: 'fixtures', detail: 'manifest.json is missing one of the sets tone_sine_48k, tone_sine_44k, vib_sine_48k, latency.' };
    }
    const total = tones.reduce((n, f) => n + f.length, 0) + vib.length + 1;
    let n = 0;
    /** Renders one file, or returns null if the run was cancelled before it started or while it rendered. */
    const next = async (e: FixtureEntry): Promise<WorkletFrame[] | null> => {
      if (signal.aborted) return null;
      opts.onProgress?.(++n, total, SET_LABEL[e.set] ?? e.set);
      const frames = await opts.render(e);
      return signal.aborted ? null : frames; // the file in flight finishes and is discarded
    };

    const toneReports: ToneSetReport[] = [];
    for (const files of tones) {
      const errs: number[] = [];
      let frames = 0;
      for (const e of files) {
        const fr = await next(e);
        if (!fr) return CANCELLED;
        for (const f of fr) {
          if (f.t < SELF_EDGE_S || f.t > e.dur - SELF_EDGE_S) continue;
          frames++;
          if (f.voiced) errs.push(Math.abs(centsBetween(f.f0, truthAt(e, f.t))));
        }
      }
      toneReports.push({ frames, voiced: errs.length, median: pct(errs, 0.5), p95: pct(errs, 0.95), max: Math.max(...errs), octave: errs.filter((x) => x > SELF_OCTAVE_CENTS).length });
    }

    let worstRate = 0, worstExt = 0, fails = 0;
    for (const e of vib) {
      const fr = await next(e);
      if (!fr) return CANCELLED;
      const v = analyzeVibrato(fr.map((f) => ({ t: f.t, f0: f.voiced ? f.f0 : 0 })));
      if (!v) { fails++; continue; }
      const re = Math.abs(v.rateHz - e.rate), ee = Math.abs(v.extentCents - e.extent) / e.extent;
      worstRate = Math.max(worstRate, re); worstExt = Math.max(worstExt, ee);
      if (re > th.vib_rate || ee > th.vib_extent_rel) fails++;
    }

    const lf = await next(lat);
    if (!lf) return CANCELLED;
    const onset = lat.onset_sample;
    const first = lf.find((f) => f.voiced && Math.abs(centsBetween(f.f0, SELF_LAT_HZ)) <= SELF_LAT_MATCH_CENTS && f.readyAt > onset);
    const latMs = first ? ((first.readyAt - onset) / lat.sr) * 1000 : NaN;

    const report: SelfTestReport = {
      tone_sine_48k: toneReports[0],
      tone_sine_44k: toneReports[1],
      vibrato: { cases: vib.length, worstRateErrHz: worstRate, worstExtentRelErr: worstExt, failing: fails },
      algorithmicLatencyMs: latMs,
      userAgent: opts.userAgent ?? '',
    };
    return {
      kind: 'done',
      result: {
        report,
        verdicts: { tone_sine_48k: toneVerdict(report.tone_sine_48k, th), tone_sine_44k: toneVerdict(report.tone_sine_44k, th), vibrato: vibratoVerdict(report.vibrato) },
      },
    };
  } catch (e) {
    if (signal.aborted) return CANCELLED; // an aborted fetch or render is a cancel, not a missing file
    const missing = (e as { name?: unknown } | null)?.name === 'FixtureMissingError';
    return { kind: 'error', reason: missing ? 'fixtures' : 'other', detail: describe(e) };
  }
}
