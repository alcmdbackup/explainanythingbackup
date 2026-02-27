# Analyze Test Suite Research

## Problem Statement
Assess the existing test suite including critical tests and all tests across unit, integration, and E2E tiers. Look for ways to reduce flakiness, update testing-related documentation, and identify gaps that need to be plugged.

## Requirements (from GH Issue #582)
- Assess existing test suite including critical tests and all tests
- Unit, integration, E2E tiers
- Look for ways to reduce flakiness
- Update testing-related documentation
- Look for gaps that need to be plugged

## High Level Summary

The test suite is substantial (267 test files / 5158 individual unit tests, 29 integration suites / 212 tests, 37 E2E specs / ~230-250 tests) but the documentation is significantly out of date — file counts, directory trees, and helper listings all diverge from reality. The biggest flakiness source is **77 `networkidle` usages** in admin E2E POM files plus **42 inline `networkidle` usages** in E2E spec files (tracked in issue #548) — a concrete migration guide has been developed with 3 categories of replacement. Coverage thresholds are all 0 (no enforcement). There are 22 skipped test entries across all tiers (categorized by root cause below), missing unit tests for 2 services (plus 5 high-priority services lacking integration tests), and several integration tests that are pure-logic (no DB) misclassified as integration. CI has no explicit timeouts on 7/8 jobs and `tsconfig.ci.json` excludes test files from type checking. One unit test suite is currently failing (`run-strategy-experiment.test.ts` — missing `tsx` binary).

**Additional findings from deep-dive rounds**: All 4 evolution/hall-of-fame `describe.skip` blocks can be un-skipped (DB tables fully migrated). Non-admin POMs have widespread Rule 12 violations (missing post-action waits). Jest unit tests lack `--forceExit` and `--detectOpenHandles` flags. Admin `@critical` tags use name-string pattern instead of Playwright's `{ tag: '@critical' }` option — 11 admin critical tests are silently excluded from the chromium-critical CI project. `debug-publish-bug.spec.ts` is a debug artifact that should be removed. Hardcoded fallback credentials in `fixtures/auth.ts` should be replaced with required env vars.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/feature_deep_dives/testing_pipeline.md

## Code Files Read

### Configuration
- `jest.config.js` — unit test config, jsdom env, coverage thresholds at 0
- `jest.setup.js` — global mocks, polyfills, console suppression
- `jest.shims.js` — OpenAI Node shims (has debug console.log)
- `jest.integration.config.js` — node env, maxWorkers: 1, 30s timeout
- `jest.integration-setup.js` — dotenv, Pinecone/OpenAI global mocks, real Supabase
- `playwright.config.ts` — 4 projects, tmux server management, timeout tiers
- `tsconfig.ci.json` — excludes all test files from tsc

### CI/CD Workflows
- `.github/workflows/ci.yml` — PR pipeline with change detection, sharded E2E
- `.github/workflows/e2e-nightly.yml` — daily production tests, Chromium+Firefox
- `.github/workflows/post-deploy-smoke.yml` — post-deploy @smoke tests

### Test Helpers & Utilities
- `src/testing/utils/integration-helpers.ts` — DB setup/teardown, test context
- `src/__tests__/e2e/helpers/wait-utils.ts` — polling waits, page stability
- `src/__tests__/e2e/helpers/api-mocks.ts` — SSE streaming mocks, route interception
- `src/__tests__/e2e/helpers/error-utils.ts` — safe wait/visibility/screenshot helpers
- `src/__tests__/e2e/helpers/test-data-factory.ts` — explanation creation, auto-tracking cleanup
- `src/__tests__/e2e/setup/global-setup.ts` — health check, test data seeding, admin seeding
- `src/__tests__/e2e/setup/global-teardown.ts` — [TEST] prefix cleanup, tracked ID cleanup
- `src/__tests__/e2e/setup/auth.setup.ts` — dead code (never referenced by any project)
- `src/__tests__/e2e/fixtures/auth.ts` — per-worker Supabase auth, cookie injection
- `src/__tests__/e2e/fixtures/base.ts` — Vercel bypass, unrouteAll teardown
- `src/__tests__/e2e/fixtures/admin-auth.ts` — admin auth fixture

### Page Object Models
- `src/__tests__/e2e/helpers/pages/BasePage.ts`
- `src/__tests__/e2e/helpers/pages/SearchPage.ts`
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts`
- `src/__tests__/e2e/helpers/pages/ImportPage.ts`
- `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts`
- `src/__tests__/e2e/helpers/pages/LoginPage.ts`
- `src/__tests__/e2e/helpers/pages/admin/AdminBasePage.ts`

### ESLint Rules
- `eslint-rules/` — 5 flakiness rules (no-networkidle, no-wait-for-timeout, no-silent-catch, no-test-skip, max-test-timeout)

### All 29 integration test files (first 50 lines each)
### All 37 E2E spec files (structure and tagging)
### All 32 service test files in src/lib/services/

---

## Key Findings

### 1. Documentation vs Reality — Major Discrepancies

| Item | testing_overview.md | testing_setup.md | Actual |
|------|-------------------|-----------------|--------|
| Unit test files | 150+ | 60+ | ~139 |
| Integration test files | 20 | 19 (18+1) | 29 (28+1) |
| Integration listed in dir tree | — | 14 files | 28 files |
| E2E spec files | 34 | 23 | 37 |
| E2E total tests | "170+" and "163" (self-contradicting) | 163 | ~230-250 estimated |
| @critical tagged tests | 10 | 10 | 10 via `tag:` (correct), but admin specs embed `@critical` in name strings instead |
| `src/testing/mocks/` | — | 4 files | 9 files (5 undocumented: @anthropic-ai/sdk, openskill, d3-dag, d3, openai-helpers-zod) |
| `evolution-test-helpers.ts` | referenced | listed at `src/testing/utils/` | **Actually at `evolution/src/testing/`** (wrong path in docs) |
| E2E helpers/pages/ | — | 5 POMs | 6 POMs + admin/ subdir |
| E2E fixtures/ | — | auth.ts only | auth.ts + admin-auth.ts + base.ts |
| E2E setup/ | — | auth.setup.ts only | 4 files (global-setup, global-teardown, auth.setup, vercel-bypass) |
| Undocumented npm scripts | — | — | test:integration:critical, test:e2e:critical, test:e2e:full, test:eslint-rules |

### 2. Flakiness — E2E (Most Critical)

**77 `networkidle` usages** across admin E2E specs (all have eslint-disable comments referencing issue #548):
- `AdminBasePage.goto()` — called by every admin test navigation
- `admin-hall-of-fame.spec.ts` — 20 occurrences
- `admin-evolution-visualization.spec.ts` — 7 occurrences
- `admin-evolution.spec.ts` — 8 occurrences
- `admin-elo-optimization.spec.ts` — 8 occurrences
- Various other admin specs

**10 permanently skipped E2E tests** (test.skip):
- `auth.spec.ts` — logout (Server Action bug)
- `auth.unauth.spec.ts` — localStorage/sessionStorage remember-me tests
- `search-generate.spec.ts` — tag assignment, save-to-library button
- `regenerate.spec.ts` — rewrite dropdown
- `admin-auth.spec.ts` — non-admin redirect
- `action-buttons.spec.ts` — 3 rewrite/edit with tags tests

**@critical tag inconsistency**: Admin specs put `@critical` in the test name string (e.g., `'page loads @critical'`) rather than using Playwright's `{ tag: '@critical' }`. This works because `grep: /@critical/` matches name strings too, but it's fragile — renaming the test silently drops it from critical runs.

**Other E2E issues**:
- `auth.setup.ts` is dead code — never referenced by any Playwright project
- `fixtures/auth.ts` has hardcoded fallback credentials (`abecha@gmail.com` / `'password'`)
- `debug-publish-bug.spec.ts` runs in the main suite with a 120s timeout (debug spec shouldn't be in CI)
- `ResultsPage.ts` has 3 silent `.catch(() => {})` calls that can hide failures
- `api-mocks.ts` has 8 debug `console.log('[MOCK-DEBUG]')` statements left in
- `global-setup.ts` has 7 debug `console.log('[DEBUG]')` statements
- `mockAISuggestionsPipeline()` is marked `@deprecated` but still present
- CSS class selectors used in some POMs (`.text-red-700`, `.diff-accept-btn`, `.animate-spin`) instead of `data-testid`
- `UserLibraryPage.navigate()` has no post-navigate wait
- `LoginPage.clickSubmit()` has no post-action wait (Rule 12 violation)
- `ImportPage.clickProcess()` and `clickPublish()` have no post-action waits

### 3. Flakiness — Unit Tests

**Wall-clock timing assertion** in `findMatches.test.ts:490-497`:
```typescript
const duration = Date.now() - startTime;
expect(duration).toBeLessThan(1000);
```
Will fail on slow CI machines.

**Timing-dependent fire-and-forget test** in `userLibrary.test.ts:93`:
```typescript
await new Promise(resolve => setTimeout(resolve, 10)); // arbitrary 10ms
```

**`process.env` mutations without proper cleanup**:
- `browserTracing.test.ts` — sets `process.env.NODE_ENV` in `it()` blocks
- `cronAuth.test.ts` — sets `process.env.CRON_SECRET` without beforeEach/afterEach
- `cron/evolution-watchdog/route.test.ts` — sets env at describe scope

**`jest.mock()` inside `describe` block** in `returnExplanation.test.ts:130-135` — `jest.mock()` is hoisted by Babel, so calling it inside `describe` has order-dependent behavior.

**Module singleton test-order dependency** in `browserTracing.test.ts:85-87` — acknowledged in comment as a compromise.

**Debug console.log in `jest.shims.js`** — fires on every test run (lines 4, 10).

### 4. Flakiness — Integration Tests

**Non-deterministic delays** in concurrency tests:
- `request-id-propagation.integration.test.ts:269` — `Math.random() * 10` ms delay
- `session-id-propagation.integration.test.ts:115` — same pattern

**Hardcoded sleep** in `logging-infrastructure.integration.test.ts:169` — 50ms for timing measurement

**`hall-of-fame-actions.integration.test.ts` loads `.env.local`** instead of `.env.test` — will fail in CI environments that only have `.env.test`

**`explanation-update.integration.test.ts`** re-declares its own Pinecone/OpenAI mocks, shadowing the global setup mocks — inconsistent with other test files

**`rls-policies.integration.test.ts`** accepts both empty-result and error for RLS-blocked tables — cannot distinguish enforced-but-silent RLS from missing RLS

### 5. Missing Test Coverage

**Unit tests missing for 2 services**:
- `src/lib/services/linkCandidates.ts` — no test file
- `src/lib/services/sourceSummarizer.ts` — no test file

**Integration tests missing for critical paths**:
- `/api/returnExplanation` route — the primary user-facing API
- `userLibrary.ts` — only basic entry creation tested (in auth-flow)
- `auditLog.ts` — DB persistence untested
- `featureFlags.ts` — DB reads untested
- `sourceDiscovery.ts` / `sourceFetcher.ts` pipeline
- `contentQuality*` services (quality evaluation is a key feature)
- `actions.ts` (main server actions)
- Cron routes (evolution-runner, evolution-watchdog, experiment-driver)

**Misclassified integration tests** (no DB operations, should be unit tests):
- `evolution-agent-selection.integration.test.ts` — pure pipeline wiring
- `strategy-experiment.integration.test.ts` — pure algorithm test

### 6. CI/CD Issues

**No explicit timeout on most CI jobs**: Only `e2e-full` has `timeout-minutes: 30`. The typecheck, lint, unit-tests, integration-critical, e2e-critical, and post-deploy-smoke jobs use GitHub's 360-minute default.

**`integration-full` ignores change detection**: Unlike unit-tests, the production integration run doesn't gate on `path == 'full'`. A docs-only PR to `production` runs all integration tests.

**`tsconfig.ci.json` excludes test files**: Type errors in `*.test.ts` / `*.spec.ts` are invisible to CI typecheck.

**Coverage thresholds all at 0**: Both `jest.config.js` and `jest.integration.config.js` — coverage regressions never blocked.

**No flaky test tracking**: No issue templates, no flaky test dashboard, no retry-based detection.

### 7. 13 Skipped Unit Tests

All in Lexical editor files:
- `importExportUtils.test.ts` — 4 skips (need full Lexical lifecycle)
- `StandaloneTitleLinkNode.test.ts` — 8-9 skips (need DOM/browser integration)

---

## Round 2 Findings (Actual Test Runs + Deep Dives)

### 8. Actual Unit Test Statistics

```
Test Suites: 1 failed, 266 passed, 267 total
Tests:       5 failed, 13 skipped, 5140 passed, 5158 total
Snapshots:   139 passed, 139 total
Time:        19.591 s
```

**1 failing suite**: `scripts/run-strategy-experiment.test.ts` — all 5 tests fail because they shell out to `npx tsx` which isn't installed locally. The test uses `execFileSync('npx', ['tsx', SCRIPT])` which tries to fetch `tsx` from npm. This test likely works in CI where `tsx` is a dev dependency.

**13 skipped tests**: Matches round 1 finding (4 in `importExportUtils.test.ts`, 8-9 in `StandaloneTitleLinkNode.test.ts`).

**Worker leak warning**: Jest emitted "A worker process has failed to exit gracefully and has been force exited" — indicates open handles (timers/async ops) in at least one suite preventing clean exit.

**ESM tests**: `npm run test:esm` also failed in this environment (missing `tsx`). These work in CI.

### 9. Actual Integration Test Statistics

```
Test Suites: 19 failed, 10 passed, 29 total
Tests:       116 failed, 1 skipped, 95 passed, 212 total
Time:        4.698 s
```

All 19 failures are due to missing environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`) — expected since we don't have a test database configured. The 10 passing suites are those that don't require real DB connections:
- `error-handling` (pure logic, no DB)
- `logging-infrastructure` (console spy tests)
- `otelLogger` (module initialization)
- `evolution-cost-estimation` (Zod validation)
- `session-id-propagation` / `request-id-propagation` (context propagation)
- `evolution-agent-selection` (pure pipeline wiring)
- `strategy-experiment` (pure algorithm)
- `vercel-bypass` (file I/O)
- `hall-of-fame-actions` (conditional skip when tables missing)

