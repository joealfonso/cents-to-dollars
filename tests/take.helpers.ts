// Shared fixture builders for the M2.1 take-pipeline tests (specs/M2.md 4.x, specs/M2.1-API.md).
// Not a test file (no .test.ts suffix). Everything here builds bytes from the container specs, so no
// test depends on the implementation under test to make its own inputs.
// Erasable TypeScript only (node strips types): no enums, no parameter properties.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function tmpDir(prefix = 'take-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Small deterministic PRNG so failures reproduce. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ---------------------------------------------------------------- signals

export interface ToneSpec {
  sr: number;
  dur: number;
  f0: number;
  /** Relative amplitude of harmonics 1..n. Default: three harmonics so YIN has something to chew on. */
  harmonics?: number[];
  /** Vibrato rate in Hz and plus-or-minus extent in cents (0 = steady). */
  vibRate?: number;
  vibCents?: number;
  amp?: number;
  /** Linear fade in/out in seconds (avoids a click that is not part of the test). */
  fade?: number;
  /** Additive white noise amplitude (uniform), seeded. */
  noise?: number;
  seed?: number;
}

export function tone(s: ToneSpec): Float64Array {
  const n = Math.round(s.sr * s.dur);
  const out = new Float64Array(n);
  const harm = s.harmonics ?? [1, 0.5, 0.25];
  const amp = s.amp ?? 0.5;
  const fade = s.fade ?? 0.02;
  const rand = rng(s.seed ?? 1);
  let phase = 0;
  const norm = harm.reduce((a, b) => a + Math.abs(b), 0);
  for (let i = 0; i < n; i++) {
    const t = i / s.sr;
    const cents = s.vibRate ? (s.vibCents ?? 0) * Math.sin(2 * Math.PI * s.vibRate * t) : 0;
    const f = s.f0 * 2 ** (cents / 1200);
    phase += (2 * Math.PI * f) / s.sr;
    let v = 0;
    for (let h = 0; h < harm.length; h++) v += harm[h] * Math.sin((h + 1) * phase);
    let env = 1;
    if (fade > 0) env = Math.min(1, t / fade, (s.dur - t) / fade);
    out[i] = (amp / norm) * v * Math.max(0, env) + (s.noise ? (rand() - 0.5) * 2 * s.noise : 0);
  }
  return out;
}

// ---------------------------------------------------------------- WAV writer

export type WavFormat = 'pcm8' | 'pcm16' | 'pcm24' | 'pcm32' | 'f32' | 'f64' | 'adpcm';

export interface WavSpec {
  sampleRate: number;
  /** One Float64Array per channel, values in [-1, 1]. All the same length. */
  channels: Float64Array[];
  format: WavFormat;
  /** Write WAVE_FORMAT_EXTENSIBLE (fmt size 40, sub-format GUID) instead of a plain fmt chunk. */
  extensible?: boolean;
  /** Chunks inserted between fmt and data (e.g. an odd-sized LIST chunk, to exercise pad bytes). */
  chunksBeforeData?: Array<{ id: string; body: Uint8Array }>;
  /** Chunks after data. */
  chunksAfterData?: Array<{ id: string; body: Uint8Array }>;
}

const BITS: Record<WavFormat, number> = { pcm8: 8, pcm16: 16, pcm24: 24, pcm32: 32, f32: 32, f64: 64, adpcm: 4 };

