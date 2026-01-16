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
Test creates explanation → trackExplanationForCleanup(id) → writes to /tmp/e2e-tracked-*.json
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
- **Unit**: 60+ colocated `.test.ts` files
- **ESM**: 1 file for AST diffing (bypasses Jest ESM limitations)
- **Integration**: 15 test files (14 in `src/__tests__/integration/` + 1 in `__tests__/integration/`)
  - **Critical**: 5 tests (auth-flow, explanation-generation, streaming-api, error-handling, vector-matching)
  - **Full**: All 15 tests
- **E2E**: 22 spec files in `__tests__/e2e/specs/`
  - **Critical**: 10 `@critical` tagged tests (run on PRs to main)
  - **Full**: 163 tests (run on PRs to production)

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

---

## Test Configuration

| Aspect | Unit | Integration | E2E |
|--------|------|-------------|-----|
| **Config** | `jest.config.js` | `jest.integration.config.js` | `playwright.config.ts` |
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
| **E2E server** | `npm run dev` (HMR) | `npm run build && npm start` |
| **E2E retries** | 0 | 2 |
| **E2E timeout** | 30s test / 10s expect | 60s test / 20s expect |
| **E2E mode** | `E2E_TEST_MODE` via env | `E2E_TEST_MODE` inline at runtime |

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
| `main` | Critical (5 tests) | Critical (10 tests) | None |
| `production` | Full (15 tests) | Full (163 tests) | 4 shards |

**Key Optimizations:**
- Unit tests run only on affected files (`--changedSince`)
- Integration and E2E critical tests run in parallel
- Browser: Chromium only
- Fail strategy: fail-fast (stops on first failure)

### Nightly Workflow (`e2e-nightly.yml`)

**Trigger:** Daily at 6 AM UTC (or manual dispatch)

**Behavior:**
- Runs on `main` branch
- Full E2E test suite (no sharding)
- **Browser matrix:** Chromium + Firefox
- **No E2E_TEST_MODE** - uses real AI, tests create real content (hence [TEST] prefix is critical)
- **Fail strategy:** Continues on failure (tests all browsers)

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
| **Branch** | PR branch | main | production |
| **Test types** | Unit → Integration → E2E | E2E only | E2E `@smoke` only |
| **Target** | Local build | Live production URL | Live production URL |
| **Secrets** | Development environment | Production environment | Production environment |
| **Browsers** | Chromium | Chromium + Firefox | Chromium |
| **E2E_TEST_MODE** | Yes (mocked SSE) | No (real AI) | No (real AI) |

> **Note:** CI workflow builds and runs the app locally on the GitHub runner (`npm run build && npm start`). Nightly and Post-Deploy Smoke workflows test against the live production deployment (no local build).

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

### Development Environment Secrets

Used by `ci.yml` and `e2e-nightly.yml` with `environment: Development`:

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

Used by `post-deploy-smoke.yml` with `environment: Production`:

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
