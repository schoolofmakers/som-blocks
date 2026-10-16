import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

// Pattern: vite-pwa/vite-plugin-pwa examples/preact-router/playwright.config.ts
// (smoke against the built preview, not the dev server, so the PWA build is what we test).
const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
const preview = `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // CI runs `pnpm build` as its own step first; locally we build so the smoke never
    // runs against a stale dist/.
    command: process.env.CI ? preview : `pnpm build && ${preview}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
