// File to Worker input at the analysis rate (specs/M2.md 4.2 items 1 to 4, 4.3, 4.5). Browser only.
// Nothing CPU-heavy runs here: WAV parsing and the mono mix happen in the Worker (take.worker.ts), and
// decodeAudioData runs off the main thread.
//
// Type first (M2-DESIGN.md 3.3, D17): only WAV, MP3, M4A and ADTS AAC are decoded. Bytes that sniff as none
// of them are refused before any decoding: 'unsupported-type', or 'decode-failed' when the name or MIME type
// claims a supported type (F-11: random bytes named .mp3 read as "could not decode").
//
// Every refusal that needs only the header is in headerRefusal, run on the first PRECHECK_BYTES by
// precheckFile (which the #/file view also calls, so it can refuse before showing Decoding) and again on the
// whole file here, so the two can never disagree.
//
// Limits (src/take/limits.ts): a file over MAX_FILE_BYTES is refused before it is read ('too-large'). A
// take over MAX_DURATION_S is refused ('too-long') before the big allocations where the duration can be
// read from the header: WAV from its data chunk (exact; parseWav refuses on its own too); MP3 from a
// Xing/Info or VBRI frame count; M4A from moov/mvhd, else mvex/mehd; ADTS AAC from its frame headers.
// When an MP3 or M4A duration is unknown or only an estimate, a file over MAX_COMPRESSED_BYTES is refused
// as 'too-large' before decoding. Compressed durations get DURATION_SLACK_S for encoder priming and
// padding, in the header check and in the check right after decodeAudioData (before the channels go
// anywhere).
//
// Rate policy (4.3, Q1 Option B): 44.1 and 48 kHz are analysed at the file's own rate; every other or
// unknown rate is decoded at 48 kHz.
//  - WAV at 44.1 or 48 kHz: its bytes go to the Worker, which parses them (src/take/wav.ts). No resampling.
//  - WAV at another rate: decodeAudioData in a 48 kHz context (the browser's decoder resamples).
//  - MP3: rate from the first frame header; M4A: from the esds AudioSpecificConfig; ADTS AAC: from the
//    first ADTS header. Decoded in an OfflineAudioContext at that rate when it is 44.1 or 48 kHz, else 48 kHz.
//  - M4A or ADTS whose rate is not confirmed (implicit SBR possible): rateSource 'not-confirmed', decoded at
//    the header rate if that is 44.1 or 48 kHz, otherwise at 48 kHz.
//  - Supported container with an unreadable rate header: decoded at 48 kHz, rateSource 'resampled-unknown'.
// The returned input holds the only reference to the bytes or channels, and `transfer` lists their
// buffers: the client transfers them to the Worker, so the main thread keeps nothing. The AudioBuffer is
// dropped here.

import { readWavInfo } from '../take/wav.ts';
import { readMp3Info, readM4aRate, readM4aDuration, readAdtsInfo, sniffContainer } from '../take/headers.ts';
import { TakeError } from '../take/errors.ts';
import { MAX_DURATION_S, MAX_FILE_BYTES, MAX_COMPRESSED_BYTES, DURATION_SLACK_S } from '../take/limits.ts';
import type { TakeInput } from './take.worker.ts';

export type RateSource = 'header' | 'resampled' | 'resampled-unknown' | 'not-confirmed';
export interface DecodedFile {
  /** What the Worker receives (plus a job number). Holds the only reference to the samples or bytes. */
  input: TakeInput;
  /** Buffers in `input`, to transfer. */
  transfer: ArrayBuffer[];
  /** Rate the samples are at, and the analysis runs at. */
  sampleRate: number;
  channels: number;
  rateSource: RateSource;
  /** The file's own rate from its header; null when it could not be read. */
  nativeRate: number | null;
  durationS: number;
}

export const NATIVE_RATES: readonly number[] = [44100, 48000];
export const RESAMPLE_RATE = 48000;

const AUDIO_NAME = /\.(wav|wave|mp3|m4a|mp4|aac)$/i;
const SUPPORTED_MIME = /^audio\/(wav|wave|x-wav|vnd\.wave|mpeg|mp3|mp4|x-m4a|m4a|aac|x-aac|aacp)$/i;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TakeError('cancelled', 'decoding cancelled');
}

function tooLong(durationS: number, how: string): TakeError {
  return new TakeError('too-long', `take is ${durationS.toFixed(1)} s (${how}), the limit is ${MAX_DURATION_S} s`, { durationS });
}

function asTakeError(err: unknown): TakeError {
  if (err instanceof TakeError) return err;
  if (err instanceof RangeError && /Array buffer allocation failed|Invalid typed array length/i.test(err.message)) return new TakeError('out-of-memory', String(err));
  return new TakeError('decode-failed', String(err));
}

