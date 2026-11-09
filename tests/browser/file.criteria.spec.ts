// Screen-level acceptance tests for Recording analysis, #/file (specs/M2.md 4.6 B criteria and 4.8 edge cases,
// design/M2-DESIGN.md 1.6, 2.2, 3.2, 3.3, 3.6, 8). Written from the spec, driven only through the page:
// the hidden file input, the visible text, ARIA attributes, keyboard and canvas pixels.
// The pipeline-level criteria (F-04, F-08, F-09, F-11, F-12, F-16, F-20) have their own API tests in take.*.spec.ts.
//
// Covered here:
//   F-08  44.1 kHz file strip shows 44100 Hz and no "Resampled" label (WAV always, MP3/M4A when an encoder exists)
//   F-09  96 kHz WAV: strip shows 48000 Hz and "Resampled from 96000 Hz to 48 kHz."
//   F-10  not testable at screen level, see the report (no decodable fixture whose rate cannot be read)
//   F-11  random bytes named .mp3: "could not decode", no plot; F-12 over MAX_FILE_BYTES; F-13 over MAX_DURATION_S
//   F-14  too short; F-15 no pitch (silence, and opposite-phase stereo, spec 4.8)
//   F-16  second file mid-analysis: first file's results never shown
//   F-17  leaving the route mid-analysis: no later Worker message, nothing rendered on return
//   F-18  progress non-decreasing, 100 only in Done
//   F-21  hostile file name is literal text, creates no element
//   F-23  A4 change updates cents with no new Worker
//   F-27  no pitch mark at a value that is not some frame's F0 (cursor walk over every frame, and canvas marks)
//   F-28  method label and the not-a-diagnostic footer line
//   3.6   tips visible in No file, collapsed disclosure in Done, absent in error/busy/cancelled states
//   2.2   keyboard on the time cursor updates the readings; 1.6 dropped files; 3.3 Cancel, several files dropped
import { test as base, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tone, encodeWav, rng, tmpDir, writeFile, haveBinary } from '../take.helpers.ts';
import { MAX_DURATION_S, MAX_FILE_BYTES } from '../../src/take/limits.ts';

// ---------------------------------------------------------------- fixture: page errors fail the test

const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errs.push(m.text()); });
    await use(errs);
    expect(errs, 'no page errors or console errors').toEqual([]);
  }, { auto: true }],
});

// ---------------------------------------------------------------- signals and helpers

const wav = (sr: number, dur: number, f0: number, extra: { vibRate?: number; vibCents?: number } = {}) =>
  Buffer.from(encodeWav({ sampleRate: sr, format: 'pcm16', channels: [tone({ sr, dur, f0, ...extra })] }));
const wavOf = (sr: number, samples: Float64Array) => Buffer.from(encodeWav({ sampleRate: sr, format: 'pcm16', channels: [samples] }));
const silence = (sr: number, dur: number) => new Float64Array(Math.round(sr * dur));
const cat = (...xs: Float64Array[]) => { const o = new Float64Array(xs.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };

/** Linear glide in log frequency, no gaps: a control signal for the canvas tests. */
function glide(sr: number, dur: number, fa: number, fb: number): Float64Array {
  const n = Math.round(sr * dur), out = new Float64Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = fa * (fb / fa) ** (t / dur);
    ph += (2 * Math.PI * f) / sr;
    const env = Math.min(1, t / 0.02, (dur - t) / 0.02);
    out[i] = 0.16 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph)) * Math.max(0, env);
  }
  return out;
}

let longBuf: Buffer | null = null;
/** A take long enough (240 s, 48 kHz) to still be analysing when the test acts. Built once per worker. */
const LONG_S = 240;
const long = () => (longBuf ??= wav(48000, LONG_S, 220));

/** A natural-language limit like the spec's "{MAX_DURATION_S formatted}", built here from the constant. */
function limitText(s: number): string {
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  const parts = [m ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '', r ? `${r} ${r === 1 ? 'second' : 'seconds'}` : ''].filter(Boolean);
  return parts.join(' ');
}
/** "m:ss.ss" */
const clock = (s: number) => {
  const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = cs - m * 6000;
  return `${m}:${String(Math.floor(rest / 100)).padStart(2, '0')}.${String(rest % 100).padStart(2, '0')}`;
};

const TIPS_1_TO_4 = [
  'Export a WAV file at 44.1 or 48 kHz. It is analysed as it is, with no resampling.',
  'Other rates, such as 96 kHz, also open. They are converted to 48 kHz, and the file strip says so.',
  'WAV is the format the measurements were checked on. MP3 and M4A files also open, and their accuracy has not been checked yet.',
  'Turn off noise suppression, automatic gain, pitch correction and effects in the recording app. They change the sound that is measured.',
];
const TIPS_ALL = [...TIPS_1_TO_4, `Keep the recording to ${limitText(MAX_DURATION_S)} or less.`];

async function instrumentWorkers(page: Page) {
  await page.addInitScript(() => {
    const W = window.Worker;
    const rec = { count: 0, msgs: [] as number[] };
    (window as any).__w = rec;
    (window as any).Worker = class extends W {
      constructor(u: string | URL, o?: WorkerOptions) {
        super(u, o);
        rec.count++;
        this.addEventListener('message', () => rec.msgs.push(performance.now()));
      }
    };
  });
}

async function openRoute(page: Page) {
  await page.goto('/#/file');
  await expect(page.locator('#fa-title')).toBeVisible();
}
const pick = (page: Page, name: string, buffer: Buffer, mimeType = 'audio/wav') => page.setInputFiles('#fa-input', { name, mimeType, buffer });
const done = (page: Page, timeout = 30000) => expect(page.locator('#fa-take')).toBeVisible({ timeout });
async function pickDone(page: Page, name: string, buffer: Buffer) { await pick(page, name, buffer); await done(page); }
const cursorLine = (page: Page) => page.locator('#fa-cursor-line');
const workers = (page: Page) => page.evaluate(() => (window as any).__w.count as number);

/** Wait until a long file is genuinely mid-analysis: progress bar has a number and the plots are not shown. */
async function untilAnalysing(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const b = document.getElementById('fa-progress-bar')!;
    const p = document.getElementById('fa-progress')!;
    return !p.hidden && b.getAttribute('aria-valuenow') !== null && document.getElementById('fa-take')!.hidden;
  }), { timeout: 20000, message: 'file reached the Analysing state with a numeric progress value' }).toBe(true);
}

