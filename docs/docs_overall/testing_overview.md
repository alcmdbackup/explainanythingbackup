# Testing Overview

Consolidated guide covering testing rules, tiers, and CI/CD workflows.

## Testing Rules

1. **Start from a known state every test.** Create all needed data in the test (or via API/seed), and reset/cleanup DB + auth/session so tests don't depend on order or shared accounts.
2. **Never use fixed sleeps.** Wait only on observable conditions: element is visible/enabled, URL changed, specific network response completed, websocket event received, etc.
3. **Use stable selectors only.** Prefer `data-testid` (or equivalent); avoid brittle CSS/XPath based on layout/text unless it's an accessibility role/name that's truly stable.
4. **Make async explicit.** After actions, assert the next expected state (auto-waiting assertions) and/or wait for the relevant request: "click → wait for /api/foo 200 → expect success UI."
5. **Isolate external dependencies.** Mock/stub third-party services (payments, email, maps, feature flags) and make backend responses deterministic; avoid real timeouts to external systems.
6. **Keep timeouts short** - 60 seconds max per test
7. **Never silently swallow errors.** Use helpers from `src/__tests__/e2e/helpers/error-utils.ts` instead of bare `.catch(() => {})`:
   - `safeWaitFor()` - Wait with timeout logging
   - `safeIsVisible()` - Visibility check with error logging
   - `safeTextContent()` - Text extraction with error logging
   - `safeScreenshot()` - Screenshot with failure logging
8. **Avoid test.skip() - create test data instead.** Tests should use `test-data-factory.ts` to create required data in `beforeAll`, not skip when data isn't available. Acceptable exceptions (require `eslint-disable` comment):
   - Feature not yet implemented
   - Infrastructure limitation (e.g., Supabase SSR cookies)
   - Known bug being tracked separately
9. **Never use `waitForLoadState('networkidle')`.** It waits for "no network requests for 500ms" which is unreliable in CI — background polling, analytics, or SSE connections prevent it from settling, causing tests to hang or pass prematurely. Use specific waits instead:
   - `page.waitForSelector('[data-testid="..."]')` - Wait for specific element
   - `locator.waitFor({ state: 'visible' })` - Wait for element state
   - `page.waitForResponse('**/api/endpoint')` - Wait for specific API call
   - `waitForPageStable()` from `wait-utils.ts` - Custom stability check
10. **Always unregister route mocks between tests.** Call `await page.unrouteAll({ behavior: 'wait' })` in `afterEach` or use scoped route mocking. Stacked `page.route()` handlers from previous tests cause non-deterministic behavior when multiple handlers match the same URL.
11. **Use per-shard/per-worker temp files.** Never write to hardcoded `/tmp/` paths shared between parallel runners. Include the worker/shard index in file names (e.g., `/tmp/e2e-tracked-ids-worker-${workerIndex}.json`) or use `$TMPDIR`. Shared file writes between shards cause data loss and race conditions.
12. **Page Object methods must wait after actions.** Every POM method that performs a click, submit, or navigation must wait for the expected state change before returning. The caller should not need to add their own waits. Pattern: `async clickSave() { await this.saveBtn.click(); await this.page.waitForResponse('**/api/save'); }`
13. **E2E suites with `beforeAll` state must use serial mode.** Any `test.describe` block that creates shared state in `beforeAll` and mutates it in tests must use `test.describe.configure({ mode: 'serial' })`. This prevents parallel tests from racing on shared mutable state. Merge with existing config: `{ retries: 2, mode: 'serial' }`.
14. **Mock helpers must unroute before routing.** All mock helper functions in `api-mocks.ts` must call `await page.unroute(pattern)` before `await page.route(pattern, ...)` to prevent handler stacking when a mock is called multiple times in the same test.
15. **Restore global.fetch in unit tests.** Any test that assigns `global.fetch` must save the original and restore it in `afterEach`: `const originalFetch = global.fetch; afterEach(() => { global.fetch = originalFetch; });`
16. **E2E specs that import database tools must have afterAll cleanup.** Any spec file importing `@supabase/supabase-js`, `test-data-factory`, or `evolution-test-helpers` must include a `test.afterAll` or `adminTest.afterAll` block that deletes created entities. Enforced by ESLint `flakiness/require-test-cleanup`.
17. **Never hardcode URLs in Page Objects or fixtures.** Use `page.goto('/relative-path')` so Playwright resolves against the configured `baseURL`. Never construct absolute URLs with `process.env.BASE_URL || 'http://localhost:...'` — the fallback port will be wrong when the dev server runs on a dynamic port. If you need the base URL outside `page.goto()` (e.g., cookie domain), read it from `process.env.BASE_URL` which is set by `playwright.config.ts` from instance discovery. Enforced by ESLint `flakiness/no-hardcoded-base-url`.
18. **Wait for hydration proof before interacting.** Visible !== interactive. After navigating to a page with dynamic imports or server-fetched data, wait for a data-dependent element (e.g., a table with rows, a loaded form) before clicking buttons or links. A button can be visible in SSR HTML but not wired to its React handler until hydration completes. Pattern: `await table.waitFor({ state: 'visible', timeout: 30000 }); await button.click();` Enforced by ESLint `flakiness/require-hydration-wait`.

