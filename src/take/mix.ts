// Mono mix (specs/M2.md 4.2 item 4, FINAL): arithmetic mean of all channels per sample in float64,
// summed in channel order and then divided, exactly as tools/wav.ts does, so parity is bit-exact.

export function mixToMono(channels: ArrayLike<number>[]): Float64Array {
  const nch = channels.length;
  if (nch === 0) return new Float64Array(0);
  let n = channels[0].length;
  for (let c = 1; c < nch; c++) n = Math.min(n, channels[c].length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < nch; c++) acc += channels[c][i];
    out[i] = acc / nch;
  }
  return out;
}
