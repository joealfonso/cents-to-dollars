// YIN fundamental frequency estimator (de Cheveigne and Kawahara, 2002, JASA 111(4):1917-1930).
// Steps implemented: (2) difference function, (3) cumulative mean normalized difference,
// (4) absolute threshold, (5) parabolic interpolation. Step 6 (best local estimate) is not used.
// The difference function is computed with an FFT cross-correlation plus prefix sums of energy,
// which is exact (up to float rounding) and much cheaper than the direct double loop.
// See MEASUREMENT.md section 1 for the exact definition this file implements.

import { FFT } from './fft.ts';

export interface YinConfig {
  sampleRate: number;
  /** Total samples per analysis buffer (N). */
  bufferSize: number;
  /** Integration window (W). Lags searched are 0..N-W. */
  windowSize: number;
  fMin: number;
  fMax: number;
  /** Absolute threshold on the cumulative mean normalized difference. */
  threshold: number;
  /** Frames whose window RMS is below this level (dBFS) are unvoiced. */
  silenceDb: number;
  /** Octave-up guard: move to the dip near 2*tau when it is below this fraction of the current dip. 0 disables. */
  octaveRatio: number;
  /** The octave guard only runs when the chosen dip is at least this deep-valued (a shallow, suspicious dip). */
  octaveMinDip: number;
  /** Candidate dips kept for the continuity tracker: local minima of the normalized difference below this value. */
  candCeiling: number;
  /** At most this many candidates per frame (lowest normalized difference first). */
  maxCandidates: number;
}

export const DEFAULT_YIN: Omit<YinConfig, 'sampleRate'> = {
  bufferSize: 2048,
  windowSize: 1024,
  fMin: 60,
  fMax: 2000,
  threshold: 0.15,
  silenceDb: -50,
  octaveRatio: 0,
  octaveMinDip: 0,
  candCeiling: 0.5,
  maxCandidates: 6,
};

export interface YinResult {
  /** Estimated F0 in Hz, or 0 when unvoiced. */
  f0: number;
  voiced: boolean;
  /** Minimum of the normalized difference at the chosen lag (0 = perfectly periodic). */
  aperiodicity: number;
  /** RMS of the integration window in dBFS. */
  rmsDb: number;
  /** Fractional lag in samples (0 when unvoiced). */
  tau: number;
  /** Offset in samples from buffer start to the midpoint of the samples used (W + tau) / 2. */
  centerOffset: number;
  /**
   * Candidate dips for voiced frames (see MEASUREMENT.md 1.5). Index 0 is always the threshold pick above,
   * the rest are other local minima below candCeiling. Views into tracker-owned buffers: copy before the next call.
   */
  candF0: Float64Array;
  candD: Float64Array;
  candCount: number;
}

export class YinTracker {
  readonly cfg: YinConfig;
  private readonly fft: FFT;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly xRe: Float64Array;
  private readonly xIm: Float64Array;
  private readonly prefix: Float64Array;
  private readonly diff: Float64Array;
  private readonly cmnd: Float64Array;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly candF0: Float64Array;
  private readonly candD: Float64Array;

  constructor(cfg: Partial<YinConfig> & { sampleRate: number }) {
    this.cfg = { ...DEFAULT_YIN, ...cfg };
    const { bufferSize: N, windowSize: W, sampleRate: fs, fMin, fMax } = this.cfg;
    if (W >= N) throw new Error('windowSize must be smaller than bufferSize');
    this.fft = new FFT(N);
    this.aRe = new Float64Array(N);
    this.aIm = new Float64Array(N);
    this.xRe = new Float64Array(N);
    this.xIm = new Float64Array(N);
    this.prefix = new Float64Array(N + 1);
    this.tauMax = Math.min(N - W, Math.ceil(fs / fMin));
    this.tauMin = Math.max(2, Math.floor(fs / fMax));
    this.diff = new Float64Array(this.tauMax + 2);
    this.cmnd = new Float64Array(this.tauMax + 2);
    this.candF0 = new Float64Array(this.cfg.maxCandidates);
    this.candD = new Float64Array(this.cfg.maxCandidates);
  }

  /** Parabolic interpolation of the normalized difference around integer minimum t. */
  private refine(t: number, last: number): number {
    const c = this.cmnd;
    if (t > 1 && t < last) {
      const s0 = c[t - 1], s1 = c[t], s2 = c[t + 1];
      const den = s0 - 2 * s1 + s2;
      if (den > 0) {
        const shift = (0.5 * (s0 - s2)) / den;
        if (Math.abs(shift) <= 1) return t + shift;
      }
    }
    return t;
  }

