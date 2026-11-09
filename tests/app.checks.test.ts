// Methods check logic (src/app/checks.ts) from DESIGN.md 3.4, 2.12, 6.4 to 6.8, 7.4 and the legacy page
// (src/testpage/main.ts). Hand-written stubs, no DOM, no microphone, no real 5 s waits (mock timers).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calibrationStats, validateThresholds, runSelfTest, runCalibration, runLoopback, loopbackStats, toneVerdict,
  type Thresholds, type ToneSetReport,
} from '../src/app/checks.ts';
import type { FixtureEntry } from '../src/audio/offline.ts';

// src/audio/offline.ts cannot load in Node (it imports capture.ts, which uses a Vite ?worker&url import), so the
// error is stubbed by name and message, the way offline.ts defines it. checks.ts identifies it by name.
class FixtureMissingError extends Error {
  constructor(what: string) { super(`Not found: /fixtures/synthetic/${what}`); this.name = 'FixtureMissingError'; }
}

const summary = JSON.parse(readFileSync(new URL('../results/summary.json', import.meta.url), 'utf8'));
const TH = validateThresholds(summary.thresholds) as Thresholds;
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// ---------------------------------------------------------------- calibrationStats
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
type Stats = { medianHz: number; count: number; offsetCents: number; p95Cents: number; refHz: number };

test('calibrationStats: 442 Hz against a 440 Hz reference reads about +7.85 cents', () => {
  const st = calibrationStats(Array(60).fill(442), 440) as Stats;
  assert.equal(st.medianHz, 442);
  assert.equal(st.count, 60);
  assert.equal(st.refHz, 440);
  assert.ok(Math.abs(st.offsetCents - 7.8514) < 0.001, String(st.offsetCents));
  assert.equal(st.p95Cents, 0);
});

test('calibrationStats: 440 Hz against a 442 Hz reference reads about -7.85 cents', () => {
  const st = calibrationStats(Array(60).fill(440), 442) as Stats;
  assert.ok(Math.abs(st.offsetCents + 7.8514) < 0.001, String(st.offsetCents));
});

test('calibrationStats: exact match is 0 cents', () => {
  const st = calibrationStats(Array(50).fill(440), 440) as Stats;
  assert.equal(st.offsetCents, 0);
});

test('calibrationStats: median ignores outliers and unvoiced (0) readings', () => {
  const st = calibrationStats([...Array(45).fill(440), 1000, 1000, 1000, 20, 30, ...Array(8).fill(0)], 440) as Stats;
  assert.equal(st.count, 50);
  assert.equal(st.medianHz, 440);
});

test('calibrationStats: zeros are not counted, so 50 voiced plus zeros still passes and 49 plus zeros does not', () => {
  const ok = calibrationStats([...Array(50).fill(440), ...Array(100).fill(0)], 440) as Stats;
  assert.equal(ok.count, 50);
  const few = calibrationStats([...Array(49).fill(440), ...Array(100).fill(0)], 440);
  assert.deepEqual(few, { tooFew: 49 });
});

test('calibrationStats: minimum is 50 voiced frames (49 is too few, 50 is enough)', () => {
  assert.deepEqual(calibrationStats(Array(49).fill(440), 440), { tooFew: 49 });
  assert.ok(!('tooFew' in calibrationStats(Array(50).fill(440), 440)));
  assert.deepEqual(calibrationStats([], 440), { tooFew: 0 });
});

test('calibrationStats: median is the upper middle (legacy f[len >> 1]) for an even count', () => {
  const st = calibrationStats([...Array(25).fill(440), ...Array(25).fill(442)], 440) as Stats;
  assert.equal(st.medianHz, 442);
});

test('calibrationStats: P95 is the legacy 95th percentile of |cents from the median|', () => {
  // 100 frames, sorted devs: index floor(.95*100)=95. With 4 outliers index 95 is still a zero.
  const st = calibrationStats([...Array(96).fill(440), ...Array(4).fill(450)], 440) as Stats;
  assert.equal(st.p95Cents, 0);
  const full = calibrationStats([...Array(95).fill(440), ...Array(5).fill(450)], 440) as Stats;
  assert.ok(Math.abs(full.p95Cents - Math.abs(cents(450, 440))) < 1e-9);
  // 3 outliers of 100: index 95 is zero
  const st4 = calibrationStats([...Array(97).fill(440), ...Array(3).fill(450)], 440) as Stats;
  assert.equal(st4.p95Cents, 0);
});