/** Every plot and reading is hidden: the "no plot" requirement of F-11, F-12, F-13, F-14. */
async function expectNoPlot(page: Page) {
  await expect(page.locator('#fa-take')).toBeHidden();
  await expect(page.locator('#fa-readings')).toBeHidden();
  for (const id of ['fa-fig-pitch', 'fa-fig-cents', 'fa-fig-vib', 'fa-fig-spec']) await expect(page.locator(`#${id}`)).toBeHidden();
  await expect(page.locator('#fa-cursor')).toBeHidden();
}

// ================================================================ F-28 and 3.6 in No file

test('F-28: Done shows the method label verbatim and the not-a-diagnostic footer line', async ({ page }) => {
  await openRoute(page);
  // Control: the footer line is there before any file, the method label is not shown before analysis.
  await expect(page.locator('footer')).toContainText('For practice and study. Not a diagnostic or medical device.');
  await expect(page.locator('#fa-info')).toBeHidden();
  await pickDone(page, 'a.wav', wav(48000, 2, 330));
  await expect(page.locator('#fa-info-method')).toHaveText('Whole take (YIN + continuity)');
  await expect(page.locator('footer')).toBeVisible();
  await expect(page.locator('footer')).toContainText('For practice and study. Not a diagnostic or medical device.');
});

test('3.6 / 3.3 No file: the drop zone shows the limits, the privacy line and the five tips, derived from MAX_DURATION_S', async ({ page }) => {
  await openRoute(page);
  await expect(page.locator('#fa-figs-title')).toHaveText('Open a recording');
  await expect(page.locator('#fa-open')).toHaveText('Open an audio file');
  await expect(page.locator('#fa-empty')).toContainText('Choose a WAV, MP3 or M4A file, or drop it here.');
  await expect(page.locator('#fa-empty')).toContainText('It stays on this computer.');
  const limits = (await page.locator('#fa-empty').innerText());
  const m = new RegExp(`Up to ${limitText(MAX_DURATION_S)} and (\\d+) MB\\.`).exec(limits);
  expect(m, `limits line "Up to ${limitText(MAX_DURATION_S)} and N MB." in: ${limits}`).not.toBeNull();
  // MB as decimal or binary megabytes, both are a reasonable reading of "{MAX_FILE_BYTES as MB}".
  expect([Math.floor(MAX_FILE_BYTES / 1e6), Math.round(MAX_FILE_BYTES / 2 ** 20), Math.floor(MAX_FILE_BYTES / 2 ** 20)]).toContain(Number(m![1]));

  await expect(page.locator('#fa-tips-title')).toBeVisible();
  await expect(page.locator('#fa-tips-title')).toHaveText('Recording tips');
  await expect(page.locator('#fa-tips-list')).toBeVisible();
  expect(await page.locator('#fa-tips-list li').allTextContents()).toEqual(TIPS_ALL);
  // The block sits below the Open button in read order (3.1): the tips come after the button in the DOM.
  const order = await page.evaluate(() => {
    const a = document.getElementById('fa-open')!, b = document.getElementById('fa-tips-list')!;
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  expect(await page.locator('#fa-tips-list').getAttribute('aria-labelledby')).toBe('fa-tips-title');
});

test('3.6 No file after leaving: the cleared line shows once and the tips are back in the drop zone', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'a.wav', wav(48000, 1.5, 330));
  await page.goto('/#/tools');
  await page.goto('/#/file');
  await expect(page.locator('#fa-cleared')).toHaveText('The last recording was cleared when you left this page. Nothing is saved.');
  await expect(page.locator('#fa-take')).toBeHidden();
  await expect(page.locator('#fa-tips-list li')).toHaveCount(5);
  await expect(page.locator('#fa-tips-list')).toBeVisible();
  // Control: a visit with no file open does not show the line.
  await page.goto('/#/tools');
  await page.goto('/#/file');
  await expect(page.locator('#fa-cleared')).toBeHidden();
});

