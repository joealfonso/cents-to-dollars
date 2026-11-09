// Engineer's wiring smoke test for #/file (M2-DESIGN.md 3). Not the criterion tests: test-writer owns those.
// Opens a WAV through the real file input, waits for Done, and checks that the screen is wired: file strip,
// method label, cursor line, figures drawn, A4 change updates cents with no new Worker, other states reachable.
import { test, expect, type Page } from '@playwright/test';
import { tone, encodeWav } from '../take.helpers.ts';

const wav = (sr: number, dur: number, f0: number) =>
  Buffer.from(encodeWav({ sampleRate: sr, format: 'pcm16', channels: [tone({ sr, dur, f0, vibRate: 5.5, vibCents: 40 })] }));

async function openRoute(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  await page.goto('/#/file');
  await expect(page.locator('#fa-title')).toBeVisible();
}

test('#/file: a 48 kHz WAV reaches Done with strip, cursor line and figures; A4 updates cents with no new Worker', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => {
    const W = window.Worker;
    (window as any).__workers = 0;
    (window as any).Worker = class extends W { constructor(u: string | URL, o?: WorkerOptions) { super(u, o); (window as any).__workers++; } };
  });
  await openRoute(page, errors);
  await expect(page.locator('#fa-figs-title')).toHaveText('Open a recording');
  await expect(page.locator('#fa-tips-list li')).toHaveCount(5);

  await page.setInputFiles('#fa-input', { name: '<b>take one</b>.wav', mimeType: 'audio/wav', buffer: wav(48000, 4, 440) });
  await expect(page.locator('#fa-take')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#fa-info-name')).toHaveText('<b>take one</b>.wav');
  await expect(page.locator('#fa-info-name b')).toHaveCount(0);
  await expect(page.locator('#fa-info-method')).toHaveText('Whole take (YIN + continuity)');
  await expect(page.locator('#fa-info-rate')).toHaveText('48000 Hz');
  await expect(page.locator('#fa-info-rate-note')).toHaveText('From the file. Not resampled.');
  await expect(page.locator('#fa-cursor-line')).toContainText(/^At [\d.]+ s: A4, 4\d\d\.\d Hz/);
  await expect(page.locator('#fa-open')).toHaveText('Open another file');
  await expect(page.locator('#fa-tips #fa-tips-list li')).toHaveCount(5);
  expect(await page.locator('#fa-progress-bar').getAttribute('aria-valuenow')).toBe('100');

  // Figures drawn: some non-surface pixel in the pitch canvas.
  const drawn = await page.evaluate(() => {
    const c = document.getElementById('fa-fig-pitch') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const [r, g, b] = [d[0], d[1], d[2]];
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) > 60) return true;
    return false;
  });
  expect(drawn).toBe(true);

  const workers = await page.evaluate(() => (window as any).__workers);
  const before = await page.locator('#fa-r-offby').textContent();
  await page.locator('#fa-a4-inc').click();
  await expect(page.locator('#fa-a4')).toHaveValue('441');
  await expect(page.locator('#fa-r-offby')).not.toHaveText(before ?? '');
  expect(await page.evaluate(() => (window as any).__workers)).toBe(workers);
  await page.locator('#fa-a4-dec').click();

  // Keyboard on the time cursor moves one frame.
  const t0 = await page.locator('#fa-cursor').getAttribute('aria-valuenow');
  await page.locator('#fa-cursor').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.locator('#fa-cursor').getAttribute('aria-valuenow')).not.toBe(t0);

  expect(errors).toEqual([]);
});

test('#/file: random bytes named .mp3 show could not decode; leaving and returning shows the cleared line once', async ({ page }) => {
  const errors: string[] = [];
  await openRoute(page, errors);
  await page.setInputFiles('#fa-input', { name: 'noise.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251)) });
  await expect(page.locator('#fa-error')).toHaveText('This file could not be read as audio. It may be damaged or protected.');
  await expect(page.locator('#fa-take')).toBeHidden();

  await page.setInputFiles('#fa-input', { name: 'ok.wav', mimeType: 'audio/wav', buffer: wav(44100, 2, 220) });
  await expect(page.locator('#fa-take')).toBeVisible({ timeout: 20000 });
  await page.goto('/#/tools');
  await expect(page.locator('[data-fa-status]')).toHaveText('Ready');
  await page.goto('/#/file');
  await expect(page.locator('#fa-cleared')).toBeVisible();
  await page.goto('/#/tools');
  await page.goto('/#/file');
  await expect(page.locator('#fa-cleared')).toBeHidden();
  expect(errors).toEqual([]);
});