// ---------------------------------------------------------------- calibration time window (runCalibration)
function fakeLive(opts: { t0: number; sr?: number } = { t0: 10 }) {
  let cb: ((f: unknown) => void) | null = null;
  let stops = 0;
  const session = { ctx: { currentTime: opts.t0, sampleRate: opts.sr ?? 48000 } };
  const l = {
    status: 'idle' as string,
    session: null as unknown,
    stopCalls: () => stops,
    emit: (f: unknown) => cb?.(f),
    start: async (_o: unknown) => { l.status = 'listening'; l.session = session; return session; },
    stop: async () => { stops++; l.status = 'stopped'; l.session = null; },
    reset: () => { l.status = 'idle'; },
    onFrame: (c: (f: unknown) => void) => { cb = c; return () => { cb = null; }; },
    snapshot: () => ({ status: l.status, error: null, detail: '', owner: null, session: l.session }),
  };
  return l;
}
const fr = (t: number, f0: number, voiced = true) => ({ t, f0, voiced });

test('runCalibration: only frames at or after the session start time count (the time window)', async () => {
  const live = fakeLive({ t0: 10 });
  const ac = new AbortController();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let out;
  try {
    const p = runCalibration({ live: live as never, signal: ac.signal, refHz: 440 });
    await flush();
    for (let i = 0; i < 60; i++) live.emit(fr(9.9, 300));        // before the window: ignored
    for (let i = 0; i < 49; i++) live.emit(fr(10 + i * 0.01, 440)); // 49 inside
    live.emit(fr(10, 440));                                       // exactly at the start counts: 50
    for (let i = 0; i < 5; i++) { await flush(); mock.timers.tick(1000); }
    await flush();
    out = await p;
  } finally { mock.timers.reset(); }
  assert.equal(out.kind, 'done');
  if (out.kind === 'done') {
    assert.equal(out.result.count, 50);
    assert.equal(out.result.medianHz, 440);
    assert.equal(out.result.sampleRate, 48000);
  }
});

test('runCalibration: 49 voiced frames in the window gives a warning naming 49 of 50, no numbers', async () => {
  const live = fakeLive({ t0: 0 });
  const ac = new AbortController();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let out;
  try {
    const p = runCalibration({ live: live as never, signal: ac.signal, refHz: 440 });
    await flush();
    for (let i = 0; i < 49; i++) live.emit(fr(1 + i * 0.01, 440));
    for (let i = 0; i < 100; i++) live.emit(fr(2, 0, false)); // unvoiced never count
    for (let i = 0; i < 5; i++) { await flush(); mock.timers.tick(1000); }
    await flush();
    out = await p;
  } finally { mock.timers.reset(); }
  assert.equal(out.kind, 'warning');
  if (out.kind === 'warning') assert.match(out.message, /49 of 50/);
  assert.ok(!('result' in out));
});

test('runCalibration: frames arriving after the 5 s window are not counted', async () => {
  const live = fakeLive({ t0: 0 });
  const ac = new AbortController();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let out;
  try {
    const p = runCalibration({ live: live as never, signal: ac.signal, refHz: 440 });
    await flush();
    for (let i = 0; i < 49; i++) live.emit(fr(1, 440));
    for (let i = 0; i < 5; i++) { await flush(); mock.timers.tick(1000); }
    await flush();
    out = await p;
    live.emit(fr(6, 440)); // too late, listener removed; must not throw
  } finally { mock.timers.reset(); }
  assert.equal(out.kind, 'warning');
});

