import { defineConfig, devices } from '@playwright/test';

// Set E2E_TEST_MODE before config is evaluated so globalSetup/globalTeardown can access it
// (webServer.env only applies to the dev server, not to setup scripts)
process.env.E2E_TEST_MODE = 'true';

export default defineConfig({
  globalSetup: './src/__tests__/e2e/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/setup/global-teardown.ts',
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,  // Limit workers to avoid ECONNRESET from dev server overload
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3008',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Chromium - default for local and PR (authenticated via per-worker API auth)
    {
      name: 'chromium',
      testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // Chromium unauthenticated - for testing auth redirects
    {
      name: 'chromium-unauth',
      testMatch: /\.unauth\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
    },
    // Firefox - for nightly runs only (authenticated via per-worker API auth)
    {
      name: 'firefox',
      testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Firefox'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- -p 3008',
    url: 'http://localhost:3008',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      // Enable API route for AI suggestions (mockable in E2E tests)
      NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
      // Enable E2E test mode for SSE streaming bypass
      E2E_TEST_MODE: 'true',
    },
  },
  timeout: process.env.CI ? 60000 : 30000,
  expect: {
    timeout: process.env.CI ? 20000 : 10000,
  },
});