### Enforcement Summary

| Rule | Enforcement Mechanism | Catch Point |
|------|-----------------------|-------------|
| Rule 2: No fixed sleeps | ESLint `flakiness/no-wait-for-timeout` (catches `waitForTimeout` + `new Promise(setTimeout)`) | Lint (CI + IDE) |
| Rule 6: Short timeouts | ESLint `flakiness/max-test-timeout` | Lint (CI + IDE) |
| Rule 7: No silent errors | ESLint `flakiness/no-silent-catch` | Lint (CI + IDE) |
| Rule 8: No test.skip | ESLint `flakiness/no-test-skip` | Lint (CI + IDE) |
| Rule 9: No `networkidle` | ESLint `flakiness/no-networkidle` | Lint (CI + IDE) |
| Rule 10: Unregister route mocks | Fixture teardown in `base.ts` + `auth.ts` (after `use()`) | Runtime (automatic) |
| Rule 11: Per-worker temp files | ESLint `flakiness/no-hardcoded-tmpdir` + Claude hook warning | Lint + edit-time |
| Rule 12: POM waits after actions | Claude hook heuristic check | Edit-time |
| Rule 13: Serial mode for beforeAll suites | Code review + `test.describe.configure` | Edit-time |
| Rule 14: Unroute before route in mocks | Code review + `page.unroute()` in helpers | Edit-time |
| Rule 15: Restore global.fetch | Code review + `afterEach` pattern | Edit-time |
| Rule 16: E2E cleanup for DB imports | ESLint `flakiness/require-test-cleanup` | Lint (CI + IDE) |
| Rule 17: No hardcoded URLs in POMs | ESLint `flakiness/no-hardcoded-base-url` | Lint (CI + IDE) |
| Rule 18: Wait for hydration proof | ESLint `flakiness/require-hydration-wait` | Lint (CI + IDE) |
| Column label uniqueness | ESLint `no-duplicate-column-labels` | Lint (CI + IDE) |

---

## Test Data Management

### The `[TEST]` Prefix Convention

All test content uses the `[TEST]` prefix at the start of titles to:
1. **Enable discovery filtering** - Test content is excluded from Explore page, vector search, related content, and user query matching
2. **Support cleanup** - Pattern matching on `[TEST]%` identifies content for deletion
3. **Prevent pollution** - Real users never see test content in production

### Title Format

| Content Type | Format Example |
|--------------|----------------|
| Explanations | `[TEST] Quantum Physics - 1704067200000` |
| Topics | `[TEST] Topic - 1704067200000` |
| Tags | `[TEST] basic - 1704067200000` |

### Key Files

| File | Purpose |
|------|---------|
| `src/__tests__/e2e/helpers/test-data-factory.ts` | E2E test content creation, auto-tracking, cleanup functions |
| `src/testing/utils/integration-helpers.ts` | Integration test content with `TEST_PREFIX` |
| `src/__tests__/e2e/setup/global-teardown.ts` | E2E cleanup including Pinecone vectors and tracked IDs |
| `scripts/cleanup-test-content.ts` | One-time cleanup script for existing test data |
| `scripts/cleanup-specific-junk.ts` | Pattern-based cleanup for specific junk content |

