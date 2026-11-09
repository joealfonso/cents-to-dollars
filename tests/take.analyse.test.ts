// M2.1 shared analysis module (src/take/analyse.ts) against the Node runner and the spec.
//   F-02  frame count, start per frame, voiced per frame equal `node tools/run_ts.ts track <file> <out> cont`
//   F-03  on voiced frames |1200 log2(f_module / f_runner)| <= 0.001 c
//   F-14  fewer than 2048 samples: zero frames, status 'too-short'
//   F-15  digital silence: no voiced frame, status 'no-pitch'
//   F-26  steady tone (no vibrato): every vibrato window reports "none found"
//   4.8   opposite-phase stereo: 'no pitch found'
// F-01..F-03 are compared on a handful of self-generated WAVs; the full V-01 set is run by validate.sh.
// F-24 and F-25 (vibrato accuracy) are scored by validate.sh and are not duplicated here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameAnalyzer } from '../src/dsp/analyzer.ts';
import { tone, encodeWav, runTrackCont, type WavSpec, type RunnerJson } from './take.helpers.ts';

const wavMod = () => import('../src/take/wav.ts');
const analyseMod = () => import('../src/take/analyse.ts');

const HOP = 256;
const N = 2048;

function gap(sr: number, dur: number): Float64Array { return new Float64Array(Math.round(sr * dur)); }
function cat(...xs: Float64Array[]): Float64Array {
  const out = new Float64Array(xs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of xs) { out.set(x, o); o += x.length; }
  return out;
}

// A few fixtures covering: both rates, three bit depths and float, stereo with different channels, vibrato,
// noise, gaps (unvoiced runs), and a strong 2nd partial (octave candidates that continuity may change).
const FIXTURES: Record<string, WavSpec> = {
  'tone_pcm16_48k': { sampleRate: 48000, format: 'pcm16', channels: [tone({ sr: 48000, dur: 1.2, f0: 220 })] },
  'stereo_pcm24_44k': {
    sampleRate: 44100, format: 'pcm24',
    channels: [tone({ sr: 44100, dur: 1.0, f0: 330 }), tone({ sr: 44100, dur: 1.0, f0: 247, amp: 0.3 })],
  },
  'vib_f32_48k': { sampleRate: 48000, format: 'f32', channels: [tone({ sr: 48000, dur: 2.5, f0: 220, vibRate: 5.5, vibCents: 50 })] },
  'noisy_pcm32_44k': { sampleRate: 44100, format: 'pcm32', channels: [tone({ sr: 44100, dur: 1.0, f0: 150, noise: 0.08, seed: 9 })] },
  'gaps_pcm16_48k': {
    sampleRate: 48000, format: 'pcm16',
    channels: [cat(tone({ sr: 48000, dur: 0.5, f0: 196 }), gap(48000, 0.3), tone({ sr: 48000, dur: 0.5, f0: 262, harmonics: [0.3, 1, 0.6] }))],
  },
};

let cache: Promise<Record<string, { got: any; samples: Float64Array; runner: RunnerJson; refFrames: ReturnType<FrameAnalyzer['run']>; sr: number }>> | null = null;

function parityRuns() {
  cache ??= (async () => {
    const { parseWav } = await wavMod();
    const { analyseTake } = await analyseMod();
    const files: Record<string, Uint8Array> = {};
    for (const [name, spec] of Object.entries(FIXTURES)) files[`${name}.wav`] = encodeWav(spec);
    const runner = runTrackCont(files);
    const out: Record<string, any> = {};
    for (const name of Object.keys(FIXTURES)) {
      const parsed = parseWav(files[`${name}.wav`]);
      const got = analyseTake(parsed.samples, parsed.sampleRate);
      // Independent reference for `start` and plain-YIN `voiced`: the M1 FrameAnalyzer the runner itself uses.
      const refFrames = new FrameAnalyzer({ sampleRate: parsed.sampleRate }).run(parsed.samples, false, false);
      out[name] = { got, samples: parsed.samples, runner: runner[name], refFrames, sr: parsed.sampleRate };
    }
    return out;
  })();
  return cache;
}