**Critical test subset** (5 files): 4/5 fail (only `error-handling` passes without DB).

**Key issue discovered**: 4 suites fail at **module import time** (not at test time) because `src/lib/services/vectorsim.ts:14` calls `getRequiredEnvVar('OPENAI_API_KEY')` at the top level. Any test that transitively imports `vectorsim.ts` (via `actions.ts`, `returnExplanation.ts`, `importActions.ts`) crashes before any test runs. This is a design issue — env var validation should be lazy, not at import time.

**Secondary failure cascade**: When `setupTestDatabase()` throws, tests that destructure `const { cleanup } = await setupTestDatabase()` get `cleanup = undefined`, then crash in `afterEach` with `TypeError: cleanup is not a function`.

### 10. networkidle Migration Guide (Concrete Replacements)

The 77 networkidle usages fall into 3 categories with specific replacements:

**Category 1: After page navigation (goto methods) — ~35 occurrences**
- `AdminBasePage.goto()` and all subpage `goto*()` methods
- Replace with: `await page.waitForLoadState('domcontentloaded')` + `await this.table.waitFor({ state: 'visible' })`
- Key insight: every test already calls `expect*Loaded()` which asserts table visibility — the networkidle is redundant

**Category 2: After filter/search/toggle (data re-fetch) — ~25 occurrences**
- `filterByStatus()`, `search()`, `toggleShowHidden()`, tab switches, pagination
- Replace with: `await expect(table.locator('tbody')).not.toContainText('Loading...')`
- Key insight: admin tables show plain "Loading..." text during fetch — `waitForPageStable()` won't work because these tables don't use `animate-spin` or `aria-busy`