### Discovery Path Filtering

Test content is filtered from 4 discovery paths:

| Path | File | Filter Method |
|------|------|---------------|
| Explore page | `explanations.ts` | `.not('explanation_title', 'ilike', '[TEST]%')` |
| Vector search | `returnExplanation.ts` | `filterTestContent()` post-query |
| Related content | `findMatches.ts` | `filterTestContent()` helper |
| User query matching | `returnExplanation.ts` | `filterTestContent()` before best match |

### Cleanup Script

For one-time cleanup of existing test content:

```bash
# Preview what would be deleted
npx tsx scripts/cleanup-test-content.ts --dry-run

# Run on dev database
npx tsx scripts/cleanup-test-content.ts

# Run on production (10-second confirmation delay)
npx tsx scripts/cleanup-test-content.ts --prod
```

### Defense-in-Depth: Auto-Tracking Cleanup

Beyond prefix filtering, a second layer tracks and cleans explanations automatically:

**How it works:**
```
Test creates explanation → trackExplanationForCleanup(id) → writes to /tmp/e2e-tracked-*.txt
                                                                      ↓
Global teardown → cleanupAllTrackedExplanations() → reads file → deletes each ID → clears file
```

**Key functions (from `test-data-factory.ts`):**

| Function | Purpose |
|----------|---------|
| `trackExplanationForCleanup(id)` | Register an ID for cleanup (called automatically by factory) |
| `cleanupAllTrackedExplanations()` | Delete all tracked IDs and clear file |
| `deleteExplanationById(id)` | Delete single explanation with Pinecone vectors |

**When to use manual tracking:**
- Tests that create explanations via API (not factory) - e.g., import tests with LLM-generated titles
- Any content that bypasses the factory's automatic tracking

**Example:**
```typescript
import { trackExplanationForCleanup } from '../../helpers/test-data-factory';

test('import creates explanation', async ({ page }) => {
  // ... test actions that create an explanation ...

  // Capture ID from redirect URL and track for cleanup
  const url = new URL(page.url());
  const explanationId = url.searchParams.get('explanation_id');
  if (explanationId) {
    trackExplanationForCleanup(explanationId);
  }
});
```

### Two Layers of Protection

| Layer | Mechanism | Catches |
|-------|-----------|---------|
| **Prefix filtering** | `[TEST]` prefix excluded from discovery | Factory-created content |
| **Auto-tracking** | ID-based cleanup via temp file | LLM-generated content, orphaned records |

---

## Testing Tiers

| Tier | Tool | Environment | Purpose |
|------|------|-------------|---------|
| **Unit** | Jest + jsdom | Browser simulation | Component/service tests with mocked dependencies |
| **ESM** | Node test runner + tsx | Node ESM | Tests for ESM-only packages (unified, remark-parse) |
| **Integration** | Jest + node | Real Supabase | Service + database tests with mocked external APIs |
| **E2E** | Playwright | Real browser | Full user flows against running app |

### Test Statistics
- **Unit**: ~310 colocated `.test.ts` files (src + evolution + scripts), including 65 evolution-specific
- **ESM**: 1 file for AST diffing (bypasses Jest ESM limitations)
- **Integration**: 32 test files in `src/__tests__/integration/`
  - **Critical**: 5 tests (auth-flow, explanation-generation, streaming-api, error-handling, vector-matching)
  - **Evolution**: 16 files (claim, budget, costs, completion, watchdog, strategy-hash, strategy-aggregates, cancel-experiment, sync-arena, entity-logger, experiment-lifecycle, metrics-recomputation, cost-cascade, visualization-data, experiment-create-complete, arena-comparison). Auto-skip when evolution DB tables not yet migrated.
  - **Full**: All 32 tests
- **E2E**: 48 spec files in `__tests__/e2e/specs/`
  - **Critical**: `@critical` tagged tests via `{ tag: '@critical' }` (run on PRs to main). Evolution Phase 1-2 E2E specs are tagged `@critical`.
  - **Evolution**: `@evolution` tagged specs (dashboard, runs, strategies, arena, experiments, invocations, variants, experiments-list, invocation-detail, logs, run pipeline, experiment wizard). Includes 5 new specs + 1 accessibility spec added in `09-admin/`.
  - **Full**: All tests (run on PRs to production)

