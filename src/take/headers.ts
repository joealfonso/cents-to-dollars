// Native sample rate from compressed-file headers, and container sniffing by magic bytes (specs/M2.md 4.3).
// decodeAudioData never reports a file's own rate, so the rate has to come from here.

export type Container = 'wav' | 'mp3' | 'm4a' | 'aac' | 'unknown';

const ascii4 = (b: Uint8Array, at: number) =>
  at + 4 <= b.length ? String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]) : '';

// ---------------------------------------------------------------- MP3

const MPEG_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};
// kbit/s by bitrate index; index 0 is free format, 15 is invalid.
const BR_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
const BR_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
const BR_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

interface MpegHeader { version: number; layer: number; rate: number; length: number; bitrate: number; mono: boolean; samplesPerFrame: number }

/** Parses a 4-byte MPEG audio frame header at `at`; null if it is not a valid, fixed-bitrate header. */
function mpegHeader(b: Uint8Array, at: number): MpegHeader | null {
  if (at + 4 > b.length) return null;
  if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3; // 0 = 2.5, 1 reserved, 2 = MPEG 2, 3 = MPEG 1
  const layerBits = (b[at + 1] >> 1) & 3; // 1 = III, 2 = II, 3 = I, 0 reserved
  if (version === 1 || layerBits === 0) return null;
  const layer = 4 - layerBits;
  const brIdx = b[at + 2] >> 4;
  const srIdx = (b[at + 2] >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null; // free format is not handled
  const pad = (b[at + 2] >> 1) & 1;
  const rate = MPEG_RATES[version][srIdx];
  const v1 = version === 3;
  const table = layer === 1 ? (v1 ? BR_V1_L1 : BR_V2_L1) : layer === 2 ? (v1 ? BR_V1_L2 : BR_V2_L23) : v1 ? BR_V1_L3 : BR_V2_L23;
  const br = table[brIdx] * 1000;
  let length: number;
  if (layer === 1) length = (Math.floor((12 * br) / rate) + pad) * 4;
  else if (layer === 3 && !v1) length = Math.floor((72 * br) / rate) + pad;
  else length = Math.floor((144 * br) / rate) + pad;
  const samplesPerFrame = layer === 1 ? 384 : layer === 3 && !v1 ? 576 : 1152;
  return { version, layer, rate, length, bitrate: br, mono: b[at + 3] >> 6 === 3, samplesPerFrame };
}

/** Offset just past any ID3v2 tags at the start (several tags can be chained). */
function skipId3(b: Uint8Array): number {
  let pos = 0;
  while (pos + 10 <= b.length && b[pos] === 0x49 && b[pos + 1] === 0x44 && b[pos + 2] === 0x33) {
    const size = ((b[pos + 6] & 0x7f) << 21) | ((b[pos + 7] & 0x7f) << 14) | ((b[pos + 8] & 0x7f) << 7) | (b[pos + 9] & 0x7f);
    const footer = b[pos + 5] & 0x10 ? 10 : 0;
    pos += 10 + size + footer;
  }
  return pos;
}

/** A header at `at` counts as a frame if the next frame (when it lies inside the bytes) has a matching header. */
function validFrameAt(b: Uint8Array, at: number): MpegHeader | null {
  const h = mpegHeader(b, at);
  if (!h || h.length < 4) return null;
  const next = at + h.length;
  if (next + 4 > b.length) return h;
  const n = mpegHeader(b, next);
  return n && n.version === h.version && n.layer === h.layer && n.rate === h.rate ? h : null;
}

function firstFrame(bytes: Uint8Array): { at: number; h: MpegHeader } | null {
  for (let at = skipId3(bytes); at + 4 <= bytes.length; at++) {
    if (bytes[at] !== 0xff) continue;
    const h = validFrameAt(bytes, at);
    if (h) return { at, h };
  }
  return null;
}

/** Sample rate of the first valid MPEG audio frame after any ID3v2 tag, or null. */
export function readMp3Rate(bytes: Uint8Array): number | null {
  return firstFrame(bytes)?.h.rate ?? null;
}

export interface Mp3Info {
  rate: number;
  durationS: number;
  /** 'xing' (Xing or Info frame count), 'vbri' (VBRI frame count), or 'estimate' (file size / first frame bitrate). */
  durationSource: 'xing' | 'vbri' | 'estimate';
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/** Rate and duration of an MP3 from its first frame, before decoding. */
export function readMp3Info(bytes: Uint8Array): Mp3Info | null {
  const f = firstFrame(bytes);
  if (!f) return null;
  const { at, h } = f;
  const side = h.version === 3 ? (h.mono ? 17 : 32) : h.mono ? 9 : 17;
  for (const off of [4 + side, 6 + side]) {
    const tag = ascii4(bytes, at + off);
    if ((tag === 'Xing' || tag === 'Info') && at + off + 12 <= bytes.length && u32be(bytes, at + off + 4) & 1) {
      return { rate: h.rate, durationS: (u32be(bytes, at + off + 8) * h.samplesPerFrame) / h.rate, durationSource: 'xing' };
    }
  }
  if (ascii4(bytes, at + 36) === 'VBRI' && at + 36 + 18 <= bytes.length) {
    return { rate: h.rate, durationS: (u32be(bytes, at + 36 + 14) * h.samplesPerFrame) / h.rate, durationSource: 'vbri' };
  }
  return { rate: h.rate, durationS: ((bytes.length - at) * 8) / h.bitrate, durationSource: 'estimate' };
}

// ---------------------------------------------------------------- M4A / MP4

export interface M4aRate { rate: number; confirmed: boolean }

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

class Bits {
  private pos = 0;
  private readonly b: Uint8Array;
  private readonly start: number;
  private readonly end: number;
  constructor(b: Uint8Array, start: number, end: number) { this.b = b; this.start = start; this.end = end; }
  left(): number { return (this.end - this.start) * 8 - this.pos; }
  read(n: number): number {
    if (n > this.left()) throw new RangeError('out of bits');
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[this.start + (this.pos >> 3)];
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

function readAot(br: Bits): number {
  const a = br.read(5);
  return a === 31 ? 32 + br.read(6) : a;
}
function readRate(br: Bits): number | null {
  const i = br.read(4);
  return i === 15 ? br.read(24) : (AAC_RATES[i] ?? null);
}

// Highest core rate at which implicit SBR can occur. Implicit SBR doubles the output rate, and the HE-AAC
// profiles allow at most 48 kHz output, so a core above 24 kHz cannot carry it (design choice, see
// specs/M2.md 4.3: "when the header gives a rate but SBR could be implicit").
const MAX_IMPLICIT_SBR_CORE = 24000;

/** AudioSpecificConfig (ISO/IEC 14496-3 1.6.2.1) to a rate. */
function parseAsc(b: Uint8Array, start: number, end: number): M4aRate | null {
  const br = new Bits(b, start, end);
  try {
    let aot = readAot(br);
    const base = readRate(br);
    if (base === null) return null;
    const chanCfg = br.read(4);
    if (aot === 5 || aot === 29) {
      // Explicit hierarchical signalling of SBR (and PS for 29): the extension rate is the output rate.
      const ext = readRate(br);
      return ext === null ? null : { rate: ext, confirmed: true };
    }
    const gaAots = [1, 2, 3, 4, 6, 7, 17, 19, 20, 21, 22, 23];
    if (!gaAots.includes(aot)) return { rate: base, confirmed: true };
    // GASpecificConfig
    br.read(1); // frameLengthFlag
    if (br.read(1)) br.read(14); // dependsOnCoreCoder, coreCoderDelay
    const extensionFlag = br.read(1);
    if (chanCfg === 0) return implicit(aot, base); // program_config_element not parsed; no explicit signal read
    if (aot === 6 || aot === 20) br.read(3);
    if (extensionFlag) {
      if (aot === 22) br.read(16);
      if (aot === 17 || aot === 19 || aot === 20 || aot === 23) br.read(3);
      br.read(1);
    }
    if ([17, 19, 20, 21, 22, 23].includes(aot)) br.read(2); // epConfig
    // Backward-compatible explicit signalling: syncExtensionType 0x2b7.
    if (br.left() >= 16 && br.read(11) === 0x2b7) {
      const extAot = readAot(br);
      if (extAot === 5) {
        if (br.read(1)) {
          const ext = readRate(br);
          return ext === null ? null : { rate: ext, confirmed: true };
        }
        return { rate: base, confirmed: true }; // SBR explicitly absent
      }
    }
    return implicit(aot, base);
  } catch {
    return null;
  }
}

// Rule for "rate not confirmed" (specs/M2.md 4.3): flag only AAC-LC (object type 2) with a core rate of
// 24 kHz or less and no SBR signalled. Implicit SBR doubles the output rate, and the HE-AAC profiles
// (ISO/IEC 14496-3, HE-AAC and HE-AAC v2 profiles, levels 2 to 4) cap the SBR output at 48 kHz, so a core
// above 24 kHz cannot carry implicit SBR. Explicit signalling (object type 5 or 29, or a sync extension)
// is read above and is always confirmed.
function implicit(aot: number, base: number): M4aRate {
  return { rate: base, confirmed: !(aot === 2 && base <= MAX_IMPLICIT_SBR_CORE) };
}

interface Box { type: string; start: number; body: number; end: number }

function* boxes(b: Uint8Array, dv: DataView, from: number, to: number): Generator<Box> {
  let pos = from;
  while (pos + 8 <= to) {
    let size = dv.getUint32(pos);
    const type = ascii4(b, pos + 4);
    let body = pos + 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      size = dv.getUint32(pos + 8) * 2 ** 32 + dv.getUint32(pos + 12);
      body = pos + 16;
    } else if (size === 0) size = to - pos;
    if (size < body - pos) return;
    const end = Math.min(to, pos + size);
    yield { type, start: pos, body, end };
    pos = pos + size;
  }
}

function descLen(b: Uint8Array, at: number, end: number): [number, number] | null {
  let len = 0;
  for (let i = 0; i < 4; i++) {
    if (at >= end) return null;
    const v = b[at++];
    len = len * 128 + (v & 0x7f);
    if (!(v & 0x80)) return [len, at];
  }
  return [len, at];
}

/** esds box body to a rate, or undefined when there is no AudioSpecificConfig to read. */
function parseEsds(b: Uint8Array, start: number, end: number, entryRate: number): M4aRate | null | undefined {
  let p = start + 4; // version and flags
  if (b[p] !== 0x03) return undefined;
  let l = descLen(b, p + 1, end);
  if (!l) return null;
  p = l[1];
  const flags = b[p + 2];
  p += 3;
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + b[p];
  if (flags & 0x20) p += 2;
  if (b[p] !== 0x04) return undefined;
  l = descLen(b, p + 1, end);
  if (!l) return null;
  p = l[1];
  const oti = b[p];
  if (oti === 0x69 || oti === 0x6b) return { rate: entryRate, confirmed: true }; // MP3 in MP4
  p += 13;
  if (b[p] !== 0x05) return undefined;
  l = descLen(b, p + 1, end);
  if (!l) return null;
  return parseAsc(b, l[1], Math.min(end, l[1] + l[0]));
}

function findBox(b: Uint8Array, dv: DataView, from: number, to: number, type: string, depth = 0): Box | null {
  for (const bx of boxes(b, dv, from, to)) {
    if (bx.type === type) return bx;
    if (depth < 2 && bx.type === 'wave') {
      const inner = findBox(b, dv, bx.body, bx.end, type, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

function mp4aRate(b: Uint8Array, dv: DataView, e: Box): M4aRate | null {
  if (e.start + 36 > e.end) return null;
  const version = dv.getUint16(e.start + 16);
  let rate: number, children: number;
  if (version === 2) {
    if (e.start + 72 > e.end) return null;
    rate = Math.round(dv.getFloat64(e.start + 40));
    children = e.start + 72;
  } else {
    rate = dv.getUint32(e.start + 32) / 65536;
    children = e.start + (version === 1 ? 52 : 36);
  }
  const esds = findBox(b, dv, children, e.end, 'esds');
  const fromEsds = esds ? parseEsds(b, esds.body, esds.end, rate) : undefined;
  if (fromEsds !== undefined) return fromEsds;
  // No AudioSpecificConfig: only the sample entry's rate, which implicit SBR can make wrong.
  return rate > 0 ? { rate, confirmed: rate > MAX_IMPLICIT_SBR_CORE } : null;
}

/**
 * Rate of the first `mp4a` sample entry in the file (esds AudioSpecificConfig, else the sample entry).
 * Raw AAC in ADTS frames (.aac) is read too, from its first header, with the same "not confirmed" rule.
 */
export function readM4aRate(bytes: Uint8Array): M4aRate | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const path = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd'];
  const walk = (from: number, to: number, depth: number): M4aRate | null => {
    for (const bx of boxes(bytes, dv, from, to)) {
      if (bx.type !== path[depth]) continue;
      if (depth === path.length - 1) {
        // stsd: full box header (4) and entry count (4), then sample entries.
        for (const e of boxes(bytes, dv, bx.body + 8, bx.end)) if (e.type === 'mp4a') return mp4aRate(bytes, dv, e);
        continue;
      }
      const r = walk(bx.body, bx.end, depth + 1);
      if (r) return r;
    }
    return null;
  };
  try {
    const r = walk(0, bytes.length, 0);
    if (r) return r;
  } catch {
    /* not an MP4: fall through to ADTS */
  }
  const a = readAdtsInfo(bytes);
  return a ? { rate: a.rate, confirmed: a.confirmed } : null;
}

/**
 * Movie duration in seconds, or null when unknown. From moov/mvhd; when that is 0 or all ones (fragmented
 * MP4 often writes 0), from moov/mvex/mehd fragment_duration in the mvhd timescale. Includes encoder
 * priming and padding.
 */
export function readM4aDuration(bytes: Uint8Array): number | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (at: number) => dv.getUint32(at) * 2 ** 32 + dv.getUint32(at + 4);
  try {
    for (const moov of boxes(bytes, dv, 0, bytes.length)) {
      if (moov.type !== 'moov') continue;
      let ts = 0, dur: number | null = null;
      for (const bx of boxes(bytes, dv, moov.body, moov.end)) {
        if (bx.type !== 'mvhd') continue;
        const v1 = bytes[bx.body] === 1;
        if (bx.body + (v1 ? 32 : 20) > bx.end) return null;
        ts = dv.getUint32(bx.body + (v1 ? 20 : 12));
        const d = v1 ? u64(bx.body + 24) : dv.getUint32(bx.body + 16);
        const unknown = d === 0 || (v1 ? dv.getUint32(bx.body + 24) === 0xffffffff && dv.getUint32(bx.body + 28) === 0xffffffff : d === 0xffffffff);
        dur = unknown ? null : d;
      }
      if (ts <= 0) return null;
      if (dur !== null) return dur / ts;
      for (const mvex of boxes(bytes, dv, moov.body, moov.end)) {
        if (mvex.type !== 'mvex') continue;
        for (const bx of boxes(bytes, dv, mvex.body, mvex.end)) {
          if (bx.type !== 'mehd') continue;
          const v1 = bytes[bx.body] === 1;
          if (bx.body + (v1 ? 12 : 8) > bx.end) return null;
          const d = v1 ? u64(bx.body + 4) : dv.getUint32(bx.body + 4);
          return d > 0 ? d / ts : null;
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- ADTS (raw .aac)

interface AdtsHeader { aot: number; rate: number; length: number; blocks: number }

function adtsHeader(b: Uint8Array, at: number): AdtsHeader | null {
  if (at + 7 > b.length || b[at] !== 0xff || (b[at + 1] & 0xf6) !== 0xf0) return null; // sync 0xFFF, layer 00
  const aot = (b[at + 2] >> 6) + 1;
  const rate = AAC_RATES[(b[at + 2] >> 2) & 0xf];
  const length = ((b[at + 3] & 3) << 11) | (b[at + 4] << 3) | (b[at + 5] >> 5);
  if (rate === undefined || length < 7) return null;
  return { aot, rate, length, blocks: (b[at + 6] & 3) + 1 };
}

function adtsAt(b: Uint8Array, at: number): AdtsHeader | null {
  const h = adtsHeader(b, at);
  if (!h) return null;
  const next = at + h.length;
  if (next + 7 > b.length) return h;
  const n = adtsHeader(b, next);
  return n && n.rate === h.rate && n.aot === h.aot ? h : null;
}

export interface AdtsInfo extends M4aRate { durationS: number }

/**
 * Raw AAC in ADTS frames (after any ID3v2 tag): rate from the first header's sampling_frequency_index,
 * duration from walking the frame headers (1024 samples per raw data block at the core rate). ADTS cannot
 * signal SBR, so the same "not confirmed" rule as M4A applies to the core rate.
 */
export function readAdtsInfo(bytes: Uint8Array): AdtsInfo | null {
  const start = skipId3(bytes);
  const h = adtsAt(bytes, start);
  if (!h) return null;
  let blocks = 0;
  for (let at = start; ; ) {
    const x = adtsHeader(bytes, at);
    if (!x || x.rate !== h.rate) break;
    blocks += x.blocks;
    at += x.length;
  }
  return { ...implicit(h.aot, h.rate), durationS: (blocks * 1024) / h.rate };
}

// ---------------------------------------------------------------- sniffing

/** How far into a file without an ID3v2 tag the MP3 sniff looks for a frame pair (leading junk). */
const MP3_SNIFF_SCAN_BYTES = 64 * 1024;

export function sniffContainer(bytes: Uint8Array): Container {
  if (ascii4(bytes, 0) === 'RIFF' && ascii4(bytes, 8) === 'WAVE') return 'wav';
  const t = ascii4(bytes, 4);
  if (t === 'ftyp' || t === 'moov') return 'm4a';
  const id3 = skipId3(bytes);
  if (adtsAt(bytes, id3)) return 'aac';
  if (id3 > 0) return 'mp3';
  if (validFrameAt(bytes, 0)) return 'mp3';
  // Leading junk without a tag: a frame whose next frame is present and matches (a pair, not a lone sync).
  const end = Math.min(bytes.length - 4, MP3_SNIFF_SCAN_BYTES);
  for (let at = 1; at < end; at++) {
    if (bytes[at] !== 0xff) continue;
    const h = mpegHeader(bytes, at);
    if (!h || h.length < 4 || at + h.length + 4 > bytes.length) continue;
    if (validFrameAt(bytes, at)) return 'mp3';
  }
  return 'unknown';
}
