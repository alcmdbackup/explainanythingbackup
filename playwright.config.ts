import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/__tests__/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,  // Reduced from 4 to avoid resource contention
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
    // Auth setup - runs once before all tests
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // Chromium - default for local and PR (authenticated)
    {
      name: 'chromium',
      testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
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
    // Firefox - for nightly runs only (authenticated)
    {
      name: 'firefox',
      testMatch: /^(?!.*\.unauth\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
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
    },
  },
  timeout: process.env.CI ? 60000 : 30000,
  expect: {
    timeout: process.env.CI ? 20000 : 10000,
  },
});
