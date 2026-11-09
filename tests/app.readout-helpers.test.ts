// Readout helpers, from design/DESIGN.md rev 2 section 2.9 and VA-19..VA-30, VA-45. Interface only is taken
// from src/app/readout.ts. The owner's decision: a deviation of exactly TOLERANCE_CENTS counts as WITHIN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signedFixed, centsLabel, noteGlyph, splitNote, directionFor, holdExpired, gateHintDue, shouldAnnounce,
  stableFor, EPS_MS, ANNOUNCE_HYSTERESIS_CENTS, ANNOUNCE_STABLE_MS,
} from '../src/app/readout.ts';
import { TOLERANCE_CENTS, HOLD_FULL_MS, GATE_HINT_MS } from '../src/app/readout-constants.ts';

const MINUS = '−';

// ---- VA-25 / VA-26: zero and the minus sign
test('VA-25: -0.4 c shows "0", not "-0" or U+2212 "0"', () => {
  const s = centsLabel(-0.4);
  assert.equal(s, '0');
  assert.ok(!s.includes('-') && !s.includes(MINUS));
});
test('zero in any form shows "0" with no sign', () => {
  for (const v of [0, -0, 0.4, 0.49, -0.49]) assert.equal(centsLabel(v), '0', String(v));
});
test('VA-26: -12.6 c shows U+2212 then 13', () => {
  const s = centsLabel(-12.6);
  assert.equal(s, `${MINUS}13`);
  assert.equal(s.charCodeAt(0), 0x2212);
  assert.ok(!s.includes('-'), 'no ASCII hyphen-minus');
});
test('positive cents are signed with +', () => {
  assert.equal(centsLabel(12.4), '+12');
  assert.equal(centsLabel(0.6), '+1');
});
test('negative rounds to a nonzero integer keeps U+2212, never ASCII hyphen', () => {
  assert.equal(centsLabel(-0.6), `${MINUS}1`);
  assert.equal(centsLabel(-50), `${MINUS}50`);
});
test('signedFixed: zero after rounding has no sign at any decimals', () => {
  assert.equal(signedFixed(-0.04, 1), '0.0');
  assert.equal(signedFixed(0.04, 1), '0.0');
  assert.equal(signedFixed(-0, 0), '0');
});
test('signedFixed: real minus sign and fixed decimals', () => {
  assert.equal(signedFixed(-1.25, 1).charCodeAt(0), 0x2212);
  assert.equal(signedFixed(-12.34, 1), `${MINUS}12.3`);
  assert.equal(signedFixed(3.14159, 2), '+3.14');
  assert.ok(!signedFixed(-7.5, 2).includes('-'));
});

// ---- direction (VA-22, 23, 24) and the tolerance edge
test('constants: tolerance is 10 c, hold and gate hint are 1000 ms', () => {
  assert.equal(TOLERANCE_CENTS, 10);
  assert.equal(HOLD_FULL_MS, 1000);
  assert.equal(GATE_HINT_MS, 1000);
});
test('VA-22/23: 20 c below is FLAT, 20 c above is SHARP', () => {
  assert.equal(directionFor(-20, TOLERANCE_CENTS), 'FLAT');
  assert.equal(directionFor(20, TOLERANCE_CENTS), 'SHARP');
});
test('VA-24: in tune and well inside tolerance is WITHIN', () => {
  for (const c of [0, 3, -3, 9, -9]) assert.equal(directionFor(c, TOLERANCE_CENTS), 'WITHIN', String(c));
});
test('exactly the tolerance counts as WITHIN, both sides', () => {
  assert.equal(directionFor(TOLERANCE_CENTS, TOLERANCE_CENTS), 'WITHIN');
  assert.equal(directionFor(-TOLERANCE_CENTS, TOLERANCE_CENTS), 'WITHIN');
});
test('one cent past the tolerance is not WITHIN', () => {
  assert.equal(directionFor(TOLERANCE_CENTS + 1, TOLERANCE_CENTS), 'SHARP');
  assert.equal(directionFor(-(TOLERANCE_CENTS + 1), TOLERANCE_CENTS), 'FLAT');
});
test('clearly past the tolerance by a fraction is not WITHIN', () => {
  assert.equal(directionFor(10.6, 10), 'SHARP');
  assert.equal(directionFor(-10.6, 10), 'FLAT');
});
test('the cue agrees with the number on the chip around the edge', () => {
  for (const c of [9.4, 9.6, 10, 10.6, 11, -9.6, -10, -10.6, -11]) {
    const shown = Number(centsLabel(c).replace(MINUS, '-'));
    const expected = Math.abs(shown) <= 10 ? 'WITHIN' : shown < 0 ? 'FLAT' : 'SHARP';
    assert.equal(directionFor(c, 10), expected, `cents ${c} chip ${centsLabel(c)}`);
  }
});
test('tolerance is a parameter', () => {
  assert.equal(directionFor(15, 20), 'WITHIN');
  assert.equal(directionFor(25, 20), 'SHARP');
});