test('runCalibration: abort during the wait gives cancelled with no numbers and stops the mic it opened', async () => {
  const live = fakeLive({ t0: 0 });
  const ac = new AbortController();
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let out;
  try {
    const p = runCalibration({ live: live as never, signal: ac.signal, refHz: 440 });
    await flush();
    for (let i = 0; i < 80; i++) live.emit(fr(1, 440));
    mock.timers.tick(2000);
    await flush();
    ac.abort();
    await flush();
    out = await p;
  } finally { mock.timers.reset(); }
  assert.equal(out.kind, 'cancelled');
  assert.ok(!('result' in out));
  assert.equal(live.stopCalls(), 1);
});

// ---------------------------------------------------------------- validateThresholds
test('validateThresholds: results/summary.json thresholds pass and carry the expected numbers', () => {
  assert.ok(TH);
  assert.deepEqual(
    { a: TH.tone_median, b: TH.tone_p95, c: TH.tone_octave, d: TH.vib_rate, e: TH.vib_extent_rel },
    { a: summary.thresholds.tone_median, b: summary.thresholds.tone_p95, c: summary.thresholds.tone_octave, d: summary.thresholds.vib_rate, e: summary.thresholds.vib_extent_rel },
  );
});

const KEYS = ['tone_median', 'tone_p95', 'tone_octave', 'vib_rate', 'vib_extent_rel'] as const;
for (const k of KEYS) {
  test(`validateThresholds: missing ${k} gives null`, () => {
    const raw: Record<string, unknown> = { ...summary.thresholds };
    delete raw[k];
    assert.equal(validateThresholds(raw), null);
  });
  for (const [label, bad] of [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['a string', '5'], ['null', null], ['undefined', undefined]] as const) {
    test(`validateThresholds: ${k} = ${label} gives null`, () => {
      assert.equal(validateThresholds({ ...summary.thresholds, [k]: bad }), null);
    });
  }
}
test('validateThresholds: non-objects give null', () => {
  for (const v of [null, undefined, 5, 'x', {}, []]) assert.equal(validateThresholds(v), null);
});
test('validateThresholds: 0 is a valid value (tone_octave is 0)', () => {
  assert.notEqual(validateThresholds({ ...summary.thresholds, tone_octave: 0 }), null);
});

// ---------------------------------------------------------------- verdicts use the thresholds as given
const okReport = (over: Partial<ToneSetReport> = {}): ToneSetReport => ({ frames: 100, voiced: 100, median: 0, p95: 0, max: 0, octave: 0, ...over });
const EPS = 1e-6;

test('toneVerdict: summary.json thresholds, at the threshold passes and just over fails (median, p95, octave)', () => {
  assert.equal(toneVerdict(okReport(), TH), 'pass');
  assert.equal(toneVerdict(okReport({ median: TH.tone_median }), TH), 'pass');
  assert.equal(toneVerdict(okReport({ median: TH.tone_median + EPS }), TH), 'fail');
  assert.equal(toneVerdict(okReport({ p95: TH.tone_p95 }), TH), 'pass');
  assert.equal(toneVerdict(okReport({ p95: TH.tone_p95 + EPS }), TH), 'fail');
  assert.equal(toneVerdict(okReport({ octave: TH.tone_octave }), TH), 'pass');
  assert.equal(toneVerdict(okReport({ octave: TH.tone_octave + 1 }), TH), 'fail');
});

test('toneVerdict: no voiced frames (NaN stats) is a fail, not a pass', () => {
  assert.equal(toneVerdict(okReport({ median: NaN, p95: NaN, voiced: 0 }), TH), 'fail');
});

test('toneVerdict: uses the thresholds it is given, not baked-in numbers', () => {
  const tight = { ...TH, tone_median: 1 };
  assert.equal(toneVerdict(okReport({ median: 2 }), tight), 'fail');
  assert.equal(toneVerdict(okReport({ median: 2 }), { ...TH, tone_median: 3 }), 'pass');
});

