// M2.1 browser criteria that need no UI, driven through src/file/client.ts via the harness page:
//   F-04  end to end (file -> parser -> Worker) equals the Node module / runner on frame count, start, voiced, F0 (0.001 c)
//   F-08  44.1 kHz MP3 and M4A decode at 44100 Hz, no "Resampled" (rateSource stays 'header')
//   F-09  96 kHz WAV: analysed at 48000 Hz, rateSource 'resampled' (Option B, Q1)
//   F-11  random bytes named .mp3 are rejected as "could not decode" with no analysis
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FrameAnalyzer } from '../../src/dsp/analyzer.ts';
import { tone, encodeWav, runTrackCont, rng, tmpDir, writeFile, haveBinary, cents } from '../take.helpers.ts';
import { openHarness, runFile, medianVoicedF0, type JobState } from './take.util.ts';

test.beforeEach(async ({ page }) => { await openHarness(page); });

const gap = (sr: number, d: number) => new Float64Array(Math.round(sr * d));
const cat = (...xs: Float64Array[]) => { const o = new Float64Array(xs.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };

const F04_FILES = {
  'vib_pcm16_48k_mono.wav': encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [tone({ sr: 48000, dur: 1.5, f0: 220, vibRate: 5.5, vibCents: 50 })] }),
  'stereo_pcm24_44k.wav': encodeWav({ sampleRate: 44100, format: 'pcm24', channels: [tone({ sr: 44100, dur: 1.0, f0: 330 }), tone({ sr: 44100, dur: 1.0, f0: 247, amp: 0.3 })] }),
  'gaps_f32_48k.wav': encodeWav({ sampleRate: 48000, format: 'f32', channels: [cat(tone({ sr: 48000, dur: 0.5, f0: 196 }), gap(48000, 0.3), tone({ sr: 48000, dur: 0.5, f0: 262, harmonics: [0.3, 1, 0.6] }))] }),
};

test('F-04: file -> parser -> Worker gives the same frames, start, voiced and F0 (0.001 c) as the Node module and the Node runner', async ({ page }) => {
  const { parseWav } = await import('../../src/take/wav.ts');
  const { analyseTake } = await import('../../src/take/analyse.ts');
  const runner = runTrackCont(F04_FILES);
  for (const [name, bytes] of Object.entries(F04_FILES)) {
    const got = await runFile(page, bytes, name, 'audio/wav');
    expect(got.error, `${name}: ${JSON.stringify(got.error)}`).toBeNull();
    expect(got.settled, name).toBe('fulfilled');
    const s = got.summary!;
    expect(s.foundTake, `${name}: result shape ${JSON.stringify(s.shapeKeys)} has no object with typed-array f0`).toBe(true);
    const parsed = parseWav(bytes);
    const node = analyseTake(parsed.samples, parsed.sampleRate);
    const ref = new FrameAnalyzer({ sampleRate: parsed.sampleRate }).run(parsed.samples, false, false);
    expect(s.frameCount, `${name}: frameCount vs module`).toBe(node.frameCount);
    expect(s.frameCount, `${name}: frameCount vs runner`).toBe(runner[name.replace(/\.wav$/, '')].t.length);
    expect(s.takeSampleRate ?? s.sampleRate, `${name}: analysis rate`).toBe(parsed.sampleRate);
    expect(s.rateSource, `${name}: 44.1 and 48 kHz WAV are never resampled`).toBe('header');
    let badStart = 0, badVoiced = 0, outF0 = 0, voiced = 0, worst = 0;
    for (let i = 0; i < node.frameCount; i++) {
      if (s.start![i] !== node.start[i] || s.start![i] !== ref[i].start) badStart++;
      if (s.voiced![i] !== node.voiced[i] || (s.voiced![i] === 1) !== ref[i].voiced) badVoiced++;
      if (node.voiced[i] === 1) {
        voiced++;
        const c1 = Math.abs(cents(s.f0![i], node.f0[i]));
        const c2 = Math.abs(cents(s.f0![i], runner[name.replace(/\.wav$/, '')].f0[i]));
        worst = Math.max(worst, c1, c2);
        if (!(c1 <= 0.001) || !(c2 <= 0.001)) outF0++;
      } else if (s.f0![i] !== 0) outF0++;
    }
    expect(voiced, `${name}: voiced frames compared`).toBeGreaterThan(0);
    expect(badStart, `${name}: frames with a different start`).toBe(0);
    expect(badVoiced, `${name}: frames with a different voiced flag`).toBe(0);
    expect(outF0, `${name}: frames outside 0.001 c (worst ${worst} c)`).toBe(0);
  }
});

test('F-09: a 96 kHz WAV is resampled to 48 kHz (rateSource resampled, nativeRate 96000) and analysed at 48000 Hz', async ({ page }) => {
  const bytes = encodeWav({ sampleRate: 96000, format: 'pcm16', channels: [tone({ sr: 96000, dur: 1, f0: 220 })] });
  const got = await runFile(page, bytes, 'rate_96k.wav', 'audio/wav');
  expect(got.error, JSON.stringify(got.error)).toBeNull();
  const s = got.summary!;
  expect(s.foundTake).toBe(true);
  expect(s.rateSource).toBe('resampled');
  expect(s.nativeRate).toBe(96000);
  expect(s.takeSampleRate ?? s.sampleRate).toBe(48000);
  expect(s.status).toBe('ok');
  // 1 s at 48 kHz is 180 frames; allow one frame for resampler length rounding.
  expect(Math.abs(s.frameCount! - 180)).toBeLessThanOrEqual(1);
  expect(Math.abs(cents(medianVoicedF0(s.f0!, s.voiced!), 220))).toBeLessThan(5);
});

