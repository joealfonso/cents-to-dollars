// Main-thread entry to the take pipeline (specs/M2.1-API.md): decode, then parse or mix and analyse in a Worker.
// Every rejection is a TakeError with a code (src/take/errors.ts).
// One job at a time: starting a new job cancels the previous one, and a cancelled job never delivers
// progress or a result (its Worker is terminated and its messages are ignored by job number).
// Progress: phase 'decoding' (0 when it starts) then 'analysing' (fractions from analyseTake, below 1).
// 100% is left to the caller's Done state (F-18).

import { decodeFile, type RateSource } from './decode.ts';
import { TakeError, type TakeErrorCode } from '../take/errors.ts';
import type { TakeResult } from '../take/analyse.ts';
import type { TakeInput, TakeJob, TakeWorkerMessage } from './take.worker.ts';

export type TakePhase = 'decoding' | 'analysing';
export interface AnalyseFileOptions {
  onProgress?: (fraction: number, phase: TakePhase) => void;
  signal?: AbortSignal;
}
export interface AnalysedFile {
  job: number;
  fileName: string;
  fileBytes: number;
  sampleRate: number;
  channels: number;
  rateSource: RateSource;
  nativeRate: number | null;
  durationS: number;
  result: TakeResult;
  /** Wall-clock spans on the main thread, ms. */
  timings: { decodeMs: number; analyseMs: number; totalMs: number };
}

let nextJob = 1;
let current: { job: number; cancel: () => void } | null = null;

/** Cancels the running job, if any. */
export function cancelAnalysis(): void {
  current?.cancel();
}

export async function analyseFile(file: File, opts: AnalyseFileOptions = {}): Promise<AnalysedFile> {
  current?.cancel();
  const job = nextJob++;
  const ctl = new AbortController();
  let worker: Worker | null = null;
  let rejectRun: ((e: TakeError) => void) | null = null;
  const cancel = () => {
    ctl.abort();
    worker?.terminate();
    rejectRun?.(new TakeError('cancelled', 'analysis cancelled'));
  };
  opts.signal?.addEventListener('abort', cancel);
  if (opts.signal?.aborted) ctl.abort();
  current = { job, cancel };
  const live = () => !ctl.signal.aborted;
  const progress = (f: number, phase: TakePhase) => { if (live()) opts.onProgress?.(f, phase); };

  try {
    const t0 = performance.now();
    progress(0, 'decoding');
    let decoded: Awaited<ReturnType<typeof decodeFile>> | null = await decodeFile(file, ctl.signal);
    if (!live()) throw new TakeError('cancelled', 'analysis cancelled');
    const t1 = performance.now();
    const { sampleRate, channels, rateSource, nativeRate, durationS } = decoded;
    let input: TakeInput | null = decoded.input;
    let transfer: ArrayBuffer[] = decoded.transfer;
    decoded = null;

    const result = await new Promise<TakeResult>((resolve, reject) => {
      rejectRun = reject;
      let w: Worker;
      try {
        w = new Worker(new URL('./take.worker.ts', import.meta.url), { type: 'module' });
      } catch (err) {
        reject(new TakeError('analysis-failed', `could not start the analysis worker: ${String(err)}`));
        return;
      }
      worker = w;
      w.onmessage = (e: MessageEvent<TakeWorkerMessage>) => {
        const m = e.data;
        if (m.job !== job || !live()) return;
        if (m.kind === 'progress') progress(m.fraction, 'analysing');
        else if (m.kind === 'result') resolve(m.result);
        else reject(new TakeError(m.code as TakeErrorCode, m.message));
      };
      // onerror: the Worker failed to load or crashed. Its message is passed on as is.
      w.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        reject(new TakeError('analysis-failed', `analysis worker error: ${e.message || 'no message'}`));
      };
      w.onmessageerror = () => reject(new TakeError('analysis-failed', 'analysis result could not be received'));
      try {
        w.postMessage({ job, ...input! } as TakeJob, transfer); // transfer: the main thread keeps no copy
      } catch (err) {
        // A browser that refuses to transfer AudioBuffer channel arrays: copy each once, transfer the copies.
        if (input!.kind !== 'channels') { reject(new TakeError('analysis-failed', `could not send the take to the worker: ${String(err)}`)); return; }
        const copies = input!.channels.map((c) => c.slice());
        try {
          w.postMessage({ job, kind: 'channels', channels: copies, sampleRate: input!.sampleRate } as TakeJob, copies.map((c) => c.buffer));
        } catch (err2) {
          reject(new TakeError('analysis-failed', `could not send the take to the worker: ${String(err2)}`));
          return;
        }
      } finally {
        input = null;
        transfer = [];
      }
    });
    const t2 = performance.now();
    return {
      job, fileName: file.name, fileBytes: file.size, sampleRate, channels, rateSource, nativeRate, durationS, result,
      timings: { decodeMs: t1 - t0, analyseMs: t2 - t1, totalMs: t2 - t0 },
    };
  } catch (err) {
    if (err instanceof TakeError) throw err;
    const oom = err instanceof RangeError && /Array buffer allocation failed|Invalid typed array length/i.test(err.message);
    throw new TakeError(oom ? 'out-of-memory' : 'analysis-failed', String(err));
  } finally {
    (worker as Worker | null)?.terminate();
    opts.signal?.removeEventListener('abort', cancel);
    if (current?.job === job) current = null;
  }
}