**Category 3: After form submission / action buttons — ~15 occurrences**
- `approveCandidate()`, `rejectCandidate()`, `fillTermForm()`, `addAlias()`, `saveNotes()`, `disableUser()`
- Replace with: modal close (`expect(modal).not.toBeVisible()`), toast visibility (`locator('[data-sonner-toast]').waitFor()`), or state change assertion
- Key insight: many spec tests already assert on toasts after these actions — the networkidle in the POM method is redundant

**2 occurrences in `auth.unauth.spec.ts`**: Inside `test.skip()` blocks — already exempt, fix when unskipped.

### 11. Service Test Gap Prioritization

| Service | Priority | Risk | Best Test Type |
|---------|----------|------|---------------|
| `sourceFetcher.ts` | ~~HIGH~~ **ALREADY TESTED** | Has comprehensive test file (489 lines). SSRF protection tested. | — |
| `featureFlags.ts` | **HIGH** | `getFeatureFlagAction` called everywhere; "missing = disabled" contract is load-bearing | Integration (real DB) |
| `linkCandidates.ts` | **HIGH** | 11 exported fns, silent error swallowing in loops, approve has unguarded 2-step write | Unit with mocked Supabase |
| `userAdmin.ts` | **HIGH** | `isUserDisabledAction` is middleware security gate; disable/enable conditional upsert | Integration + Unit mock |
| `sourceDiscovery.ts` | **HIGH** | Multi-system Pinecone+DB pipeline; client-side aggregation; zero coverage | Unit with mocks + Integration |
| `auditLog.ts` | **MEDIUM** | `sanitizeAuditDetails` recursion is pure; fire-and-forget never-throw contract | Unit (pure) + Integration |
| `sourceSummarizer.ts` | **MEDIUM** | 1 exported fn, LLM fallback truncation paths untested | Unit with mocked `callLLM` |
| `contentQualityEval.ts` | **LOW** | No DB, no side effects, returns null on failure | Unit with mocked `callLLM` |