function chunk(id: string, body: Uint8Array): Uint8Array {
  const pad = body.length & 1;
  const out = new Uint8Array(8 + body.length + pad);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  dv.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function encodeWav(spec: WavSpec): Uint8Array {
  const nch = spec.channels.length;
  const frames = spec.channels[0].length;
  const bits = BITS[spec.format];
  const bytes = bits / 8;
  const isFloat = spec.format === 'f32' || spec.format === 'f64';
  const tag = spec.format === 'adpcm' ? 2 : isFloat ? 3 : 1;

  // Layout of the fmt chunk: Microsoft RIFF WAVEFORMATEX (16 bytes) with the extensible tail when asked.
  // 0 wFormatTag u16, 2 nChannels u16, 4 nSamplesPerSec u32, 8 nAvgBytesPerSec u32, 12 nBlockAlign u16,
  // 14 wBitsPerSample u16, [16 cbSize u16, 18 wValidBitsPerSample u16, 20 dwChannelMask u32, 24 SubFormat GUID (16)].
  const fmtLen = spec.extensible ? 40 : 16;
  const fmt = new Uint8Array(fmtLen);
  const fdv = new DataView(fmt.buffer);
  fdv.setUint16(0, spec.extensible ? 0xfffe : tag, true);
  fdv.setUint16(2, nch, true);
  fdv.setUint32(4, spec.sampleRate, true);
  fdv.setUint32(8, spec.sampleRate * nch * bytes, true);
  fdv.setUint16(12, nch * bytes, true);
  fdv.setUint16(14, bits, true);
  if (spec.extensible) {
    fdv.setUint16(16, 22, true);
    fdv.setUint16(18, bits, true);
    fdv.setUint32(20, nch === 1 ? 4 : 3, true);
    // KSDATAFORMAT_SUBTYPE_PCM / IEEE_FLOAT = {0000000x-0000-0010-8000-00aa00389b71}, x = format tag in the first 2 bytes.
    fdv.setUint16(24, tag, true);
    const tail = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
    for (let i = 0; i < tail.length; i++) fmt[26 + i] = tail[i];
  }

  const data = new Uint8Array(frames * nch * bytes);
  const dv = new DataView(data.buffer);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const x = Math.max(-1, Math.min(1, spec.channels[c][i]));
      const o = (i * nch + c) * bytes;
      switch (spec.format) {
        case 'pcm8': dv.setUint8(o, Math.round(x * 127) + 128); break;
        case 'pcm16': dv.setInt16(o, Math.round(x * 32767), true); break;
        case 'pcm24': {
          const v = Math.round(x * 8388607);
          dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255);
          break;
        }
        case 'pcm32': dv.setInt32(o, Math.round(x * 2147483647), true); break;
        case 'f32': dv.setFloat32(o, x, true); break;
        case 'f64': dv.setFloat64(o, x, true); break;
        case 'adpcm': break;
      }
    }
  }

  const body = concat([
    new Uint8Array([0x57, 0x41, 0x56, 0x45]), // 'WAVE'
    chunk('fmt ', fmt),
    ...(spec.chunksBeforeData ?? []).map((c) => chunk(c.id, c.body)),
    chunk('data', data),
    ...(spec.chunksAfterData ?? []).map((c) => chunk(c.id, c.body)),
  ]);
  const out = new Uint8Array(8 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

/** Raw RIFF/WAVE with caller-chosen chunks, for corrupt-file cases. */
export function rawRiff(chunks: Array<{ id: string; body: Uint8Array; sizeOverride?: number }>): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x57, 0x41, 0x56, 0x45])];
  for (const c of chunks) {
    const piece = chunk(c.id, c.body);
    if (c.sizeOverride !== undefined) new DataView(piece.buffer).setUint32(4, c.sizeOverride, true);
    parts.push(piece);
  }
  const body = concat(parts);
  const out = new Uint8Array(8 + body.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

export function fmtBody(tag: number, channels: number, rate: number, bits: number): Uint8Array {
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, tag, true);
  dv.setUint16(2, channels, true);
  dv.setUint32(4, rate, true);
  dv.setUint32(8, rate * channels * (bits / 8), true);
  dv.setUint16(12, channels * (bits / 8), true);
  dv.setUint16(14, bits, true);
  return b;
}

export function writeFile(dir: string, name: string, bytes: Uint8Array): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

// ---------------------------------------------------------------- MP3 frame builder