test('F-02: frame count equals the Node runner on every parity fixture', async () => {
  const runs = await parityRuns();
  for (const [name, r] of Object.entries(runs)) {
    assert.equal(r.got.status, 'ok', `${name}: status`);
    assert.equal(r.got.frameCount, r.runner.t.length, `${name}: frameCount vs runner`);
    assert.equal(r.got.t.length, r.got.frameCount, `${name}: t length`);
    assert.equal(r.got.hop, r.runner.hop, `${name}: hop`);
    assert.equal(r.got.hop, HOP);
    assert.equal(r.got.sampleRate, r.runner.sampleRate, `${name}: sampleRate`);
  }
});

test('F-02: start per frame equals the frame start of the M1 analyser (i * hop)', async () => {
  const runs = await parityRuns();
  for (const [name, r] of Object.entries(runs)) {
    assert.equal(r.got.start.length, r.refFrames.length, `${name}: start length`);
    let bad = 0;
    for (let i = 0; i < r.refFrames.length; i++) if (r.got.start[i] !== r.refFrames[i].start) bad++;
    assert.equal(bad, 0, `${name}: ${bad} frames with a different start`);
  }
});

test('F-02: voiced per frame equals plain-YIN voiced of the M1 analyser, and some frames are voiced', async () => {
  const runs = await parityRuns();
  for (const [name, r] of Object.entries(runs)) {
    assert.equal(r.got.voiced.length, r.refFrames.length, `${name}: voiced length`);
    let bad = 0, voiced = 0;
    for (let i = 0; i < r.refFrames.length; i++) {
      if ((r.got.voiced[i] === 1) !== r.refFrames[i].voiced) bad++;
      if (r.got.voiced[i] === 1) voiced++;
    }
    assert.equal(bad, 0, `${name}: ${bad} frames with a different voiced flag`);
    assert.ok(voiced > 0, `${name}: fixture has voiced frames (the test would be vacuous otherwise)`);
  }
  const gaps = runs['gaps_pcm16_48k'];
  const unvoiced = Array.from(gaps.got.voiced as Uint8Array).filter((v) => v === 0).length;
  assert.ok(unvoiced > 20, 'the gap fixture really has unvoiced frames');
});

test('F-02: t per frame equals the runner (which rounds t to 6 decimals)', async () => {
  const runs = await parityRuns();
  for (const [name, r] of Object.entries(runs)) {
    let bad = 0;
    for (let i = 0; i < r.runner.t.length; i++) if (Math.abs(r.got.t[i] - r.runner.t[i]) > 5.01e-7) bad++;
    assert.equal(bad, 0, `${name}: ${bad} frames with t off by more than the runner's rounding`);
  }
});

test('F-03: on every voiced frame the module F0 is within 0.001 c of the runner F0', async () => {
  const runs = await parityRuns();
  const failures: string[] = [];
  for (const [name, r] of Object.entries(runs)) {
    let out = 0, checked = 0, worst = 0;
    for (let i = 0; i < r.got.frameCount; i++) {
      if (r.got.voiced[i] !== 1) continue;
      checked++;
      const a = r.got.f0[i], b = r.runner.f0[i];
      if (!(a > 0) || !(b > 0)) { out++; continue; }
      const c = Math.abs(1200 * Math.log2(a / b));
      worst = Math.max(worst, c);
      if (c > 0.001) out++;
    }
    assert.ok(checked > 0, `${name}: voiced frames checked`);
    if (out) failures.push(`${name}: ${out} of ${checked} voiced frames outside 0.001 c (worst ${worst.toFixed(6)} c)`);
  }
  assert.deepEqual(failures, []);
});

test('F0 is 0 exactly on frames where plain YIN is unvoiced, and positive on voiced frames (API: "0 when unvoiced")', async () => {
  const runs = await parityRuns();
  for (const [name, r] of Object.entries(runs)) {
    let bad = 0;
    for (let i = 0; i < r.got.frameCount; i++) {
      const voiced = r.got.voiced[i] === 1;
      if (voiced !== r.got.f0[i] > 0) bad++;
    }
    assert.equal(bad, 0, `${name}: ${bad} frames where f0 > 0 disagrees with voiced`);
  }
});