// ---- VA-29 / VA-30: hold boundary. Frame times (Frame.t) are in seconds; hold and gate durations are in ms.
test('VA-29: 999 ms after the last voiced frame is not expired', () => {
  assert.equal(holdExpired(5.999, 5, HOLD_FULL_MS), false);
  assert.equal(holdExpired(0.999, 0, HOLD_FULL_MS), false);
});
test('VA-30: 1000 ms after the last voiced frame is expired', () => {
  assert.equal(holdExpired(6, 5, HOLD_FULL_MS), true);
  assert.equal(holdExpired(1, 0, HOLD_FULL_MS), true);
});
test('hold: well past is expired, same instant is not', () => {
  assert.equal(holdExpired(9, 5, HOLD_FULL_MS), true);
  assert.equal(holdExpired(5, 5, HOLD_FULL_MS), false);
});
test('hold: float clock error right at 1.0 s still counts as 1000 ms (EPS_MS)', () => {
  assert.ok(EPS_MS > 0 && EPS_MS < 1, 'EPS_MS is a small positive slack');
  const last = 0.1 + 0.2; // 0.30000000000000004
  assert.equal(holdExpired(last + 1 - 1e-12, last, 1000), true);
  let t = 0; for (let i = 0; i < 10; i++) t += 0.1; // 0.9999999999999999
  assert.equal(holdExpired(t, 0, 1000), true);
});
test('hold: 999.5 ms stays below even with slack', () => {
  assert.equal(holdExpired(0.9995, 0, 1000), false);
});
test('hold: uses holdMs, not a fixed number', () => {
  assert.equal(holdExpired(0.5, 0, 500), true);
  assert.equal(holdExpired(0.499, 0, 500), false);
});
test('hold: never voiced is not "expired" (no note to dim)', () => {
  assert.equal(holdExpired(10, null, 1000), false);
});
test('hold: no newer frame is not expired', () => {
  assert.equal(holdExpired(null, 0, 1000), false);
});

// ---- VA-19 / VA-20: gate hint timing
test('VA-19: below the gate for 999 ms, hint is not due', () => {
  assert.equal(gateHintDue(0.999, 0, GATE_HINT_MS), false);
  assert.equal(gateHintDue(10.999, 10, GATE_HINT_MS), false);
});
test('VA-20: below the gate for 1000 ms or more, hint is due', () => {
  assert.equal(gateHintDue(1, 0, GATE_HINT_MS), true);
  assert.equal(gateHintDue(11, 10, GATE_HINT_MS), true);
  assert.equal(gateHintDue(60, 10, GATE_HINT_MS), true);
});
test('gate hint: level at or above the gate (no run) is never due', () => {
  assert.equal(gateHintDue(60, null, GATE_HINT_MS), false);
});
test('gate hint: no frame yet is never due', () => {
  assert.equal(gateHintDue(null, 0, GATE_HINT_MS), false);
});
test('gate hint: float error right at 1.0 s still fires', () => {
  let t = 0; for (let i = 0; i < 10; i++) t += 0.1;
  assert.equal(gateHintDue(t, 0, 1000), true);
});