test('F-09 control: a 48 kHz WAV is not labelled resampled', async ({ page }) => {
  const bytes = encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [tone({ sr: 48000, dur: 1, f0: 220 })] });
  const s = (await runFile(page, bytes, 'ok48.wav', 'audio/wav')).summary!;
  expect(s.rateSource).toBe('header');
  expect(s.takeSampleRate ?? s.sampleRate).toBe(48000);
});

test('F-11: random bytes named .mp3 are rejected with a decode failure and no analysis', async ({ page }) => {
  const rand = rng(99);
  const junk = Uint8Array.from({ length: 6000 }, () => Math.floor(rand() * 256));
  const got = await runFile(page, junk, 'noise.mp3', 'audio/mpeg');
  expect(got.settled, 'promise settles').not.toBe('pending');
  expect(got.settled, 'the file must be rejected, not analysed').toBe('rejected');
  expect(got.summary, 'no result is produced').toBeNull();
});

test('F-11: the rejection reads as a decode failure ("could not decode")', async ({ page }) => {
  const rand = rng(100);
  const junk = Uint8Array.from({ length: 6000 }, () => Math.floor(rand() * 256));
  const got = await runFile(page, junk, 'noise.mp3', 'audio/mpeg');
  expect(got.error).not.toBeNull();
  expect(`${got.error!.code} ${got.error!.message}`.toLowerCase()).toMatch(/decode/);
});

// ---------------------------------------------------------------- F-08: real encoders at test setup

const lameOk = haveBinary('lame');
const afOk = haveBinary('afconvert', ['-h']);

function encodeMp3(rate: number): Uint8Array {
  const dir = tmpDir('take-b-mp3-');
  const wav = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 1, f0: 220 })], format: 'pcm16' }));
  const out = join(dir, 'o.mp3');
  const r = spawnSync('lame', ['--quiet', '-b', '128', '--resample', String(rate / 1000), wav, out]);
  if (r.status !== 0) throw new Error(`lame failed: ${r.stderr}`);
  return readFileSync(out);
}

function encodeM4a(rate: number): Uint8Array | null {
  const dir = tmpDir('take-b-m4a-');
  const wav = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 1, f0: 220 })], format: 'pcm16' }));
  const out = join(dir, 'o.m4a');
  const r = spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', wav, out], { encoding: 'utf8' });
  return r.status === 0 ? readFileSync(out) : null;
}

test('F-08: a 44.1 kHz MP3 is decoded at 44100 Hz and not labelled resampled', async ({ page }) => {
  test.skip(!lameOk, 'lame binary not installed, cannot make the MP3 fixture');
  const got = await runFile(page, encodeMp3(44100), 'tone44.mp3', 'audio/mpeg');
  expect(got.error, JSON.stringify(got.error)).toBeNull();
  const s = got.summary!;
  expect(s.nativeRate).toBe(44100);
  expect(s.takeSampleRate ?? s.sampleRate).toBe(44100);
  expect(s.rateSource).toBe('header');
  expect(s.status).toBe('ok');
  expect(Math.abs(cents(medianVoicedF0(s.f0!, s.voiced!), 220))).toBeLessThan(5);
  expect(s.durationS!).toBeGreaterThan(0.9);
  expect(s.durationS!).toBeLessThan(1.3);
});

test('F-08: a 44.1 kHz M4A (AAC-LC) is decoded at 44100 Hz and not labelled resampled', async ({ page }) => {
  test.skip(!afOk, 'afconvert not available, cannot make the M4A fixture');
  test.skip(process.env.PW_CHANNEL === 'chromium', "Playwright's bundled Chromium has no AAC decoder (use installed Chrome, Q5)");
  const m4a = encodeM4a(44100);
  test.skip(m4a === null, 'afconvert could not encode AAC here (it needs the Bash sandbox off)');
  const got = await runFile(page, m4a!, 'tone44.m4a', 'audio/mp4');
  expect(got.error, JSON.stringify(got.error)).toBeNull();
  const s = got.summary!;
  expect(s.nativeRate).toBe(44100);
  expect(s.takeSampleRate ?? s.sampleRate).toBe(44100);
  expect(s.rateSource).toBe('header');
  expect(s.status).toBe('ok');
  expect(Math.abs(cents(medianVoicedF0(s.f0!, s.voiced!), 220))).toBeLessThan(5);
});

// ---------------------------------------------------------------- F-12

test('F-12: a file over MAX_FILE_BYTES is refused (too-large) before decoding is attempted', async ({ page }) => {
  const { MAX_FILE_BYTES } = await import('../../src/take/limits.ts');
  await page.addInitScript(() => {
    const w = window as any;
    w.__decodeCalls = 0; w.__readCalls = 0;
    const d = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: any[]) { w.__decodeCalls++; return (d as any).apply(this, a); } as any;
    const r = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (this: Blob) { w.__readCalls++; return r.call(this); };
  });
  await page.goto('/tests/browser/fixtures/take-harness.html');
  await page.waitForFunction(() => (window as any).takeHarnessReady === true);
  for (const type of ['audio/wav', 'audio/mpeg']) {
    const got = await page.evaluate(([n, t]) => (window as any).takeHarness.runSized(n, 'big.' + (t === 'audio/wav' ? 'wav' : 'mp3'), t), [MAX_FILE_BYTES + 1, type] as const) as JobState;
    expect(got.settled, type).toBe('rejected');
    expect(got.error!.code, type).toBe('too-large');
    expect(got.summary, type).toBeNull();
  }
  expect(await page.evaluate(() => (window as any).__decodeCalls), 'decodeAudioData never called').toBe(0);
  expect(await page.evaluate(() => (window as any).__readCalls), 'file bytes never read').toBe(0);
});
