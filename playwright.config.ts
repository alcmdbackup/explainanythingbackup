import { defineConfig, devices } from '@playwright/test';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

// Note: Do NOT set E2E_TEST_MODE here - it would pollute the environment during
// `npm run build` and cause the app to reject the production build.
// E2E_TEST_MODE is set inline in the webServer command for runtime only.

/**
 * Ensures a dev server is running before discovering its URL.
 * Starts server on-demand if not already running, resets idle timer.
 */
function ensureServerRunning(): void {
  const ensureScript = join(__dirname, 'docs/planning/tmux_usage/ensure-server.sh');
  if (!existsSync(ensureScript)) {
    console.log('[Playwright] ensure-server.sh not found, skipping on-demand start');
    return;
  }

  try {
    console.log('[Playwright] Ensuring dev server is running...');
    execSync(`bash "${ensureScript}"`, {
      stdio: 'inherit',
      timeout: 60000  // 60s timeout for server startup
    });
  } catch (error) {
    console.warn('[Playwright] Failed to ensure server:', error);
  }
}

/**
 * Discovers the frontend URL from Claude Code instance files.
 * When Claude Code starts, it creates /tmp/claude-instance-{id}.json with server URLs.
 * This function finds the matching instance for the current project.
 */
function discoverInstanceURL(): string | null {
  try {
    const instanceFiles = readdirSync('/tmp').filter(f => f.startsWith('claude-instance-'));
    if (instanceFiles.length === 0) return null;

    const cwd = process.cwd();

    // Try to find an instance matching our project root
    for (const file of instanceFiles) {
      try {
        const info = JSON.parse(readFileSync(`/tmp/${file}`, 'utf-8'));
        if (info.project_root === cwd) {
          console.log(`[Playwright] Using Claude instance ${info.instance_id}: ${info.frontend_url}`);
          return info.frontend_url;
        }
      } catch {
        // Skip malformed files
      }
    }

    // No exact match - use first available instance (for worktrees with different paths)
    // H2: Warn user that fallback may connect to wrong project
    const firstInfo = JSON.parse(readFileSync(`/tmp/${instanceFiles[0]}`, 'utf-8'));
    console.warn(`[Playwright] WARNING: No instance matches project_root "${cwd}"`);
    console.warn(`[Playwright] Falling back to instance ${firstInfo.instance_id} from "${firstInfo.project_root}"`);
    console.warn(`[Playwright] Tests may run against wrong server! Set BASE_URL to override.`);
    return firstInfo.frontend_url;
  } catch {
    return null;
  }
}

// Ensure server is running before discovery (on-demand start)
// Skip in CI where webServer handles startup
if (!process.env.CI) {
  ensureServerRunning();
}

// Resolve baseURL: explicit env var > instance discovery > hardcoded fallback
const instanceURL = discoverInstanceURL();
const baseURL = process.env.BASE_URL || instanceURL || 'http://localhost:3008';

// Detect production environment for extended timeouts and serial execution
const isProduction = baseURL.includes('vercel.app') || baseURL.includes('explainanything');

export default defineConfig({
  globalSetup: './src/__tests__/e2e/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/setup/global-teardown.ts',
  testDir: './src/__tests__/e2e',
  fullyParallel: isProduction ? false : true,  // Serial execution in production to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: isProduction ? 3 : (process.env.CI ? 2 : 0),  // More retries for real AI flakiness
  workers: isProduction ? 2 : 2,  // 2 workers in production (with 30s helper timeouts)
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    // Priority: BASE_URL env > Claude instance discovery > fallback
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
  // Disable webServer when using external server (BASE_URL set or Claude instance discovered)
  ...(process.env.BASE_URL || instanceURL ? {} : {
    webServer: {
      // Use production build in CI for stability; dev server locally for HMR
      // Note: E2E_TEST_MODE must be set at runtime (npm start), not build time,
      // because the app blocks E2E_TEST_MODE in production builds.
      command: process.env.CI
        ? 'npm run build && E2E_TEST_MODE=true npm start -- -p 3008'
        : 'npm run dev -- -p 3008',
      url: baseURL,
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
  // Extended timeouts for production (real AI latency)
  timeout: isProduction ? 120000 : (process.env.CI ? 60000 : 30000),
  expect: {
    timeout: isProduction ? 60000 : (process.env.CI ? 20000 : 10000),
  },
});
