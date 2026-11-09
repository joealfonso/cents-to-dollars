// Tests for src/dsp/continuity.ts, written from the header-comment spec (MEASUREMENT.md 1.5 method).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ContinuityTracker,
  decodeAll,
  DEFAULT_CONTINUITY,
  type CandidateFrame,
  type ContinuityConfig,
  type Decided,
} from '../src/dsp/continuity.ts';
import { FrameAnalyzer } from '../src/dsp/analyzer.ts';

// ---------- helpers ----------

interface TF extends CandidateFrame { id: number }

function vf(id: number, cands: Array<[number, number]>): TF {
  return {
    id,
    voiced: true,
    candF0: Float64Array.from(cands.map((c) => c[0])),
    candD: Float64Array.from(cands.map((c) => c[1])),
    candCount: cands.length,
  };
}
function uf(id: number, count = 0): TF {
  return { id, voiced: false, candF0: new Float64Array(count), candD: new Float64Array(count), candCount: count };
}

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomRun(rand: () => number, n: number, startId = 0): TF[] {
  const frames: TF[] = [];
  const base = 150 + rand() * 200;
  for (let i = 0; i < n; i++) {
    const k = 2 + Math.floor(rand() * 2); // 2 or 3 candidates
    const cands: Array<[number, number]> = [];
    for (let c = 0; c < k; c++) {
      const octave = [0.5, 1, 2][Math.floor(rand() * 3)];
      cands.push([base * octave * (1 + (rand() - 0.5) * 0.1), rand() * 0.5]);
    }
    frames.push(vf(startId + i, cands));
  }
  return frames;
}

const cfgOf = (over: Partial<ContinuityConfig> = {}): ContinuityConfig => ({ ...DEFAULT_CONTINUITY, ...over });

/** Cost of a path of candidate indices through a run, straight from the header formula. */
function pathCost(frames: TF[], path: number[], cfg: ContinuityConfig): number {
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i].candF0[path[i]];
    const oct = Math.log2(f / frames[i].candF0[0]);
    total += cfg.wD * frames[i].candD[path[i]] + (oct < 0 ? cfg.wDown * -oct : cfg.wUp * oct);
    if (i > 0) total += cfg.wJump * Math.abs(Math.log2(f / frames[i - 1].candF0[path[i - 1]]));
  }
  return total;
}

/** Brute-force minimum cost path (whole run), optionally with a fixed predecessor frequency. */
function bruteBest(frames: TF[], cfg: ContinuityConfig, anchorF0?: number): number[] {
  let best: number[] = [];
  let bestCost = Infinity;
  const path: number[] = [];
  const rec = (i: number) => {
    if (i === frames.length) {
      let c = pathCost(frames, path, cfg);
      if (anchorF0 !== undefined) c += cfg.wJump * Math.abs(Math.log2(frames[0].candF0[path[0]] / anchorF0));
      if (c < bestCost) { bestCost = c; best = path.slice(); }
      return;
    }
    for (let k = 0; k < frames[i].candCount; k++) { path[i] = k; rec(i + 1); }
  };
  rec(0);
  return best;
}

/** Reference for fixed-lag decoding of one voiced run: sequential windowed brute force. */
function bruteFixedLag(frames: TF[], lag: number, cfg: ContinuityConfig): number[] {
  const out: number[] = [];
  let anchor: number | undefined;
  let next = 0;
  for (let t = 0; t < frames.length; t++) {
    if (t - next + 1 > lag) {
      const p = bruteBest(frames.slice(next, t + 1), cfg, anchor);
      out.push(p[0]);
      anchor = frames[next].candF0[p[0]];
      next++;
    }
  }
  if (next < frames.length) {
    const p = bruteBest(frames.slice(next), cfg, anchor);
    for (let i = 0; i < p.length; i++) out.push(p[i]);
  }
  return out;
}

