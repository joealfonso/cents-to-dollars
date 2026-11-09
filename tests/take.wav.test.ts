// M2.1 take pipeline, WAV side. Written from specs/M2.md 4.2, 4.3, 4.6, 4.8 and specs/M2.1-API.md, not from the code.
//   F-01  parseWav equals tools/wav.ts exactly (rate, channels, samples)
//   F-05  stereo with different channels is the per-sample mean in float64
//   4.3   extensible WAV, any channel count, all PCM and float widths tools/wav.ts accepts
//   4.8   corrupt WAV throws TakeError
// Modules are imported inside each test so a missing module fails that test by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWav } from '../tools/wav.ts';
import { tone, encodeWav, rawRiff, fmtBody, rng, tmpDir, type WavFormat, type WavSpec } from './take.helpers.ts';

const wavMod = () => import('../src/take/wav.ts');
const errMod = () => import('../src/take/errors.ts');
const mixMod = () => import('../src/take/mix.ts');

function reference(bytes: Uint8Array) {
  const p = join(tmpDir('take-wav-'), 'f.wav');
  writeFileSync(p, bytes);
  return readWav(p);
}

function assertSameSamples(a: Float64Array, b: Float64Array, label: string) {
  assert.equal(a.length, b.length, `${label}: length`);
  let bad = 0, first = -1;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i]) && !(a[i] === b[i])) { bad++; if (first < 0) first = i; }
  }
  assert.equal(bad, 0, `${label}: ${bad} samples differ, first at ${first} (${a[first]} vs ${b[first]})`);
}

/** Different content per channel on purpose, so a "take channel 0" or "sum" bug shows up. */
function channelsFor(sr: number, nch: number): Float64Array[] {
  const out: Float64Array[] = [];
  for (let c = 0; c < nch; c++) out.push(tone({ sr, dur: 0.3, f0: 180 + 70 * c, amp: 0.3 + 0.1 * c, harmonics: [1, 0.4] }));
  return out;
}

const FORMATS: WavFormat[] = ['pcm16', 'pcm24', 'pcm32', 'f32', 'f64'];

test('F-01: parseWav matches tools/wav.ts exactly for every format, rate and channel count', async () => {
  const { parseWav } = await wavMod();
  for (const format of FORMATS) {
    for (const sr of [44100, 48000]) {
      for (const nch of [1, 2, 3]) {
        const bytes = encodeWav({ sampleRate: sr, channels: channelsFor(sr, nch), format });
        const ref = reference(bytes);
        const got = parseWav(bytes);
        const label = `${format} ${sr} Hz ${nch} ch`;
        assert.equal(got.sampleRate, ref.sampleRate, `${label}: sampleRate`);
        assert.equal(got.channels, ref.channels, `${label}: channels`);
        assert.ok(got.samples instanceof Float64Array, `${label}: samples are Float64Array`);
        assertSameSamples(got.samples, ref.samples, label);
      }
    }
  }
});

test('F-01: parseWav accepts ArrayBuffer and a Uint8Array view with a non-zero byteOffset', async () => {
  const { parseWav } = await wavMod();
  const bytes = encodeWav({ sampleRate: 48000, channels: channelsFor(48000, 2), format: 'pcm16' });
  const ref = reference(bytes);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
  assertSameSamples(parseWav(ab).samples, ref.samples, 'ArrayBuffer');
  const big = new Uint8Array(bytes.length + 37);
  big.fill(0xaa);
  big.set(bytes, 13);
  const view = big.subarray(13, 13 + bytes.length);
  const got = parseWav(view);
  assert.equal(got.sampleRate, 48000);
  assertSameSamples(got.samples, ref.samples, 'view at byteOffset 13');
});

test('F-01: extensible WAV (fmt size 40, PCM and float sub-formats) matches tools/wav.ts', async () => {
  const { parseWav } = await wavMod();
  for (const format of ['pcm16', 'pcm24', 'f32'] as WavFormat[]) {
    for (const nch of [1, 2]) {
      const bytes = encodeWav({ sampleRate: 48000, channels: channelsFor(48000, nch), format, extensible: true });
      const ref = reference(bytes);
      const got = parseWav(bytes);
      assert.equal(got.sampleRate, 48000);
      assert.equal(got.channels, nch);
      assertSameSamples(got.samples, ref.samples, `extensible ${format} ${nch} ch`);
    }
  }
});

test('extensible WAV: float sub-format is read as float, not as integer PCM (known value)', async () => {
  const { parseWav } = await wavMod();
  const x = Float64Array.from([0.25, -0.5, 0.125, 0]);
  const got = parseWav(encodeWav({ sampleRate: 44100, channels: [x], format: 'f32', extensible: true }));
  assert.deepEqual(Array.from(got.samples), [0.25, -0.5, 0.125, 0]);
});