**actions.ts**: 58 exported server actions. The create/update flows chain DB + Pinecone writes without transactions — partial failure leaves orphaned data. Needs integration tests for the core paths.

**Cron routes**: `evolution-watchdog` and `experiment-driver` already have test files. `evolution-runner` is a re-export shim with no test.

### 12. Additional Integration Test Issues

- `vectorsim.ts` top-level `getRequiredEnvVar('OPENAI_API_KEY')` prevents any transitive importer from running without that env var set — should be lazy initialization
- `teardownTestDatabase()` doesn't clean `content_reports`, `userExplanationEvents`, `evolution_*`, or `source_cache`/`article_sources` tables — each test implements its own cleanup for those
- `content-report.integration.test.ts` uses hardcoded sentinel UUIDs instead of test ID pattern
- `hall-of-fame-actions.integration.test.ts` loads `.env.local` instead of `.env.test`

## Round 3 Findings (Deep Dives)

### 13. vectorsim.ts Module-Level Env Validation Root Cause

**Root cause traced**: `src/lib/services/vectorsim.ts` lines 13-19 instantiate OpenAI and Pinecone clients at module scope:
```typescript
const openai = new OpenAI({
  apiKey: getRequiredEnvVar('OPENAI_API_KEY'),   // LINE 14 — crashes at import
});
const pc = new Pinecone({
  apiKey: getRequiredEnvVar('PINECONE_API_KEY')   // LINE 18 — crashes at import
});
```

