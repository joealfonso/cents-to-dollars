// Analysis Worker (specs/M2.md 4.2 item 5). One Worker per job; cancel = the client terminates it.
//
// Input, with its buffers transferred (never copied):
//   { job, kind: 'wav', bytes }                       the WAV file's bytes; parsed here with parseWav
//   { job, kind: 'channels', channels, sampleRate }   decoded channels (MP3, M4A, AAC, other-rate WAV); mixed here
//   { job, kind: 'mono', mono, sampleRate }           an already mixed signal
// Parsing and mixing run here, not on the main thread. The handler then queues the analysis in a later
// task with only the mono array, so the message (file bytes or channels) is unreachable before analysis
// starts. The result goes back with every typed-array buffer transferred (takeTransferables), and the
// Worker keeps no reference to it.
//
// Errors: a TakeError keeps its code. Only a failed big allocation (RangeError "Array buffer allocation
// failed" or "Invalid typed array length") is 'out-of-memory'; anything else is 'analysis-failed'.

import { analyseTake, takeTransferables, type TakeResult } from '../take/analyse.ts';
import { parseWav } from '../take/wav.ts';
import { mixToMono } from '../take/mix.ts';
import { TakeError } from '../take/errors.ts';

export type TakeInput =
  | { kind: 'wav'; bytes: ArrayBuffer }
  | { kind: 'channels'; channels: Float32Array[]; sampleRate: number }
  | { kind: 'mono'; mono: Float64Array; sampleRate: number };
export type TakeJob = { job: number } & TakeInput;
export type TakeWorkerMessage =
  | { job: number; kind: 'progress'; fraction: number }
  | { job: number; kind: 'result'; result: TakeResult }
  | { job: number; kind: 'error'; code: string; message: string };

const post = (m: TakeWorkerMessage, transfer: Transferable[] = []) => self.postMessage(m, { transfer });

const OOM = /Array buffer allocation failed|Invalid typed array length/i;
function codeOf(err: unknown): string {
  if (err instanceof TakeError) return err.code;
  if (err instanceof RangeError && OOM.test(err.message)) return 'out-of-memory';
  return 'analysis-failed';
}
const fail = (job: number, err: unknown) => post({ job, kind: 'error', code: codeOf(err), message: String(err) });

function analyse(job: number, mono: Float64Array, sampleRate: number): void {
  try {
    const result = analyseTake(mono, sampleRate, { onProgress: (fraction) => post({ job, kind: 'progress', fraction }) });
    post({ job, kind: 'result', result }, takeTransferables(result));
  } catch (err) {
    fail(job, err);
  }
}

self.onmessage = (e: MessageEvent<TakeJob>) => {
  const d = e.data;
  try {
    let mono: Float64Array, sampleRate: number;
    if (d.kind === 'wav') {
      const w = parseWav(d.bytes);
      mono = w.samples;
      sampleRate = w.sampleRate;
    } else if (d.kind === 'channels') {
      mono = mixToMono(d.channels);
      sampleRate = d.sampleRate;
    } else {
      mono = d.mono;
      sampleRate = d.sampleRate;
    }
    setTimeout(analyse, 0, d.job, mono, sampleRate);
  } catch (err) {
    fail(d.job, err);
  }
};