test('3.6 Done: tips are a collapsed "Recording tips" disclosure in About this analysis, not in the drop zone', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'a.wav', wav(48000, 2, 330));
  await expect(page.locator('#fa-empty')).toBeHidden();
  const tips = page.locator('#fa-tips');
  await expect(tips).toBeVisible();
  expect(await tips.evaluate((d) => (d as HTMLDetailsElement).tagName === 'DETAILS' && !(d as HTMLDetailsElement).open), 'closed by default').toBe(true);
  await expect(page.locator('#fa-tips > summary')).toHaveText('Recording tips');
  // Inside About this analysis, before the MEASUREMENT.md / VALIDATION.md links.
  expect(await page.evaluate(() => {
    const about = document.getElementById('fa-about')!, t = document.getElementById('fa-tips')!;
    const link = about.querySelector('a[href$="MEASUREMENT.md"]')!;
    return about.contains(t) && !!(t.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await page.locator('#fa-tips > summary').click();
  expect(await tips.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
  await expect(page.locator('#fa-tips-list')).toBeVisible();
  expect(await page.locator('#fa-tips-list li').allTextContents()).toEqual(TIPS_ALL);
  await page.locator('#fa-tips > summary').click();
  expect(await tips.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
});

test('3.6 Done, no pitch found: tips are also a collapsed disclosure', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'quiet.wav', wavOf(48000, silence(48000, 1.5)));
  await expect(page.locator('#fa-tips')).toBeVisible();
  expect(await page.locator('#fa-tips').evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
  await expect(page.locator('#fa-tips > summary')).toHaveText('Recording tips');
});

test('3.6 tips are not shown while analysing, after an error, or after Cancel', async ({ page }) => {
  await openRoute(page);
  // Control: shown in No file.
  await expect(page.locator('#fa-tips-list')).toBeVisible();

  await pick(page, 'long.wav', long());
  await untilAnalysing(page);
  await expect(page.locator('#fa-tips-list')).toBeHidden();
  await expect(page.locator('#fa-tips')).toBeHidden();
  await page.locator('#fa-cancel').click();
  await expect(page.locator('#fa-message')).toHaveText('Analysis cancelled. Nothing was kept.');
  await expect(page.locator('#fa-tips-list')).toBeHidden();
  await expect(page.locator('#fa-tips')).toBeHidden();

  const rand = rng(5);
  await pick(page, 'noise.mp3', Buffer.from(Uint8Array.from({ length: 4096 }, () => Math.floor(rand() * 256))), 'audio/mpeg');
  await expect(page.locator('#fa-error')).toBeVisible();
  await expect(page.locator('#fa-tips-list')).toBeHidden();
  await expect(page.locator('#fa-tips')).toBeHidden();
});

// ================================================================ error states with no plot

test('F-11: random bytes named .mp3 show "could not decode", raw text under Details, and no plot (a good take before it is removed)', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'good.wav', wav(48000, 1.5, 262));
  await expect(page.locator('#fa-fig-pitch')).toBeVisible(); // control: there is a plot to be removed
  const rand = rng(11);
  await pick(page, 'noise.mp3', Buffer.from(Uint8Array.from({ length: 6000 }, () => Math.floor(rand() * 256))), 'audio/mpeg');
  await expect(page.locator('#fa-error')).toHaveText('This file could not be read as audio. It may be damaged or protected.');
  await expectNoPlot(page);
  await expect(page.locator('#fa-info-name')).toHaveText('noise.mp3');
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  await expect(page.locator('#fa-error-details')).toBeVisible();
  await page.locator('#fa-error-details > summary').click();
  expect((await page.locator('#fa-error-raw').textContent())!.trim().length, 'raw error text under Details').toBeGreaterThan(0);
});

async function pickBlob(page: Page, name: string, size: number, type = 'audio/wav') {
  await page.evaluate(([n, sz, t]) => {
    const chunk = new Blob([new Uint8Array(1 << 20)]);
    const full = Math.floor((sz as number) / (1 << 20));
    const parts: BlobPart[] = Array(full).fill(chunk);
    parts.push(new Uint8Array((sz as number) - full * (1 << 20)));
    const f = new File(parts, n as string, { type: t as string });
    if (f.size !== sz) throw new Error(`built ${f.size} not ${sz}`);
    const dt = new DataTransfer();
    dt.items.add(f);
    const input = document.getElementById('fa-input') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [name, size, type] as const);
}

test('F-12: a file one byte over MAX_FILE_BYTES is refused with the size and limit, no plot; a file at the limit is not refused for size', async ({ page }) => {
  test.setTimeout(120000);
  await openRoute(page);
  await pickBlob(page, 'huge.wav', MAX_FILE_BYTES + 1);
  await expect(page.locator('#fa-error')).toBeVisible({ timeout: 30000 });
  const text = (await page.locator('#fa-error').textContent())!;
  const m = /^This file is ([\d.]+) MB\. The limit is ([\d.]+) MB\.$/.exec(text);
  expect(m, `size/limit message, got: ${text}`).not.toBeNull();
  const lim = Number(m![2]), size = Number(m![1]);
  expect([MAX_FILE_BYTES / 1e6, MAX_FILE_BYTES / 2 ** 20].some((v) => Math.abs(v - lim) <= 1), `limit ${lim} MB is MAX_FILE_BYTES in MB`).toBe(true);
  expect(size).toBeGreaterThanOrEqual(lim);
  await expectNoPlot(page);
  await expect(page.locator('#fa-open')).toHaveText('Open another file');

  // Boundary control: exactly MAX_FILE_BYTES is not a size refusal (it fails later, as not audio).
  await pickBlob(page, 'atlimit.wav', MAX_FILE_BYTES);
  await expect(page.locator('#fa-msg')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#fa-error, #fa-type-error').first()).not.toContainText('The limit is');
  await expect(page.locator('#fa-error')).not.toContainText('MB. The limit');
});

test('F-13: a WAV just over MAX_DURATION_S shows "too long" with its duration and the limit, no partial results', async ({ page }) => {
  test.setTimeout(90000);
  await openRoute(page);
  const sr = 11025, dur = MAX_DURATION_S + 1;
  await pick(page, 'longer.wav', wavOf(sr, silence(sr, dur)));
  await expect(page.locator('#fa-error')).toHaveText(
    `This recording is ${clock(dur)}. The limit is ${limitText(MAX_DURATION_S)}. Trim it and open it again.`, { timeout: 60000 });
  await expectNoPlot(page);
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
});

test('F-14: fewer than 2048 samples shows "too short" with the sample count and ms, no plot; 2048 samples is analysed', async ({ page }) => {
  await openRoute(page);
  await pick(page, 'tiny.wav', wavOf(48000, new Float64Array(2047)));
  await expect(page.locator('#fa-error')).toHaveText('This recording is too short to analyse. It needs at least 2048 samples, about 43 ms at 48000 Hz.');
  await expectNoPlot(page);
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  // 44.1 kHz: the ms and rate follow the file.
  await pick(page, 'tiny44.wav', wavOf(44100, new Float64Array(1000)));
  await expect(page.locator('#fa-error')).toHaveText('This recording is too short to analyse. It needs at least 2048 samples, about 46 ms at 44100 Hz.');
  // Boundary control: exactly 2048 samples is one frame, not "too short".
  await pick(page, 'edge.wav', wavOf(48000, new Float64Array(2048)));
  await done(page);
  await expect(page.locator('#fa-error')).toBeHidden();
});

test('F-15: digital silence reaches Done with "No pitch found" overlays, no note or cents anywhere, and the reasons line', async ({ page }) => {
  await openRoute(page);
  await pick(page, 'silence.wav', wavOf(48000, silence(48000, 2)));
  await done(page);
  await expect(page.locator('#fa-status')).toHaveText('Done. No pitch found.');
  const overlays = page.locator('.fa-nopitch');
  expect(await overlays.count()).toBeGreaterThanOrEqual(3);
  for (const o of await overlays.all()) { await expect(o).toBeVisible(); await expect(o).toContainText('No pitch found in this recording'); }
  await expect(page.locator('#fa-reasons')).toContainText('Common causes: silence, singing below the voicing gate (');
  await expect(page.locator('#fa-reasons')).toContainText('dBFS)');
  await expect(page.locator('#fa-reasons')).toContainText('or stereo channels that cancel when mixed.');
  await expect(page.locator('#fa-info-method')).toHaveText('Whole take (YIN + continuity)');
  await expect(page.locator('#fa-fig-spec')).toBeVisible();
  await expect(page.locator('#fa-cursor-line')).toHaveText(/^At \d+\.\d{3} s: no pitch$/);
  await expect(page.locator('#fa-r-note')).toHaveText('No pitch at this time');
  await expect(page.locator('#fa-r-pitch')).toHaveText('No pitch');
  await expect(page.locator('#fa-r-offby')).toHaveText('No pitch');
  expect(await page.locator('#fa-cursor').getAttribute('aria-valuetext')).toMatch(/seconds\. No pitch\.$/);
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  // Control: a voiced file has no overlays and no reasons line.
  await pickDone(page, 'tone.wav', wav(48000, 2, 330));
  for (const o of await overlays.all()) await expect(o).toBeHidden();
  await expect(page.locator('#fa-reasons')).toBeHidden();
  await expect(page.locator('#fa-r-pitch')).toHaveText(/^\d+\.\d Hz$/);
});

test('4.8: stereo channels in opposite phase average to silence: "No pitch found", and the strip says the channels were averaged', async ({ page }) => {
  await openRoute(page);
  const a = tone({ sr: 48000, dur: 1.5, f0: 262 });
  const b = a.map((x) => -x);
  await pick(page, 'cancel.wav', Buffer.from(encodeWav({ sampleRate: 48000, format: 'f32', channels: [a, b] })));
  await done(page);
  await expect(page.locator('#fa-status')).toHaveText('Done. No pitch found.');
  await expect(page.locator('#fa-info-ch')).toHaveText('2, mixed to one by averaging');
  await expect(page.locator('#fa-r-pitch')).toHaveText('No pitch');
});

// ================================================================ file strip: F-08, F-09, F-21

test('F-08 (WAV): a 44.1 kHz WAV shows 44100 Hz, "From the file. Not resampled." and no Resampled label or link', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'a44.wav', wav(44100, 2, 330));
  await expect(page.locator('#fa-info-rate')).toHaveText('44100 Hz');
  await expect(page.locator('#fa-info-rate-note')).toHaveText('From the file. Not resampled.');
  await expect(page.locator('#fa-info-rate-link')).toBeHidden();
  await expect(page.locator('#fa-info-ch')).toHaveText('1');
  await expect(page.locator('#fa-info')).not.toContainText(/Resampled (from|to)/);
});

const lameOk = haveBinary('lame');
const afOk = haveBinary('afconvert', ['-h']);
function encodeMp3(rate: number): Buffer {
  const dir = tmpDir('fa-mp3-');
  const w = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 1.5, f0: 220 })], format: 'pcm16' }));
  const out = join(dir, 'o.mp3');
  const r = spawnSync('lame', ['--quiet', '-b', '128', '--resample', String(rate / 1000), w, out]);
  if (r.status !== 0) throw new Error(`lame failed: ${r.stderr}`);
  return readFileSync(out);
}
function encodeM4a(rate: number): Buffer | null {
  const dir = tmpDir('fa-m4a-');
  const w = writeFile(dir, 'in.wav', encodeWav({ sampleRate: rate, channels: [tone({ sr: rate, dur: 1.5, f0: 220 })], format: 'pcm16' }));
  const out = join(dir, 'o.m4a');
  const r = spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', w, out], { encoding: 'utf8' });
  return r.status === 0 ? readFileSync(out) : null;
}