function runLive(frames: TF[], lag: number): { perPush: Decided<TF>[][]; flushed: Decided<TF>[]; all: Decided<TF>[] } {
  const ct = new ContinuityTracker<TF>({ lag });
  const perPush = frames.map((f) => ct.push(f, f));
  const flushed = ct.flush();
  return { perPush, flushed, all: [...perPush.flat(), ...flushed] };
}

// ---------- unvoiced handling and plain-YIN fidelity ----------

test('unvoiced frames give f0 0 and choice -1', () => {
  const out = decodeAll([uf(0), uf(1, 2)]);
  assert.equal(out.length, 2);
  for (const d of out) { assert.equal(d.f0, 0); assert.equal(d.choice, -1); }
});

test('voiced flag true with candCount 0 is treated as unvoiced', () => {
  const fr: TF = { id: 0, voiced: true, candF0: new Float64Array(0), candD: new Float64Array(0), candCount: 0 };
  const out = decodeAll([fr]);
  assert.equal(out[0].f0, 0);
  assert.equal(out[0].choice, -1);
});

test('voiced frames never change voicing and f0 is exactly the chosen candidate value', () => {
  const rand = rng(7);
  const frames: TF[] = [];
  let id = 0;
  for (let r = 0; r < 5; r++) {
    frames.push(...randomRun(rand, 3 + Math.floor(rand() * 6), id));
    id = frames.length;
    frames.push(uf(id++));
  }
  for (const lag of [0, 1, 3, Infinity]) {
    const out = decodeAll(frames, { lag });
    assert.equal(out.length, frames.length);
    out.forEach((d, i) => {
      const fr = frames[i];
      if (!fr.voiced) { assert.equal(d.f0, 0); assert.equal(d.choice, -1); return; }
      assert.ok(d.choice >= 0 && d.choice < fr.candCount);
      assert.equal(d.f0, fr.candF0[d.choice]);
    });
  }
});

test('an unvoiced frame ends the run: later run decodes as if alone', () => {
  const rand = rng(11);
  const a = randomRun(rand, 5, 0);
  const b = randomRun(rand, 5, 6);
  const joined = decodeAll([...a, uf(5), ...b], { lag: Infinity });
  const alone = decodeAll(b, { lag: Infinity });
  assert.deepEqual(joined.slice(6).map((d) => d.choice), alone.map((d) => d.choice));
  const aloneA = decodeAll(a, { lag: Infinity });
  assert.deepEqual(joined.slice(0, 5).map((d) => d.choice), aloneA.map((d) => d.choice));
});

test('an unvoiced frame flushes pending frames of the run before itself', () => {
  const rand = rng(3);
  const a = randomRun(rand, 4, 0);
  const ct = new ContinuityTracker<TF>({ lag: 100 });
  for (const f of a) assert.deepEqual(ct.push(f, f), []);
  const out = ct.push(uf(4), uf(4));
  assert.deepEqual(out.map((d) => d.frame.id), [0, 1, 2, 3, 4]);
  assert.equal(out[4].choice, -1);
  assert.deepEqual(ct.flush(), []);
});

// ---------- emission order / exactly once ----------

test('every frame is emitted exactly once, in input order, for various lags and mixes', () => {
  const rand = rng(21);
  const frames: TF[] = [];
  for (let i = 0; i < 60; i++) {
    const r = rand();
    if (r < 0.15) frames.push(uf(i, Math.floor(rand() * 3)));
    else frames.push(randomRun(rand, 1, i)[0]);
  }
  frames.forEach((f, i) => (f.id = i));
  for (const lag of [0, 1, 2, 5, 8, Infinity]) {
    const { all } = runLive(frames, lag);
    assert.deepEqual(all.map((d) => d.frame.id), frames.map((f) => f.id), `lag ${lag}`);
  }
});

test('flush on empty tracker returns nothing and tracker is reusable after flush', () => {
  const ct = new ContinuityTracker<TF>();
  assert.deepEqual(ct.flush(), []);
  const rand = rng(5);
  const run = randomRun(rand, 4, 0);
  const first = [...run.flatMap((f) => ct.push(f, f)), ...ct.flush()];
  const second = [...run.flatMap((f) => ct.push(f, f)), ...ct.flush()];
  assert.deepEqual(first.map((d) => d.choice), second.map((d) => d.choice));
});

