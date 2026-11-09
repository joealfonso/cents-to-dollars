// Temporal-continuity choice among YIN candidate dips (M1.1). See MEASUREMENT.md section 1.5.
// Project method, in the spirit of pYIN (Mauch and Dixon 2014), which decodes YIN candidates with an HMM.
// It is not pYIN: the costs below are this project's own and were tuned on Vocadito tracks 1 to 20 only.
//
// Each voiced frame offers candidates (f_i, d_i); candidate 0 is the plain YIN threshold pick.
// A path through a run of consecutive voiced frames costs
//   sum over frames of  wD * d_i  +  wDown * octaves below the YIN pick  +  wUp * octaves above it
//   plus, between consecutive frames, wJump * |octaves jumped|.
// The cheapest path is found with the Viterbi algorithm. An unvoiced frame ends the run, so the
// voicing decision and every candidate's frequency value are exactly those of plain YIN;
// only the choice between candidates changes.
//
// Live use decodes with a fixed lag of `lag` frames. When frame t + lag arrives, frame t is committed
// to the first state of the cheapest path over the window t .. t + lag, where that path starts from
// the previously committed frame's chosen candidate (jump cost included). After each commit the
// remaining pending frames are re-optimised from the committed choice, so every later window is
// conditioned on all earlier commitments and an emitted path never contains a transition that was
// not costed. When the voiced run ends, the pending frames take the cheapest path from the last
// commit. lag = Infinity decodes each run as a whole (offline Viterbi).

export interface ContinuityConfig {
  wD: number;
  wDown: number;
  wUp: number;
  wJump: number;
  /** Frames of lookahead before a choice is final. Infinity = whole run (offline). */
  lag: number;
}

export const DEFAULT_CONTINUITY: ContinuityConfig = {
  wD: 1,
  wDown: 0.05,
  wUp: 0.1,
  wJump: 2,
  lag: 8,
};

export interface CandidateFrame {
  voiced: boolean;
  candF0: ArrayLike<number>;
  candD: ArrayLike<number>;
  candCount: number;
}

export interface Decided<T> {
  frame: T;
  /** Chosen F0 in Hz, 0 when unvoiced. */
  f0: number;
  /** Index of the chosen candidate (0 = plain YIN pick), -1 when unvoiced. */
  choice: number;
}

interface Pending<T> {
  frame: T;
  f0: Float64Array;
  /** Observation cost per candidate (kept so the window can be re-optimised after a commit). */
  obs: Float64Array;
  back: Int32Array;
}

export class ContinuityTracker<T> {
  readonly cfg: ContinuityConfig;
  private pending: Pending<T>[] = [];
  /** Cumulative path cost per candidate of the newest pending frame. */
  private cost = new Float64Array(0);
  /** F0 per candidate of the last frame already emitted in this run (anchors the path start). */
  private anchor: Float64Array | null = null;
  private anchorChoice = -1;
  /** Scratch cost rows for re-optimising the pending window (grown on demand, reused). */
  private scratchA = new Float64Array(8);
  private scratchB = new Float64Array(8);

  constructor(cfg: Partial<ContinuityConfig> = {}) {
    this.cfg = { ...DEFAULT_CONTINUITY, ...cfg };
  }

  private obs(f: number, f0: number, d: number): number {
    const { wD, wDown, wUp } = this.cfg;
    const oct = Math.log2(f / f0);
    return wD * d + (oct < 0 ? -wDown * oct : wUp * oct);
  }

