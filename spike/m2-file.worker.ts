// M2.1 spike worker (specs/M2.md 4.5). Not app code.
// Pipeline, as M2.1 would run it:
//  1. onmessage: mix the transferred channels to mono (arithmetic mean in float64, as tools/wav.ts),
//     then queue analyse() with setTimeout, passing only the mono array. When onmessage returns, the
//     event and its float32 channels are unreachable before FrameAnalyzer.run starts.
//  2. analyse(): exactly the `cont` path of tools/run_ts.ts, FrameAnalyzer.run(mono, true) then
//     decodeAll(frames, { lag: Infinity }), timed as analysisMs. Then, timed separately, a second pass
//     that stores each frame's 0 to 4 kHz power column as a Float32Array: Spectrum.compute (src/dsp/
//     spectrum.ts, unchanged; FrameAnalyzer.run does not keep per-frame spectra) at each frame's start,
//     bins 0..floor(4000 * N / sampleRate).
//  3. The result (per-frame fields of specs/M2.md 4.2 item 6 without YIN candidates, decoded f0 as a
//     Float64Array, the spectrum columns) goes to the page by structured clone, not transfer. The
//     worker then drops every reference to it.

import { FrameAnalyzer } from '../src/dsp/analyzer.ts';
import { decodeAll } from '../src/dsp/continuity.ts';

const SPECTRUM_MAX_HZ = 4000;

function analyse(mono: Float64Array, sampleRate: number, mixMs: number): void {
  try {
    const an = new FrameAnalyzer({ sampleRate });
    const t0 = performance.now();
    const frames = an.run(mono, true);
    const t1 = performance.now();
    const dec = decodeAll(frames, { lag: Infinity });
    const t2 = performance.now();
    const kMax = Math.floor((SPECTRUM_MAX_HZ * an.N) / sampleRate);
    const columns: Float32Array[] = new Array(frames.length);
    for (let i = 0; i < frames.length; i++) {
      const p = an.spec.compute(mono, frames[i].start);
      const col = new Float32Array(kMax + 1);
      for (let k = 0; k <= kMax; k++) col[k] = p[k];
      columns[i] = col;
    }
    const t3 = performance.now();
    const f0 = new Float64Array(dec.length);
    let voiced = 0, f0Sum = 0;
    for (let i = 0; i < dec.length; i++) { f0[i] = dec[i].f0; if (f0[i] > 0) { voiced++; f0Sum += f0[i]; } }
    const outFrames = frames.map((x) => ({
      t: x.t, start: x.start, voiced: x.voiced, aperiodicity: x.aperiodicity, rmsDb: x.rmsDb, eSf: x.eSf, eRef: x.eRef,
    }));
    const stats = {
      samples: mono.length, frames: frames.length, decoded: dec.length, voiced, f0Sum, binsPerColumn: kMax + 1,
      mixMs, runMs: t1 - t0, decodeAllMs: t2 - t1, analysisMs: t2 - t0, spectrumColumnsMs: t3 - t2,
    };
    const tPost = performance.now();
    self.postMessage({ kind: 'result', result: { frames: outFrames, f0, columns } });
    const postCloneMs = performance.now() - tPost;
    self.postMessage({ kind: 'stats', stats: { ...stats, postCloneMs } });
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err) });
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { kind: 'analyse'; sampleRate: number; channels: Float32Array[] };
  if (msg.kind !== 'analyse') return;
  try {
    const nch = msg.channels.length;
    const n = msg.channels[0].length;
    const tMix = performance.now();
    const mono = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let c = 0; c < nch; c++) acc += msg.channels[c][i];
      mono[i] = acc / nch;
    }
    const mixMs = performance.now() - tMix;
    setTimeout(analyse, 0, mono, msg.sampleRate, mixMs);
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err) });
  }
};

self.postMessage({ kind: 'ready' });