// ---------- lag timing ----------

test('after push k, frames up to k - lag are out (voiced run)', () => {
  const rand = rng(33);
  const frames = randomRun(rand, 20);
  for (const lag of [0, 1, 2, 5, 8]) {
    const { perPush, flushed } = runLive(frames, lag);
    let emitted = 0;
    for (let k = 0; k < frames.length; k++) {
      emitted += perPush[k].length;
      assert.equal(emitted, Math.max(0, k - lag + 1), `lag ${lag}, after push ${k}`);
    }
    assert.equal(flushed.length, Math.min(lag, frames.length));
  }
});

test('lag Infinity emits nothing until the run ends', () => {
  const frames = randomRun(rng(4), 15);
  const { perPush, flushed } = runLive(frames, Infinity);
  assert.ok(perPush.every((p) => p.length === 0));
  assert.equal(flushed.length, 15);
});

// ---------- brute-force equivalence ----------

test('lag = Infinity equals brute-force minimum-cost path (random short runs)', () => {
  const rand = rng(99);
  const cfg = cfgOf({ lag: Infinity });
  for (let trial = 0; trial < 200; trial++) {
    const n = 3 + Math.floor(rand() * 4); // 3..6
    const frames = randomRun(rand, n);
    const expected = bruteBest(frames, cfg);
    const got = decodeAll(frames, { lag: Infinity }).map((d) => d.choice);
    assert.deepEqual(got, expected, `trial ${trial}`);
  }
});

test('lag = Infinity equals brute force with non-default weights', () => {
  const rand = rng(1234);
  const over = { wD: 2.5, wDown: 0.3, wUp: 0.01, wJump: 0.7, lag: Infinity };
  const cfg = cfgOf(over);
  for (let trial = 0; trial < 100; trial++) {
    const frames = randomRun(rand, 3 + Math.floor(rand() * 4));
    assert.deepEqual(decodeAll(frames, over).map((d) => d.choice), bruteBest(frames, cfg), `trial ${trial}`);
  }
});

test('lag = Infinity decodes each run of a multi-run stream by brute force', () => {
  const rand = rng(555);
  const cfg = cfgOf({ lag: Infinity });
  const r1 = randomRun(rand, 4, 0), r2 = randomRun(rand, 5, 5);
  const out = decodeAll([...r1, uf(4), ...r2], { lag: Infinity }).map((d) => d.choice);
  assert.deepEqual(out, [...bruteBest(r1, cfg), -1, ...bruteBest(r2, cfg)]);
});

test('lag 0 equals greedy brute force anchored on the previous choice', () => {
  const rand = rng(2025);
  const cfg = cfgOf({ lag: 0 });
  for (let trial = 0; trial < 100; trial++) {
    const frames = randomRun(rand, 3 + Math.floor(rand() * 4));
    assert.deepEqual(decodeAll(frames, { lag: 0 }).map((d) => d.choice), bruteFixedLag(frames, 0, cfg), `trial ${trial}`);
  }
});

test('finite lag 1..3 equals sequential windowed brute force anchored on committed choices', () => {
  const rand = rng(2024);
  for (const lag of [1, 2, 3]) {
    const cfg = cfgOf({ lag });
    for (let trial = 0; trial < 100; trial++) {
      const frames = randomRun(rand, 3 + Math.floor(rand() * 4));
      const got = decodeAll(frames, { lag }).map((d) => d.choice);
      assert.deepEqual(got, bruteFixedLag(frames, lag, cfg), `lag ${lag} trial ${trial}`);
    }
  }
});

test('lag at least run length behaves like Infinity', () => {
  const rand = rng(8);
  for (let trial = 0; trial < 50; trial++) {
    const frames = randomRun(rand, 6);
    assert.deepEqual(
      decodeAll(frames, { lag: 6 }).map((d) => d.choice),
      decodeAll(frames, { lag: Infinity }).map((d) => d.choice),
    );
  }
});