// ---- VA-21: note glyph and octave split
test('noteGlyph turns # into the sharp glyph U+266F', () => {
  assert.equal(noteGlyph('A#4'), 'A♯4');
  assert.equal(noteGlyph('A#4').charCodeAt(1), 0x266f);
});
test('noteGlyph leaves naturals alone', () => {
  assert.equal(noteGlyph('A4'), 'A4');
  assert.equal(noteGlyph('C2'), 'C2');
});
test('VA-21: A4 splits into "A", "", "4"', () => {
  const p = splitNote('A4');
  assert.equal(p.letter, 'A'); assert.equal(p.acc, ''); assert.equal(p.oct, '4');
});
test('sharp splits into letter, glyph, octave, and spoken "A sharp 4" (2.9 accessible name)', () => {
  const p = splitNote('A#4');
  assert.equal(p.letter, 'A'); assert.equal(p.acc, '♯'); assert.equal(p.oct, '4');
  assert.equal(p.spoken, 'A sharp 4');
});
test('natural spoken name has no "sharp"', () => {
  assert.equal(splitNote('A4').spoken, 'A 4');
});
test('octave edge cases: 0 and 10-style two digits and negative octaves', () => {
  assert.equal(splitNote('C0').oct, '0');
  assert.equal(splitNote('F#0').acc, '♯');
  assert.equal(splitNote('C-1').oct, '-1');
  assert.equal(splitNote('C-1').letter, 'C');
  assert.equal(splitNote('G#10').oct, '10');
});
test('every pitch class splits to one letter A-G', () => {
  for (const n of ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']) {
    const p = splitNote(`${n}3`);
    assert.match(p.letter, /^[A-G]$/);
    assert.equal(p.acc, n.endsWith('#') ? '♯' : '');
    assert.equal(p.oct, '3');
  }
});

// ---- announcements (2.9 screen readers, VA-45)
const A4 = { note: 'A4', targetHz: 440, dir: 'WITHIN' as const };
const hzAt = (cents: number) => 440 * Math.pow(2, cents / 1200);
/** The reading the tracker would give for a pitch `c` cents above A4. */
const reading = (c: number) =>
  c > 50 ? { note: 'A#4', cents: c - 100, f0: hzAt(c) }
  : c < -50 ? { note: 'G#4', cents: c + 100, f0: hzAt(c) }
  : { note: 'A4', cents: c, f0: hzAt(c) };

