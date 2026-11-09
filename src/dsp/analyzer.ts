// Frame runner shared by the AudioWorklet and the offline Node CLI, so both paths run identical code.

import { YinTracker, type YinConfig } from './yin.ts';
import { Spectrum, SF_BAND, REF_BAND } from './spectrum.ts';

export const DEFAULT_HOP = 256;

export interface Frame {
  /** Index of the first sample of the analysis buffer. */
  start: number;
  /** Time in seconds of the midpoint of the samples YIN used. */
  t: number;
  f0: number;
  voiced: boolean;
  aperiodicity: number;
  rmsDb: number;
  /** Band energies for the singer's formant ratio (summed over frames later). */
  eSf: number;
  eRef: number;
  /** YIN candidate dips (index 0 = threshold pick). Copies, safe to keep. */
  candF0: Float64Array;
  candD: Float64Array;
  candCount: number;
}

export interface AnalyzerOptions extends Partial<YinConfig> {
  sampleRate: number;
  hop?: number;
}

export class FrameAnalyzer {
  readonly yin: YinTracker;
  readonly spec: Spectrum;
  readonly hop: number;
  readonly N: number;

  constructor(opts: AnalyzerOptions) {
    this.yin = new YinTracker(opts);
    this.N = this.yin.cfg.bufferSize;
    this.spec = new Spectrum(this.N, opts.sampleRate);
    this.hop = opts.hop ?? DEFAULT_HOP;
  }

  /** Analyze one buffer of N samples that begins at absolute sample index `start`. */
  analyzeAt(x: ArrayLike<number>, offset: number, start: number, withSpectrum = true): Frame {
    const r = this.yin.analyze(x, offset);
    let eSf = 0, eRef = 0;
    if (withSpectrum) {
      this.spec.compute(x, offset);
      eSf = this.spec.bandEnergy(SF_BAND[0], SF_BAND[1]);
      eRef = this.spec.bandEnergy(REF_BAND[0], REF_BAND[1]);
    }
    return {
      start,
      t: (start + r.centerOffset) / this.yin.cfg.sampleRate,
      f0: r.f0,
      voiced: r.voiced,
      aperiodicity: r.aperiodicity,
      rmsDb: r.rmsDb,
      eSf,
      eRef,
      candF0: r.candF0.slice(0, r.candCount),
      candD: r.candD.slice(0, r.candCount),
      candCount: r.candCount,
    };
  }

  /** Offline: every hop over a whole signal. */
  run(x: Float32Array | Float64Array, withSpectrum = true): Frame[] {
    const out: Frame[] = [];
    for (let s = 0; s + this.N <= x.length; s += this.hop) out.push(this.analyzeAt(x, s, s, withSpectrum));
    return out;
  }
}