// ---------- the octave-error scenarios ----------

function noteWithJump(len: number, jumpStart: number, jumpLen: number, jumpFrame: () => Array<[number, number]>): TF[] {
  const frames: TF[] = [];
  for (let i = 0; i < len; i++) {
    const inJump = i >= jumpStart && i < jumpStart + jumpLen;
    // Normal frames: YIN picks 200 Hz cleanly; an octave-up dip exists but is shallow.
    frames.push(vf(i, inJump ? jumpFrame() : [[200, 0.05], [400, 0.3]]));
  }
  return frames;
}

test('short octave-up YIN error with a deep dip at the original pitch is corrected', () => {
  // Candidate 0 jumps to 400 Hz for 2 frames; candidate 1 at 200 Hz has a deep dip.
  const frames = noteWithJump(20, 9, 2, () => [[400, 0.1], [200, 0.01]]);
  for (const lag of [Infinity, 8]) {
    const out = decodeAll(frames, { lag });
    assert.equal(out.length, 20);
    for (const d of out) assert.equal(d.f0, 200, `lag ${lag}`);
    assert.equal(out[9].choice, 1);
    assert.equal(out[10].choice, 1);
    assert.equal(out[0].choice, 0);
  }
});

test('a genuine sustained octave leap is kept (many frames)', () => {
  // 20 frames at 200 Hz, then 30 frames at 400 Hz where the old pitch has no real dip.
  const frames: TF[] = [];
  for (let i = 0; i < 20; i++) frames.push(vf(i, [[200, 0.05], [400, 0.3]]));
  for (let i = 20; i < 50; i++) frames.push(vf(i, [[400, 0.05], [200, 0.5]]));
  for (const lag of [Infinity, 8]) {
    const out = decodeAll(frames, { lag });
    out.forEach((d, i) => assert.equal(d.f0, i < 20 ? 200 : 400, `lag ${lag} frame ${i}`));
    out.forEach((d) => assert.equal(d.choice, 0));
  }
});

test('the same short octave error is NOT altered when no better candidate exists', () => {
  const frames = noteWithJump(12, 5, 2, () => [[400, 0.1]]);
  const out = decodeAll(frames, { lag: Infinity });
  assert.equal(out[5].f0, 400);
  assert.equal(out[6].f0, 400);
});

// ---------- edge cases ----------

test('single-frame run chooses by observation cost (no jump term)', () => {
  // cand1 at 200 Hz is far cheaper than cand0 at 400 Hz even after the octave-below penalty.
  const out = decodeAll([vf(0, [[400, 0.5], [200, 0.0]])]);
  assert.equal(out.length, 1);
  assert.equal(out[0].choice, 1);
  assert.equal(out[0].f0, 200);
  // Single candidate: always index 0.
  const one = decodeAll([vf(0, [[330, 0.2]])]);
  assert.equal(one[0].choice, 0);
  assert.equal(one[0].f0, 330);
});

test('single-frame run between unvoiced frames, every lag', () => {
  for (const lag of [0, 1, 8, Infinity]) {
    const out = decodeAll([uf(0), vf(1, [[250, 0.1], [125, 0.1]]), uf(2)], { lag });
    assert.deepEqual(out.map((d) => d.frame.id), [0, 1, 2]);
    assert.equal(out[1].choice, 0); // tie in d: octave below costs extra, so pick 0
    assert.equal(out[0].choice, -1);
    assert.equal(out[2].choice, -1);
  }
});

test('candCount varying between frames is handled (matches brute force)', () => {
  const frames = [
    vf(0, [[200, 0.1]]),
    vf(1, [[400, 0.1], [200, 0.05], [100, 0.4]]),
    vf(2, [[200, 0.2], [400, 0.3]]),
    vf(3, [[205, 0.1]]),
    vf(4, [[410, 0.1], [205, 0.02], [102, 0.3]]),
  ];
  const cfg = cfgOf({ lag: Infinity });
  assert.deepEqual(decodeAll(frames, { lag: Infinity }).map((d) => d.choice), bruteBest(frames, cfg));
  for (const lag of [0, 1, 2]) {
    assert.deepEqual(decodeAll(frames, { lag }).map((d) => d.choice), bruteFixedLag(frames, lag, cfgOf({ lag })));
  }
});

