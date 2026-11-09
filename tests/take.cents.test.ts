// F-22: recomputing cents from stored F0 with A4 442 instead of 440 changes every cents value by -7.85 c
// (to 0.01 c) and changes no F0. specs/M2.1-API.md: centsSeries(f0, a4) is NaN where f0 == 0.
// Expected values are computed here from the definition, 1200 log2(442/440), not read from the module.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const centsMod = () => import('../src/take/cents.ts');

// Frequencies chosen so the offset from the nearest equal-tempered note is within +-30 c at A4 = 440 AND at 442
// (so the answer is the same whether the series is cents from A4 or deviation from the nearest note).
const A4 = 440;
const F0 = Float64Array.from([
  A4, A4 * 2 ** (20 / 1200), A4 * 2 ** (-25 / 1200), 261.6255653005986 * 2 ** (10 / 1200), 110 * 2 ** (-15 / 1200), 880 * 2 ** (5 / 1200),
  329.6275569128699 * 2 ** (12 / 1200),
]);

test('F-22: A4 442 vs 440 shifts every cents value by -7.85 c (to 0.01 c)', async () => {
  const { centsSeries } = await centsMod();
  const c440 = centsSeries(F0, 440);
  const c442 = centsSeries(F0, 442);
  assert.equal(c440.length, F0.length);
  assert.equal(c442.length, F0.length);
  const exact = -1200 * Math.log2(442 / 440);
  assert.ok(Math.abs(exact + 7.85) < 0.01, 'sanity: the spec number is the definition');
  for (let i = 0; i < F0.length; i++) {
    const d = c442[i] - c440[i];
    assert.ok(Math.abs(d - -7.85) <= 0.01, `index ${i}: shift ${d}, expected -7.85 +- 0.01`);
    assert.ok(Math.abs(d - exact) <= 1e-9, `index ${i}: shift ${d} should equal the definition ${exact}`);
  }
});

test('F-22: centsSeries does not change F0 (input untouched, output is a new array)', async () => {
  const { centsSeries } = await centsMod();
  const before = F0.slice();
  const out = centsSeries(F0, 442);
  assert.deepEqual(Array.from(F0), Array.from(before));
  assert.notEqual(out.buffer, F0.buffer);
  centsSeries(F0, 440);
  assert.deepEqual(Array.from(F0), Array.from(before));
});

test('F-22: cents values are in cents (440 Hz at A4 440 reads 0; a semitone up is 100 c off an A4 note)', async () => {
  const { centsSeries } = await centsMod();
  const c = centsSeries(Float64Array.from([440]), 440);
  assert.ok(Math.abs(c[0]) < 1e-9, `440 Hz at A4 440 is ${c[0]}`);
  // Raising A4 lowers the reading of a fixed F0.
  const a = centsSeries(Float64Array.from([440 * 2 ** (20 / 1200)]), 440)[0];
  assert.ok(Math.abs(Math.abs(a) - 20) < 1e-6, `20 c above A4 reads magnitude ${a}`);
});

test('F-22 / API: centsSeries is NaN exactly where f0 is 0 (unvoiced), for both A4 values', async () => {
  const { centsSeries } = await centsMod();
  const f0 = Float64Array.from([0, 220, 0, 0, 330, 0]);
  for (const a4 of [440, 442]) {
    const c = centsSeries(f0, a4);
    f0.forEach((v, i) => {
      if (v === 0) assert.ok(Number.isNaN(c[i]), `a4 ${a4} index ${i} should be NaN, got ${c[i]}`);
      else assert.ok(Number.isFinite(c[i]), `a4 ${a4} index ${i} should be finite, got ${c[i]}`);
    });
  }
  assert.equal(centsSeries(new Float64Array(0), 440).length, 0);
});