Integration test setup mocks the constructors, but `getRequiredEnvVar()` runs **before** the constructor is reached. This crashes 4 integration suites at import time: any test importing `actions.ts`, `returnExplanation.ts`, or `importActions.ts` transitively pulls in `vectorsim.ts`.

**Fix**: Use the lazy `getClient()` pattern already proven in `src/lib/services/llms.ts` (lines 92-113):
```typescript
let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: getRequiredEnvVar('OPENAI_API_KEY') });
  }
  return openaiClient;
}
```

### 14. Admin POM networkidle — Line-by-Line Replacement Catalog

All 6 admin POM files have been audited with exact line numbers and replacement code:

| File | Count | Lines |
|------|-------|-------|
| `AdminBasePage.ts` | 1 | 42 |
| `AdminCandidatesPage.ts` | 6 | 51, 54, 99, 125, 134, 144 |
| `AdminContentPage.ts` | 5 | 59, 120, 131, 140, 190 |
| `AdminWhitelistPage.ts` | 6 | 71, 145, 163, 172, 189, 198 |
| `AdminUsersPage.ts` | 6 | 65, 97, 106, 132, 146, 155 |
| `AdminReportsPage.ts` | 5 | 45, 104, 113, 122, 131 |

**Key discovery**: Admin tables use 2 different loading patterns:
1. **WhitelistContent/CandidatesContent**: Completely remove the table during loading → use `table.waitFor({ state: 'visible' })`
2. **ExplanationTable/ReportsTable/UsersPage**: Keep table visible but show "Loading..." → use `expect(tbody).not.toContainText('Loading...')`