test('F-01: pad byte after an odd-sized chunk, chunks after data, and a fact chunk do not shift samples', async () => {
  const { parseWav } = await wavMod();
  const spec: WavSpec = {
    sampleRate: 44100, channels: channelsFor(44100, 2), format: 'pcm16',
    chunksBeforeData: [{ id: 'LIST', body: new Uint8Array([1, 2, 3, 4, 5]) }, { id: 'fact', body: new Uint8Array(4) }], // 5 bytes: odd, so padded
    chunksAfterData: [{ id: 'id3 ', body: new Uint8Array([9, 9, 9]) }],
  };
  const bytes = encodeWav(spec);
  assertSameSamples(parseWav(bytes).samples, reference(bytes).samples, 'odd chunk');
});

test('known values: 16-bit PCM scaling is /32768, 24-bit /8388608, 32-bit /2147483648 (full scale negative is exactly -1)', async () => {
  const { parseWav } = await wavMod();
  const mk = (bits: number, vals: number[]) => {
    const bytes = bits / 8;
    const data = new Uint8Array(vals.length * bytes);
    const dv = new DataView(data.buffer);
    vals.forEach((v, i) => {
      if (bits === 16) dv.setInt16(i * 2, v, true);
      else if (bits === 32) dv.setInt32(i * 4, v, true);
      else { dv.setUint8(i * 3, v & 255); dv.setUint8(i * 3 + 1, (v >> 8) & 255); dv.setUint8(i * 3 + 2, (v >> 16) & 255); }
    });
    return rawRiff([{ id: 'fmt ', body: fmtBody(1, 1, 48000, bits) }, { id: 'data', body: data }]);
  };
  assert.deepEqual(Array.from(parseWav(mk(16, [-32768, 16384, 0, 32767])).samples), [-1, 0.5, 0, 32767 / 32768]);
  assert.deepEqual(Array.from(parseWav(mk(24, [-8388608, 4194304, 1])).samples), [-1, 0.5, 1 / 8388608]);
  assert.deepEqual(Array.from(parseWav(mk(32, [-2147483648, 1073741824, 1])).samples), [-1, 0.5, 1 / 2147483648]);
});

test('F-05: a 2-channel WAV whose channels differ parses to the per-sample mean in float64', async () => {
  const { parseWav } = await wavMod();
  const sr = 48000;
  const left = tone({ sr, dur: 0.2, f0: 220 });
  const right = tone({ sr, dur: 0.2, f0: 330, amp: 0.2 });
  for (const format of ['pcm16', 'pcm24', 'f32'] as WavFormat[]) {
    const bytes = encodeWav({ sampleRate: sr, channels: [left, right], format });
    const ref = reference(bytes);
    const mono = parseWav(bytes);
    assert.equal(mono.channels, 2);
    assertSameSamples(mono.samples, ref.samples, `${format} vs tools/wav.ts`);
    // Independent expectation: decode each channel alone (mono file of the same data), then (L + R) / 2 in float64.
    const l = parseWav(encodeWav({ sampleRate: sr, channels: [left], format })).samples;
    const r = parseWav(encodeWav({ sampleRate: sr, channels: [right], format })).samples;
    const expected = new Float64Array(l.length);
    for (let i = 0; i < l.length; i++) expected[i] = (l[i] + r[i]) / 2;
    assertSameSamples(mono.samples, expected, `${format} vs (L+R)/2`);
  }
});

test('F-05: mixToMono is the arithmetic mean per sample in float64, not float32, and does not touch its input', async () => {
  const { mixToMono } = await mixMod();
  const rand = rng(7);
  const n = 2000;
  const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { a[i] = rand() * 2 - 1; b[i] = rand() * 2 - 1; c[i] = rand() * 2 - 1; }
  const aCopy = a.slice();
  const two = mixToMono([a, b]);
  assert.ok(two instanceof Float64Array);
  assert.equal(two.length, n);
  let notFloat32 = 0;
  for (let i = 0; i < n; i++) {
    assert.equal(two[i], (a[i] + b[i]) / 2, `2 ch sample ${i}`);
    if (Math.fround(two[i]) !== two[i]) notFloat32++;
  }
  assert.ok(notFloat32 > n / 2, 'result keeps float64 precision (is not rounded to float32)');
  const three = mixToMono([a, b, c]);
  for (let i = 0; i < n; i++) assert.equal(three[i], (a[i] + b[i] + c[i]) / 3, `3 ch sample ${i}`);
  assert.deepEqual(a, aCopy, 'input untouched');
  // One channel is returned unchanged in value.
  assert.deepEqual(Array.from(mixToMono([a])), Array.from(a));
  // Plain arrays and Float32Array inputs are ArrayLike<number>.
  const f32 = Float32Array.from([0.1, -0.7, 0.3]);
  const m = mixToMono([f32, [0.5, 0.5, 0.5]]);
  for (let i = 0; i < 3; i++) assert.equal(m[i], (f32[i] + 0.5) / 2);
});

