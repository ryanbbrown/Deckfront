import { defineConfig } from '@playwright/test';

process.env.HEXDECK_E2E_LIVE = '1';

export default defineConfig({
  testDir: './test/e2e',
  testMatch: 'ai-live-browser.spec.ts',
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 260_000 },
  reporter: [['list'], ['html', { outputFolder: '.e2e-live-report', open: 'never' }]],
  outputDir: '.e2e-live-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});
