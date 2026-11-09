// Browser harness for the B criteria in specs/M2.md (Q3 decided: Playwright).
// Runs its own Vite server on 5180 so it never clashes with a dev server on 5173.
// Runs in installed Google Chrome, her browser (specs/M2.md Q5). Set PW_CHANNEL=chromium to use
// Playwright's bundled Chromium instead (npm run test:browser:install puts it in .playwright-browsers).
import { defineConfig } from '@playwright/test';

const PORT = 5180;
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.ts',
  outputDir: 'results/playwright',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', ...(channel === 'chromium' ? {} : { channel }) },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
