// Recording analysis (#/file) screen states and copy. Source: design/M2-DESIGN.md 1.1, 1.3, 1.6, 3.2, 3.3 (exact copy),
// specs/M2.md 4.6. Criteria: F-10 (skipped, reason below), F-11, F-12, F-13, F-14, F-15, F-21, F-28, plus every
// state row of design 3.3 that a generated file can reach.
// Limits come from src/take/limits.ts and src/dsp/yin.ts, never typed here.
import { test, expect } from '@playwright/test';
import { MAX_DURATION_S, MAX_FILE_BYTES } from '../../src/take/limits.ts';
import { DEFAULT_YIN } from '../../src/dsp/yin.ts';
import {
  FILE_ROUTE, FOOTER_LINE, INSTRUMENT, openFileRoute, pick, waitDone, fa, dropFiles, toB64,
  wavBytes, longWavPath, silentWavPath, sparseFilePath, filePath, parseClock,
} from './file.util.ts';

const route = (page: import('@playwright/test').Page) => page.locator('section[data-route="file"]');

// ---------------------------------------------------------------- route (1.1)

test('1.1: #/file has h1 and title "Recording analysis"', async ({ page }) => {
  await openFileRoute(page);
  await expect(page.locator('h1:visible')).toHaveText('Recording analysis');
  expect(await page.title()).toMatch(/^Recording analysis/);
  await expect(page.locator('#fa-open')).toHaveText('Open an audio file');
  await expect(page.getByText('Open a recording from this computer. It is analysed in this browser and never uploaded.')).toBeVisible();
});

// ---------------------------------------------------------------- No file

test('3.3 No file: drop zone copy, limits line formatted from the constants, no figures, no file strip', async ({ page }) => {
  await openFileRoute(page);
  const r = route(page);
  await expect(r.getByRole('heading', { level: 2, name: 'Open a recording' })).toBeVisible();
  await expect(r.getByText('Choose a WAV, MP3 or M4A file, or drop it here.', { exact: true })).toBeVisible();
  await expect(r.getByText('It stays on this computer.', { exact: true })).toBeVisible();
  const limits = await r.getByText(/^Up to .+ and .+ MB\.$/).first().textContent();
  const m = /^Up to (.+) and ([\d.,]+) MB\.$/.exec((limits ?? '').trim());
  expect(m, `limits line: ${limits}`).not.toBeNull();
  const mb = Number(m![2].replace(/,/g, ''));
  const okMb = [MAX_FILE_BYTES / 1e6, MAX_FILE_BYTES / 2 ** 20].some((v) => Math.abs(v - mb) <= 0.51);
  expect(okMb, `MB figure ${mb} must come from MAX_FILE_BYTES=${MAX_FILE_BYTES}`).toBe(true);
  const dur = m![1];
  const durOk = [String(MAX_DURATION_S), `${Math.floor(MAX_DURATION_S / 60)}:${String(MAX_DURATION_S % 60).padStart(2, '0')}`, `${MAX_DURATION_S / 60} minutes`].some((c) => dur.includes(c));
  expect(durOk, `duration "${dur}" must be MAX_DURATION_S=${MAX_DURATION_S} formatted`).toBe(true);
  for (const id of ['#fa-figs', '#fa-info', '#fa-cursor', '#fa-progress', '#fa-error']) await expect(page.locator(id)).toBeHidden();
  await expect(page.getByText('The last recording was cleared when you left this page.')).toBeHidden();
});

