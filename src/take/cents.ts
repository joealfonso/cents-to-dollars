// Cents of each whole-take F0 above A4 = a4 (MEASUREMENT.md 2). NaN where the frame is unvoiced (f0 == 0).
// Recomputed when A4 changes; F0 itself never depends on A4 (F-22).

export function centsSeries(f0: Float64Array, a4: number): Float64Array {
  const out = new Float64Array(f0.length);
  for (let i = 0; i < f0.length; i++) out[i] = f0[i] > 0 ? 1200 * Math.log2(f0[i] / a4) : NaN;
  return out;
}