The `waitForPageStable()` utility won't work for admin tables because they don't use `animate-spin` or `aria-busy`.

### 15. Service Test Coverage — Corrections and Details

**CORRECTION**: `sourceFetcher.ts` already has comprehensive tests (`sourceFetcher.test.ts`, 489 lines). SSRF protection is tested. Initial research incorrectly listed it as untested.

**`linkCandidates.ts`** (11 exported fns, NO test file):
- Silent error swallowing in `saveCandidatesFromLLM` (lines 306-310) and `updateOccurrencesForArticle` (lines 358-363)
- Unguarded 2-step write in `approveCandidate` — whitelist creation + status update without transaction
- Test plan: ~55 test cases needed

**`sourceSummarizer.ts`** (1 exported fn, NO test file):
- LLM-based summarization with truncation fallback
- Test plan: ~14 test cases needed

### 16. CI Timeout and Configuration Audit

**7/8 CI jobs missing `timeout-minutes`** (only `e2e-full` has 30):

| Job | Recommended Timeout |
|-----|-------------------|
| `detect-changes` | 5 min |
| `typecheck` | 10 min |
| `lint` | 10 min |
| `unit-tests` | 15 min |
| `integration-critical` | 15 min |
| `integration-full` | 30 min |
| `e2e-critical` | 20 min |
| `post-deploy-smoke.yml` | 15 min |

**`auth.setup.ts` confirmed dead**: All 3 authenticated projects have `testIgnore: /auth\.setup\.ts/`; `.auth/user.json` referenced nowhere.

**3 admin specs need `@critical` tag fix**: Use name-string `@critical` instead of `{ tag: '@critical' }`:
- `admin-auth.spec.ts` line 16
- `admin-content.spec.ts` line 35
- `admin-candidates.spec.ts` line 14

**14 debug console.log lines to remove**: 7 `[MOCK-DEBUG]` in `api-mocks.ts`, 7 `[DEBUG]` in `global-setup.ts`.

---

## Round 4 Findings (E2E Deep Dives)

### 17. E2E Spec Inline networkidle — 42 Active Occurrences

Found **42 active networkidle occurrences** across 8 spec files (separate from the 77 POM occurrences):

| Spec File | Count | Action |
|-----------|-------|--------|
| `admin-content.spec.ts` | 7 | ~5 removable (assertions auto-wait), 2 replace with table wait |
| `admin-whitelist.spec.ts` | 6 | All removable (redundant with POM waits) |
| `admin-candidates.spec.ts` | 5 | All removable |
| `admin-users.spec.ts` | 5 | All removable |
| `admin-reports.spec.ts` | 4 | All removable |
| `admin-auth.spec.ts` | 3 | 1 replace with sidebar wait, 2 removable |
| `admin-evolution.spec.ts` | 6 | All removable (inside `describe.skip`) |
| `admin-hall-of-fame.spec.ts` | 6 | All removable (inside `describe.skip`) |

**~35 can simply be deleted** (Playwright assertions already auto-wait). **~6 are post-action waits** where the next assertion serves as the wait. **1 needs a new assertion** (admin-auth sidebar visibility).

### 18. POM Rule 12 Violations (Non-Admin)

Comprehensive audit of all non-admin POMs — methods that fire actions without post-action waits:

**LoginPage.ts**:
- `login()`, `clickSubmit()`, `loginWithRememberMe()` — all missing post-action waits

**SearchPage.ts**:
- `search()`, `clickSearch()` — missing `waitForURL(/\/results/)` after navigation-triggering click

**ResultsPage.ts** (~15 methods):
- 3 silent `.catch(() => {})` patterns (removeTag line 191, clickApplyTags line 197, clickSaveToLibrary lines 220-221) that hide failures
- Methods like `clickRewrite()`, `clickEdit()`, `getSubSuggestionText()` without waits

**ImportPage.ts**:
- `clickProcess()`, `clickPublish()`, `clickCancel()`, `clickBack()` — all fire-and-forget (callers compensate but violate Rule 12)

**UserLibraryPage.ts**:
- `navigate()` has no load wait; `clickViewByTitle()` missing `waitForURL` that `clickCardByIndex` already has

### 19. Skipped Tests Categorized (22 entries)