test('3.3 No file, after leaving: line shown once, only if a file was open; flag clears', async ({ page }) => {
  await openFileRoute(page);
  // Leaving with no file open sets no flag.
  await page.evaluate(() => { location.hash = '#/tools'; });
  await expect(page.locator('section[data-route="tools"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/file'; });
  await expect(page.locator('#fa-open')).toBeVisible();
  const line = 'The last recording was cleared when you left this page. Nothing is saved.';
  await expect(page.getByText(line)).toBeHidden();
  // Leaving with a file open sets it.
  await pick(page, filePath('clear.wav', wavBytes({ dur: 1.5 })));
  await waitDone(page);
  await page.evaluate(() => { location.hash = '#/tools'; });
  await expect(page.locator('section[data-route="tools"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/file'; });
  await expect(page.getByText(line, { exact: true })).toBeVisible();
  await expect(route(page).getByRole('heading', { level: 2, name: 'Open a recording' })).toBeVisible();
  await expect(page.locator('#fa-figs')).toBeHidden();
  // Shown once.
  await page.evaluate(() => { location.hash = '#/tools'; });
  await expect(page.locator('section[data-route="tools"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/file'; });
  await expect(page.locator('#fa-open')).toBeVisible();
  await expect(page.getByText(line)).toBeHidden();
});

// ---------------------------------------------------------------- Drag over, several files, 1.6

test('3.3 Drag over: overlay text "Drop the file to analyse it"', async ({ page }) => {
  await openFileRoute(page);
  const prevented = await dropFiles(page, 'h1:visible', [{ name: 'a.wav', b64: toB64(wavBytes({ dur: 1 })) }], ['dragenter', 'dragover']);
  await expect(page.getByText('Drop the file to analyse it', { exact: true })).toBeVisible();
  expect(prevented.dragover, 'dragover with files is cancelled so the drop can happen').toBe(true);
});

test('3.3 Several files dropped: notice, previous state stays, nothing opened', async ({ page }) => {
  await openFileRoute(page);
  const b = toB64(wavBytes({ dur: 1 }));
  await dropFiles(page, 'h1:visible', [{ name: 'a.wav', b64: b }, { name: 'b.wav', b64: b }]);
  await expect(page.getByText('Drop one file at a time. Nothing was opened.', { exact: true }).first()).toBeVisible();
  await expect(page.locator('#fa-status')).toHaveText('Drop one file at a time. Nothing was opened.');
  await expect(route(page).getByRole('heading', { level: 2, name: 'Open a recording' })).toBeVisible();
  for (const id of ['#fa-info', '#fa-figs', '#fa-progress']) await expect(page.locator(id)).toBeHidden();
  expect((await fa(page)).workers, 'no worker for a refused drop').toBe(0);
});

test('3.3 One file dropped on #/file is analysed like a pick', async ({ page }) => {
  await openFileRoute(page);
  await dropFiles(page, 'h1:visible', [{ name: 'dropped.wav', b64: toB64(wavBytes({ dur: 1.5 })) }]);
  await waitDone(page);
  await expect(page.locator('#fa-info-name')).toHaveText('dropped.wav');
});

for (const hash of ['#/', '#/tools', '#/voice', '#/about', '#/methods']) {
  test(`1.6: a file dropped on ${hash} is ignored, default prevented, no message`, async ({ page }) => {
    await page.addInitScript(INSTRUMENT);
    await page.goto('/' + hash);
    await page.locator('h1:visible').first().waitFor();
    const before = await page.evaluate(() => location.hash);
    const prevented = await dropFiles(page, 'h1:visible', [{ name: 'a.wav', b64: toB64(wavBytes({ dur: 1 })) }]);
    expect(prevented.dragover, 'dragover cancelled').toBe(true);
    expect(prevented.drop, 'drop cancelled, so the browser does not open the file').toBe(true);
    expect(await page.evaluate(() => location.hash)).toBe(before);
    await page.waitForTimeout(300);
    expect((await fa(page)).workers, 'no analysis started').toBe(0);
    await expect(page.getByText('Drop one file at a time. Nothing was opened.')).toBeHidden();
    await expect(page.getByText('Drop the file to analyse it')).toBeHidden();
    // Going to the file route afterwards shows the empty state.
    await page.evaluate(() => { location.hash = '#/file'; });
    await expect(page.locator('#fa-open')).toBeVisible();
    await expect(page.locator('#fa-info')).toBeHidden();
    await expect(page.locator('#fa-figs')).toBeHidden();
  });
}

