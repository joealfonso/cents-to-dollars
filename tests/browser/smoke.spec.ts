// Smoke test for the harness itself: the app loads with no console errors, and the
// Web Audio pieces M2.1 relies on exist (OfflineAudioContext at 44.1 and 48 kHz, Worker).
import { test, expect } from '@playwright/test';

test('app loads with no console errors', async ({ page }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  // "Failed to load resource" console lines carry no URL, so failed responses are listed by URL instead.
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto('/');
  await expect(page).toHaveTitle(/Cents to Dollars/);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
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
