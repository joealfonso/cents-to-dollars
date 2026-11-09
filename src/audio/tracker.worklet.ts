// AudioWorklet processor: runs the shared FrameAnalyzer every `hop` samples on the live input.
// Posts two message kinds per frame:
//   'meter' immediately after analysis: voicing, plain YIN F0, aperiodicity, levels, band energies, spectrum.
//   'f0' once the continuity-tracked F0 is final (MEASUREMENT.md 1.5): DEFAULT_CONTINUITY.lag frames
//        after analysis, as soon as its voiced run ends, or on a 'flush' request.
// Both carry the frame's `start` and `t`, so the main thread can join them. Voicing is the same in both
// (the continuity choice never changes voicing). On {type: 'flush'} the processor finalizes every pending
// frame, posts their 'f0' messages, then posts {type: 'flushed'}.

import { FrameAnalyzer } from '../dsp/analyzer.ts';
import { ContinuityTracker, type Decided } from '../dsp/continuity.ts';

// AudioWorkletGlobalScope declarations (not part of lib.dom).
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}

export interface WorkletMeter {
  type: 'meter';
  /** Absolute sample index of the analysis buffer start. */
  start: number;
  /** Absolute sample index of the end of the buffer that produced this frame. */
  readyAt: number;
  t: number;
  /** Plain YIN threshold pick (the M1 value), 0 when unvoiced. Not continuity-tracked. */
  yinF0: number;
  voiced: boolean;
  aperiodicity: number;
  rmsDb: number;
  eSf: number;
  eRef: number;
  /** Power spectrum bins 0..specBins-1 (only when spectrum is enabled). */
  power?: Float32Array;
}

export interface WorkletF0 {
  type: 'f0';
  /** Absolute sample index of the analysis buffer start (same as the frame's 'meter' message). */
  start: number;
  /** Absolute sample index at which this frame's F0 became final. */
  readyAt: number;
  t: number;
  /** Continuity-tracked F0 in Hz (0 when unvoiced). */
  f0: number;
  voiced: boolean;
}

export interface WorkletFlushed {
  type: 'flushed';
}

export type WorkletMessage = WorkletMeter | WorkletF0 | WorkletFlushed;

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
  private readonly cont = new ContinuityTracker<WorkletF0>();

  constructor() {
    super();
    this.an = new FrameAnalyzer({ sampleRate });
    this.ring = new Float32Array(this.an.N);
    this.lin = new Float64Array(this.an.N);
    this.specBins = Math.ceil((SPEC_MAX_HZ * this.an.N) / sampleRate) + 1;
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'spectrum') this.spectrum = !!e.data.enabled;
      else if (e.data?.type === 'flush') {
        this.post(this.cont.flush(), currentFrame);
        this.port.postMessage({ type: 'flushed' } satisfies WorkletFlushed);
      }
    };
  }

  private post(decided: Decided<WorkletF0>[], readyAt: number): void {
    for (const d of decided) {
      const m = d.frame;
      m.f0 = d.f0;
      m.voiced = d.choice >= 0;
      m.readyAt = readyAt;
      this.port.postMessage(m);
    }
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
      const f = this.an.analyzeAt(this.lin, 0, start, this.spectrum);
      const msg: WorkletMeter = {
        type: 'meter', start: f.start, readyAt: end, t: f.t, yinF0: f.voiced ? f.f0 : 0,
        voiced: f.voiced, aperiodicity: f.aperiodicity, rmsDb: f.rmsDb, eSf: f.eSf, eRef: f.eRef,
      };
      if (this.spectrum) {
        const p = new Float32Array(this.specBins);
        for (let k = 0; k < this.specBins; k++) p[k] = this.an.spec.power[k];
        msg.power = p;
        this.port.postMessage(msg, [p.buffer]);
      } else this.port.postMessage(msg);
      const pend: WorkletF0 = { type: 'f0', start: f.start, readyAt: end, t: f.t, f0: 0, voiced: f.voiced };
      this.post(this.cont.push(f, pend), end);
    }
    return true;
  }
}

registerProcessor('pitch-tracker', TrackerProcessor);