  /** Analyze `bufferSize` samples starting at `offset`. */
  analyze(x: ArrayLike<number>, offset = 0): YinResult {
    const { bufferSize: N, windowSize: W, sampleRate: fs, threshold, silenceDb } = this.cfg;
    const { aRe, aIm, xRe, xIm, prefix, diff, cmnd, tauMin, tauMax } = this;

    prefix[0] = 0;
    for (let i = 0; i < N; i++) {
      const v = x[offset + i];
      xRe[i] = v;
      xIm[i] = 0;
      aRe[i] = i < W ? v : 0;
      aIm[i] = 0;
      prefix[i + 1] = prefix[i] + v * v;
    }
    const e0 = prefix[W];
    const rms = Math.sqrt(e0 / W);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const unvoiced: YinResult = {
      f0: 0, voiced: false, aperiodicity: 1, rmsDb, tau: 0, centerOffset: W / 2,
      candF0: this.candF0, candD: this.candD, candCount: 0,
    };
    if (rmsDb < silenceDb) return unvoiced;

    // r(tau) = sum_{j<W} x[j] x[j+tau] = IFFT(conj(A) X)[tau]; no wrap because j + tau <= N - 1.
    this.fft.transform(aRe, aIm);
    this.fft.transform(xRe, xIm);
    for (let k = 0; k < N; k++) {
      const re = aRe[k] * xRe[k] + aIm[k] * xIm[k];
      const im = aRe[k] * xIm[k] - aIm[k] * xRe[k];
      aRe[k] = re;
      aIm[k] = im;
    }
    this.fft.transform(aRe, aIm, true);

    diff[0] = 0;
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1 && tau <= N - W; tau++) {
      const et = prefix[tau + W] - prefix[tau];
      const r = aRe[tau] / N;
      const d = Math.max(0, e0 + et - 2 * r);
      diff[tau] = d;
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }
    const last = Math.min(tauMax + 1, N - W);

    // Absolute threshold: first dip below threshold, then walk to its local minimum.
    let tauEst = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    let voiced = true;
    if (tauEst < 0) {
      voiced = false;
      let best = tauMin;
      for (let tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
      tauEst = best;
    }
    if (!voiced) return { ...unvoiced, aperiodicity: cmnd[tauEst] };

    // Octave-up guard (project addition, not in the 2002 paper; see MEASUREMENT.md 1.3):
    // the first dip below threshold can sit at half the true period when the second harmonic is strong.
    // If the normalized difference near twice the lag is clearly deeper, move to that dip.
    if (this.cfg.octaveRatio > 0 && cmnd[tauEst] >= this.cfg.octaveMinDip) {
      for (;;) {
        const target = 2 * tauEst;
        const span = Math.max(2, Math.round(0.03 * target));
        if (target + span > tauMax) break;
        let best = target - span;
        for (let tau = target - span + 1; tau <= target + span; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
        if (cmnd[best] < this.cfg.octaveRatio * cmnd[tauEst]) tauEst = best;
        else break;
      }
    }
    const aper = cmnd[tauEst];

    const frac = this.refine(tauEst, last);

    // Candidate dips: the threshold pick first, then other local minima below candCeiling, deepest first.
    const { candF0, candD } = this;
    const K = this.cfg.maxCandidates;
    candF0[0] = fs / frac;
    candD[0] = aper;
    let n = 1;
    if (K > 1) {
      for (let tau = tauMin; tau <= tauMax; tau++) {
        const v = cmnd[tau];
        if (v >= this.cfg.candCeiling || tau === tauEst) continue;
        if (v > cmnd[tau - 1] || (tau + 1 <= last && v >= cmnd[tau + 1])) continue;
        // Insert into slots 1..K-1, sorted by v ascending; drop the worst when full.
        let pos = n;
        if (n === K) {
          if (v >= candD[K - 1]) continue;
          pos = K - 1;
        } else n++;
        while (pos > 1 && candD[pos - 1] > v) {
          candD[pos] = candD[pos - 1];
          candF0[pos] = candF0[pos - 1];
          pos--;
        }
        candD[pos] = v;
        candF0[pos] = fs / this.refine(tau, last);
      }
    }
    return {
      f0: fs / frac, voiced: true, aperiodicity: aper, rmsDb, tau: frac, centerOffset: (W + frac) / 2,
      candF0, candD, candCount: n,
    };
  }
}