/**
 * Minimal MPEG audio frames, Layer III, from ISO/IEC 11172-3 (MPEG-1) frame header layout.
 * 32-bit header, MSB first:
 *   bits 31..21  frame sync, all ones (11 bits)
 *   bits 20..19  version: 11 = MPEG-1, 10 = MPEG-2, 00 = MPEG-2.5, 01 = reserved
 *   bits 18..17  layer: 01 = Layer III, 10 = Layer II, 11 = Layer I, 00 = reserved
 *   bit  16      protection (1 = no CRC)
 *   bits 15..12  bitrate index (MPEG-1 Layer III: 1001 = 128 kbit/s; 1111 = bad)
 *   bits 11..10  sampling rate index (MPEG-1: 00 = 44100, 01 = 48000, 10 = 32000, 11 = reserved)
 *   bit  9       padding
 *   bit  8       private
 *   bits 7..6    channel mode (00 stereo, 11 mono)
 *   bits 5..0    mode extension, copyright, original, emphasis
 * MPEG-1 Layer III frame length in bytes = floor(144 * bitrate / sampleRate) + padding.
 */
export function mp3Frames(rate: 44100 | 48000 | 32000, count = 4): Uint8Array {
  const srIndex = rate === 44100 ? 0 : rate === 48000 ? 1 : 2;
  const bitrate = 128000;
  const len = Math.floor((144 * bitrate) / rate);
  const header = [0xff, 0xfb, (9 << 4) | (srIndex << 2), 0x00]; // 0xfb = sync tail 111, MPEG-1 (11), Layer III (01), no CRC (1)
  const out = new Uint8Array(len * count);
  for (let i = 0; i < count; i++) out.set(header, i * len);
  return out;
}

/** A header that has the sync pattern but is not valid: bitrate index 1111 (bad). */
export const MP3_BAD_BITRATE_HEADER = [0xff, 0xfb, 0xf0, 0x00];
/** A header with the reserved sampling rate index 11. */
export const MP3_RESERVED_RATE_HEADER = [0xff, 0xfb, (9 << 4) | (3 << 2), 0x00];

/**
 * ID3v2 tag (id3.org v2.3 / v2.4 structure): 'ID3', version (2 bytes), flags (1 byte), size (4 bytes,
 * syncsafe: 7 bits per byte, MSB zero) counting the bytes after the 10-byte header. v2.4 footer flag is
 * bit 4 (0x10) and appends a 10-byte footer ('3DI' ...) that is not counted in the size.
 */