  /** Add one analysis frame; returns the frames whose choice became final, in order. */
  push(fr: CandidateFrame, frame: T): Decided<T>[] {
    const out: Decided<T>[] = [];
    if (!fr.voiced || fr.candCount === 0) {
      this.finish(out);
      out.push({ frame, f0: 0, choice: -1 });
      return out;
    }
    const n = fr.candCount;
    const f0s = new Float64Array(n);
    for (let i = 0; i < n; i++) f0s[i] = fr.candF0[i];
    const back = new Int32Array(n).fill(-1);
    const obs = new Float64Array(n);
    const cost = new Float64Array(n);
    const prev = this.pending.length ? this.pending[this.pending.length - 1].f0 : null;
    const { wJump } = this.cfg;
    for (let i = 0; i < n; i++) {
      const o = this.obs(f0s[i], f0s[0], fr.candD[i]);
      obs[i] = o;
      let c = o;
      if (prev) {
        let best = Infinity, bj = 0;
        for (let j = 0; j < prev.length; j++) {
          const v = this.cost[j] + wJump * Math.abs(Math.log2(f0s[i] / prev[j]));
          if (v < best) { best = v; bj = j; }
        }
        c += best;
        back[i] = bj;
      } else if (this.anchor) {
        // The previous frame of this run is already final: continue from its chosen candidate.
        c += wJump * Math.abs(Math.log2(f0s[i] / this.anchor[this.anchorChoice]));
      }
      cost[i] = c;
    }
    this.pending.push({ frame, f0: f0s, obs, back });
    this.cost = cost;
    if (this.pending.length > this.cfg.lag) this.emitOldest(out);
    return out;
  }

  /** End of input: finalize everything pending. */
  flush(): Decided<T>[] {
    const out: Decided<T>[] = [];
    this.finish(out);
    return out;
  }

  private argminCost(): number {
    let b = 0;
    for (let i = 1; i < this.cost.length; i++) if (this.cost[i] < this.cost[b]) b = i;
    return b;
  }

  private emitOldest(out: Decided<T>[]): void {
    let s = this.argminCost();
    for (let k = this.pending.length - 1; k > 0; k--) s = this.pending[k].back[s];
    const p = this.pending.shift()!;
    out.push({ frame: p.frame, f0: p.f0[s], choice: s });
    this.anchor = p.f0;
    this.anchorChoice = s;
    this.reoptimise();
  }

  /**
   * Recompute cumulative costs and back-pointers of the pending frames, starting from the committed
   * anchor choice. At most `lag` frames x candidates^2 operations; no allocation in steady state.
   * Arithmetic matches push() term for term, so an uncommitted window decodes exactly as before.
   */
  private reoptimise(): void {
    const P = this.pending;
    if (!P.length) return;
    const { wJump } = this.cfg;
    let maxN = 0;
    for (let k = 0; k < P.length; k++) if (P[k].f0.length > maxN) maxN = P[k].f0.length;
    if (this.scratchA.length < maxN) {
      this.scratchA = new Float64Array(maxN);
      this.scratchB = new Float64Array(maxN);
    }
    const a = this.anchor![this.anchorChoice];
    let prev = this.scratchA, cur = this.scratchB;
    for (let k = 0; k < P.length; k++) {
      const { f0, obs, back } = P[k];
      const dst = k === P.length - 1 ? this.cost : cur;
      if (k === 0) {
        for (let i = 0; i < f0.length; i++) {
          let c = obs[i];
          c += wJump * Math.abs(Math.log2(f0[i] / a));
          dst[i] = c;
          back[i] = -1;
        }
      } else {
        const pf = P[k - 1].f0;
        for (let i = 0; i < f0.length; i++) {
          let best = Infinity, bj = 0;
          for (let j = 0; j < pf.length; j++) {
            const v = prev[j] + wJump * Math.abs(Math.log2(f0[i] / pf[j]));
            if (v < best) { best = v; bj = j; }
          }
          let c = obs[i];
          c += best;
          dst[i] = c;
          back[i] = bj;
        }
      }
      const t = prev; prev = dst; cur = t;
    }
  }

  private finish(out: Decided<T>[]): void {
    const P = this.pending;
    if (P.length) {
      const states = new Int32Array(P.length);
      let s = this.argminCost();
      for (let k = P.length - 1; k >= 0; k--) {
        states[k] = s;
        s = P[k].back[s];
      }
      for (let k = 0; k < P.length; k++) out.push({ frame: P[k].frame, f0: P[k].f0[states[k]], choice: states[k] });
    }
    this.pending = [];
    this.cost = new Float64Array(0);
    this.anchor = null;
    this.anchorChoice = -1;
  }
}

/** Offline helper: decode a whole frame list. */
export function decodeAll<T extends CandidateFrame>(frames: T[], cfg: Partial<ContinuityConfig> = {}): Decided<T>[] {
  const ct = new ContinuityTracker<T>(cfg);
  const out: Decided<T>[] = [];
  for (const f of frames) for (const d of ct.push(f, f)) out.push(d);
  for (const d of ct.flush()) out.push(d);
  return out;
}
