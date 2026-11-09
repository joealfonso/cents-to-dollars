// Short-time spectrum and band-energy ratio. Definitions in MEASUREMENT.md sections 4 and 5.

import { FFT } from './fft.ts';

export const SF_BAND: readonly [number, number] = [2500, 3500];
export const REF_BAND: readonly [number, number] = [50, 2000];

export class Spectrum {
  readonly size: number;
  readonly sampleRate: number;
  readonly window: Float64Array;
  /** Sum of window coefficients, for amplitude normalization. */
  readonly windowSum: number;
  private readonly fft: FFT;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  /** Power per bin, |X_k|^2, bins 0..size/2. */
  readonly power: Float64Array;

  constructor(size: number, sampleRate: number) {
    this.size = size;
    this.sampleRate = sampleRate;
    this.fft = new FFT(size);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.power = new Float64Array(size / 2 + 1);
    this.window = new Float64Array(size);
    let s = 0;
    for (let i = 0; i < size; i++) {
      // Periodic Hann
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
      s += this.window[i];
    }
    this.windowSum = s;
  }

  /** Computes the power spectrum of `size` samples from `offset`. Returns this.power. */
  compute(x: ArrayLike<number>, offset = 0): Float64Array {
    const { re, im, window, size } = this;
    for (let i = 0; i < size; i++) {
      re[i] = x[offset + i] * window[i];
      im[i] = 0;
    }
    this.fft.transform(re, im);
    for (let k = 0; k <= size / 2; k++) this.power[k] = re[k] * re[k] + im[k] * im[k];
    return this.power;
  }

  binHz(k: number): number {
    return (k * this.sampleRate) / this.size;
  }

  /** Magnitude in dBFS such that a full-scale sine reads 0 dB at its peak bin. */
  dbfs(k: number): number {
    const amp = (2 * Math.sqrt(this.power[k])) / this.windowSum;
    return amp > 0 ? 20 * Math.log10(amp) : -Infinity;
  }

  /** Sum of power over bins whose centre frequency f_k satisfies lo <= f_k < hi. */
  bandEnergy(lo: number, hi: number, power: ArrayLike<number> = this.power): number {
    const k0 = Math.ceil((lo * this.size) / this.sampleRate);
    const k1 = Math.min(this.size / 2, Math.ceil((hi * this.size) / this.sampleRate) - 1);
    let e = 0;
    for (let k = k0; k <= k1; k++) e += power[k];
    return e;
  }

  /** Frequency of the strongest bin in [lo, hi), refined by parabolic interpolation on log power. */
  peakHz(lo: number, hi: number): number {
    const k0 = Math.max(1, Math.ceil((lo * this.size) / this.sampleRate));
    const k1 = Math.min(this.size / 2 - 1, Math.ceil((hi * this.size) / this.sampleRate) - 1);
    let best = k0;
    for (let k = k0 + 1; k <= k1; k++) if (this.power[k] > this.power[best]) best = k;
    const a = Math.log(this.power[best - 1] + 1e-300);
    const b = Math.log(this.power[best] + 1e-300);
    const c = Math.log(this.power[best + 1] + 1e-300);
    const den = a - 2 * b + c;
    const shift = den < 0 ? (0.5 * (a - c)) / den : 0;
    return this.binHz(best + shift);
  }
}

/**
 * Singer's formant band-energy ratio in dB:
 * 10 log10( E[2500, 3500) / E[50, 2000) ), energies summed over the given power spectra.
 * Pass the summed power of all voiced frames for a take-level value.
 */
export function bandRatioDb(spec: Spectrum, power: ArrayLike<number>, band = SF_BAND, ref = REF_BAND): number {
  const num = spec.bandEnergy(band[0], band[1], power);
  const den = spec.bandEnergy(ref[0], ref[1], power);
  if (den <= 0 || num <= 0) return -Infinity;
  return 10 * Math.log10(num / den);
}