// ---------------------------------------------------------------- runSelfTest with stubs
const SR = 48000, HOP = 256;
interface Spec { f0Of: (t: number) => number; voicedOf?: (t: number) => boolean }
function frames(e: FixtureEntry, spec: Spec) {
  const out = [];
  const n = Math.floor((Math.round(e.dur * e.sr) - 2048) / HOP) + 1;
  for (let i = 0; i < n; i++) {
    const start = i * HOP;
    const t = start / e.sr;
    out.push({ type: 'frame' as const, start, readyAt: start + 2048, t, f0: spec.f0Of(t), voiced: spec.voicedOf?.(t) ?? true, aperiodicity: 0, rmsDb: -20, eSf: 0 });
  }
  return out;
}
function entry(id: string, set: string, over: Partial<FixtureEntry> = {}): FixtureEntry {
  return { id, set, file: `${id}.wav`, sr: SR, dur: 1, f0: 440, rate: 0, extent: 0, ...over };
}
function manifest(vibRate = 5.5, vibExtent = 50): FixtureEntry[] {
  return [
    entry('t48a', 'tone_sine_48k'), entry('t48b', 'tone_sine_48k', { f0: 220 }),
    entry('t44a', 'tone_sine_44k', { sr: 44100 }),
    entry('v1', 'vib_sine_48k', { dur: 2, rate: vibRate, extent: vibExtent }),
    entry('lat', 'latency', { onset_sample: 10000 }),
  ];
}
interface Behaviour { toneErrCents?: number; vibRate?: number; vibExtent?: number; latencyFirstCents?: number }
function renderFor(b: Behaviour = {}, onCall?: (e: FixtureEntry) => void) {
  return async (e: FixtureEntry) => {
    onCall?.(e);
    const off = (c: number) => Math.pow(2, c / 1200);
    if (e.set.startsWith('tone')) return frames(e, { f0Of: () => e.f0 * off(b.toneErrCents ?? 0) });
    if (e.set === 'vib_sine_48k') {
      const rate = b.vibRate ?? 5.5, ext = b.vibExtent ?? 50;
      return frames(e, { f0Of: (t) => e.f0 * Math.pow(2, (ext / 1200) * Math.sin(2 * Math.PI * rate * t)) });
    }
    // latency: unvoiced before the onset, then 440 Hz
    return frames(e, { f0Of: () => 440 * off(b.latencyFirstCents ?? 0), voicedOf: (t) => t * e.sr >= (e.onset_sample ?? 0) });
  };
}
const selfOpts = (over: Record<string, unknown> = {}) => ({
  signal: new AbortController().signal, thresholds: TH, loadManifest: async () => manifest(), render: renderFor(), ...over,
});

test('runSelfTest: clean synthetic data passes all three verdicts and reports the legacy shape', async () => {
  const out = await runSelfTest(selfOpts({ userAgent: 'ua' }));
  assert.equal(out.kind, 'done');
  if (out.kind !== 'done') return;
  assert.deepEqual(out.result.verdicts, { tone_sine_48k: 'pass', tone_sine_44k: 'pass', vibrato: 'pass' });
  const r = out.result.report;
  assert.equal(r.userAgent, 'ua');
  assert.equal(r.vibrato.cases, 1);
  assert.equal(r.vibrato.failing, 0);
  assert.ok(r.tone_sine_48k.voiced > 0 && r.tone_sine_48k.median < 1e-6 && r.tone_sine_48k.octave === 0);
});

test('runSelfTest: tone error just under the median threshold passes, just over fails', async () => {
  const under = await runSelfTest(selfOpts({ render: renderFor({ toneErrCents: TH.tone_median - 0.05 }) }));
  const over = await runSelfTest(selfOpts({ render: renderFor({ toneErrCents: TH.tone_median + 0.05 }) }));
  assert.equal(under.kind === 'done' && under.result.verdicts.tone_sine_48k, 'pass');
  assert.equal(under.kind === 'done' && under.result.verdicts.tone_sine_44k, 'pass');
  assert.equal(over.kind === 'done' && over.result.verdicts.tone_sine_48k, 'fail');
  assert.equal(over.kind === 'done' && over.result.verdicts.tone_sine_44k, 'fail');
});

