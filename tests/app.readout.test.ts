// Readout numbers, from DESIGN.md 2.9 and VA-21..VA-26. The helpers in views/voice.ts (signedFixed, splitNote,
// direction and hold logic) are not exported, so this file tests what is exported: nearestNote (src/dsp/pitch.ts)
// and readout-constants.ts. See the report for the untestable parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestNote } from '../src/dsp/pitch.ts';
import { TOLERANCE_CENTS, HOLD_FULL_MS, GATE_HINT_MS } from '../src/app/readout-constants.ts';

const hz = (a4: number, semisFromA4: number) => a4 * Math.pow(2, semisFromA4 / 12);
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('constants match 2.9: tolerance 10 c, hold 1000 ms, gate hint 1000 ms', () => {
  assert.equal(TOLERANCE_CENTS, 10);
  assert.equal(HOLD_FULL_MS, 1000);
  assert.equal(GATE_HINT_MS, 1000);
});

test('TOLERANCE_CENTS fits inside the meter track (0 < tol < 50) so the zone is drawable', () => {
  assert.ok(TOLERANCE_CENTS > 0 && TOLERANCE_CENTS < 50);
});

test('440 Hz at A4 = 440 is A4 with 0 cents (VA-21)', () => {
  const r = nearestNote(440, 440);
  assert.equal(r.name, 'A4');
  assert.equal(r.midi, 69);
  near(r.cents, 0);
  near(r.targetHz, 440);
});

for (const a4 of [415, 440, 466]) {
  test(`A4 = ${a4}: ${a4} Hz is A4 at 0 c, and 440 Hz is judged against the new reference`, () => {
    const r = nearestNote(a4, a4);
    assert.equal(r.name, 'A4');
    near(r.cents, 0);
    near(r.targetHz, a4);
    const r440 = nearestNote(440, a4);
    const expected = 1200 * Math.log2(440 / a4);
    // 440 is judged against the chosen reference, not against 440
    const semis = expected / 100;
    const n = Math.round(semis);
    near(r440.cents, expected - 100 * n, 1e-6);
    near(r440.targetHz, a4 * Math.pow(2, n / 12), 1e-6);
  });
}

test('A4 = 415: 440 Hz reads as A#4, about +1.4 c (not A4)', () => {
  const r = nearestNote(440, 415);
  assert.equal(r.name, 'A#4');
  near(r.cents, 1200 * Math.log2(440 / 415) - 100, 1e-6);
});

test('A4 = 466: 440 Hz reads as G#4, about +0.7 c', () => {
  const r = nearestNote(440, 466);
  assert.equal(r.name, 'G#4');
  near(r.cents, 1200 * Math.log2(440 / 466) + 100, 1e-6);
});

test('octave number changes between B and C, not between A and B (B3 -> C4)', () => {
  assert.equal(nearestNote(hz(440, -10), 440).name, 'B3');
  assert.equal(nearestNote(hz(440, -9), 440).name, 'C4');
  assert.equal(nearestNote(hz(440, -11), 440).name, 'A#3');
  assert.equal(nearestNote(hz(440, 2), 440).name, 'B4');
  assert.equal(nearestNote(hz(440, 3), 440).name, 'C5');
});

test('middle C is C4 (MIDI 60) and C0 / low octaves do not produce a negative-octave glitch', () => {
  const c4 = nearestNote(261.6255653005986, 440);
  assert.equal(c4.name, 'C4'); assert.equal(c4.midi, 60); near(c4.cents, 0, 1e-6);
  assert.equal(nearestNote(hz(440, -57), 440).name, 'C0');
  assert.equal(nearestNote(hz(440, -69), 440).name, 'C-1');
});

test('accidentals are named with sharps (note name feeds "A sharp 4")', () => {
  assert.equal(nearestNote(hz(440, 1), 440).name, 'A#4');
  assert.equal(nearestNote(hz(440, -1), 440).name, 'G#4');
});

test('20 cents below and above a note: negative / positive deviation (VA-22, VA-23)', () => {
  const lo = nearestNote(440 * Math.pow(2, -20 / 1200), 440);
  const hi = nearestNote(440 * Math.pow(2, 20 / 1200), 440);
  assert.equal(lo.name, 'A4'); near(lo.cents, -20);
  assert.equal(hi.name, 'A4'); near(hi.cents, 20);
});

test('cents stay within the meter range [-50, +50] everywhere, with a sweep over two octaves', () => {
  for (let c = -2400; c <= 2400; c += 0.5) {
    const r = nearestNote(440 * Math.pow(2, c / 1200), 440);
    assert.ok(r.cents >= -50 - 1e-9 && r.cents <= 50 + 1e-9, `cents ${r.cents} at ${c}`);
  }
});

test('exactly +-50 c lands on one of the two neighbours with a deviation of magnitude 50', () => {
  const up = nearestNote(440 * Math.pow(2, 50 / 1200), 440);
  assert.ok(up.name === 'A4' || up.name === 'A#4');
  assert.ok(Math.abs(Math.abs(up.cents) - 50) < 1e-6, `got ${up.cents}`);
  const down = nearestNote(440 * Math.pow(2, -50 / 1200), 440);
  assert.ok(down.name === 'A4' || down.name === 'G#4');
  assert.ok(Math.abs(Math.abs(down.cents) - 50) < 1e-6, `got ${down.cents}`);
});

test('49.9 c above A4 is still A4, 50.1 c above is A#4 with a negative deviation', () => {
  const a = nearestNote(440 * Math.pow(2, 49.9 / 1200), 440);
  assert.equal(a.name, 'A4'); near(a.cents, 49.9, 1e-6);
  const b = nearestNote(440 * Math.pow(2, 50.1 / 1200), 440);
  assert.equal(b.name, 'A#4'); near(b.cents, -49.9, 1e-6);
});

test('tolerance edge: 10 c above is on the boundary, 10.5 c is outside, 9.5 c inside (deviation, not rounding)', () => {
  const dev = (c: number) => nearestNote(440 * Math.pow(2, c / 1200), 440).cents;
  assert.ok(Math.abs(dev(TOLERANCE_CENTS - 0.5)) < TOLERANCE_CENTS);
  assert.ok(Math.abs(dev(TOLERANCE_CENTS + 0.5)) > TOLERANCE_CENTS);
  near(Math.abs(dev(TOLERANCE_CENTS)), TOLERANCE_CENTS, 1e-9);
  assert.ok(Math.abs(dev(-(TOLERANCE_CENTS + 0.5))) > TOLERANCE_CENTS);
});