test('F-05: stereo with different channels is analysed on the per-sample mean (same frames as the runner on the same file)', async () => {
  const runs = await parityRuns();
  const r = runs['stereo_pcm24_44k'];
  assert.equal(r.got.frameCount, r.runner.t.length);
  // The mean of a 330 Hz and a 247 Hz tone is not a 330 Hz tone: if only channel 0 were analysed, most
  // frames would read near 330. The runner (tools/wav.ts mean) is the arbiter, so require agreement frame by frame.
  let off = 0;
  for (let i = 0; i < r.got.frameCount; i++) {
    if (r.got.voiced[i] === 1 && Math.abs(1200 * Math.log2(r.got.f0[i] / r.runner.f0[i])) > 0.001) off++;
  }
  assert.equal(off, 0);
});

// ------------------------------------------------------------------ F-14, F-15

test('F-14: a WAV with 2047 samples yields zero frames and status too-short', async () => {
  const { parseWav } = await wavMod();
  const { analyseTake } = await analyseMod();
  const x = tone({ sr: 48000, dur: 1, f0: 220 }).subarray(0, N - 1);
  const p = parseWav(encodeWav({ sampleRate: 48000, channels: [x], format: 'pcm16' }));
  assert.equal(p.samples.length, N - 1);
  const r = analyseTake(p.samples, p.sampleRate);
  assert.equal(r.status, 'too-short');
  assert.equal(r.frameCount, 0);
  assert.equal(r.t.length, 0);
  assert.equal(r.f0.length, 0);
  assert.equal(r.voiced.length, 0);
  assert.equal(r.spectrum.length, 0);
});

test('F-14: empty input and a few samples are too-short with zero frames', async () => {
  const { analyseTake } = await analyseMod();
  for (const n of [0, 1, 100]) {
    const r = analyseTake(new Float64Array(n), 44100);
    assert.equal(r.status, 'too-short', `${n} samples`);
    assert.equal(r.frameCount, 0, `${n} samples`);
  }
});

test('F-14 boundary: exactly 2048 samples is one frame and not too-short', async () => {
  const { analyseTake } = await analyseMod();
  const r = analyseTake(tone({ sr: 48000, dur: 1, f0: 220 }).subarray(0, N), 48000);
  assert.equal(r.frameCount, 1);
  assert.notEqual(r.status, 'too-short');
  assert.equal(r.start[0], 0);
  // 2048 + 256 - 1 samples: still one frame; 2048 + 256: two.
  assert.equal(analyseTake(tone({ sr: 48000, dur: 1, f0: 220 }).subarray(0, N + HOP - 1), 48000).frameCount, 1);
  assert.equal(analyseTake(tone({ sr: 48000, dur: 1, f0: 220 }).subarray(0, N + HOP), 48000).frameCount, 2);
});

test('F-15: digital silence yields no voiced frame and status no-pitch', async () => {
  const { parseWav } = await wavMod();
  const { analyseTake } = await analyseMod();
  for (const sr of [44100, 48000]) {
    const p = parseWav(encodeWav({ sampleRate: sr, channels: [new Float64Array(sr)], format: 'pcm16' }));
    const r = analyseTake(p.samples, p.sampleRate);
    assert.equal(r.status, 'no-pitch', `${sr} Hz`);
    assert.ok(r.frameCount > 0, 'silence still has frames');
    assert.equal(Array.from(r.voiced).filter((v) => v === 1).length, 0, 'no voiced frame');
    assert.ok(r.f0.every((v) => v === 0), 'f0 is 0 everywhere');
  }
});

test('F-15 control: a real tone is NOT reported as no-pitch (so the silence test can fail)', async () => {
  const { analyseTake } = await analyseMod();
  const r = analyseTake(tone({ sr: 48000, dur: 1, f0: 220 }), 48000);
  assert.equal(r.status, 'ok');
  assert.ok(Array.from(r.voiced).some((v) => v === 1));
});

