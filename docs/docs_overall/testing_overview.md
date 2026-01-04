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
- **Integration**: 11 test files in `__tests__/integration/`
- **E2E**: 17 spec files in `__tests__/e2e/specs/` (including 6 AI suggestions specs)

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

**Pipeline:**
```
typecheck → lint → unit tests → integration tests → E2E tests
```

**E2E Behavior by Target Branch:**

| Target Branch | E2E Scope | Tests | Sharding |
|---------------|-----------|-------|----------|
| `main` | Critical only | ~36 `@critical` tagged | None |
| `production` | Full suite | All tests | 4 shards |

- **Browser:** Chromium only
- **Fail strategy:** fail-fast (stops on first failure)

### Nightly Workflow (`e2e-nightly.yml`)

**Trigger:** Daily at 6 AM UTC (or manual dispatch)

**Behavior:**
- Runs on `main` branch
- Full E2E test suite (no sharding)
- **Browser matrix:** Chromium + Firefox
- `E2E_TEST_MODE=true` for SSE streaming compatibility
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
| **Target** | Local build | Local build | Live production URL |
| **Secrets** | Repository (dev) | Repository (dev) | Production environment |
| **Browsers** | Chromium | Chromium + Firefox | Chromium |

> **Note:** CI and Nightly workflows build and run the app locally on the GitHub runner (`npm run build && npm start`). They do NOT test against any deployed environment. Only the Post-Deploy Smoke workflow tests against a live deployment.

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