interface Plan { ctxRate: number; rateSource: RateSource; nativeRate: number | null }

function planFor(rate: number | null, confirmed = true): Plan {
  if (rate === null) return { ctxRate: RESAMPLE_RATE, rateSource: 'resampled-unknown', nativeRate: null };
  const native = NATIVE_RATES.includes(rate);
  if (!confirmed) return { ctxRate: native ? rate : RESAMPLE_RATE, rateSource: 'not-confirmed', nativeRate: rate };
  return native ? { ctxRate: rate, rateSource: 'header', nativeRate: rate } : { ctxRate: RESAMPLE_RATE, rateSource: 'resampled', nativeRate: rate };
}

function tooLargeUnknownDuration(bytes: number, what: string): TakeError {
  return new TakeError('too-large', `${what}, and the file is ${bytes} bytes; the limit for that case is ${MAX_COMPRESSED_BYTES}`);
}

async function decodeAt(bytes: ArrayBuffer, ctxRate: number, signal: AbortSignal | undefined, slackS: number): Promise<{ channels: Float32Array[]; durationS: number }> {
  let ctx: OfflineAudioContext;
  try {
    ctx = new OfflineAudioContext(1, 1, ctxRate);
  } catch (err) {
    throw new TakeError('unsupported-rate', `this browser cannot decode at ${ctxRate} Hz: ${String(err)}`);
  }
  let buf: AudioBuffer | null;
  try {
    buf = await ctx.decodeAudioData(bytes); // detaches `bytes`
  } catch (err) {
    if (err instanceof RangeError && /Array buffer allocation failed|Invalid typed array length/i.test(err.message)) throw new TakeError('out-of-memory', String(err));
    throw new TakeError('decode-failed', String(err));
  }
  checkAbort(signal);
  const durationS = buf.length / buf.sampleRate;
  if (durationS > MAX_DURATION_S + slackS) throw tooLong(durationS, 'decoded');
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  buf = null;
  return { channels, durationS };
}

/** How much of the file precheckFile reads: enough for every header the refusal rules look at, in practice. */
export const PRECHECK_BYTES = 1024 * 1024;

/**
 * Every refusal that needs only the file's size, name, type and header bytes (M2-DESIGN.md 3.3: Decoding
 * applies only to an accepted file). One rule set, used twice: by precheckFile on the first PRECHECK_BYTES
 * (complete = false, when the file is longer than that) so the screen can refuse before any Decoding state,
 * and by decodeFile on the whole file (complete = true). On a partial head, a rule that cannot be decided
 * from the bytes present returns null (undecided) rather than refusing; decodeFile then decides it.
 *   too-large    file.size over MAX_FILE_BYTES; or an MP3 or M4A whose duration cannot be read before
 *                decoding and that is over MAX_COMPRESSED_BYTES
 *   unsupported-type / decode-failed   bytes that are not WAV, MP3, M4A or ADTS AAC (decode-failed when the
 *                name or MIME type claims a supported type, F-11)
 *   too-long     WAV data chunk (format, bits and channels from readWavInfo), MP3 Xing/Info/VBRI frame count,
 *                M4A mvhd or mehd, ADTS frame count. Compressed durations get DURATION_SLACK_S.
 *   corrupt / unsupported-format / not-wav   a WAV header readWavInfo refuses (whole file only)
 */