test('F-08 (MP3): a 44.1 kHz MP3 shows 44100 Hz and no Resampled label', async ({ page }) => {
  test.skip(!lameOk, 'lame binary not installed, cannot make the MP3 fixture');
  await openRoute(page);
  await pickDone(page, 'a44.mp3', encodeMp3(44100));
  await expect(page.locator('#fa-info-rate')).toHaveText('44100 Hz');
  await expect(page.locator('#fa-info-rate-note')).not.toContainText(/^Resampled/);
  await expect(page.locator('#fa-info-rate-link')).toBeHidden();
  await expect(page.locator('#fa-info')).not.toContainText(/Resampled (from|to)/);
});

test('F-08 (M4A): a 44.1 kHz M4A shows 44100 Hz and no Resampled label', async ({ page }) => {
  test.skip(!afOk, 'afconvert not available, cannot make the M4A fixture');
  test.skip(process.env.PW_CHANNEL === 'chromium', "Playwright's bundled Chromium has no AAC decoder (use installed Chrome, Q5)");
  const m4a = encodeM4a(44100);
  test.skip(m4a === null, 'afconvert could not encode AAC here');
  await openRoute(page);
  await pickDone(page, 'a44.m4a', m4a!);
  await expect(page.locator('#fa-info-rate')).toHaveText('44100 Hz');
  await expect(page.locator('#fa-info-rate-note')).not.toContainText(/^Resampled/);
  await expect(page.locator('#fa-info')).not.toContainText(/Resampled (from|to)/);
});

test('F-09: a 96 kHz WAV shows 48000 Hz with "Resampled from 96000 Hz to 48 kHz." and the how-resampling-affects link', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'rate96.wav', wav(96000, 2, 220));
  await expect(page.locator('#fa-info-rate')).toHaveText('48000 Hz');
  await expect(page.locator('#fa-info-rate-note')).toHaveText('Resampled from 96000 Hz to 48 kHz.');
  await expect(page.locator('#fa-info-rate-link')).toBeVisible();
  // The measurement itself is at the right pitch (about 220 Hz).
  await expect(cursorLine(page)).toHaveText(/^At [\d.]+ s: A3, 2(19|20|21)\.\d Hz/);
  // Control: the 48 kHz WAV in the same session is not labelled.
  await pickDone(page, 'rate48.wav', wav(48000, 2, 220));
  await expect(page.locator('#fa-info-rate')).toHaveText('48000 Hz');
  await expect(page.locator('#fa-info-rate-note')).toHaveText('From the file. Not resampled.');
  await expect(page.locator('#fa-info-rate-link')).toBeHidden();
});

