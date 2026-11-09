// F-30 (specs/M2.md 4.6, revision 2.5): analyzeVibrato reports a synthetic vibrato of +-10 c (4.5 and 7.5 Hz) and returns
// "none found" (null) at +-2 c. The floor is read from the exported VIB_MIN_EXTENT_C, never hardcoded. Boundary pinned at
// floor + 1.5 c (found) and floor - 1.5 c (none found) on a clean sine contour.
// The M1 vibrato criteria are read from results/summary.json `thresholds` (vib_rate, vib_extent_rel), as tests/app.checks.test.ts does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './take.helpers.ts';

const vibMod = () => import('../src/dsp/vibrato.ts');
const TH = JSON.parse(readFileSync(join(ROOT, 'results/summary.json'), 'utf8')).thresholds as { vib_rate: number; vib_extent_rel: number };

/** Clean sine vibrato contour on the analyser's frame grid (hop 256 at 48 kHz), 3 s, carrier 220 Hz. */
function contour(rateHz: number, extentC: number, dur = 3) {
  const dt = 256 / 48000;
  const n = Math.floor(dur / dt);
  return Array.from({ length: n }, (_, i) => {
    const t = i * dt + 0.0107;
    return { t, f0: 220 * 2 ** ((extentC * Math.sin(2 * Math.PI * rateHz * t)) / 1200) };
  });
}

test('F-30 setup: thresholds are read from summary.json and the floor is an exported positive number', async () => {
  const { VIB_MIN_EXTENT_C } = await vibMod();
  assert.ok(Number.isFinite(VIB_MIN_EXTENT_C) && VIB_MIN_EXTENT_C > 0);
  assert.ok(VIB_MIN_EXTENT_C > 2 && VIB_MIN_EXTENT_C < 10, `the F-30 cases (+-2 c none, +-10 c found) need 2 < floor < 10, got ${VIB_MIN_EXTENT_C}`);
  assert.ok(TH.vib_rate > 0 && TH.vib_extent_rel > 0);
});

for (const rate of [4.5, 7.5]) {
  test(`F-30: +-10 c vibrato at ${rate} Hz is reported, rate and extent within the M1 criteria`, async () => {
    const { analyzeVibrato } = await vibMod();
    const r = analyzeVibrato(contour(rate, 10));
    assert.ok(r, 'vibrato found');
    assert.ok(Math.abs(r.rateHz - rate) <= TH.vib_rate, `rate ${r.rateHz} vs ${rate}`);
    assert.ok(Math.abs(r.extentCents - 10) / 10 <= TH.vib_extent_rel, `extent ${r.extentCents} vs 10`);
  });

  test(`F-30: +-2 c at ${rate} Hz is "none found" (null)`, async () => {
    const { analyzeVibrato } = await vibMod();
    assert.equal(analyzeVibrato(contour(rate, 2)), null);
  });
}

for (const rate of [4.5, 7.5]) {
  test(`F-30 boundary: floor + 1.5 c at ${rate} Hz is found with extent within the M1 criterion`, async () => {
    const { analyzeVibrato, VIB_MIN_EXTENT_C } = await vibMod();
    const e = VIB_MIN_EXTENT_C + 1.5;
    const r = analyzeVibrato(contour(rate, e));
    assert.ok(r, `vibrato of +-${e} c found`);
    assert.ok(Math.abs(r.extentCents - e) / e <= TH.vib_extent_rel, `extent ${r.extentCents} vs ${e}`);
    assert.ok(Math.abs(r.rateHz - rate) <= TH.vib_rate);
  });

  test(`F-30 boundary: floor - 1.5 c at ${rate} Hz is "none found" (null)`, async () => {
    const { analyzeVibrato, VIB_MIN_EXTENT_C } = await vibMod();
    assert.equal(analyzeVibrato(contour(rate, VIB_MIN_EXTENT_C - 1.5)), null);
  });
}

test('F-30: a perfectly steady contour is "none found"', async () => {
  const { analyzeVibrato } = await vibMod();
  assert.equal(analyzeVibrato(contour(5.5, 0)), null);
});
