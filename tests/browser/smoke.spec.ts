// Smoke test for the harness itself: the app loads with no console errors, and the
// Web Audio pieces M2.1 relies on exist (OfflineAudioContext at 44.1 and 48 kHz, Worker).
import { test, expect } from '@playwright/test';

test('app loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page).toHaveTitle(/Cents to Dollars/);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Web Audio and Worker are available for file analysis', async ({ page }) => {
  await page.goto('/');
  const got = await page.evaluate(async () => {
    const rates: number[] = [];
    for (const r of [44100, 48000]) {
      const ctx = new OfflineAudioContext(1, r, r);
      rates.push(ctx.sampleRate);
    }
    return { rates, worker: typeof Worker === 'function' };
  });
  expect(got).toEqual({ rates: [44100, 48000], worker: true });
});
