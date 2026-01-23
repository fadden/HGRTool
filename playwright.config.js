import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Run tests serially to avoid port conflicts
  reporter: 'html',

  // Global timeout: 90s - Maximum time for entire test suite run per worker
  // Allows for slow Viterbi image conversions (10-20s) while preventing indefinite hangs
  timeout: 90000,

  // Assertion timeout: 5s - expect() statements must complete within this time
  expect: {
    timeout: 5000,
  },

  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',

    // Action timeout: 15s - Maximum time for UI interactions (clicks, inputs, navigation)
    // Generous enough for file dialogs and image loading, but prevents infinite waits
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Per-test timeout: 30s - Maximum time for any individual test
      // Most tests complete in <5s; this allows for slow image conversion tests
      timeout: 30000,
    },
  ],

  // Run local dev server before starting tests
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  outputDir: 'test-output/playwright-results',
});