test('F-21: a file named <img src=x onerror=alert(1)>.wav is literal text in the strip, while decoding and in an error, and creates no element', async ({ page }) => {
  const NAME = '<img src=x onerror=alert(1)>.wav';
  const dialogs: string[] = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await openRoute(page);
  // Control: the detector sees an injected element.
  const imgs = () => page.evaluate(() => document.querySelectorAll('img').length);
  const base0 = await imgs();
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'ctl'; d.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'; document.body.appendChild(d); });
  expect(await imgs(), 'control: injected img is counted').toBe(base0 + 1);
  await page.evaluate(() => document.getElementById('ctl')!.remove());

  await pickDone(page, NAME, wav(48000, 1.5, 330));
  await expect(page.locator('#fa-info-name')).toHaveText(NAME);
  expect(await page.locator('#fa-info-name').evaluate((e) => e.children.length)).toBe(0);
  expect(await imgs()).toBe(base0);
  expect(await page.locator('#fa-content img, #fa-content [onerror]').count()).toBe(0);

  const rand = rng(21);
  await pick(page, NAME.replace('.wav', '.mp3'), Buffer.from(Uint8Array.from({ length: 4096 }, () => Math.floor(rand() * 256))), 'audio/mpeg');
  await expect(page.locator('#fa-error')).toBeVisible();
  await expect(page.locator('#fa-info-name')).toHaveText(NAME.replace('.wav', '.mp3'));
  expect(await imgs()).toBe(base0);
  await page.waitForTimeout(300);
  expect(dialogs, 'no alert fired').toEqual([]);
});

// ================================================================ F-16, F-17, F-18, Cancel

