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

// Export resolved baseURL so test helpers (AdminBasePage, admin-auth fixture) use the correct URL
// instead of falling back to hardcoded port 3008 when process.env.BASE_URL is unset
if (!process.env.BASE_URL && instanceURL) {
  process.env.BASE_URL = baseURL;
}
// B109: persist the resolved URL to a separate env var so global-setup.ts reuses it
// instead of running a second discovery pass in its own Node process (which could race
// ensure-server.sh and fall back to a stale URL).
process.env.E2E_BASE_URL = baseURL;

// Detect production environment for extended timeouts and serial execution
const isProduction = baseURL.includes('vercel.app') || baseURL.includes('explainanything');

export default defineConfig({
  globalSetup: './src/__tests__/e2e/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/setup/global-teardown.ts',
  testDir: './src/__tests__/e2e',
  fullyParallel: isProduction ? false : true,  // Serial execution in production to avoid rate limiting
  forbidOnly: !!process.env.CI,
  retries: isProduction ? 3 : (process.env.CI ? 2 : 0),  // More retries for real AI flakiness
  workers: process.env.CI ? 2 : 3,
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
      testMatch: /^(?!.*\.unauth\.spec\.ts$)(?!.*guest-auto-login\.spec\.ts$)(?!.*\.prod-ai\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      grep: /@critical/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // Chromium - full test suite for local and main branch (authenticated via per-worker API auth)
    {
      name: 'chromium',
      testMatch: /^(?!.*\.unauth\.spec\.ts$)(?!.*guest-auto-login\.spec\.ts$)(?!.*\.prod-ai\.spec\.ts$).*\.spec\.ts$/,
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    // Chromium unauthenticated - for testing auth redirects
    {
      name: 'chromium-unauth',
      testMatch: /\.unauth\.spec\.ts$/,
      grep: /@critical/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: { cookies: [], origins: [] },
      },
    },
    // Chromium guest-auto-login — points at the SECONDARY webServer on port 3009
    // that intentionally runs WITHOUT E2E_TEST_MODE so the middleware auto-login
    // code path actually fires. Tests in this project verify the guest auto-login
    // behavior end-to-end (Phase 5 of fixes_explainanything_for_public_demo_20260523).
    // NOTE: requires GUEST_EMAIL / GUEST_PASSWORD / NEXT_PUBLIC_GUEST_EMAIL env vars
    // to be set in the CI runner env block (added to ci.yml in a follow-up PR after
    // staging GUEST_* secrets exist).
    {
      name: 'chromium-guest-auto',
      testMatch: /guest-auto-login\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3009',
        storageState: { cookies: [], origins: [] },
      },
    },
    // prod-ai — the deliberate cheap real-AI smoke (reduce_e2e_openai_test_costs_20260607).
    // Points at the SECONDARY webServer on port 3010 which runs WITHOUT E2E_TEST_MODE (so the
    // real returnExplanation pipeline executes) but WITH TEST_LLM_MODEL=google/gemini-2.5-flash
    // (so it runs on a cheap model). Chromium-only, explicit retries:2 to absorb real-LLM
    // non-determinism (assertions are structural, not exact-text). Run by e2e-real-ai-smoke.yml.
    {
      name: 'prod-ai',
      testMatch: /\.prod-ai\.spec\.ts$/,
      grep: /@prod-ai/,
      retries: 2,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:3010',
      },
    },
  ],
  // Disable webServer when using external server (BASE_URL set or Claude instance discovered)
  ...(process.env.BASE_URL || instanceURL ? {} : {
    webServer: [
      {
        // Primary 3008 server — has E2E_TEST_MODE=true so middleware guest auto-login is suppressed
        // and existing unauth-redirect tests still pass.
        // Use production build in CI for stability; dev server locally for HMR.
        // CI builds the app in a DEDICATED `npm run build` step BEFORE Playwright
        // (see ci.yml e2e jobs), so this command is start-only — the build time no
        // longer competes with the server-start timeout below. This removes the
        // recurring `Timed out waiting from config.webServer` flake where a cold
        // `.next` build ate the whole start budget (testing_overview Rule 21 / S1).
        // Note: E2E_TEST_MODE must be set at runtime (npm start), not build time,
        // because the app blocks E2E_TEST_MODE in production builds.
        // FAST_DEV=true bypasses observability wrappers (withActiveSpan span exporters,
        // server logging instrumentation) so pipeline E2E tests don't suffer from
        // OTel/Sentry export latency on every agent execution. Production builds
        // run with full observability; this only affects the E2E job's web server.
        command: process.env.CI
          ? 'E2E_TEST_MODE=true FAST_DEV=true npm start -- -p 3008'
          : 'npm run dev -- -p 3008',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        // Start-only budget (the build is a separate CI step). Was 240000 when this
        // command also ran `npm run build`.
        timeout: process.env.CI ? 120000 : 120000,
        env: {
          NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
          ...(process.env.CI ? {} : { E2E_TEST_MODE: 'true' }),
          ...(process.env.NODE_USE_ENV_PROXY ? { NODE_USE_ENV_PROXY: '1' } : {}),
          // Required by /reset-password's server-side guest gate: the page
          // 404s when getUser() returns the guest user id. Without this the
          // password-reset spec's guest-protection test cannot fire.
          ...(process.env.GUEST_USER_ID ? { GUEST_USER_ID: process.env.GUEST_USER_ID } : {}),
        },
      },
      // Secondary 3009 server — intentionally runs WITHOUT E2E_TEST_MODE so
      // middleware guest auto-login actually fires (Phase 5 of demo-prep).
      // Used by the chromium-guest-auto project. `env -u E2E_TEST_MODE` wrapper
      // strips the var from the inherited shell env (Playwright `env: {}` would
      // NOT do this — it merges with process.env by default).
      //
      // GATED: only spins up when RUN_GUEST_AUTO_TESTS=1 is set. Playwright starts
      // ALL configured webServers regardless of which projects are selected, so
      // leaving this unconditional would start an extra server for the standard
      // chromium-critical job that doesn't need it. (Build is a separate CI step;
      // this command is start-only — see the primary server's note above.)
      ...(process.env.RUN_GUEST_AUTO_TESTS === '1' ? [{
        command: process.env.CI
          ? 'env -u E2E_TEST_MODE npm start -- -p 3009'
          : 'env -u E2E_TEST_MODE npm run dev -- -p 3009',
        url: 'http://localhost:3009',
        reuseExistingServer: !process.env.CI,
        timeout: process.env.CI ? 120000 : 120000,
        env: {
          NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
          ...(process.env.NODE_USE_ENV_PROXY ? { NODE_USE_ENV_PROXY: '1' } : {}),
        },
      }] : []),
      // Tertiary 3010 server — the cheap real-AI smoke (reduce_e2e_openai_test_costs_20260607).
      // Runs WITHOUT E2E_TEST_MODE (real pipeline) but WITH TEST_LLM_MODEL so every LLM call
      // uses the cheap model. GATED on RUN_PROD_AI=1 so normal CI/local runs don't pay its build.
      // `env -u E2E_TEST_MODE` strips the inherited var (Playwright `env:` merges, not replaces).
      ...(process.env.RUN_PROD_AI === '1' ? [{
        command: process.env.CI
          ? 'env -u E2E_TEST_MODE npm start -- -p 3010'
          : 'env -u E2E_TEST_MODE npm run dev -- -p 3010',
        url: 'http://localhost:3010',
        reuseExistingServer: !process.env.CI,
        timeout: process.env.CI ? 120000 : 120000,
        env: {
          NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
          TEST_LLM_MODEL: process.env.TEST_LLM_MODEL || 'google/gemini-2.5-flash',
          // This server runs the REAL pipeline under the evolution system userid (…001) with
          // neither E2E_TEST_MODE nor NODE_ENV=test, so isTestLlmCall can't tell its cheap-model
          // spend from a real evolution run by userid. Flag it explicitly so its rows are tagged
          // is_test=true and excluded from reconciliation. debug_llm_spending_data_issues_…_20260621.
          LLM_TRACKING_TEST_RUNTIME: 'true',
          ...(process.env.NODE_USE_ENV_PROXY ? { NODE_USE_ENV_PROXY: '1' } : {}),
        },
      }] : []),
    ],
  }),
  // B116/fix: exclude @skip-prod tests ONLY when targeting real prod (BASE_URL is a
  // *.vercel.app / explainanything host → isProduction). Locally + in CI these
  // mock-dependent / local-only specs SHOULD run (mocks are active there); the prod
  // nightly and post-deploy already exclude them via their CLI --grep-invert="@skip-prod"
  // and positive @smoke-* greps respectively. Gating here (instead of unconditional)
  // restores local/CI coverage while keeping prod exclusion intact.
  ...(isProduction ? { grepInvert: /@skip-prod/ } : {}),
  // Extended timeouts for production (real AI latency)
  timeout: isProduction ? 120000 : (process.env.CI ? 60000 : 30000),
  expect: {
    timeout: isProduction ? 60000 : (process.env.CI ? 20000 : 10000),
  },
});
