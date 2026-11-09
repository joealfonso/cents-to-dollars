// Minimal WAV reader for the offline CLI: PCM 16/24/32-bit and IEEE float 32/64, any channel count
// (channels are averaged to mono). Sample rate is preserved; nothing is resampled.

import { readFileSync } from 'node:fs';

export interface Wav { sampleRate: number; channels: number; samples: Float64Array }

export function readWav(path: string): Wav {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a RIFF/WAVE file`);
  let pos = 12;
  let fmt = 0, channels = 0, sampleRate = 0, bits = 0;
  let data: Buffer | null = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = b.readUInt16LE(body);
      channels = b.readUInt16LE(body + 2);
      sampleRate = b.readUInt32LE(body + 4);
      bits = b.readUInt16LE(body + 14);
      if (fmt === 0xfffe) fmt = b.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE sub-format
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(b.length, body + size));
    }
    pos = body + size + (size & 1);
  }
  if (!data || !channels) throw new Error(`${path}: missing fmt or data chunk`);
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let ch = 0; ch < channels; ch++) {
      const o = (i * channels + ch) * bytes;
      let v: number;
      if (fmt === 3) v = bits === 32 ? data.readFloatLE(o) : data.readDoubleLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648;
      else throw new Error(`${path}: unsupported ${bits}-bit format ${fmt}`);
      acc += v;
    }
    out[i] = acc / channels;
  }
  return { sampleRate, channels, samples: out };
}
