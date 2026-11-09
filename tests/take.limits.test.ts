// F-12 and F-13, Node side (WAV header path). specs/M2.md 4.5, 4.6 and specs/M2.1-API.md decisions:
// MAX_DURATION_S and MAX_FILE_BYTES live in an exported constants module; TakeError codes 'too-long' and 'too-large'.
// The constants are imported, never hardcoded. The module is found at src/take/limits.ts or src/take/constants.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, wavHeaderClaiming, tone } from './take.helpers.ts';

const errMod = () => import('../src/take/errors.ts');

async function limits(): Promise<{ MAX_DURATION_S: number; MAX_FILE_BYTES: number }> {
  const tries = [() => import('../src/take/limits.ts'), () => import('../src/take/constants.ts')];
  for (const t of tries) {
    try {
      const m = (await t()) as Record<string, unknown>;
      if (typeof m.MAX_DURATION_S === 'number' && typeof m.MAX_FILE_BYTES === 'number') return m as any;
    } catch { /* try the next location */ }
  }
  throw new Error('no constants module exporting MAX_DURATION_S and MAX_FILE_BYTES found in src/take/limits.ts or constants.ts');
}

async function expectCode(fn: () => unknown, code: string, label: string) {
  const { TakeError } = await errMod();
  let thrown: unknown;
  try { fn(); } catch (e) { thrown = e; }
  assert.ok(thrown instanceof TakeError, `${label}: should throw TakeError, got ${thrown}`);
  assert.equal((thrown as { code: string }).code, code, label);
}

test('limits: MAX_DURATION_S is at least 600 (her longest take, spec 4.5) and MAX_FILE_BYTES is a positive number', async () => {
  const { MAX_DURATION_S, MAX_FILE_BYTES } = await limits();
  assert.ok(MAX_DURATION_S >= 600, `MAX_DURATION_S ${MAX_DURATION_S}`);
  assert.ok(Number.isFinite(MAX_FILE_BYTES) && MAX_FILE_BYTES > 0);
});

// The duration and size checks live in src/file/decode.ts (decodeFile), before any decodeAudioData. For WAV at 44.1/48 kHz
// and for the size check that path touches only File, so it runs in Node (Node 22 has a global File).
const decodeMod = () => import('../src/file/decode.ts');
const fileOf = (bytes: Uint8Array, name = 'f.wav') => new File([bytes as BlobPart], name, { type: 'audio/wav' });

async function rejectsWith(p: Promise<unknown>, code: string, label: string) {
  const { TakeError } = await errMod();
  let thrown: unknown;
  try { await p; } catch (e) { thrown = e; }
  assert.ok(thrown instanceof TakeError, `${label}: should reject with TakeError, got ${thrown}`);
  assert.equal((thrown as { code: string }).code, code, label);
}

test('F-13: a WAV whose real duration is just over MAX_DURATION_S is refused with TakeError too-long', async () => {
  const { decodeFile } = await decodeMod();
  const { MAX_DURATION_S } = await limits();
  const sr = 44100; // mono 16-bit: 601 s is 53 MB, and 44.1 kHz stays on the no-decodeAudioData WAV path
  const bytes = encodeWav({ sampleRate: sr, format: 'pcm16', channels: [new Float64Array((MAX_DURATION_S + 1) * sr)] });
  await rejectsWith(decodeFile(fileOf(bytes)), 'too-long', `${MAX_DURATION_S + 1} s`);
});

test('F-13 boundary: a WAV of exactly MAX_DURATION_S is not refused as too-long', async () => {
  const { decodeFile } = await decodeMod();
  const { MAX_DURATION_S } = await limits();
  const sr = 44100;
  const bytes = encodeWav({ sampleRate: sr, format: 'pcm16', channels: [new Float64Array(MAX_DURATION_S * sr)] });
  const d = await decodeFile(fileOf(bytes));
  assert.equal(d.durationS, MAX_DURATION_S);
  assert.equal(d.rateSource, 'header');
});

test('F-13: a header claiming far more than MAX_DURATION_S with a short body never yields the claimed duration (no allocation for the claim)', async () => {
  const { decodeFile } = await decodeMod();
  const { MAX_DURATION_S } = await limits();
  const sr = 48000;
  const claimed = (MAX_DURATION_S + 600) * sr;
  const bytes = wavHeaderClaiming(sr, claimed, 4000);
  assert.ok(bytes.length < 5000, 'the size is only claimed');
  let outcome: { code?: string; durationS?: number };
  try { outcome = { durationS: (await decodeFile(fileOf(bytes))).durationS }; } catch (e) { outcome = { code: (e as { code: string }).code }; }
  // Spec 4.8 treats damaged files as "analyse what is there", so reading the 2000 real frames is acceptable; refusing as too-long is too.
  // What is never acceptable is reporting or allocating the claimed length.
  if (outcome.code !== undefined) assert.equal(outcome.code, 'too-long');
  else assert.ok(outcome.durationS! < 1, `durationS ${outcome.durationS} must be the real body, not the claimed ${claimed / sr} s`);
});

test('F-12: a file over MAX_FILE_BYTES is refused with TakeError too-large before it is read', async () => {
  const { decodeFile } = await decodeMod();
  const { MAX_FILE_BYTES } = await limits();
  const chunk = new Blob([new Uint8Array(1 << 20)]);
  const n = Math.floor(MAX_FILE_BYTES / (1 << 20)) + 1;
  const rest = MAX_FILE_BYTES + 1 - n * (1 << 20) + (1 << 20); // make the total exactly MAX_FILE_BYTES + 1
  const parts: BlobPart[] = Array(n - 1).fill(chunk);
  parts.push(new Uint8Array(rest));
  const f = new File(parts, 'huge.wav', { type: 'audio/wav' });
  assert.equal(f.size, MAX_FILE_BYTES + 1);
  let read = 0;
  const orig = f.arrayBuffer.bind(f);
  f.arrayBuffer = () => { read++; return orig(); };
  await rejectsWith(decodeFile(f), 'too-large', 'MAX_FILE_BYTES + 1');
  assert.equal(read, 0, 'the file was not read');
});

test('F-13 control: a normal short WAV is not refused', async () => {
  const { decodeFile } = await decodeMod();
  const d = await decodeFile(fileOf(encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [tone({ sr: 48000, dur: 1, f0: 220 })] })));
  assert.equal(d.durationS, 1);
});
