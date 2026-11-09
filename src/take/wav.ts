// DOM-free WAV parser (specs/M2.md 4.3). Reads what tools/wav.ts reads: PCM 16, 24 and 32-bit, IEEE float
// 32 and 64-bit, WAVE_FORMAT_EXTENSIBLE with either sub-format, any channel count. Channels are mixed
// to mono exactly as tools/wav.ts does (sum in channel order, then divide, in float64), so the samples
// are bit-identical (F-01). The rate is the file's own; nothing is resampled.
// Chunk walking also matches tools/wav.ts: chunks are word-aligned, the last fmt and data chunks win,
// and a data chunk that runs past the end of the bytes is cut at the end (a truncated file still reads).

import { TakeError } from './errors.ts';
import { MAX_DURATION_S } from './limits.ts';

export interface ParsedWav { sampleRate: number; channels: number; samples: Float64Array }

export interface WavInfo {
  sampleRate: number;
  channels: number;
  /** 1 = integer PCM, 3 = IEEE float (after resolving WAVE_FORMAT_EXTENSIBLE). */
  format: 1 | 3;
  bitsPerSample: number;
  /** Byte offset and length of the data chunk body within the bytes (length cut at the end of the bytes). */
  dataOffset: number;
  dataLength: number;
  /** Whole sample frames in the data chunk. */
  frames: number;
}

function view(bytes: ArrayBuffer | Uint8Array): DataView {
  return bytes instanceof Uint8Array ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes);
}

function ascii(dv: DataView, at: number): string {
  return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
}

/** Header only: validates the format and locates the data chunk without reading samples. */
export function readWavInfo(bytes: ArrayBuffer | Uint8Array): WavInfo {
  const dv = view(bytes);
  const len = dv.byteLength;
  if (len < 12 || ascii(dv, 0) !== 'RIFF' || ascii(dv, 8) !== 'WAVE') throw new TakeError('not-wav', 'not a RIFF/WAVE file');
  let pos = 12;
  let fmt = -1, channels = 0, sampleRate = 0, bits = 0;
  let dataOffset = -1, dataLength = 0;
  while (pos + 8 <= len) {
    const id = ascii(dv, pos);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > len) throw new TakeError('corrupt', 'fmt chunk is too short');
      fmt = dv.getUint16(body, true);
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bits = dv.getUint16(body + 14, true);
      if (fmt === 0xfffe) {
        if (size < 26 || body + 26 > len) throw new TakeError('corrupt', 'extensible fmt chunk is too short');
        fmt = dv.getUint16(body + 24, true); // sub-format GUID, first two bytes
      }
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = Math.max(0, Math.min(len, body + size) - body);
    }
    pos = body + size + (size & 1);
  }
  if (fmt < 0 || dataOffset < 0 || !channels) throw new TakeError('corrupt', 'missing fmt or data chunk');
  if (!sampleRate) throw new TakeError('corrupt', 'sample rate is 0');
  const ok = (fmt === 1 && (bits === 16 || bits === 24 || bits === 32)) || (fmt === 3 && (bits === 32 || bits === 64));
  if (!ok) throw new TakeError('unsupported-format', `unsupported WAV encoding: format ${fmt}, ${bits}-bit`);
  const frames = Math.floor(dataLength / ((bits / 8) * channels));
  return { sampleRate, channels, format: fmt as 1 | 3, bitsPerSample: bits, dataOffset, dataLength, frames };
}

/**
 * Throws TakeError 'too-long' when the data chunk holds more than MAX_DURATION_S of audio (F-13), before the
 * samples are allocated. readWavInfo only reports the frame count, so callers can check it themselves.
 */
export function parseWav(bytes: ArrayBuffer | Uint8Array): ParsedWav {
  const info = readWavInfo(bytes);
  const durationS = info.frames / info.sampleRate;
  if (durationS > MAX_DURATION_S) throw new TakeError('too-long', `take is ${durationS.toFixed(1)} s, the limit is ${MAX_DURATION_S} s`, { durationS });
  const dv = view(bytes);
  const { channels, format, bitsPerSample: bits, dataOffset, frames } = info;
  const bps = bits / 8;
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let ch = 0; ch < channels; ch++) {
      const o = dataOffset + (i * channels + ch) * bps;
      let v: number;
      if (format === 3) v = bits === 32 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
      else if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 24) v = (((dv.getUint8(o + 2) << 24) >> 8) | (dv.getUint8(o + 1) << 8) | dv.getUint8(o)) / 8388608;
      else v = dv.getInt32(o, true) / 2147483648;
      acc += v;
    }
    out[i] = acc / channels;
  }
  return { sampleRate: info.sampleRate, channels, samples: out };
}