/** Records what the page shows, with a snapshot at every DOM change, so superseded results can be searched for. */
async function recordScreen(page: Page) {
  await page.evaluate(() => {
    const hist: string[] = [];
    (window as any).__hist = hist;
    (window as any).__mark = (s: string) => hist.push(`@@${s}`);
    const snap = () => {
      const g = (id: string) => document.getElementById(id)?.textContent ?? '';
      hist.push(JSON.stringify({ name: g('fa-info-name'), dur: g('fa-info-dur'), line: g('fa-cursor-line'), pitch: g('fa-r-pitch'), take: !document.getElementById('fa-take')!.hidden }));
    };
    new MutationObserver(snap).observe(document.getElementById('fa-content')!, { subtree: true, childList: true, characterData: true, attributes: true });
    new MutationObserver(snap).observe(document.getElementById('fa-readings')!, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

test('F-16: picking a second file while the first is analysing never shows the first file\'s name, duration or pitch', async ({ page }) => {
  await openRoute(page);
  await recordScreen(page);
  await pick(page, 'first-long.wav', long());
  await untilAnalysing(page);
  await page.evaluate(() => (window as any).__mark('PICK_B'));
  await pick(page, 'second.wav', wav(48000, 2, 440));
  await done(page);
  await expect(page.locator('#fa-info-name')).toHaveText('second.wav');
  await expect(page.locator('#fa-info-dur')).toHaveText('0:02.00');
  await expect(cursorLine(page)).toHaveText(/^At [\d.]+ s: A4, 4[34]\d\.\d Hz/);
  // Wait well past the time the first file would have finished if it were still running.
  await page.waitForTimeout(3000);
  const hist: string[] = await page.evaluate(() => (window as any).__hist);
  const after = hist.slice(hist.indexOf('@@PICK_B') + 1);
  expect(after.length, 'the recorder saw changes after the second pick').toBeGreaterThan(0);
  expect(after.filter((h) => h.includes('first-long.wav') || h.includes('4:00.00')), 'entries showing the first file after the second was picked').toEqual([]);
  expect(after.filter((h) => /"line":"At [\d.]+ s: A3, 2[12]\d\.\d Hz/.test(h) || /"pitch":"2[12]\d\.\d Hz"/.test(h)), 'first file pitch (220 Hz) shown after the second pick').toEqual([]);
  await expect(page.locator('#fa-info-name')).toHaveText('second.wav');
  await expect(page.locator('#fa-info-dur')).toHaveText('0:02.00');
});

test('F-16 control: the recorder does see the first file\'s name, duration and pitch when it is the only one', async ({ page }) => {
  await openRoute(page);
  await recordScreen(page);
  await pickDone(page, 'first-long.wav', long());
  const hist: string[] = await page.evaluate(() => (window as any).__hist);
  expect(hist.some((h) => h.includes('first-long.wav'))).toBe(true);
  expect(hist.some((h) => h.includes('4:00.00'))).toBe(true);
  expect(hist.some((h) => /"pitch":"2[12]\d\.\d Hz"/.test(h))).toBe(true);
});

test('F-16: the second pick replaces the first at once, before the second finishes decoding', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'one.wav', wav(48000, 2, 330));
  await pick(page, 'two.wav', long());
  // As soon as the new file is accepted, the old take's plots are gone and the name is the new one.
  await expect(page.locator('#fa-info-name')).toHaveText('two.wav');
  await expect(page.locator('#fa-take')).toBeHidden();
  await expect(page.locator('#fa-readings')).toBeHidden();
});

test('F-17: leaving the route mid-analysis delivers no further Worker message and renders nothing on return', async ({ page }) => {
  await instrumentWorkers(page);
  await openRoute(page);
  await pick(page, 'long.wav', long());
  await untilAnalysing(page);
  await expect.poll(() => page.evaluate(() => (window as any).__w.msgs.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.getElementById('fa-take')!.hidden), 'precondition: still analysing at the moment of leaving').toBe(true);
  await page.goto('/#/tools');
  await expect(page.locator('[data-fa-status]')).toHaveText('Ready');
  const tLeave = await page.evaluate(() => performance.now());
  await page.waitForTimeout(3500);
  const late = await page.evaluate((t) => (window as any).__w.msgs.filter((m: number) => m > t) as number[], tLeave);
  expect(late.length, `Worker messages after the leave resolved: ${late.length}`).toBe(0);
  await page.goto('/#/file');
  await expect(page.locator('#fa-take')).toBeHidden();
  await expect(page.locator('#fa-progress')).toBeHidden();
  await expect(page.locator('#fa-figs-title')).toHaveText('Open a recording');
  await expect(page.locator('#fa-cleared')).toBeVisible();
});

test('F-17 control: staying on the route, the same file keeps delivering Worker messages after that point and reaches Done', async ({ page }) => {
  await instrumentWorkers(page);
  await openRoute(page);
  await pick(page, 'long.wav', long());
  await untilAnalysing(page);
  await expect.poll(() => page.evaluate(() => (window as any).__w.msgs.length)).toBeGreaterThan(0);
  const t0 = await page.evaluate(() => performance.now());
  await done(page, 60000);
  const later = await page.evaluate((t) => (window as any).__w.msgs.filter((m: number) => m > t).length as number, t0);
  expect(later, 'messages still arrive after the point where F-17 leaves').toBeGreaterThan(0);
});

test('F-18: progress values never decrease, stay below 100 until Done, and 100 appears only with the plots', async ({ page }) => {
  await openRoute(page);
  await page.evaluate(() => {
    const recs: Array<{ v: number | null; take: boolean; text: string }> = [];
    (window as any).__prog = recs;
    const bar = document.getElementById('fa-progress-bar')!, take = document.getElementById('fa-take')!, txt = document.getElementById('fa-progress-text')!;
    const snap = () => { const v = bar.getAttribute('aria-valuenow'); recs.push({ v: v === null ? null : Number(v), take: !take.hidden, text: txt.textContent ?? '' }); };
    const mo = new MutationObserver(snap);
    mo.observe(bar, { attributes: true, attributeFilter: ['aria-valuenow'] });
    mo.observe(txt, { childList: true, characterData: true, subtree: true });
    mo.observe(take, { attributes: true, attributeFilter: ['hidden'] });
  });
  await pick(page, 'long.wav', long());
  await done(page, 60000);
  await page.waitForTimeout(200);
  const recs: Array<{ v: number | null; take: boolean; text: string }> = await page.evaluate(() => (window as any).__prog);
  const vals = recs.filter((r) => r.v !== null).map((r) => r.v as number);
  const below = new Set(vals.filter((v) => v < 100));
  expect(below.size, `intermediate progress values seen: ${[...below]}`).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < vals.length; i++) expect(vals[i], `progress went down at ${i}: ${vals.slice(Math.max(0, i - 3), i + 1)}`).toBeGreaterThanOrEqual(vals[i - 1]);
  for (const r of recs) {
    if (r.v === 100) expect(r.take, '100% shown while the plots are not shown').toBe(true);
    if (!r.take && r.v !== null) expect(r.v, 'a Done-level value before Done').toBeLessThan(100);
  }
  expect(vals.some((v) => v === 100), 'Done reports 100').toBe(true);
  for (const r of recs) {
    const m = /^Analysing, (\d+)%$/.exec(r.text);
    if (m && r.v !== null) expect(Number(m[1]), 'text and bar agree').toBe(r.v);
  }
  expect(recs.some((r) => /^Decoding /.test(r.text)), 'decoding phase text was shown, without a numeric bar').toBe(true);
  for (const r of recs.filter((r) => /^Decoding /.test(r.text))) expect(r.v).toBeNull();
});

test('3.3 Cancel: pressing Cancel mid-analysis shows "Analysis cancelled. Nothing was kept.", no plot, and nothing arrives later', async ({ page }) => {
  await instrumentWorkers(page);
  await openRoute(page);
  await pick(page, 'long.wav', long());
  await untilAnalysing(page);
  await page.locator('#fa-cancel').click();
  await expect(page.locator('#fa-message')).toHaveText('Analysis cancelled. Nothing was kept.');
  await expect(page.locator('#fa-open')).toHaveText('Open an audio file');
  await expectNoPlot(page);
  const t = await page.evaluate(() => performance.now());
  await page.waitForTimeout(3000);
  await expectNoPlot(page);
  await expect(page.locator('#fa-message')).toHaveText('Analysis cancelled. Nothing was kept.');
  await expect(page.locator('#fa-progress')).toBeHidden();
  expect(await page.evaluate((x) => (window as any).__w.msgs.filter((m: number) => m > x).length as number, t)).toBe(0);
});

// ================================================================ F-23

test('F-23: changing A4 updates cents and the readings, with no new Worker, no progress block and the same plots', async ({ page }) => {
  await instrumentWorkers(page);
  await openRoute(page);
  await pickDone(page, 'a440.wav', wav(48000, 3, 440));
  const n0 = await workers(page);
  expect(n0, 'control: the analysis used a Worker').toBeGreaterThan(0);
  const before = await page.locator('#fa-r-offby').textContent();
  const lineBefore = await cursorLine(page).textContent();
  await page.locator('#fa-a4').fill('442');
  await page.locator('#fa-a4').press('Enter');
  await expect(page.locator('#fa-a4')).toHaveValue('442');
  // 440 Hz against A4 = 442 is 7.85 c flat (F-22), so about 8 cents flat.
  await expect(page.locator('#fa-r-offby')).toHaveText(/^[78] cents flat of /);
  expect(await page.locator('#fa-r-offby').textContent()).not.toBe(before);
  await expect(cursorLine(page)).toHaveText(/[78] cents flat$/);
  expect(await cursorLine(page).textContent()).not.toBe(lineBefore);
  await expect(page.locator('#fa-d-dev')).toContainText('c from');
  await expect(page.locator('#fa-progress')).toBeHidden();
  await expect(page.locator('#fa-take')).toBeVisible();
  expect(await workers(page), 'no new Worker for an A4 change').toBe(n0);
  // The pitch itself is unchanged.
  await expect(page.locator('#fa-r-pitch')).toHaveText(/^4[34]\d\.\d Hz$/);
  // Control: a new file does start a new Worker (the counter works).
  await pickDone(page, 'again.wav', wav(48000, 1.5, 440));
  expect(await workers(page)).toBeGreaterThan(n0);
});

// ================================================================ F-27, 2.2

const TWO_NOTES = () => cat(tone({ sr: 48000, dur: 0.5, f0: 196 }), silence(48000, 0.3), tone({ sr: 48000, dur: 0.5, f0: 262 }), silence(48000, 0.1));

test('F-27: stepping the cursor over every frame, each shown pitch equals that frame\'s F0 and unvoiced frames show "no pitch"', async ({ page }) => {
  test.setTimeout(180000);
  const { parseWav } = await import('../../src/take/wav.ts');
  const { analyseTake } = await import('../../src/take/analyse.ts');
  const bytes = encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [TWO_NOTES()] });
  const parsed = parseWav(bytes);
  const exp = analyseTake(parsed.samples, parsed.sampleRate);
  const n = exp.frameCount;
  const voicedN = Array.from(exp.f0).filter((x, i) => exp.voiced[i] === 1 && x > 0).length;
  expect(voicedN, 'expected data has voiced frames').toBeGreaterThan(50);
  expect(voicedN, 'expected data has unvoiced frames').toBeLessThan(n - 20);

  await openRoute(page);
  await pickDone(page, 'two-notes.wav', Buffer.from(bytes));
  await page.locator('#fa-cursor').focus();
  await page.keyboard.press('Home');
  const allowed = new Set<string>();
  for (let i = 0; i < n; i++) if (exp.f0[i] > 0) allowed.add(exp.f0[i].toFixed(1));
  const bad: string[] = [];
  const shown = new Set<string>();
  let sawNoPitch = 0, sawPitch = 0;
  for (let i = 0; i < n; i++) {
    const [line, rpitch] = await page.evaluate(() => [document.getElementById('fa-cursor-line')!.textContent, document.getElementById('fa-r-pitch')!.textContent]);
    const t = exp.t[i].toFixed(3);
    if (exp.f0[i] > 0) {
      const hz = exp.f0[i].toFixed(1);
      sawPitch++;
      if (!new RegExp(`^At ${t} s: .*, ${hz.replace('.', '\\.')} Hz`).test(line!) || rpitch !== `${hz} Hz`) bad.push(`#${i} t=${t}: want ${hz} Hz, got "${line}" / "${rpitch}"`);
    } else {
      sawNoPitch++;
      if (line !== `At ${t} s: no pitch` || rpitch !== 'No pitch') bad.push(`#${i} t=${t}: want no pitch, got "${line}" / "${rpitch}"`);
    }
    const m = /([\d.]+) Hz/.exec(rpitch ?? '');
    if (m) shown.add(m[1]);
    if (i < n - 1) await page.keyboard.press('ArrowRight');
  }
  expect(bad.slice(0, 5), `${bad.length} frames disagree`).toEqual([]);
  expect(sawPitch).toBeGreaterThan(50);
  expect(sawNoPitch).toBeGreaterThan(20);
  for (const s of shown) expect(allowed.has(s), `shown pitch ${s} Hz is not any frame's F0`).toBe(true);
});

/** Rows and columns of the pitch canvas that hold mark-coloured pixels. */
async function markPixels(page: Page, canvasId: string) {
  return page.evaluate((id) => {
    const css = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#E4401B';
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const pg = probe.getContext('2d')!; pg.fillStyle = css; pg.fillRect(0, 0, 1, 1);
    const [mr, mg, mb] = Array.from(pg.getImageData(0, 0, 1, 1).data);
    const c = document.getElementById(id) as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const rows = new Set<number>(), cols = new Set<number>();
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const k = (y * c.width + x) * 4;
      if (Math.abs(d[k] - mr) + Math.abs(d[k + 1] - mg) + Math.abs(d[k + 2] - mb) <= 24 && d[k + 3] > 200) { rows.add(y); cols.add(x); }
    }
    return { rows: Array.from(rows).sort((a, b) => a - b), cols: Array.from(cols).sort((a, b) => a - b), W: c.width, H: c.height };
  }, canvasId);
}
/** Number of runs in a sorted list of integers, treating gaps up to `merge` as one run. */
function runs(xs: number[], merge: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x - last[1] <= merge) last[1] = x; else out.push([x, x]);
  }
  return out;
}

