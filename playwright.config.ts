import { defineConfig, devices } from '@playwright/test';

// Note: Do NOT set E2E_TEST_MODE here - it would pollute the environment during
// `npm run build` and cause the app to reject the production build.
// E2E_TEST_MODE is set inline in the webServer command for runtime only.

export default defineConfig({
  globalSetup: './src/__tests__/e2e/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/setup/global-teardown.ts',
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 2,  // Production build in CI is more stable, allows 2 workers
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    // Allow BASE_URL override for running against production
    baseURL: process.env.BASE_URL || 'http://localhost:3008',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Vercel Deployment Protection bypass - set headers if secret is available
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? {
      extraHTTPHeaders: {
        'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
        'x-vercel-set-bypass-cookie': 'true',
      },
    } : {}),
  },
  projects: [
    // Chromium Critical - fast subset for PR CI (~40 tests tagged @critical)
    {
      name: 'chromium-critical',
      testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      grep: /@critical/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // Chromium - full test suite for local and main branch (authenticated via per-worker API auth)
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
  // Disable webServer when BASE_URL is set (running against production/staging)
  ...(process.env.BASE_URL ? {} : {
    webServer: {
      // Use production build in CI for stability; dev server locally for HMR
      // Note: E2E_TEST_MODE must be set at runtime (npm start), not build time,
      // because the app blocks E2E_TEST_MODE in production builds.
      command: process.env.CI
        ? 'npm run build && E2E_TEST_MODE=true npm start -- -p 3008'
        : 'npm run dev -- -p 3008',
      url: 'http://localhost:3008',
      reuseExistingServer: !process.env.CI,
      timeout: process.env.CI ? 180000 : 120000,  // Extra time for build in CI
      env: {
        // Enable API route for AI suggestions (mockable in E2E tests)
        NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
        // Enable E2E test mode for SSE streaming bypass (dev server only, CI uses inline env)
        ...(process.env.CI ? {} : { E2E_TEST_MODE: 'true' }),
      },
    },
  }),
  timeout: process.env.CI ? 60000 : 30000,
  expect: {
    timeout: process.env.CI ? 20000 : 10000,
  },
});
