import { defineConfig } from '@playwright/test';

process.env.HEXDECK_E2E_LIVE = '0';

export default defineConfig({
  testDir: './test/e2e',
  testIgnore: '**/ai-live-browser.spec.ts',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: '.e2e-report', open: 'never' }]],
  outputDir: '.e2e-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});
