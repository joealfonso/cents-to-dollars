// M2.1 memory re-measure with the real pipeline (not app code). Driven by tools/spike_m2_run.ts --take.
// Runs analyseFile from src/file/client.ts (decodeFile, then a Worker running analyseTake, every result
// buffer transferred back) and holds the returned TakeResult on the main thread, as a result screen would,
// until release().

import { analyseFile, type AnalysedFile } from '../src/file/client.ts';

let held: AnalysedFile | null = null;

async function run(): Promise<unknown> {
  const input = document.getElementById('file') as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) throw new Error('no file selected');
  let progressEvents = 0, lastFraction = -1, nonDecreasing = true, firstAnalysingMs: number | null = null;
  const t0 = performance.now();
  const a = await analyseFile(file, {
    onProgress: (f, phase) => {
      progressEvents++;
      if (phase === 'analysing') {
        if (firstAnalysingMs === null) firstAnalysingMs = performance.now() - t0;
        if (f < lastFraction) nonDecreasing = false;
        lastFraction = f;
      }
    },
  });
  held = a;
  const r = a.result;
  let voiced = 0, f0Sum = 0;
  for (let i = 0; i < r.frameCount; i++) if (r.f0[i] > 0) { voiced++; f0Sum += r.f0[i]; }
  const resultBytes = [r.t, r.start, r.voiced, r.f0, r.aperiodicity, r.rmsDb, r.eSf, r.eRef, r.spectrum].reduce((s, x) => s + x.byteLength, 0);
  return {
    fileName: a.fileName, fileBytes: a.fileBytes, sampleRate: a.sampleRate, channels: a.channels, rateSource: a.rateSource,
    nativeRate: a.nativeRate, durationS: a.durationS, samples: Math.round(a.durationS * a.sampleRate),
    status: r.status, frames: r.frameCount, voiced, f0Sum, specBins: r.specBins, vibratoSpans: r.vibrato.length,
    resultTypedArrayBytes: resultBytes,
    decodeMs: a.timings.decodeMs, analyseMs: a.timings.analyseMs, totalMs: a.timings.totalMs, firstAnalysingProgressMs: firstAnalysingMs,
    progressEvents, lastAnalysingFraction: lastFraction, progressNonDecreasing: nonDecreasing,
    holding: held !== null,
  };
}

function release(): boolean {
  held = null;
  return true;
}

const w = window as unknown as Record<string, unknown>;
w.__spikeRun = run;
w.__spikeRelease = release;
w.__spikeReady = () => true;