test('runSelfTest: an octave error (more than 600 cents) in any tone frame fails that set even if median and p95 are fine', async () => {
  const render = async (e: FixtureEntry) => {
    const fs = await renderFor()(e);
    if (e.id === 't48a') fs[100] = { ...fs[100], f0: e.f0 * 2 }; // one frame an octave up (1200 c)
    return fs;
  };
  const out = await runSelfTest(selfOpts({ render }));
  assert.equal(out.kind, 'done');
  if (out.kind !== 'done') return;
  assert.equal(out.result.report.tone_sine_48k.octave, 1);
  assert.equal(out.result.verdicts.tone_sine_48k, 'fail');
  assert.equal(out.result.verdicts.tone_sine_44k, 'pass');
});

test('runSelfTest: tone frames within 0.07 s of either end are skipped (fades)', async () => {
  const render = async (e: FixtureEntry) => {
    const fs = await renderFor()(e);
    return e.set === 'tone_sine_48k' ? fs.map((f) => (f.t < 0.07 || f.t > e.dur - 0.07 ? { ...f, f0: e.f0 * 3 } : f)) : fs;
  };
  const out = await runSelfTest(selfOpts({ render }));
  assert.equal(out.kind === 'done' && out.result.verdicts.tone_sine_48k, 'pass');
});

test('runSelfTest: vibrato rate error just under vib_rate passes, just over fails', async () => {
  // The signal vibrates at 5.5 Hz; the manifest says what it should be.
  const run = (claimed: number) => runSelfTest(selfOpts({ loadManifest: async () => manifest(claimed, 50), render: renderFor({ vibRate: 5.5, vibExtent: 50 }) }));
  const under = await run(5.5 + TH.vib_rate - 0.1);
  const over = await run(5.5 + TH.vib_rate + 0.1);
  assert.equal(under.kind === 'done' && under.result.verdicts.vibrato, 'pass');
  assert.equal(over.kind === 'done' && over.result.verdicts.vibrato, 'fail');
  assert.equal(over.kind === 'done' && over.result.report.vibrato.failing, 1);
});

test('runSelfTest: vibrato extent error well over vib_extent_rel fails, well under passes', async () => {
  const run = (claimed: number) => runSelfTest(selfOpts({ loadManifest: async () => manifest(5.5, claimed), render: renderFor({ vibRate: 5.5, vibExtent: 50 }) }));
  const under = await run(50 / (1 - TH.vib_extent_rel / 2)); // roughly half the allowed relative error
  const over = await run(50 / (1 - TH.vib_extent_rel * 2)); // roughly twice
  assert.equal(under.kind === 'done' && under.result.verdicts.vibrato, 'pass');
  assert.equal(over.kind === 'done' && over.result.verdicts.vibrato, 'fail');
});

test('runSelfTest: a lenient threshold set passes what the real one fails (thresholds come from the argument)', async () => {
  const render = renderFor({ toneErrCents: TH.tone_median + 1 });
  const strict = await runSelfTest(selfOpts({ render }));
  const lax = await runSelfTest(selfOpts({ render, thresholds: { ...TH, tone_median: TH.tone_median + 2, tone_p95: TH.tone_p95 + 2 } }));
  assert.equal(strict.kind === 'done' && strict.result.verdicts.tone_sine_48k, 'fail');
  assert.equal(lax.kind === 'done' && lax.result.verdicts.tone_sine_48k, 'pass');
});

test('runSelfTest: algorithmic latency is onset to the first voiced frame within 50 cents', async () => {
  const out = await runSelfTest(selfOpts());
  assert.equal(out.kind, 'done');
  if (out.kind !== 'done') return;
  const lat = out.result.report.algorithmicLatencyMs;
  // frames start every 256 samples; first voiced frame has t*sr >= 10000, readyAt = start + 2048 (> onset)
  const firstStart = Math.ceil(10000 / HOP) * HOP;
  assert.ok(Math.abs(lat - ((firstStart + 2048 - 10000) / SR) * 1000) < 1e-9, String(lat));
});

test('runSelfTest: latency frames more than 50 cents off 440 Hz never match, so the latency is NaN', async () => {
  const out = await runSelfTest(selfOpts({ render: renderFor({ latencyFirstCents: 80 }) }));
  assert.equal(out.kind, 'done');
  if (out.kind === 'done') assert.ok(Number.isNaN(out.result.report.algorithmicLatencyMs));
});