export function id3v2(body: Uint8Array, opts: { major?: 3 | 4; footer?: boolean } = {}): Uint8Array {
  const major = opts.major ?? 3;
  const size = body.length;
  const header = [
    0x49, 0x44, 0x33, major, 0x00, opts.footer ? 0x10 : 0x00,
    (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f,
  ];
  const parts = [new Uint8Array(header), body];
  if (opts.footer) parts.push(new Uint8Array([0x33, 0x44, 0x49, major, 0x00, 0x10, header[6], header[7], header[8], header[9]]));
  return concat(parts);
}

export { concat };

// ---------------------------------------------------------------- M4A (ISO BMFF) builder

export class BitWriter {
  private bits: number[] = [];
  put(value: number, n: number): this {
    for (let i = n - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
    return this;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

/** ISO/IEC 14496-3 samplingFrequencyIndex table, index 0..12. */
export const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AudioSpecificConfig, ISO/IEC 14496-3 1.6.2.1.
 *  audioObjectType (5 bits), samplingFrequencyIndex (4), channelConfiguration (4), then GASpecificConfig
 *  (frameLengthFlag 1, dependsOnCoreCoder 1, extensionFlag 1). */
export function asc(kind: 'lc' | 'sbr-explicit', rate: number, channelConfig = 2): Uint8Array {
  const w = new BitWriter();
  if (kind === 'lc') {
    w.put(2, 5).put(AAC_RATES.indexOf(rate), 4).put(channelConfig, 4).put(0, 3);
  } else {
    // Explicit hierarchical signalling: AOT 5 (SBR), core rate index, channel config, extension (output) rate
    // index, then the core AOT (2 = AAC-LC) and its GASpecificConfig. `rate` is the OUTPUT rate; core = rate / 2.
    w.put(5, 5).put(AAC_RATES.indexOf(rate / 2), 4).put(channelConfig, 4).put(AAC_RATES.indexOf(rate), 4).put(2, 5).put(0, 3);
  }
  return w.bytes();
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false); // size, big-endian, includes the 8-byte header
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function descriptor(tag: number, body: Uint8Array): Uint8Array {
  // MPEG-4 descriptor: tag byte, then size as 1 to 4 bytes of 7 bits (high bit = more). Bodies here are < 128.
  if (body.length >= 128) throw new Error('descriptor too long for this builder');
  return concat([new Uint8Array([tag, body.length]), body]);
}

export interface M4aSpec {
  rate: number;
  asc: Uint8Array;
  channels?: number;
  /** Put mdat before moov (not "fast start"). */
  mdatFirst?: boolean;
}

/** ftyp + moov/trak/mdia/minf/stbl/stsd/mp4a/esds, plus a tiny mdat. ISO/IEC 14496-12 and 14496-14. */
export function m4a(spec: M4aSpec): Uint8Array {
  // esds (FullBox: version 0, flags 0), ES_Descriptor 0x03 { ES_ID u16, flags u8, DecoderConfigDescriptor 0x04 {
  //   objectTypeIndication 0x40 (Audio ISO/IEC 14496-3), streamType 0x05<<2|1 = 0x15, bufferSizeDB u24, maxBitrate u32,
  //   avgBitrate u32, DecoderSpecificInfo 0x05 { AudioSpecificConfig } }, SLConfigDescriptor 0x06 { 0x02 } }
  const dsi = descriptor(0x05, spec.asc);
  const dcd = descriptor(0x04, concat([new Uint8Array([0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), dsi]));
  const sl = descriptor(0x06, new Uint8Array([0x02]));
  const es = descriptor(0x03, concat([new Uint8Array([0, 1, 0]), dcd, sl]));
  const esds = box('esds', concat([new Uint8Array(4), es]));

  // mp4a AudioSampleEntry: 6 reserved, data_reference_index u16, 8 reserved (version/revision/vendor), channelcount u16,
  // samplesize u16 (16), pre_defined u16, reserved u16, samplerate u32 as 16.16 fixed point (integer part is only 16 bits).
  const entry = new Uint8Array(28);
  const edv = new DataView(entry.buffer);
  edv.setUint16(6, 1, false);
  edv.setUint16(16, spec.channels ?? 2, false);
  edv.setUint16(18, 16, false);
  edv.setUint32(24, ((spec.rate & 0xffff) << 16) >>> 0, false);
  const mp4a = box('mp4a', concat([entry, esds]));
  // stsd FullBox: version/flags (4), entry_count u32
  const stsdHead = new Uint8Array(8);
  new DataView(stsdHead.buffer).setUint32(4, 1, false);
  const stsd = box('stsd', concat([stsdHead, mp4a]));
  const moov = box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd)))));

  const ftyp = box('ftyp', concat([
    new Uint8Array([0x4d, 0x34, 0x41, 0x20]), // major brand 'M4A '
    new Uint8Array(4),                        // minor version
    new Uint8Array([0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d]), // 'M4A ' 'mp42' 'isom'
  ]));
  const free = box('free', new Uint8Array(6));
  const mdat = box('mdat', new Uint8Array(64));
  return spec.mdatFirst ? concat([ftyp, free, mdat, moov]) : concat([ftyp, free, moov, mdat]);
}

// ---------------------------------------------------------------- Node reference runner

export interface RunnerJson { sampleRate: number; hop: number; t: number[]; f0: number[] }

/** `node tools/run_ts.ts track <dir> <out> cont` over a directory of WAV files; returns parsed JSON by basename. */
export function runTrackCont(wavs: Record<string, Uint8Array>): Record<string, RunnerJson> {
  const dir = tmpDir('take-in-');
  const out = join(tmpDir('take-out-'), 'o');
  for (const [name, bytes] of Object.entries(wavs)) writeFile(dir, name, bytes);
  const r = spawnSync(process.execPath, ['tools/run_ts.ts', 'track', dir, out, 'cont'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`run_ts.ts track failed (${r.status}): ${r.stderr}`);
  const res: Record<string, RunnerJson> = {};
  for (const f of readdirSync(out)) res[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(out, f), 'utf8'));
  return res;
}