test('constants: hysteresis positive, stable time positive and short enough to be "at once"', () => {
  assert.ok(ANNOUNCE_HYSTERESIS_CENTS > 0);
  assert.ok(ANNOUNCE_STABLE_MS > 0 && ANNOUNCE_STABLE_MS <= 1000);
});
test('first reading always announces', () => {
  assert.equal(shouldAnnounce(null, reading(0), TOLERANCE_CENTS), true);
});
test('same note, same direction does not announce', () => {
  assert.equal(shouldAnnounce(A4, reading(2), TOLERANCE_CENTS), false);
});
test('a clearly new note announces', () => {
  assert.equal(shouldAnnounce(A4, { note: 'C5', cents: 0, f0: 523.25 }, TOLERANCE_CENTS), true);
  assert.equal(shouldAnnounce(A4, reading(150 - 100 + 100), TOLERANCE_CENTS), true); // 150 c up, A#4/B4 area
});
test('a note one semitone away, centred, announces', () => {
  assert.equal(shouldAnnounce(A4, { note: 'A#4', cents: 0, f0: hzAt(100) }, TOLERANCE_CENTS), true);
  assert.equal(shouldAnnounce(A4, { note: 'G#4', cents: 0, f0: hzAt(-100) }, TOLERANCE_CENTS), true);
});
test('a clear direction change on the same note announces', () => {
  assert.equal(shouldAnnounce(A4, reading(25), TOLERANCE_CENTS), true);
  assert.equal(shouldAnnounce(A4, reading(-25), TOLERANCE_CENTS), true);
  assert.equal(shouldAnnounce({ ...A4, dir: 'SHARP' }, reading(0), TOLERANCE_CENTS), true);
  assert.equal(shouldAnnounce({ ...A4, dir: 'FLAT' }, reading(25), TOLERANCE_CENTS), true);
});
test('vibrato around 0 c (WITHIN to WITHIN) never re-announces', () => {
  for (let i = 0; i < 200; i++) {
    const c = 8 * Math.sin((2 * Math.PI * 5.5 * i * 10) / 1000);
    assert.equal(shouldAnnounce(A4, reading(c), TOLERANCE_CENTS), false, `c=${c}`);
  }
});
test('vibrato across 0 c after a SHARP announcement stays quiet while it does not settle WITHIN', () => {
  const sharp = { ...A4, dir: 'SHARP' as const };
  for (const c of [20, 18, 16, 14, 18, 22]) assert.equal(shouldAnnounce(sharp, reading(c), TOLERANCE_CENTS), false, String(c));
});
test('vibrato across the tolerance edge does not re-announce', () => {
  // last announced WITHIN, singer wobbles +/-3 c around the 10 c edge.
  for (const c of [8, 9, 10, 11, 12, 11, 10, 9, 8]) assert.equal(shouldAnnounce(A4, reading(c), TOLERANCE_CENTS), false, String(c));
  const sharp = { ...A4, dir: 'SHARP' as const };
  for (const c of [12, 11, 10, 9, 8, 9, 10, 11, 12]) assert.equal(shouldAnnounce(sharp, reading(c), TOLERANCE_CENTS), false, String(c));
});
test('vibrato around +50 c (A4/A#4 boundary) does not re-announce', () => {
  const sharpA4 = { ...A4, dir: 'SHARP' as const };
  for (const c of [46, 48, 50, 52, 54, 52, 50, 48, 46]) assert.equal(shouldAnnounce(sharpA4, reading(c), TOLERANCE_CENTS), false, String(c));
  const asSharpNote = { note: 'A#4', targetHz: hzAt(100), dir: 'FLAT' as const };
  for (const c of [54, 52, 50, 48, 46]) assert.equal(shouldAnnounce(asSharpNote, reading(c), TOLERANCE_CENTS), false, String(c));
});
test('vibrato around -50 c (A4/G#4 boundary) does not re-announce', () => {
  const flatA4 = { ...A4, dir: 'FLAT' as const };
  for (const c of [-46, -48, -50, -52, -54, -52, -50, -48, -46]) assert.equal(shouldAnnounce(flatA4, reading(c), TOLERANCE_CENTS), false, String(c));
});
test('moving well past the +50 c boundary announces the new note', () => {
  assert.equal(shouldAnnounce(A4, reading(65), TOLERANCE_CENTS), true);
  assert.equal(shouldAnnounce(A4, reading(-65), TOLERANCE_CENTS), true);
});
test('hysteresis argument is honoured: with 0 the boundary flip announces', () => {
  assert.equal(shouldAnnounce(A4, reading(52), TOLERANCE_CENTS, 0), true);
  assert.equal(shouldAnnounce(A4, reading(52), TOLERANCE_CENTS), false);
});

test('stableFor: a change must hold ANNOUNCE_STABLE_MS (frame clock in seconds)', () => {
  const ms = ANNOUNCE_STABLE_MS;
  assert.equal(stableFor(1 + (ms - 1) / 1000, 1), false);
  assert.equal(stableFor(1 + ms / 1000, 1), true);
  assert.equal(stableFor(1 + (ms + 500) / 1000, 1), true);
});
test('stableFor: a change that just appeared is not stable', () => {
  assert.equal(stableFor(1, 1), false);
});
test('stableFor: custom window', () => {
  assert.equal(stableFor(0.149, 0, 150), false);
  assert.equal(stableFor(0.15, 0, 150), true);
});
test('stableFor: no pending change is not stable', () => {
  assert.equal(stableFor(5, null), false);
});
test('VA-45 shape: 60 different-note frames in 1 s announce at most once when gated by stableFor', () => {
  // Each frame shows a different note, so the pending change restarts every frame and never gets stable.
  let announced = 0, pendingSince: number | null = null, pendingNote = '';
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const note = `N${i}`;
    if (note !== pendingNote) { pendingNote = note; pendingSince = t; }
    if (stableFor(t, pendingSince)) announced++;
  }
  assert.ok(announced <= 1, `announced ${announced}`);
});