test('runSelfTest: null thresholds is a "criteria" error and no verdicts, without loading anything', async () => {
  let loaded = false;
  const out = await runSelfTest(selfOpts({ thresholds: null, loadManifest: async () => { loaded = true; return manifest(); } }));
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') assert.equal(out.reason, 'criteria');
  assert.ok(!('result' in out));
  assert.equal(loaded, false);
});

test('runSelfTest: abort after the first file returns cancelled, no result object, and renders no further files', async () => {
  const ac = new AbortController();
  const seen: string[] = [];
  const inner = renderFor();
  const render = async (e: FixtureEntry) => { seen.push(e.id); const f = await inner(e); ac.abort(); return f; };
  const out = await runSelfTest(selfOpts({ signal: ac.signal, render }));
  assert.equal(out.kind, 'cancelled');
  assert.ok(!('result' in out));
  assert.deepEqual(seen, ['t48a']);
});

test('runSelfTest: abort during the last file (latency) still cancels with no result', async () => {
  const ac = new AbortController();
  const inner = renderFor();
  const render = async (e: FixtureEntry) => { const f = await inner(e); if (e.set === 'latency') ac.abort(); return f; };
  const out = await runSelfTest(selfOpts({ signal: ac.signal, render }));
  assert.equal(out.kind, 'cancelled');
  assert.ok(!('result' in out));
});

test('runSelfTest: already aborted renders nothing and is cancelled', async () => {
  const ac = new AbortController();
  ac.abort();
  let calls = 0;
  const out = await runSelfTest(selfOpts({ signal: ac.signal, render: async () => { calls++; return []; } }));
  assert.equal(out.kind, 'cancelled');
  assert.equal(calls, 0);
});