// ---------------------------------------------------------------- Errors (exact copy)

async function expectError(page: import('@playwright/test').Page, copy: string, action = 'Open another file') {
  await expect(page.locator('#fa-error')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#fa-error')).toContainText(copy);
  await expect(page.locator('#fa-status')).toContainText(copy); // announced
  await expect(page.locator('#fa-open')).toHaveText(action);
  await expect(page.locator('#fa-figs')).toBeHidden();
  await expect(page.locator('#fa-progress')).toBeHidden();
}

test('F-12 / 3.3 Too large: refused before decoding, exact copy with sizes, no decode, no worker', async ({ page }) => {
  await openFileRoute(page);
  const size = MAX_FILE_BYTES + 5_000_000;
  await pick(page, sparseFilePath(size, 'huge.wav'));
  await expect(page.locator('#fa-error')).toBeVisible({ timeout: 30000 });
  const text = ((await page.locator('#fa-error').textContent()) ?? '').replace(/\s+/g, ' ');
  const m = /This file is ([\d.,]+) MB\. The limit is ([\d.,]+) MB\./.exec(text);
  expect(m, `error text: ${text}`).not.toBeNull();
  const [a, b] = [Number(m![1].replace(/,/g, '')), Number(m![2].replace(/,/g, ''))];
  const unit = [1e6, 2 ** 20].find((u) => Math.abs(size / u - a) <= 0.06 && Math.abs(MAX_FILE_BYTES / u - b) <= 0.06);
  expect(unit, `sizes ${a} and ${b} MB must be ${size} and ${MAX_FILE_BYTES} bytes in one unit`).toBeDefined();
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  const f = await fa(page);
  expect(f.workers, 'no Worker for an oversize file').toBe(0);
  expect(f.decodes, 'no decode attempted for an oversize file').toBe(0);
  expect(f.hist.filter((h) => h.progressVisible), 'no Decoding or Analysing state was ever shown').toEqual([]);
  await expect(page.locator('#fa-figs')).toBeHidden();
});

test('F-13 / 3.3 Too long: exact copy, no figures, no partial results', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, silentWavPath(MAX_DURATION_S + 1));
  await expect(page.locator('#fa-error')).toBeVisible({ timeout: 60000 });
  const text = ((await page.locator('#fa-error').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const m = /^This recording is (.+)\. The limit is (.+)\. Trim it and open it again\./.exec(text);
  expect(m, `error text: ${text}`).not.toBeNull();
  const cands = (s: number) => [String(s), `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, `${Math.floor(s / 60)} min`];
  expect(cands(MAX_DURATION_S + 1).some((c) => m![1].includes(c)), `duration "${m![1]}" is ${MAX_DURATION_S + 1} s`).toBe(true);
  expect(cands(MAX_DURATION_S).some((c) => m![2].includes(c)), `limit "${m![2]}" is MAX_DURATION_S`).toBe(true);
  await expect(page.locator('#fa-status')).toContainText('Trim it and open it again.');
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  for (const id of ['#fa-figs', '#fa-cursor', '#fa-fig-pitch', '#fa-fig-spec', '#fa-progress']) await expect(page.locator(id)).toBeHidden();
});

test('3.3 File type not supported: exact copy', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not audio, it is just some text '.repeat(100)) });
  await expectError(page, 'This file type is not supported. Open a WAV, MP3 or M4A file.');
});

test('F-11 / 3.3 Could not decode: random bytes named .mp3, exact copy, Details present, no plot', async ({ page }) => {
  await openFileRoute(page);
  const rnd = Buffer.alloc(20000);
  let s = 12345;
  for (let i = 0; i < rnd.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; rnd[i] = s >>> 24; }
  await pick(page, { name: 'random.mp3', mimeType: 'audio/mpeg', buffer: rnd });
  await expectError(page, 'This file could not be read as audio. It may be damaged or protected.');
  await expect(page.locator('#fa-error-details')).toBeAttached();
  await expect(page.locator('#fa-fig-pitch')).toBeHidden();
});

test('F-14 / 3.3 Too short: exact copy with the buffer size from DEFAULT_YIN', async ({ page }) => {
  await openFileRoute(page);
  const n = DEFAULT_YIN.bufferSize - 1;
  await pick(page, filePath('short.wav', wavBytes({ dur: n / 48000 })));
  await expect(page.locator('#fa-error')).toBeVisible({ timeout: 30000 });
  const text = ((await page.locator('#fa-error').textContent()) ?? '').replace(/\s+/g, ' ');
  expect(text).toMatch(new RegExp(`This recording is too short to analyse\\. It needs at least ${DEFAULT_YIN.bufferSize} samples, about \\d+(\\.\\d+)? ms at 48000 Hz\\.`));
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  await expect(page.locator('#fa-figs')).toBeHidden();
});

test.skip('F-10: a supported container whose header cannot be read is labelled "Resampled to 48 kHz, file rate unknown."', async () => {
  // Skipped, reason: a decodable MP3 or M4A whose rate is unreadable cannot be built independently of the header
  // reader's own leniency. A junk-prefixed MP3 is decoded by Chrome, but whether src/take/headers.ts counts the
  // prefix as "unreadable" (rate unknown) or finds the first frame by scanning (rate 22050 etc.) is the
  // implementation's choice, not the spec's, and asserting either would test the code against itself.
  // Expected when such a file exists (design 3.2 table, F-10): #fa-info-rate "48000 Hz" and
  // #fa-info-rate-note "Resampled to 48 kHz, file rate unknown."; a lossy file also lists
  // "Accuracy on MP3 and AAC files is unverified." and "Accuracy after resampling is unverified.".
  // F-09 (96 kHz WAV, rate known) is covered below for the same label family.
});

// ---------------------------------------------------------------- Decoding, Analysing, Done, Cancelled

test('3.3 Decoding and Analysing copy, Done strip and status (96 kHz WAV, Option B label)', async ({ page }) => {
  test.setTimeout(120000);
  await openFileRoute(page);
  await pick(page, longWavPath(60, 96000));
  await waitDone(page);
  const f = await fa(page);
  const progress = f.hist.map((h) => h.progress ?? '');
  expect(progress.some((p) => p.includes('Decoding long-60-96000-220.wav…')), `Decoding line seen in: ${JSON.stringify(progress.slice(0, 6))}`).toBe(true);
  expect(progress.some((p) => /Analysing, \d+%/.test(p))).toBe(true);
  expect(progress.some((p) => p.includes('The plots appear when the whole recording is analysed. Each pitch is chosen with the whole take in view, so there is nothing to show part way.'))).toBe(true);
  await expect(page.locator('#fa-status')).toHaveText(/^Done\. .+ analysed\.$/);
  await expect(page.locator('#fa-info-name')).toHaveText('long-60-96000-220.wav');
  await expect(page.locator('#fa-info-rate')).toContainText('48000 Hz');
  await expect(page.locator('#fa-info-rate-note')).toHaveText('Resampled from 96000 Hz to 48 kHz.');
  await expect(page.locator('#fa-info-ch')).toHaveText('1');
  expect(parseClock((await page.locator('#fa-info-dur').textContent())!)).toBeCloseTo(60, 1);
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
});

test('3.2 File strip for a 48 kHz mono WAV: rate from the file, duration m:ss.ss, channels', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, filePath('three.wav', wavBytes({ dur: 3 })));
  await waitDone(page);
  await expect(page.locator('#fa-info-rate')).toHaveText('48000 Hz');
  await expect(page.locator('#fa-info-rate-note')).toHaveText('From the file. Not resampled.');
  await expect(page.locator('#fa-info-dur')).toHaveText('0:03.00');
  await expect(page.locator('#fa-info-ch')).toHaveText('1');
  await expect(page.locator('#fa-info-method')).toHaveText('Whole take (YIN + continuity)');
});

test('3.2 Stereo WAV: channels value says mixed to one by averaging', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, filePath('stereo.wav', wavBytes({ dur: 2, channels: 2 })));
  await waitDone(page);
  await expect(page.locator('#fa-info-ch')).toHaveText('2, mixed to one by averaging');
});

test('3.3 Done: figures, cursor, readings and action present; focus did not move', async ({ page }) => {
  await openFileRoute(page);
  await page.locator('#fa-open').focus();
  await pick(page, filePath('done.wav', wavBytes({ dur: 2, f0: 440 })));
  await waitDone(page);
  for (const id of ['#fa-figs', '#fa-cursor', '#fa-cursor-line', '#fa-fig-pitch', '#fa-fig-cents', '#fa-fig-vib', '#fa-fig-spec', '#fa-r-time', '#fa-r-note', '#fa-r-pitch', '#fa-r-offby', '#fa-r-vib']) {
    await expect(page.locator(id), id).toBeVisible();
  }
  expect(await page.evaluate(() => document.activeElement?.id), 'focus stays where it was when the result arrives').toBe('fa-open');
  await expect(page.locator('#fa-cursor-line')).toHaveText(/^At [\d.]+ s: [A-G][#\u266F]?\d, [\d.]+ Hz, [\d.]+ (?:cents? (?:flat|sharp)|cents)$/);
  for (const [id, name] of [['fa-fig-pitch', 'Pitch over time, '], ['fa-fig-cents', 'Cents'], ['fa-fig-vib', 'Vibrato'], ['fa-fig-spec', 'Spectrogram']] as const) {
    const img = page.locator(`#${id}[role="img"], #${id} [role="img"]`).first();
    await expect(img, id).toHaveAttribute('aria-label', new RegExp(`^${name}.*Values are in the time cursor and Readings at cursor\\.$`));
  }
});

test('3.5 Measure a held note: span inputs, target and run button are present after Done', async ({ page }) => {
  test.fixme(true, '3.5 panel ships with M2.3a (Sustain on files), not built in M2.1');
  await openFileRoute(page);
  await pick(page, filePath('sus.wav', wavBytes({ dur: 3, f0: 440 })));
  await waitDone(page);
  for (const id of ['#fa-span-from', '#fa-span-to', '#fa-sus-target', '#fa-sus-run']) await expect.soft(page.locator(id), id).toBeVisible();
  await expect.soft(page.getByText('Measure a held note', { exact: true }).first()).toBeVisible();
});

test('3.3 Cancelled: exact copy, nothing kept, button reads "Open an audio file"', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, longWavPath(300));
  await expect(page.locator('#fa-cancel')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await fa(page)).hist.some((h) => /Analysing, \d+%/.test(h.progress ?? '')), { timeout: 20000 }).toBe(true);
  await page.locator('#fa-cancel').click();
  await expect(page.locator('#fa-status')).toContainText('Analysis cancelled. Nothing was kept.');
  await expect(page.getByText('Analysis cancelled. Nothing was kept.').first()).toBeVisible();
  await expect(page.locator('#fa-open')).toHaveText('Open an audio file');
  await expect(page.locator('#fa-figs')).toBeHidden();
  await expect(page.locator('#fa-progress')).toBeHidden();
  // No result arrives later.
  await page.waitForTimeout(2500);
  await expect(page.locator('#fa-figs')).toBeHidden();
  expect((await fa(page)).hist.some((h) => h.done), 'no Done after Cancel').toBe(false);
});