export function headerRefusal(
  bytes: Uint8Array, file: { name: string; type: string; size: number }, complete: boolean,
): TakeError | null {
  if (file.size > MAX_FILE_BYTES) return new TakeError('too-large', `file is ${file.size} bytes, the limit is ${MAX_FILE_BYTES}`);
  const container = sniffContainer(bytes);
  if (container === 'unknown') {
    // Nothing is decoded. The name or MIME type only chooses the message (F-11).
    const claims = AUDIO_NAME.test(file.name) || SUPPORTED_MIME.test(file.type);
    return claims
      ? new TakeError('decode-failed', 'the file is named or typed as WAV, MP3, M4A or AAC, but its bytes are not')
      : new TakeError('unsupported-type', 'file type not supported (WAV, MP3, M4A or AAC only)');
  }
  const limit = MAX_DURATION_S + DURATION_SLACK_S;
  try {
    if (container === 'wav') {
      const info = readWavInfo(bytes);
      // readWavInfo cuts the data chunk at the end of the bytes it has; on a partial head the chunk's own size
      // (capped at what the file holds) gives the real length. On the whole file the two agree.
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const claimed = dv.getUint32(info.dataOffset - 4, true);
      const dataBytes = Math.min(claimed, file.size - info.dataOffset);
      const frames = Math.floor(dataBytes / ((info.bitsPerSample / 8) * info.channels));
      const durationS = frames / info.sampleRate;
      return durationS > MAX_DURATION_S ? tooLong(durationS, 'WAV data chunk') : null;
    }
    if (container === 'mp3') {
      const info = readMp3Info(bytes);
      if (!info && !complete) return null; // the first frame may lie past a large ID3v2 tag
      if (!info || info.durationSource === 'estimate') {
        return file.size > MAX_COMPRESSED_BYTES ? tooLargeUnknownDuration(file.size, 'MP3 duration is unknown before decoding (no Xing/Info/VBRI frame)') : null;
      }
      return info.durationS > limit ? tooLong(info.durationS, `${info.durationSource} frame count`) : null;
    }
    if (container === 'm4a') {
      const dur = readM4aDuration(bytes);
      if (dur === null) {
        if (!complete) return null; // moov may come after the head
        return file.size > MAX_COMPRESSED_BYTES ? tooLargeUnknownDuration(file.size, 'M4A duration is unknown before decoding (no mvhd or mehd duration)') : null;
      }
      return dur > limit ? tooLong(dur, 'MP4 mvhd or mehd') : null;
    }
    // ADTS: the frame walk only counts frames present, so a partial count is a lower bound and still refuses.
    const a = readAdtsInfo(bytes);
    return a && a.durationS > limit ? tooLong(a.durationS, 'ADTS frame count') : null;
  } catch (err) {
    if (!complete) return null; // a header cut off by the head: let the whole file decide
    return asTakeError(err);
  }
}

/** Refusal decided from the first PRECHECK_BYTES of the file, or null when the file goes on to decoding. */
export async function precheckFile(file: File): Promise<TakeError | null> {
  if (file.size > MAX_FILE_BYTES) return headerRefusal(new Uint8Array(0), file, false);
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, PRECHECK_BYTES).arrayBuffer());
  } catch {
    return null; // reading fails again, with its own error, in decodeFile
  }
  return headerRefusal(head, file, file.size <= PRECHECK_BYTES);
}

export async function decodeFile(file: File, signal?: AbortSignal): Promise<DecodedFile> {
  checkAbort(signal);
  const early = await precheckFile(file);
  if (early) throw early;
  checkAbort(signal);
  let bytes: ArrayBuffer | null;
  try {
    bytes = await file.arrayBuffer();
  } catch (err) {
    throw asTakeError(err);
  }
  checkAbort(signal);
  try {
    const head = new Uint8Array(bytes);
    const refusal = headerRefusal(head, file, true);
    if (refusal) throw refusal;
    const container = sniffContainer(head);

    if (container === 'wav') {
      const info = readWavInfo(bytes);
      const durationS = info.frames / info.sampleRate;
      if (NATIVE_RATES.includes(info.sampleRate)) {
        const b = bytes;
        bytes = null;
        return { input: { kind: 'wav', bytes: b }, transfer: [b], sampleRate: info.sampleRate, channels: info.channels, rateSource: 'header', nativeRate: info.sampleRate, durationS };
      }
      const b = bytes;
      bytes = null;
      const d = await decodeAt(b, RESAMPLE_RATE, signal, 0);
      return withChannels(d, { ctxRate: RESAMPLE_RATE, rateSource: 'resampled', nativeRate: info.sampleRate });
    }

    // MP3, M4A or ADTS AAC (headerRefusal refused every other container). Durations were checked there.
    let plan: Plan;
    if (container === 'mp3') {
      const info = readMp3Info(head);
      plan = planFor(info ? info.rate : null);
    } else if (container === 'm4a') {
      const r = readM4aRate(head);
      plan = r ? planFor(r.rate, r.confirmed) : planFor(null);
    } else {
      const a = readAdtsInfo(head);
      plan = a ? planFor(a.rate, a.confirmed) : planFor(null);
    }
    const b = bytes;
    bytes = null;
    const d = await decodeAt(b, plan.ctxRate, signal, DURATION_SLACK_S);
    return withChannels(d, plan);
  } catch (err) {
    throw asTakeError(err);
  }
}

function withChannels(d: { channels: Float32Array[]; durationS: number }, plan: Plan): DecodedFile {
  return {
    input: { kind: 'channels', channels: d.channels, sampleRate: plan.ctxRate },
    transfer: d.channels.map((c) => c.buffer as ArrayBuffer),
    sampleRate: plan.ctxRate, channels: d.channels.length, rateSource: plan.rateSource, nativeRate: plan.nativeRate, durationS: d.durationS,
  };
}