test('runSelfTest: progress reports 1-based file numbers out of the total', async () => {
  const seen: Array<[number, number]> = [];
  await runSelfTest(selfOpts({ onProgress: (i: number, n: number) => seen.push([i, n]) }));
  assert.deepEqual(seen, [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
});

test('runSelfTest: FixtureMissingError from the manifest maps to the fixtures outcome (test files not found)', async () => {
  const out = await runSelfTest(selfOpts({ loadManifest: async () => { throw new FixtureMissingError('manifest.json'); } }));
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') { assert.equal(out.reason, 'fixtures'); assert.match(out.detail, /fixtures\/synthetic/); }
  assert.ok(!('result' in out));
});

test('runSelfTest: FixtureMissingError from a render maps to fixtures too', async () => {
  const out = await runSelfTest(selfOpts({ render: async (e: FixtureEntry) => { throw new FixtureMissingError(e.file); } }));
  assert.equal(out.kind === 'error' && out.reason, 'fixtures');
});

test('runSelfTest: any other thrown error is not reported as missing files', async () => {
  const out = await runSelfTest(selfOpts({ render: async () => { throw new Error('boom'); } }));
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') { assert.notEqual(out.reason, 'fixtures'); assert.match(out.detail, /boom/); }
});

test('runSelfTest: a manifest missing a required set is a fixtures error', async () => {
  const out = await runSelfTest(selfOpts({ loadManifest: async () => manifest().filter((e) => e.set !== 'tone_sine_44k') }));
  assert.equal(out.kind === 'error' && out.reason, 'fixtures');
});

// ---------------------------------------------------------------- loopbackStats
test('loopbackStats: no matched tones gives null', () => {
  assert.equal(loopbackStats([]), null);
});

test('loopbackStats: median (upper middle, as the legacy page), min and max of unsorted delays', () => {
  assert.deepEqual(loopbackStats([300, 100, 200]), { medianMs: 200, minMs: 100, maxMs: 300 });
  assert.deepEqual(loopbackStats([40, 10, 30, 20]), { medianMs: 30, minMs: 10, maxMs: 40 });
  assert.deepEqual(loopbackStats([7]), { medianMs: 7, minMs: 7, maxMs: 7 });
});

test('loopbackStats: does not reorder its input', () => {
  const a = [3, 1, 2];
  loopbackStats(a);
  assert.deepEqual(a, [3, 1, 2]);
});

// ---------------------------------------------------------------- runLoopback (50 c match rule, median over matched tones)
function fakeCtx(perfTime: number) {
  const osc = () => ({ frequency: { value: 0 }, connect: (x: unknown) => x, disconnect() {}, start() {}, stop() {} });
  const gain = () => ({ gain: { value: 0 }, connect: (x: unknown) => x, disconnect() {} });
  return {
    currentTime: 0, sampleRate: SR, baseLatency: 0.01, outputLatency: 0.02, destination: {},
    createOscillator: osc, createGain: gain,
    getOutputTimestamp: () => ({ performanceTime: perfTime, contextTime: 0 }),
  };
}

async function driveLoopback(opts: { centsOfTone: (i: number) => number; perfTime?: number; delayOf?: (i: number) => number }) {
  const live = fakeLive();
  const ctx = fakeCtx(opts.perfTime ?? 1000);
  (live as { start: unknown }).start = async () => { live.status = 'listening'; const s = { ctx }; live.session = s; return s; };
  const ac = new AbortController();
  let rafCb: ((ts: number) => void) | null = null;
  let tone = 0;
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const p = runLoopback({
      live: live as never, signal: ac.signal,
      raf: (cb) => { rafCb = cb; return 1; }, caf: () => { rafCb = null; },
      onProgress: (i) => { tone = i - 1; },
    });
    let done = false;
    void p.then(() => { done = true; });
    for (let step = 0; step < 400 && !done; step++) {
      await flush(3);
      // a frame at 0.5 s of context time (after the tone starts at 0.3 s) at the cents offset for this tone
      live.emit({ t: 0.5, f0: 440 * Math.pow(2, opts.centsOfTone(tone) / 1200), voiced: true, readyAt: 0.5 * SR });
      // outPerf = perfTime + 300 ms; the frame is "drawn" delayOf(tone) ms after that
      rafCb?.((opts.perfTime ?? 1000) + 300 + (opts.delayOf?.(tone) ?? 100));
      await flush(3);
      mock.timers.tick(100);
    }
    return await p;
  } finally { mock.timers.reset(); }
}

test('runLoopback: a tone 49 cents off counts, 51 cents off does not; median is over matched tones only', async () => {
  const out = await driveLoopback({
    centsOfTone: (i) => (i < 2 ? 51 : i === 2 ? -49 : 0),
    delayOf: (i) => 100 + 10 * i,
  });
  assert.equal(out.kind, 'done');
  if (out.kind !== 'done') return;
  assert.equal(out.result.of, 10);
  assert.equal(out.result.detected, 8); // tones 0 and 1 never matched
  assert.equal(out.result.minMs, 120);
  assert.equal(out.result.maxMs, 190);
  assert.equal(out.result.medianMs, 160);
});

test('runLoopback: when no tone is within 50 cents the result is a warning with no numbers', async () => {
  const out = await driveLoopback({ centsOfTone: () => 80 });
  assert.equal(out.kind, 'warning');
  assert.ok(!('result' in out));
});

test('runLoopback: abort between tones returns cancelled', async () => {
  const live = fakeLive();
  const ctx = fakeCtx(1000);
  (live as { start: unknown }).start = async () => { live.status = 'listening'; const s = { ctx }; live.session = s; return s; };
  const ac = new AbortController();
  mock.timers.enable({ apis: ['setTimeout'] });
  let out;
  try {
    const p = runLoopback({ live: live as never, signal: ac.signal, raf: () => 1, caf: () => {} });
    await flush();
    ac.abort();
    await flush();
    out = await p;
  } finally { mock.timers.reset(); }
  assert.equal(out.kind, 'cancelled');
  assert.ok(!('result' in out));
  assert.equal(live.stopCalls(), 1);
});

// Edge-case behaviour is deliberately not pinned beyond this: a zero performanceTime must not give a number.
test('runLoopback: a zero performanceTime never yields a numeric median', async () => {
  const out = await driveLoopback({ centsOfTone: () => 0, perfTime: 0, delayOf: () => 100 });
  const numeric = out.kind === 'done' && typeof out.result.medianMs === 'number' && Number.isFinite(out.result.medianMs);
  assert.equal(numeric, false);
});