export function haveBinary(cmd: string, args: string[] = ['--version']): boolean {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return !r.error;
}

export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('base64');
}

/** Cents between two frequencies. */
export function cents(a: number, b: number): number {
  return 1200 * Math.log2(a / b);
}

// ---------------------------------------------------------------- more MP3 and ADTS builders

/**
 * MPEG-2 / MPEG-2.5 Layer III frames (ISO/IEC 13818-3; 2.5 is the Fraunhofer extension).
 * Header byte 1: sync tail 111, version (10 = MPEG-2, 00 = MPEG-2.5), layer 01, no CRC 1  -> 0xF3 / 0xE3.
 * Sampling rate index: MPEG-2 0/1/2 = 22050/24000/16000; MPEG-2.5 0/1/2 = 11025/12000/8000.
 * Bitrate index 9 = 80 kbit/s for MPEG-2 and 2.5 Layer III. Frame length = floor(72 * bitrate / rate) + padding.
 */
export function mp3FramesLowRate(rate: 22050 | 24000 | 16000 | 11025 | 12000 | 8000, count = 4): Uint8Array {
  const v25 = rate === 11025 || rate === 12000 || rate === 8000;
  const idx = [22050, 11025].includes(rate) ? 0 : [24000, 12000].includes(rate) ? 1 : 2;
  const len = Math.floor((72 * 80000) / rate);
  const header = [0xff, v25 ? 0xe3 : 0xf3, (9 << 4) | (idx << 2), 0x00];
  const out = new Uint8Array(len * count);
  for (let i = 0; i < count; i++) out.set(header, i * len);
  return out;
}

/** An MPEG-1 Layer III frame whose payload starts with a Xing or Info tag at the side-info offset (4 + 32 for stereo). */
export function mp3XingFrame(rate: 44100 | 48000, tag: 'Xing' | 'Info'): Uint8Array {
  const f = mp3Frames(rate, 1);
  for (let i = 0; i < 4; i++) f[36 + i] = tag.charCodeAt(i);
  f[43] = 0x0f; // flags: frames, bytes, TOC, quality present
  return f;
}

/**
 * ADTS stream (ISO/IEC 13818-7 / 14496-3 adts_fixed_header + adts_variable_header, 7 bytes, no CRC):
 * syncword 0xFFF (12), ID (1; 0 = MPEG-4), layer (2) = 0, protection_absent (1) = 1, profile (2; AOT - 1, 1 = LC),
 * sampling_frequency_index (4), private_bit (1), channel_configuration (3), original (1), home (1),
 * copyright_id_bit (1), copyright_id_start (1), aac_frame_length (13, includes the header), adts_buffer_fullness (11) = 0x7FF,
 * number_of_raw_data_blocks_in_frame (2) = 0.
 */
export function adts(rate: number, count = 4, frameLen = 120): Uint8Array {
  const out = new Uint8Array(frameLen * count);
  for (let i = 0; i < count; i++) {
    const w = new BitWriter();
    w.put(0xfff, 12).put(0, 1).put(0, 2).put(1, 1).put(1, 2).put(AAC_RATES.indexOf(rate), 4).put(0, 1).put(2, 3)
      .put(0, 1).put(0, 1).put(0, 1).put(0, 1).put(frameLen, 13).put(0x7ff, 11).put(0, 2);
    out.set(w.bytes(), i * frameLen);
  }
  return out;
}

/** WAV header (fmt + data chunk header only) claiming `claimedFrames` mono frames, with `bodyBytes` of real data. */
export function wavHeaderClaiming(sampleRate: number, claimedFrames: number, bodyBytes: number): Uint8Array {
  const fmt = fmtBody(1, 1, sampleRate, 16);
  const head = rawRiff([{ id: 'fmt ', body: fmt }, { id: 'data', body: new Uint8Array(bodyBytes), sizeOverride: claimedFrames * 2 }]);
  return head;
}
