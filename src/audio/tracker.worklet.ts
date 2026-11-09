// AudioWorklet processor: runs the shared FrameAnalyzer every `hop` samples on the live input.
// Live view = plain YIN (the M1 threshold pick): each frame is posted as one 'frame' message right after
// analysis, carrying voicing, F0, aperiodicity, levels, band energies and (optionally) the spectrum.
// The continuity decoder (src/dsp/continuity.ts) is not used here; it is for whole-take analysis only.
// Nothing is buffered in the worklet, so there is nothing to flush on stop.

import { FrameAnalyzer } from '../dsp/analyzer.ts';

// AudioWorkletGlobalScope declarations (not part of lib.dom).
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

export interface WorkletFrame {
  type: 'frame';
  /** Absolute sample index of the analysis buffer start. */
  start: number;
  /** Absolute sample index of the end of the buffer that produced this frame (when F0 is known). */
  readyAt: number;
  t: number;
  /** Plain YIN threshold pick in Hz, 0 when unvoiced. */
  f0: number;
  voiced: boolean;
  aperiodicity: number;
  rmsDb: number;
  eSf: number;
  eRef: number;
  /** Power spectrum bins 0..specBins-1 (only when spectrum is enabled). */
  power?: Float32Array;
}

export type WorkletMessage = WorkletFrame;

const SPEC_MAX_HZ = 5000;

class TrackerProcessor extends AudioWorkletProcessor {
  private readonly an: FrameAnalyzer;
  private readonly ring: Float32Array;
  private readonly lin: Float64Array;
  private write = 0;
  private total = 0;
  private sinceLast = 0;
  private readonly specBins: number;
  private spectrum = true;

  constructor() {
    super();
    this.an = new FrameAnalyzer({ sampleRate });
    this.ring = new Float32Array(this.an.N);
    this.lin = new Float64Array(this.an.N);
    this.specBins = Math.ceil((SPEC_MAX_HZ * this.an.N) / sampleRate) + 1;
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'spectrum') this.spectrum = !!e.data.enabled;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    const n = ch ? ch.length : 128;
    const N = this.an.N;
    for (let i = 0; i < n; i++) {
      this.ring[this.write] = ch ? ch[i] : 0;
      this.write = (this.write + 1) % N;
    }
    this.total += n;
    this.sinceLast += n;
    if (this.total >= N && this.sinceLast >= this.an.hop) {
      this.sinceLast = 0;
      for (let i = 0; i < N; i++) this.lin[i] = this.ring[(this.write + i) % N];
      const end = currentFrame + n;
      const start = end - N;
      const f = this.an.analyzeAt(this.lin, 0, start, this.spectrum, false);
      const msg: WorkletFrame = {
        type: 'frame', start: f.start, readyAt: end, t: f.t, f0: f.voiced ? f.f0 : 0,
        voiced: f.voiced, aperiodicity: f.aperiodicity, rmsDb: f.rmsDb, eSf: f.eSf, eRef: f.eRef,
      };
      if (this.spectrum) {
        const p = new Float32Array(this.specBins);
        for (let k = 0; k < this.specBins; k++) p[k] = this.an.spec.power[k];
        msg.power = p;
        this.port.postMessage(msg, [p.buffer]);
      } else this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor('pitch-tracker', TrackerProcessor);