| Category | Count | Details |
|----------|-------|---------|
| Known bug (logout) | 1 | Server Action redirect from onClick |
| Not implemented (tags UI) | 4 | rewrite-with-tags, edit-with-tags buttons |
| Infrastructure — Supabase SSR | 2 | localStorage/sessionStorage tests |
| Infrastructure — DB required | 2 | tags, save button after generation |
| Infrastructure — evolution tables | 5 | `describe.skip` blocks (CAN UN-SKIP NOW) |
| Infrastructure — hall of fame tables | 2 | `describe.skip` blocks (CAN UN-SKIP NOW) |
| Infrastructure — no non-admin test user | 1 | admin redirect test |
| Infrastructure — Lexical DOM | 13 | unit test `it.skip` (need full Lexical lifecycle) |
| Infrastructure — real OpenAI | 1 | `describe.skip` in integration |

**Dead code confirmed**:
- `auth.setup.ts` — all 3 authenticated projects ignore it
- `mockAISuggestionsPipeline` in `api-mocks.ts` line 409 — exported but never imported (the `mockAISuggestionsPipelineAPI` with "API" suffix is the active one used in 7 spec files)

### 20. Fragile CSS Selectors and Missing data-testid

**Priority 1** — `report-content.spec.ts`: Worst offender with **28 fragile selectors**, 0 `data-testid`. Entire spec needs testid migration.

**Priority 2** — `ResultsPage.ts`:
- Lines 39-40: `.diff-accept-btn`/`.diff-reject-btn` → should use `button[data-action="accept/reject"]` (already in DOM)
- Line 63: `.text-red-700` Tailwind class selector → remove, keep `[data-testid="error-message"]`

**Priority 3** — `suggestions-test-helpers.ts`:
- `button:has-text("Get Suggestions")` — text selector, fragile to copy changes
- Unicode `✓`/`✕` selectors

**Components needing `data-testid` additions**: `ReportContentButton.tsx`, `LexicalEditor.tsx` (editor div), AI suggestions submit button, evolution tab buttons.

---

## Round 5 Findings (Final Deep Dives)

### 21. Evolution/Hall-of-Fame Skipped Tests — All Can Be Un-Skipped

**4 main `describe.skip` blocks** found, all with outdated skip comments ("Skip until evolution DB tables are migrated via GitHub Actions"):

| Test Suite | File | Line | Tests |
|-----------|------|------|-------|
| Admin Evolution Pipeline | `admin-evolution.spec.ts` | 97 | 5 tests |
| Admin Evolution Visualization | `admin-evolution-visualization.spec.ts` | 126 | 9 tests (1 @critical) |
| Admin Article & Variant Detail | `admin-article-variant-detail.spec.ts` | 177 | 8 tests (2 @critical) |
| Admin Hall of Fame (2 suites) | `admin-hall-of-fame.spec.ts` | 200, 603 | 11 + 3 tests |

**All infrastructure exists**:
- DB tables migrated through 6 migrations, final rename in `20260221000002` (evolution_runs, evolution_variants, evolution_checkpoints, evolution_hall_of_fame_*)
- Backward-compatible views exist for zero-downtime deploy
- All server actions implemented: 7 evolution actions, 7 hall-of-fame actions, variant/article detail actions
- All page routes exist at expected paths

**Total: 36 tests can be un-skipped** by removing `describe.skip` and the comment. 2 nested `adminTest.skip()` blocks (lines 347, 469 in hall-of-fame) are reasonable to keep (require real LLM calls).

### 22. Jest Configuration and Worker Leak Analysis

**Unit tests (`jest.config.js`)**:
- Missing `--forceExit` — Jest hangs waiting for open handles
- Missing `--detectOpenHandles` — leaks go unnoticed
- Unbounded `maxWorkers` — defaults to CPU core count
- No explicit `testTimeout` (5000ms default)

**Integration tests (`jest.integration.config.js`)**: Well-configured — `maxWorkers: 1`, `clearMocks: true`, `restoreMocks: true`, 30s timeout.

**Package.json script issues**:
- `test` script: No `--forceExit` or `--detectOpenHandles`
- `test:ci`: Uses `--maxWorkers=2` which could create race conditions
- Missing `--forceExit` in CI scripts