### E2E Test Tagging Strategy

Tests use Playwright's `{ tag: '@tagname' }` parameter (not inline in test name strings) for CI filtering:

| Tag | Purpose | When Runs |
|-----|---------|-----------|
| `@critical` | Core user flows, must-not-break tests | PRs to `main` (fast feedback) |
| `@smoke` | Health checks against live production | Post-deploy smoke tests |
| `@prod-ai` | Tests requiring real AI (no E2E_TEST_MODE mock) | Nightly only |
| `@skip-prod` | Tests that require mocked APIs and cannot run against production (e.g., AI suggestion tests that mock browser-level routes unavailable in production) | Excluded from nightly and post-deploy via `--grep-invert` CLI flag and `grepInvert` config |

**Syntax**: Always use the parameter form, never embed tags in test name strings:
```typescript
// Correct
test('should load page', { tag: '@critical' }, async ({ page }) => { ... });
test.describe('Feature', { tag: '@critical' }, () => { ... });

// Wrong — tag in name string won't be matched by --grep='@critical' reliably
test('should load page @critical', async ({ page }) => { ... });
```

---

## Database Debugging During Tests

When debugging test failures related to database state, use the Supabase CLI and read-only query scripts. See [debugging.md](debugging.md#supabase-cli-debugging) for full reference.

### Inspecting Test Data

```bash
# Query staging DB to check data state (read-only, DB-enforced)
npm run query:staging -- "SELECT count(*) FROM explanations WHERE explanation_title LIKE '[TEST]%'"
npm run query:staging -- "SELECT id, status FROM evolution_runs ORDER BY created_at DESC LIMIT 5"

# Interactive REPL for exploratory debugging
npm run query:staging
```

### Database Health Checks

```bash
# Check migration status before running integration tests
npx supabase migration list

# Compare local vs remote schema (catch drift)
npx supabase db diff --linked

# Check for table bloat or test data pollution
npx supabase inspect db table-stats --linked

# Find long-running queries that may block tests
npx supabase inspect db long-running-queries --linked
```

> **Safety:** All commands above are read-only. `npm run query:staging` uses a DB-enforced `readonly_local` role. `supabase inspect db` uses pg_stat views. `supabase db query --linked` is blocked by hook — use `query:staging` instead.

---

## Quick Reference

| Type | Command | Purpose |
|------|---------|---------|
| Unit | `npm test` | Fast, isolated tests with mocked dependencies |
| Unit (watch) | `npm run test:watch` | Interactive development |
| Unit (coverage) | `npm run test:coverage` | With coverage report |
| ESM | `npm run test:esm` | Node native test runner for unified/remark |
| Integration | `npm run test:integration` | Real database, mocked external APIs |
| E2E | `npm run test:e2e` | Full Playwright tests |
| E2E (UI) | `npm run test:e2e:ui` | Interactive UI mode |
| E2E (headed) | `npm run test:e2e:headed` | Visible browser |
| All | `npm run test:all` | Unit + Integration |
| Typecheck | `npm run typecheck` | TypeScript check (incremental) |
| Unit (changed) | `npm run test:changed` | Only tests affected by branch changes |

### Check Parity: Local vs CI

| Check | Local (/finalize) | CI (main) | CI (prod) |
|-------|-------------------|-----------|-----------|
| Lint | `npm run lint` | `npm run lint` | `npm run lint` |
| TypeScript | `npm run typecheck` | `npm run typecheck` | `npm run typecheck` |
| Build | `npm run build` | ✗ skipped | ✗ skipped |
| Unit | `npm run test` | `test:ci --changedSince` | same |
| ESM | `npm run test:esm` | `npm run test:esm` | `npm run test:esm` |
| Integration | `test:integration` (all) | `:critical` (5) | `:evolution` + `:non-evolution` |
| E2E | `test:e2e:critical` | `test:e2e:critical` | `:evolution` + `:non-evolution --shard` |

**Intentional differences**: CI uses `--changedSince` (unit), `--shard` (E2E), `--maxWorkers=2`. Local runs full suites for strict pre-PR verification.

### E2E Tests in Skill Workflows

Both `/finalize` and `/mainToProd` include E2E tests as part of their standard verification:

| Skill | E2E Behavior | Flag | Duration |
|-------|-------------|------|----------|
| `/finalize` | Critical (`@critical` tagged) always runs | `--e2e` adds full suite | ~1.5 min (critical) |
| `/mainToProd` | Full suite always runs (no flag needed) | N/A | ~5 min |

E2E tests run after lint/tsc/build/unit/integration checks pass. The dev server is managed automatically via tmux (local) or webServer (CI).

---

## Test Configuration

| Aspect | Unit | Integration | E2E |
|--------|------|-------------|-----|
| **Config** | `jest.config.js` | `jest.integration.config.js` | `playwright.config.ts` |
| **Mock cleanup** | `clearMocks` + `restoreMocks` | `clearMocks` + `restoreMocks` | N/A |
| **Database** | Mocked | Real (service role) | Real (anon key) |
| **OpenAI** | Mocked | Mocked | Mocked via routes |
| **Pinecone** | Mocked | Mocked | Real |
| **Execution** | Parallel | Sequential (maxWorkers: 1) | Parallel (2 workers) |
| **Timeouts** | 5s | 30s | 60s (CI) / 30s (local) |
| **Retries** | 0 | 0 | 2 in CI |

### Local vs CI Execution

| Aspect | Local | CI |
|--------|-------|-----|
| **Unit tests** | Same behavior | `--maxWorkers=2` |
| **Integration** | Same behavior | Same behavior |
| **E2E server** | `npm run dev` (HMR, strict mode) | `npm run build && npm start` |
| **E2E retries** | 0 | 2 |
| **E2E timeout** | 30s test / 10s expect | 60s test / 20s expect |
| **E2E mode** | `E2E_TEST_MODE` via env | `E2E_TEST_MODE` inline at runtime |
| **React strict mode** | Active (double-mount in dev) | Inactive (production build) |

> **React Strict Mode Warning:** Local E2E tests run against `npm run dev` which enables React strict mode. This causes components to mount → unmount → remount on every render. Hooks using `useRef` to track mount state (e.g., `isMountedRef`) must reset to `true` in the effect setup, not just set `false` in cleanup. Pattern: `useEffect(() => { ref.current = true; return () => { ref.current = false; }; }, [])`. Without the setup reset, the ref stays `false` after the simulated unmount/remount, causing async callbacks to silently bail out.

---

## GitHub Actions (CI/CD)

### CI Workflow (`ci.yml`)

**Trigger:** Pull requests to `main` or `production`

**Change Detection (Fast Path vs Full Path):**

The CI workflow detects what files changed to optimize costs:

| Path | Trigger | Jobs Run |
|------|---------|----------|
| **Fast** | Only docs/migrations changed (no `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`) | lint + tsc only (~1 min) |
| **Full** | Any code file changed | All tests (~2.5-3 min) |

**Full Path Pipeline:**
```
detect-changes → typecheck + lint (parallel)
                      ↓
              unit tests (affected only)
                      ↓
     integration-critical + e2e-critical (parallel)
```

**Test Behavior by Target Branch:**

| Target Branch | Integration | E2E | Sharding |
|---------------|------------|-----|----------|
| `main` | Critical (5 tests) | Critical (`@critical` tagged) | None |
| `production` | Full (26 tests) | Full (all tests) | 4 shards |

**Key Optimizations:**
- Unit tests run only on affected files (`--changedSince`)
- Integration and E2E critical tests run in parallel
- Browser: Chromium only
- Fail strategy: fail-fast (stops on first failure)
- CI caches: Next.js build (`.next/cache`), tsc incremental (`tsbuildinfo`), Jest transforms, Playwright browsers

### Nightly Workflow (`e2e-nightly.yml`)

**Trigger:** Daily at 6 AM UTC (or manual dispatch)

**Behavior:**
- **YAML runs from `main`** (GitHub Actions cron behavior) but **checks out `production` branch** code via `actions/checkout@v4` with `ref: production`
- Full E2E test suite against live production URL (no sharding)
- **Browser matrix:** Chromium + Firefox
- **No E2E_TEST_MODE** - uses real AI, tests create real content (hence [TEST] prefix is critical)
- **`@skip-prod` filtering (belt-and-suspenders):** Tests tagged `@skip-prod` are excluded via both the CLI `--grep-invert="@skip-prod"` flag in the workflow AND the `grepInvert` config in `playwright.config.ts`. The CLI flag ensures filtering works regardless of which branch's config is checked out.
- **Blocking pre-flight audit:** Before running tests, a step verifies that all mock-dependent test files (AI suggestions, error tests) have `@skip-prod` tags. The step blocks the run if any are missing.
- **Fail strategy:** Continues on failure (tests all browsers)
- **Secrets:** Uses `environment: Production` secrets (production Supabase URL, test user credentials, Vercel bypass token)

### Post-Deploy Smoke Tests (`post-deploy-smoke.yml`)

**Trigger:** Vercel deployment completes successfully to Production

**Behavior:**
- Runs `@smoke` tagged E2E tests against the live production URL
- Uses **Production environment secrets** (separate from repository secrets)
- Health check before running tests
- Chromium only
- **Slack notification** on failure (if `SLACK_WEBHOOK_URL` is configured)

### Workflow Comparison

| Aspect | CI | Nightly | Post-Deploy Smoke |
|--------|-----|---------|-------------------|
| **Trigger** | PR to main/production | Daily 6 AM UTC | Vercel deploy success |
| **YAML source** | PR branch | main (cron behavior) | production |
| **Code checkout** | PR branch | production (`ref: production`) | production |
| **Test types** | Unit → Integration → E2E | E2E only | E2E `@smoke` only |
| **Target** | Local build | Live production URL | Live production URL |
| **Secrets** | Staging environment | Production environment | Production environment |
| **Browsers** | Chromium | Chromium + Firefox | Chromium |
| **E2E_TEST_MODE** | Yes (mocked SSE) | No (real AI) | No (real AI) |
| **@skip-prod** | N/A (isProduction=false) | CLI `--grep-invert` + config `grepInvert` | N/A (only @smoke runs) |

> **Note:** CI workflow builds and runs the app locally on the GitHub runner (`npm run build && npm start`). Nightly and Post-Deploy Smoke workflows test against the live production deployment (no local build).

> **Note:** The backup mirror repo (`alcmdbackup/explainanythingbackup`) receives code pushes from `/finalize` and `/mainToProd` but has no CI workflows enabled. It is an append-only code store, not a test target.

### Supabase Migrations Workflow (`supabase-migrations.yml`)

**Trigger:** Push to `main` with changes in `supabase/migrations/**`

Deploys migrations to Staging first, then Production. See [environments.md](environments.md#database-migrations) for details.

---

## GitHub Secrets

Secrets are organized using GitHub Environments for clear separation:

### Repository Secrets (Shared)

Available to all workflows - API keys that don't change between environments:

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | OpenAI API key |
| `PINECONE_API_KEY` | Pinecone API key |

### Staging Environment Secrets

Used by `ci.yml` with `environment: staging`:

| Secret | Value |
|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Dev Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Dev service role |
| `PINECONE_INDEX_NAME_ALL` | `explainanythingdevlarge` |
| `PINECONE_NAMESPACE` | `test` |
| `TEST_USER_EMAIL` | Dev test user email |
| `TEST_USER_PASSWORD` | Dev test user password |
| `TEST_USER_ID` | Dev test user UUID |

### Production Environment Secrets

Used by `e2e-nightly.yml` and `post-deploy-smoke.yml` with `environment: Production`:

| Secret | Value |
|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Prod Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Prod anon key |
| `TEST_USER_EMAIL` | Prod test user email |
| `TEST_USER_PASSWORD` | Prod test user password |
| `TEST_USER_ID` | Prod test user UUID |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Bypass Vercel deployment protection |
| `SLACK_WEBHOOK_URL` | Slack webhook for smoke test failure alerts (optional) |

> **Note:** Same secret names (`TEST_USER_*`) are used in both environments with different values. GitHub's environment override behavior ensures the correct credentials are used.

---

## Further Reading

- [testing_setup.md](../feature_deep_dives/testing_setup.md) - Detailed configuration, directory structure, mocking patterns, test utilities
- [environments.md](environments.md) - Database config, env vars, Vercel setup, observability