test('edge 4.8: opposite-phase stereo parses to exact silence (mean of x and -x)', async () => {
  const { parseWav } = await wavMod();
  const x = tone({ sr: 48000, dur: 0.2, f0: 220 });
  const neg = x.map((v) => -v);
  const mono = parseWav(encodeWav({ sampleRate: 48000, channels: [x, neg], format: 'pcm16' }));
  assert.equal(mono.channels, 2);
  assert.ok(mono.samples.every((v) => v === 0), 'every sample is exactly 0');
});

// ------------------------------------------------------------------ corrupt and unsupported files

async function expectTakeError(fn: () => unknown, codes: string[], label: string) {
  const { TakeError } = await errMod();
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; }
  assert.ok(thrown, `${label}: should throw`);
  assert.ok(thrown instanceof TakeError, `${label}: should throw TakeError, got ${thrown}`);
  assert.ok(codes.includes((thrown as { code: string }).code), `${label}: code ${(thrown as { code: string }).code} not in ${codes.join('|')}`);
}

test('4.8: bytes that are not RIFF/WAVE throw TakeError not-wav', async () => {
  const { parseWav } = await wavMod();
  const rand = rng(3);
  const junk = Uint8Array.from({ length: 500 }, () => Math.floor(rand() * 256));
  await expectTakeError(() => parseWav(junk), ['not-wav'], 'random bytes');
  const text = new TextEncoder().encode('this is plainly not an audio file at all');
  await expectTakeError(() => parseWav(text), ['not-wav'], 'text');
  // RIFF container with another form type (AVI), long enough to be a plausible header.
  const avi = new Uint8Array(64);
  avi.set([0x52, 0x49, 0x46, 0x46, 56, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
  await expectTakeError(() => parseWav(avi), ['not-wav'], 'RIFF AVI');
});

test('4.8: empty and truncated-header input throw TakeError', async () => {
  const { parseWav } = await wavMod();
  await expectTakeError(() => parseWav(new Uint8Array(0)), ['not-wav', 'corrupt'], 'empty');
  await expectTakeError(() => parseWav(new Uint8Array([0x52, 0x49, 0x46, 0x46])), ['not-wav', 'corrupt'], 'RIFF only');
  await expectTakeError(() => parseWav(new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), ['corrupt'], 'WAVE with no chunks');
});

test('4.8: a WAV with no data chunk, or no fmt chunk, throws TakeError corrupt', async () => {
  const { parseWav } = await wavMod();
  await expectTakeError(() => parseWav(rawRiff([{ id: 'fmt ', body: fmtBody(1, 1, 48000, 16) }])), ['corrupt'], 'no data');
  await expectTakeError(() => parseWav(rawRiff([{ id: 'data', body: new Uint8Array(100) }])), ['corrupt'], 'no fmt');
});

test('4.8: a WAV whose fmt chunk is cut short or claims zero channels or zero rate throws TakeError corrupt', async () => {
  const { parseWav } = await wavMod();
  const good = fmtBody(1, 1, 48000, 16);
  await expectTakeError(() => parseWav(rawRiff([{ id: 'fmt ', body: good.subarray(0, 10), sizeOverride: 10 }, { id: 'data', body: new Uint8Array(100) }])), ['corrupt'], 'short fmt');
  await expectTakeError(() => parseWav(rawRiff([{ id: 'fmt ', body: fmtBody(1, 0, 48000, 16) }, { id: 'data', body: new Uint8Array(100) }])), ['corrupt'], 'zero channels');
  await expectTakeError(() => parseWav(rawRiff([{ id: 'fmt ', body: fmtBody(1, 1, 0, 16) }, { id: 'data', body: new Uint8Array(100) }])), ['corrupt'], 'zero rate');
});

test('4.3/4.8: formats outside PCM 16/24/32 and float 32/64 throw TakeError unsupported-format', async () => {
  const { parseWav } = await wavMod();
  const adpcm = rawRiff([{ id: 'fmt ', body: fmtBody(2, 1, 22050, 4) }, { id: 'data', body: new Uint8Array(64) }]);
  await expectTakeError(() => parseWav(adpcm), ['unsupported-format'], 'ADPCM');
  const alaw = rawRiff([{ id: 'fmt ', body: fmtBody(6, 1, 8000, 8) }, { id: 'data', body: new Uint8Array(64) }]);
  await expectTakeError(() => parseWav(alaw), ['unsupported-format'], 'A-law');
  const pcm8 = encodeWav({ sampleRate: 48000, channels: [tone({ sr: 48000, dur: 0.05, f0: 220 })], format: 'pcm8' });
  await expectTakeError(() => parseWav(pcm8), ['unsupported-format'], '8-bit PCM (tools/wav.ts rejects it too)');
});
