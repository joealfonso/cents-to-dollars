// Browser harness for the B criteria in specs/M2.md (Q3 decided: Playwright).
// Runs its own Vite server on 5180 so it never clashes with a dev server on 5173.
// Browsers live in .playwright-browsers (gitignored): npm run test:browser:install
import { defineConfig } from '@playwright/test';

const PORT = 5180;

export default defineConfig({
  testDir: 'tests/browser',
  testMatch: '**/*.spec.ts',
  outputDir: 'results/playwright',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium' },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