test('edge 4.8: opposite-phase stereo averages to silence and is reported no-pitch', async () => {
  const { parseWav } = await wavMod();
  const { analyseTake } = await analyseMod();
  const x = tone({ sr: 48000, dur: 1, f0: 220 });
  const p = parseWav(encodeWav({ sampleRate: 48000, channels: [x, x.map((v) => -v)], format: 'pcm16' }));
  const r = analyseTake(p.samples, p.sampleRate);
  assert.equal(r.status, 'no-pitch');
  assert.equal(Array.from(r.voiced).filter((v) => v === 1).length, 0);
  // The same two channels in phase are a normal take.
  const q = parseWav(encodeWav({ sampleRate: 48000, channels: [x, x], format: 'pcm16' }));
  assert.equal(analyseTake(q.samples, q.sampleRate).status, 'ok');
});

// ------------------------------------------------------------------ vibrato windows

test('F-26: a steady tone with no vibrato gives "none found" in every window', async () => {
  const { analyseTake } = await analyseMod();
  for (const f0 of [220, 440]) {
    const r = analyseTake(tone({ sr: 48000, dur: 8, f0 }), 48000);
    assert.equal(r.status, 'ok');
    assert.ok(r.vibrato.length >= 10, `${f0} Hz: windows produced (got ${r.vibrato.length})`);
    const found = r.vibrato.filter((w) => w.rateHz !== null || w.extentCents !== null);
    assert.equal(found.length, 0, `${f0} Hz: ${found.length} of ${r.vibrato.length} windows report vibrato: ${JSON.stringify(found.slice(0, 2))}`);
  }
});

test('F-26 control: a fixture WITH vibrato gets at least one window that is not "none found" (so F-26 can fail)', async () => {
  const { analyseTake } = await analyseMod();
  const r = analyseTake(tone({ sr: 48000, dur: 8, f0: 220, vibRate: 5.5, vibCents: 50 }), 48000);
  const found = r.vibrato.filter((w) => w.rateHz !== null && w.extentCents !== null);
  assert.ok(found.length >= 5, `windows with vibrato: ${found.length} of ${r.vibrato.length}`);
  const mid = found.find((w) => w.t0 > 1 && w.t1 < 7);
  assert.ok(mid, 'an interior window found vibrato');
  assert.ok(Math.abs(mid.rateHz! - 5.5) <= 0.3, `rate ${mid.rateHz}`);
});

test('4.4: vibrato windows are 2.5 s long and start every 0.5 s (within one hop), with no window running past the take', async () => {
  const { analyseTake } = await analyseMod();
  const dur = 8;
  const r = analyseTake(tone({ sr: 48000, dur, f0: 220 }), 48000);
  const oneHop = HOP / 48000;
  assert.ok(r.vibrato.length >= 2);
  for (let i = 0; i < r.vibrato.length; i++) {
    const w = r.vibrato[i];
    assert.ok(Math.abs(w.t1 - w.t0 - 2.5) <= oneHop + 1e-9, `window ${i} length ${w.t1 - w.t0}`);
    if (i > 0) assert.ok(Math.abs(w.t0 - r.vibrato[i - 1].t0 - 0.5) <= oneHop + 1e-9, `window ${i} step ${w.t0 - r.vibrato[i - 1].t0}`);
    assert.ok(w.t1 <= dur + 1e-9, `window ${i} ends at ${w.t1}, after the take`);
  }
});