test('F-27: the pitch plot draws marks only where frames have a pitch: two held notes give two bands with a time gap, and no marks between', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'two-notes.wav', Buffer.from(encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [TWO_NOTES()] })));
  await expect.poll(async () => (await markPixels(page, 'fa-fig-pitch')).rows.length, { message: 'marks are drawn' }).toBeGreaterThan(0);
  const px = await markPixels(page, 'fa-fig-pitch');
  const rowRuns = runs(px.rows, 6), colRuns = runs(px.cols, 10);
  expect(rowRuns.length, `vertical bands (rows): ${JSON.stringify(rowRuns)}; a mark between the two notes would be a value no frame has`).toBe(2);
  expect(colRuns.length, `time runs (columns): ${JSON.stringify(colRuns)}`).toBe(2);
  const gapCols = colRuns[1][0] - colRuns[0][1];
  const dur = 1.4;
  expect(gapCols / px.W * dur, 'silent gap is about 0.3 s wide on the whole-take axis').toBeGreaterThan(0.15);
  expect(gapCols / px.W * dur).toBeLessThan(0.5);
  // The lower band is the lower note's: the band at the larger y (lower on screen) comes first in time.
  expect(colRuns[0][0], 'first note is drawn first').toBeLessThan(colRuns[1][0]);
  // Cents plot: marks only inside the same time runs.
  const cp = await markPixels(page, 'fa-fig-cents');
  const centsGap = cp.cols.filter((x) => x > colRuns[0][1] + 6 && x < colRuns[1][0] - 6);
  expect(centsGap, 'cents plot has marks inside the silent gap').toEqual([]);
});

test('F-27 control: a continuous glide has no gap, so the same detector finds one band and one time run', async ({ page }) => {
  await openRoute(page);
  await pickDone(page, 'glide.wav', wavOf(48000, glide(48000, 1.4, 196, 262)));
  await expect.poll(async () => (await markPixels(page, 'fa-fig-pitch')).rows.length).toBeGreaterThan(0);
  const px = await markPixels(page, 'fa-fig-pitch');
  expect(runs(px.rows, 6).length, 'a glide is one connected band of marks').toBe(1);
  expect(runs(px.cols, 10).length).toBe(1);
});