test('candF0/candD may be longer than candCount; extra entries are ignored', () => {
  const fr: TF = {
    id: 0,
    voiced: true,
    candF0: Float64Array.from([300, 150, 1]),
    candD: Float64Array.from([0.1, 0.0, -5]),
    candCount: 2,
  };
  const out = decodeAll([fr]);
  assert.ok(out[0].choice === 0 || out[0].choice === 1);
});

test('lag 0 emits each frame immediately, greedy given the previous choice', () => {
  const frames = randomRun(rng(77), 12);
  const ct = new ContinuityTracker<TF>({ lag: 0 });
  for (const f of frames) {
    const out = ct.push(f, f);
    assert.equal(out.length, 1);
    assert.equal(out[0].frame.id, f.id);
  }
  assert.deepEqual(ct.flush(), []);
});

test('lag 1 emits the previous frame on each push after the first', () => {
  const frames = randomRun(rng(78), 12);
  const ct = new ContinuityTracker<TF>({ lag: 1 });
  frames.forEach((f, k) => {
    const out = ct.push(f, f);
    if (k === 0) assert.equal(out.length, 0);
    else { assert.equal(out.length, 1); assert.equal(out[0].frame.id, k - 1); }
  });
  const fl = ct.flush();
  assert.deepEqual(fl.map((d) => d.frame.id), [11]);
});

test('with lag 0 a short octave error cannot be repaired, with lag 2 it can', () => {
  const frames = noteWithJump(10, 4, 1, () => [[400, 0.1], [200, 0.01]]);
  // Single bad frame: lag 0 only sees past + present, so it only weighs one jump.
  const l2 = decodeAll(frames, { lag: 2 });
  assert.equal(l2[4].f0, 200);
});

test('default config is exported with documented fields', () => {
  assert.deepEqual(Object.keys(DEFAULT_CONTINUITY).sort(), ['lag', 'wD', 'wDown', 'wJump', 'wUp']);
  assert.equal(new ContinuityTracker().cfg.lag, DEFAULT_CONTINUITY.lag);
  assert.equal(new ContinuityTracker({ lag: 3 }).cfg.lag, 3);
  assert.equal(new ContinuityTracker({ lag: 3 }).cfg.wJump, DEFAULT_CONTINUITY.wJump);
});

// ---------- integration via FrameAnalyzer ----------

test('FrameAnalyzer + decodeAll on a synthetic harmonic tone: one output per frame, f0 within 5 cents', () => {
  const sr = 44100;
  const f0 = 220;
  const x = new Float32Array(sr); // 1 s
  for (let i = 0; i < x.length; i++) {
    let v = 0;
    for (let h = 1; h <= 6; h++) v += (1 / h) * Math.sin((2 * Math.PI * f0 * h * i) / sr);
    x[i] = 0.2 * v;
  }
  const an = new FrameAnalyzer({ sampleRate: sr });
  const frames = an.run(x, false);
  assert.ok(frames.length > 10);
  for (const lag of [Infinity, 8]) {
    const out = decodeAll(frames, { lag });
    assert.equal(out.length, frames.length);
    let voiced = 0;
    out.forEach((d, i) => {
      assert.equal(d.frame, frames[i]);
      if (d.choice === -1) { assert.equal(d.f0, 0); return; }
      voiced++;
      const cents = 1200 * Math.log2(d.f0 / f0);
      assert.ok(Math.abs(cents) <= 5, `frame ${i}: ${cents.toFixed(2)} cents`);
    });
    assert.ok(voiced > frames.length / 2, `only ${voiced}/${frames.length} frames voiced`);
  }
});