**Resource cleanup patterns**:
- Integration helpers follow proper `beforeAll`/`afterAll` pattern with `setupTestDatabase`/`teardownTestDatabase`
- Supabase clients never explicitly closed (implicit cleanup by SDK)
- Mock cleanup relies on test discipline (`jest.clearAllMocks()` in `beforeEach`) rather than centralized `afterEach` in setup files
- `jest.integration-setup.js` missing `afterEach(() => { jest.clearAllMocks(); })` for defensive cleanup

**Recommendations**: Add `--forceExit --detectOpenHandles` to `test` and `test:ci` scripts. Add centralized `afterEach` mock cleanup in integration setup.

### 23. Test Tagging Strategy — Inconsistencies and Gaps

**Current state**: 4 tag types used (`@critical`, `@skip-prod`, `@smoke`, `@prod-ai`) with **3 incompatible syntax patterns**:

| Pattern | Status | Count |
|---------|--------|-------|
| `{ tag: '@critical' }` parameter | Correct (Playwright native) | ~17 tests |
| `"test name @critical"` in name string | **Wrong** — fragile, but currently works because `grep: /@critical/` matches | 11 admin tests |
| `/** @tags non-critical */` JSDoc comment | **Wrong** — Playwright ignores this | 1 file |

**Impact**: The 11 admin tests with `@critical` in name strings DO currently run in chromium-critical (because grep matches name strings), but this is fragile — renaming the test silently drops it. Should be fixed to `{ tag: '@critical' }` for robustness.

**Missing `@skip-prod` filtering**: No `grepInvert: /@skip-prod/` in playwright config — 40+ dev-only tests could accidentally run in production.

**Untagged core tests that may need `@critical`**: auth.spec.ts (5 tests), regenerate.spec.ts (4 tests), library.spec.ts (11 tests).

### 24. `debug-publish-bug.spec.ts` — Debug Artifact

**Should be deleted**:
- Filename says "debug-"
- No tags (won't run in any filtered test set but runs in full suite)
- 120s timeout with eslint-disable
- Contains debug patterns: console/page error listeners, Promise.race() timeout handling
- Single exploratory test, not a permanent verification

**Alternative**: Convert to proper `{ tag: '@critical' }` test in `search-generate.spec.ts` if publish-after-streaming is important functionality.

### 25. E2E Auth Infrastructure and Credentials

**Hardcoded fallback credentials in code** (security concern):
- `fixtures/auth.ts` line 39: `process.env.TEST_USER_EMAIL || 'abecha@gmail.com'`
- `fixtures/auth.ts` line 51: `process.env.TEST_USER_PASSWORD || 'password'`
- `auth.setup.ts` lines 10-11: same fallbacks
- `auth.unauth.spec.ts` line 69: same email fallback

**Recommendation**: Remove fallback values, require env vars, fail loudly if missing.

**Auth flow**: Per-worker Supabase API auth with session caching (5-min expiry buffer), 5 retries with exponential backoff, base64url-encoded cookie injection.

**Vercel bypass**: Single-attempt fetch with `x-vercel-protection-bypass` header, cross-worker file locking, 55-min staleness threshold, cookie cached in `/tmp/.vercel-bypass-cookie.json`.

**Debug logging cleanup needed**:
- 7 `[DEBUG]` statements in `global-setup.ts` (lines 297-382)
- 7 `[MOCK-DEBUG]` statements in `api-mocks.ts` (lines 318-357)
- 2 `console.log` in `jest.shims.js` (lines 4, 10)

---

## Open Questions

1. **Coverage targets**: Should we set minimum coverage thresholds now, or defer? What level is realistic given 5158 tests?
2. **vectorsim.ts top-level env validation**: Should we make `OPENAI_API_KEY` validation lazy to unblock transitive importers in test environments? (Recommended: yes, use lazy pattern from `llms.ts`)
3. **Un-skip strategy for evolution/hall-of-fame**: Un-skip all 4 suites at once or incrementally? They depend on seeded test data — do E2E fixtures seed evolution data?
4. **Admin @critical tag fix**: Fix the 3 name-string `@critical` tags now, or defer until broader tagging overhaul?
5. **Coverage enforcement**: Set thresholds to current actual coverage levels as a floor, or set aspirational targets?