test('2.2: Left/Right move one frame, Shift 1 s, Home/End jump, and the readings text follows; the cursor starts at the first voiced frame', async ({ page }) => {
  const { parseWav } = await import('../../src/take/wav.ts');
  const { analyseTake } = await import('../../src/take/analyse.ts');
  const samples = cat(silence(48000, 0.6), tone({ sr: 48000, dur: 3, f0: 262 }), silence(48000, 0.4));
  const bytes = encodeWav({ sampleRate: 48000, format: 'pcm16', channels: [samples] });
  const exp = analyseTake(parseWav(bytes).samples, 48000);
  const first = Array.from(exp.voiced).findIndex((v, i) => v === 1 && exp.f0[i] > 0);
  expect(first).toBeGreaterThan(10);
  const T = (i: number) => exp.t[i].toFixed(3);

  await openRoute(page);
  await pickDone(page, 'k.wav', Buffer.from(bytes));
  const cur = page.locator('#fa-cursor');
  // Initial position: first voiced frame, focus not stolen by Done.
  await expect(cursorLine(page)).toHaveText(new RegExp(`^At ${T(first)} s: `));
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(first)} s`);
  expect(await page.evaluate(() => document.activeElement?.id), 'Done does not move focus to the cursor').not.toBe('fa-cursor');
  expect(await cur.getAttribute('role')).toBe('slider');
  expect(await cur.getAttribute('aria-label')).toBe('Time cursor');
  expect(await cur.getAttribute('tabindex')).toBe('0');
  expect(await cur.getAttribute('aria-valuemin')).toBe('0');
  expect(Number(await cur.getAttribute('aria-valuemax'))).toBeCloseTo(4, 1);
  expect(await cur.getAttribute('aria-valuenow')).toBe(T(first));

  await cur.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(first + 1)} s`);
  await expect(cursorLine(page)).toHaveText(new RegExp(`^At ${T(first + 1)} s: `));
  expect(await cur.getAttribute('aria-valuenow')).toBe(T(first + 1));
  expect(await cur.getAttribute('aria-valuetext')).toMatch(new RegExp(`^${T(first + 1)} seconds\\. .+, 2[56]\\d\\.\\d hertz, `));
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(first)} s`);

  // Home: frame 0, which is silence: the readings say so (control that the text can change).
  await page.keyboard.press('Home');
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(0)} s`);
  await expect(cursorLine(page)).toHaveText(`At ${T(0)} s: no pitch`);
  await expect(page.locator('#fa-r-note')).toHaveText('No pitch at this time');
  await expect(page.locator('#fa-r-pitch')).toHaveText('No pitch');
  expect(await cur.getAttribute('aria-valuetext')).toBe(`${T(0)} seconds. No pitch.`);
  // Left at the first frame stays there.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(0)} s`);

  // Shift+Right: about one second later.
  await page.keyboard.press('Shift+ArrowRight');
  const t1 = Number((await page.locator('#fa-r-time').textContent())!.replace(' s', ''));
  expect(t1 - exp.t[0], 'Shift+Right moves about 1 s').toBeGreaterThan(0.9);
  expect(t1 - exp.t[0]).toBeLessThan(1.1);
  await expect(page.locator('#fa-r-pitch')).toHaveText(/^2[56]\d\.\d Hz$/); // 1 s in is inside the held note
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(0)} s`);

  // End: last frame.
  await page.keyboard.press('End');
  const last = exp.frameCount - 1;
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(last)} s`);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#fa-r-time')).toHaveText(`${T(last)} s`);
});

// ================================================================ 1.6 and 3.3 drag and drop

/** Dispatches a drag event carrying real File objects, as the browser would on a drop. */
async function dragEvent(page: Page, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: Array<{ name: string; b64: string }>): Promise<boolean> {
  return page.evaluate(([ty, fs]) => {
    const dt = new DataTransfer();
    for (const f of fs as Array<{ name: string; b64: string }>) {
      const bin = atob(f.b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      dt.items.add(new File([u], f.name, { type: 'audio/wav' }));
    }
    const ev = new DragEvent(ty as string, { bubbles: true, cancelable: true, dataTransfer: dt });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, [type, files] as const);
}
const f64 = (name: string, b: Buffer) => ({ name, b64: b.toString('base64') });

test('1.6: on another route a dropped file is ignored with no message (default prevented, nothing opens), and #/file is still empty after', async ({ page }) => {
  await page.goto('/#/tools');
  await expect(page.locator('[data-fa-status]')).toHaveText('Ready');
  const file = f64('x.wav', wav(48000, 1, 330));
  expect(await dragEvent(page, 'dragover', [file]), 'dragover default prevented so the browser does not open the file').toBe(true);
  expect(await dragEvent(page, 'drop', [file]), 'drop default prevented').toBe(true);
  expect(new URL(page.url()).hash).toBe('#/tools');
  await expect(page.locator('#fa-notice')).toBeHidden();
  await page.goto('/#/file');
  await expect(page.locator('#fa-figs-title')).toHaveText('Open a recording');
  await expect(page.locator('#fa-take')).toBeHidden();
  await expect(page.locator('#fa-progress')).toBeHidden();
});

test('3.3 Drag over / drop on #/file: overlay text while dragging, one dropped file is analysed, several are refused and the previous state stays', async ({ page }) => {
  await openRoute(page);
  await expect(page.locator('#fa-drop')).toBeHidden();
  await dragEvent(page, 'dragenter', [f64('x.wav', wav(48000, 1, 330))]);
  await expect(page.locator('#fa-drop')).toBeVisible();
  await expect(page.locator('#fa-drop')).toHaveText('Drop the file to analyse it');
  await dragEvent(page, 'dragleave', [f64('x.wav', wav(48000, 1, 330))]);
  await expect(page.locator('#fa-drop')).toBeHidden();

  expect(await dragEvent(page, 'drop', [f64('dropped.wav', wav(48000, 2, 330))])).toBe(true);
  await done(page);
  await expect(page.locator('#fa-info-name')).toHaveText('dropped.wav');
  await expect(page.locator('#fa-drop')).toBeHidden();

  // Several files: notice, and the open take is untouched.
  await dragEvent(page, 'drop', [f64('p.wav', wav(48000, 1, 220)), f64('q.wav', wav(48000, 1, 440))]);
  await expect(page.locator('#fa-notice')).toHaveText('Drop one file at a time. Nothing was opened.');
  await expect(page.locator('#fa-info-name')).toHaveText('dropped.wav');
  await expect(page.locator('#fa-take')).toBeVisible();
});
