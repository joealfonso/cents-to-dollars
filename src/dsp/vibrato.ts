// Vibrato rate and extent from an F0 contour. Definition in MEASUREMENT.md section 3.
// Works on any uniformly spaced contour (this tracker, pYIN or Praat), so all three are scored
// by the same code.

export interface ContourFrame { t: number; f0: number } // f0 = 0 means unvoiced

export interface VibratoResult {
  rateHz: number;
  /** Plus or minus extent in cents: half the median peak-to-trough distance. */
  extentCents: number;
  /** Peak-to-peak extent in cents (2 x extentCents), reported for convenience. */
  extentPeakToPeakCents: number;
  /** Number of half cycles (peak to trough or trough to peak) used. */
  halfCycles: number;
  /** Start and end time of the analysed voiced segment. */
  segment: [number, number];
}

export interface VibratoOptions {
  minRateHz: number;
  maxRateHz: number;
  /** Unvoiced gaps up to this many frames are bridged by linear interpolation in cents. */
  maxGapFrames: number;
  minDurationS: number;
}

export const DEFAULT_VIBRATO: VibratoOptions = { minRateHz: 3, maxRateHz: 9, maxGapFrames: 3, minDurationS: 0.5 };

function longestVoicedRun(frames: ContourFrame[], maxGap: number): [number, number] | null {
  let best: [number, number] | null = null;
  let start = -1;
  let lastVoiced = -1;
  for (let i = 0; i <= frames.length; i++) {
    const v = i < frames.length && frames[i].f0 > 0;
    if (v) {
      if (start < 0 || i - lastVoiced - 1 > maxGap) {
        if (start >= 0 && (!best || lastVoiced - start > best[1] - best[0])) best = [start, lastVoiced];
        start = i;
      }
      lastVoiced = i;
    }
  }
  if (start >= 0 && (!best || lastVoiced - start > best[1] - best[0])) best = [start, lastVoiced];
  return best;
}

export function analyzeVibrato(frames: ContourFrame[], opts: Partial<VibratoOptions> = {}): VibratoResult | null {
  const o = { ...DEFAULT_VIBRATO, ...opts };
  const run = longestVoicedRun(frames, o.maxGapFrames);
  if (!run) return null;
  const seg = frames.slice(run[0], run[1] + 1);
  const n = seg.length;
  if (n < 8) return null;
  const t = seg.map((f) => f.t);
  const dt = (t[n - 1] - t[0]) / (n - 1);
  if (t[n - 1] - t[0] < o.minDurationS) return null;

  // Cents on an arbitrary fixed reference (vibrato is a difference, so the reference cancels).
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = seg[i].f0 > 0 ? 1200 * Math.log2(seg[i].f0 / 440) : NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(c[i])) continue;
    let a = i - 1; while (a >= 0 && Number.isNaN(c[a])) a--;
    let b = i + 1; while (b < n && Number.isNaN(c[b])) b++;
    c[i] = a < 0 ? c[b] : b >= n ? c[a] : c[a] + ((c[b] - c[a]) * (i - a)) / (b - a);
  }

  // Linear detrend for the autocorrelation rate estimate.
  let st = 0, sc = 0, stt = 0, stc = 0;
  for (let i = 0; i < n; i++) { st += i; sc += c[i]; stt += i * i; stc += i * c[i]; }
  const slope = (n * stc - st * sc) / (n * stt - st * st);
  const icpt = (sc - slope * st) / n;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = c[i] - (icpt + slope * i);

  // Rate estimate: highest normalized autocorrelation peak in the allowed lag range.
  const lagMin = Math.max(2, Math.floor(1 / (o.maxRateHz * dt)));
  const lagMax = Math.min(n - 2, Math.ceil(1 / (o.minRateHz * dt)));
  if (lagMax <= lagMin + 1) return null;
  const ac = new Float64Array(lagMax + 2);
  for (let L = lagMin - 1; L <= lagMax + 1; L++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i + L < n; i++) { s += d[i] * d[i + L]; e1 += d[i] * d[i]; e2 += d[i + L] * d[i + L]; }
    ac[L] = s / Math.sqrt(e1 * e2 + 1e-12);
  }
  let bestL = -1;
  for (let L = lagMin; L <= lagMax; L++) {
    if (ac[L] > ac[L - 1] && ac[L] >= ac[L + 1] && (bestL < 0 || ac[L] > ac[bestL])) bestL = L;
  }
  if (bestL < 0 || ac[bestL] < 0.3) return null; // no clear periodic modulation
  const den = ac[bestL - 1] - 2 * ac[bestL] + ac[bestL + 1];
  const lagF = den < 0 ? bestL + (0.5 * (ac[bestL - 1] - ac[bestL + 1])) / den : bestL;
  const periodFrames = lagF;

  // Trend: centred boxcar exactly one estimated period long (fractional edge weights),
  // which has a spectral zero at the vibrato rate. Only frames with a full window are kept.
  const h = periodFrames / 2;
  const hi = Math.ceil(h + 0.5);
  const osc: number[] = [];
  const oscT: number[] = [];
  for (let i = hi; i < n - hi; i++) {
    let s = 0, w = 0;
    for (let k = -hi; k <= hi; k++) {
      const wk = Math.min(1, Math.max(0, h + 0.5 - Math.abs(k)));
      s += wk * c[i + k];
      w += wk;
    }
    osc.push(c[i] - s / w);
    oscT.push(t[i]);
  }
  const m = osc.length;
  if (m < periodFrames * 1.5) return null;

  // Alternating extrema, each the maximum (or minimum) within plus or minus a quarter period.
  const q = Math.max(1, Math.round(periodFrames / 4));
  const ext: { t: number; v: number; max: boolean }[] = [];
  for (let i = 1; i < m - 1; i++) {
    let isMax = true, isMin = true;
    for (let k = Math.max(0, i - q); k <= Math.min(m - 1, i + q); k++) {
      if (k === i) continue;
      if (osc[k] > osc[i]) isMax = false;
      if (osc[k] < osc[i]) isMin = false;
    }
    if (!isMax && !isMin) continue;
    // Skip extrema whose window is cut by the segment edge (they may not be true turning points).
    if (i - q < 0 || i + q > m - 1) continue;
    const y0 = osc[i - 1], y1 = osc[i], y2 = osc[i + 1];
    const dd = y0 - 2 * y1 + y2;
    const sh = dd !== 0 ? Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / dd)) : 0;
    const v = y1 - 0.25 * (y0 - y2) * sh;
    const te = oscT[i] + sh * dt;
    const type = isMax;
    if (ext.length && ext[ext.length - 1].max === type) {
      const prev = ext[ext.length - 1];
      if ((type && v > prev.v) || (!type && v < prev.v)) ext[ext.length - 1] = { t: te, v, max: type };
    } else {
      ext.push({ t: te, v, max: type });
    }
  }
  if (ext.length < 4) return null;

  const swings: number[] = [];
  for (let i = 1; i < ext.length; i++) swings.push(Math.abs(ext[i].v - ext[i - 1].v));
  swings.sort((a, b) => a - b);
  const mid = swings.length >> 1;
  const medianSwing = swings.length % 2 ? swings[mid] : 0.5 * (swings[mid - 1] + swings[mid]);
  const halfCycles = ext.length - 1;
  const rateHz = halfCycles / (2 * (ext[ext.length - 1].t - ext[0].t));
  return {
    rateHz,
    extentCents: medianSwing / 2,
    extentPeakToPeakCents: medianSwing,
    halfCycles,
    segment: [t[0], t[n - 1]],
  };
}
