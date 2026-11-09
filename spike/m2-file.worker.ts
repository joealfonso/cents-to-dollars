// M2.1 spike worker (specs/M2.md 4.5). Not app code. Receives transferred channel data, mixes to
// mono by the arithmetic mean in float64 (as tools/wav.ts does), then runs exactly the `cont` path of
// tools/run_ts.ts: FrameAnalyzer.run(mono, true) then decodeAll(frames, { lag: Infinity }).
// The mono mix, frames and decoded path are kept alive until the page sends 'release', so the
// memory sampler sees them as the app would while showing a result.

import { FrameAnalyzer } from '../src/dsp/analyzer.ts';
import { decodeAll } from '../src/dsp/continuity.ts';

let keep: unknown[] = [];

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { kind: 'analyse'; sampleRate: number; channels: Float32Array[] } | { kind: 'release' };
  if (msg.kind === 'release') {
    keep = [];
    self.postMessage({ kind: 'released' });
    return;
  }
  try {
    let chans: Float32Array[] | null = msg.channels;
    const nch = chans.length;
    const n = chans[0].length;
    const tMix = performance.now();
    const mono = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let c = 0; c < nch; c++) acc += chans[c][i];
      mono[i] = acc / nch;
    }
    const mixMs = performance.now() - tMix;
    chans = null; // channel data is no longer needed once mixed
    const an = new FrameAnalyzer({ sampleRate: msg.sampleRate });
    const t0 = performance.now();
    const frames = an.run(mono, true);
    const t1 = performance.now();
    const dec = decodeAll(frames, { lag: Infinity });
    const t2 = performance.now();
    let voiced = 0, f0Sum = 0;
    for (const d of dec) if (d.f0 > 0) { voiced++; f0Sum += d.f0; }
    keep = [mono, frames, dec];
    self.postMessage({
      kind: 'done', samples: n, channels: nch, frames: frames.length, decoded: dec.length, voiced, f0Sum,
      mixMs, runMs: t1 - t0, decodeAllMs: t2 - t1, analysisMs: t2 - t0,
    });
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err) });
  }
};

self.postMessage({ kind: 'ready' });