test('F-15 / 3.3 Done, no pitch found: silence shows the exact states and no note or cents anywhere', async ({ page }) => {
  await openFileRoute(page);
  await pick(page, silentWavPath(3));
  await waitDone(page);
  await expect(page.locator('#fa-status')).toHaveText('Done. No pitch found.');
  await expect(page.getByText('No pitch found in this recording').first()).toBeVisible();
  const causes = ((await page.getByText(/^Common causes: silence/).first().textContent()) ?? '').trim();
  expect(causes.startsWith('Common causes: silence, singing below the voicing gate (')).toBe(true);
  expect(causes.endsWith(' dBFS), or stereo channels that cancel when mixed.')).toBe(true);
  expect(causes).toContain(String(Math.abs(DEFAULT_YIN.silenceDb)));
  await expect(page.locator('#fa-r-note')).toHaveText('No pitch at this time');
  // 3.3 (Done, no pitch found) says "No pitch at this time" everywhere in Readings; 3.2 gives "No pitch" for the
  // Pitch and Off by rows in general. The state row is the more specific one, so it is asserted here.
  await expect(page.locator('#fa-r-pitch')).toHaveText('No pitch at this time');
  await expect(page.locator('#fa-r-offby')).toHaveText('No pitch at this time');
  await expect(page.locator('#fa-cursor-line')).toHaveText(/^At [\d.]+ s: no pitch$/);
  await expect(page.locator('#fa-fig-spec')).toBeVisible();
  await expect(page.locator('#fa-sus-run')).toBeHidden();
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  const body = (await route(page).innerText());
  expect(body, 'no note name or cents readout anywhere').not.toMatch(/\b[A-G][#♯b♭]?\d\b[^\n]*\bcents (flat|sharp)\b/);
});

test('F-15 / 3.3 Done, no pitch found: "There is no pitch to measure." replaces Measure a held note', async ({ page }) => {
  test.fixme(true, '3.5 panel ships with M2.3a (Sustain on files), not built in M2.1');
  await openFileRoute(page);
  await pick(page, silentWavPath(3));
  await waitDone(page);
  await expect(page.getByText('There is no pitch to measure.', { exact: true })).toBeVisible();
});

// ---------------------------------------------------------------- F-21, F-28

test('F-21: a file named <img src=x onerror=alert(1)>.wav is literal text and creates no element', async ({ page }) => {
  const name = '<img src=x onerror=alert(1)>.wav';
  const dialogs: string[] = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await openFileRoute(page);
  await pick(page, { name, mimeType: 'audio/wav', buffer: Buffer.from(wavBytes({ dur: 60 })) });
  await expect(page.locator('#fa-info-name')).toHaveText(name);
  expect(await page.locator('#fa-info-name').evaluate((e) => e.children.length), 'no child elements in the name').toBe(0);
  expect(await page.locator('#fa-info-name').textContent()).toBe(name);
  await waitDone(page);
  await page.waitForTimeout(500);
  expect(await page.locator('img[src="x"]').count(), 'no <img src=x> anywhere').toBe(0);
  expect(await page.locator('img[onerror]').count()).toBe(0);
  expect(dialogs, 'alert never ran').toEqual([]);
  // The name also appears in the progress and error lines; those must be text too.
  const f = await fa(page);
  expect(f.hist.some((h) => (h.progress ?? '').includes(name)), 'Decoding or Analysing line shows the name as text').toBe(true);
  // Error path with the same hostile name.
  await pick(page, { name, mimeType: 'text/plain', buffer: Buffer.from('not audio') });
  await expect(page.locator('#fa-error')).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(dialogs).toEqual([]);
});

test('F-28: method label and the not-a-diagnostic footer line', async ({ page }) => {
  await openFileRoute(page);
  await expect(page.getByText(FOOTER_LINE, { exact: true })).toBeVisible();
  await pick(page, filePath('f28.wav', wavBytes({ dur: 1.5 })));
  await waitDone(page);
  await expect(page.locator('#fa-info-method')).toHaveText('Whole take (YIN + continuity)');
  await expect(page.getByText(FOOTER_LINE, { exact: true })).toBeVisible();
  expect(FILE_ROUTE).toBe('/#/file');
});
