// Shared helpers for tests/browser/take.*.spec.ts. Not a spec file (no .spec.ts suffix).
import type { Page } from '@playwright/test';
import { b64 } from '../take.helpers.ts';

export const HARNESS_URL = '/tests/browser/fixtures/take-harness.html';

export interface JobState {
  settled: 'pending' | 'fulfilled' | 'rejected';
  summary: null | {
    shapeKeys: string[]; foundTake: boolean; rateSource: string | null; nativeRate: number | null; channels: number | null;
    durationS: number | null; sampleRate: number | null; status?: string; frameCount?: number; hop?: number;
    start?: number[]; voiced?: number[]; f0?: number[]; t?: number[]; takeSampleRate?: number;
  };
  error: null | { name: string | null; code: string | null; message: string };
  progress: number[];
  progressAfterAbort: number;
}

export async function openHarness(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(HARNESS_URL);
  await page.waitForFunction(() => (window as unknown as { takeHarnessReady?: boolean }).takeHarnessReady === true, null, { timeout: 15000 });
}

export async function runFile(page: Page, bytes: Uint8Array, name: string, type = ''): Promise<JobState> {
  return page.evaluate(([data, n, t]) => (window as any).takeHarness.run(data, n, t), [b64(bytes), name, type] as const) as Promise<JobState>;
}

export function medianVoicedF0(f0: number[], voiced: number[]): number {
  const v = f0.filter((x, i) => voiced[i] === 1 && x > 0).sort((a, b) => a - b);
  return v[v.length >> 1];
}