test('4.4: window count follows from 2.5 s windows every 0.5 s; a take shorter than one window has none, a no-pitch take never reports vibrato', async () => {
  const { analyseTake } = await analyseMod();
  // Spec 4.4: windows of 2.5 s starting every 0.5 s. A 4 s take holds starts 0, 0.5, 1.0, 1.5: four windows.
  // (Tolerance of one: the frame grid may cost the last window, never add one.)
  const steady = analyseTake(tone({ sr: 48000, dur: 4, f0: 220 }), 48000);
  assert.equal(steady.status, 'ok');
  assert.ok(steady.vibrato.length >= 3 && steady.vibrato.length <= 4, `4 s take: expected 3 or 4 windows, got ${steady.vibrato.length}`);
  // Spec 4.4 does not say whether a take with no pitch lists windows; if it does, none may report vibrato.
  const silent = analyseTake(new Float64Array(48000 * 4), 48000);
  assert.equal(silent.status, 'no-pitch');
  assert.ok(silent.vibrato.every((w) => w.rateHz === null && w.extentCents === null), 'no pitch means none found in every window');
  // A 1 s take cannot hold a 2.5 s window: no window may be invented for it.
  const short = analyseTake(tone({ sr: 48000, dur: 1, f0: 220, vibRate: 5.5, vibCents: 50 }), 48000);
  assert.equal(short.status, 'ok');
  assert.equal(short.vibrato.length, 0, `1 s take: expected 0 windows, got ${short.vibrato.length}`);
  // Too-short take: no frames, no windows.
  assert.equal(analyseTake(new Float64Array(100), 48000).vibrato.length, 0);
});

// ------------------------------------------------------------------ result shape (specs/M2.1-API.md)

test('API: result arrays are consistent (frame-count long, spectrum is frameCount x specBins and covers 0 to 4 kHz)', async () => {
  const { analyseTake } = await analyseMod();
  const sr = 48000;
  const x = tone({ sr, dur: 0.5, f0: 1000, harmonics: [1] });
  const r = analyseTake(x, sr);
  const n = Math.floor((x.length - N) / HOP) + 1;
  assert.equal(r.frameCount, n);
  for (const k of ['t', 'start', 'voiced', 'f0', 'aperiodicity', 'rmsDb', 'eSf', 'eRef'] as const) {
    assert.equal(r[k].length, n, k);
  }
  assert.equal(r.spectrum.length, n * r.specBins);
  const binHz = sr / N;
  assert.ok(r.specBins >= 4000 / binHz && r.specBins <= 4000 / binHz + 2, `specBins ${r.specBins} for 0 to 4 kHz at ${binHz} Hz/bin`);
  // A 1 kHz sine puts the spectrum peak at bin 1000 / binHz in a mid-take frame.
  const mid = Math.floor(n / 2);
  let best = 0;
  for (let b = 1; b < r.specBins; b++) if (r.spectrum[mid * r.specBins + b] > r.spectrum[mid * r.specBins + best]) best = b;
  assert.ok(Math.abs(best - 1000 / binHz) <= 1, `peak at bin ${best}, expected about ${(1000 / binHz).toFixed(1)}`);
});

test('API: takeTransferables lists every typed-array buffer of the result exactly once', async () => {
  const { analyseTake, takeTransferables } = await analyseMod();
  const r = analyseTake(tone({ sr: 48000, dur: 0.5, f0: 220 }), 48000);
  const list = takeTransferables(r);
  const want = new Set<ArrayBuffer>();
  for (const v of Object.values(r)) if (ArrayBuffer.isView(v)) want.add(v.buffer as ArrayBuffer);
  assert.ok(want.size >= 9, 'result has at least nine typed arrays');
  assert.equal(new Set(list).size, list.length, 'no buffer listed twice');
  for (const b of want) assert.ok(list.includes(b), 'a typed-array buffer is missing from the transfer list');
});

test('API: onProgress is called with non-decreasing fractions in [0, 1]', async () => {
  const { analyseTake } = await analyseMod();
  const seen: number[] = [];
  analyseTake(tone({ sr: 48000, dur: 3, f0: 220 }), 48000, { onProgress: (f) => seen.push(f) });
  assert.ok(seen.length > 0, 'progress reported');
  for (let i = 0; i < seen.length; i++) {
    assert.ok(seen[i] >= 0 && seen[i] <= 1, `fraction ${seen[i]} in range`);
    if (i > 0) assert.ok(seen[i] >= seen[i - 1], 'non-decreasing');
  }
});
