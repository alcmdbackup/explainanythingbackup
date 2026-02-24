# Fix Flaky Production Tests Research

## Problem Statement
When merging main to production via Release PRs, E2E tests frequently fail, requiring multiple CI re-runs before the same code passes. This wastes time and blocks production deployments.

## Requirements (from GH Issue #548)
I want to fix flaky production tests as well as get recommendations on how to make them more reliable and faster going forward.

## High Level Summary

Production deploy PRs trigger the **full E2E test suite** (163 tests across 4 shards), unlike PRs to main which only run critical tests (10 tests, no sharding). The full suite exposes flakiness that critical-only runs mask.

**Key finding:** The `deploy/main-to-production-feb23` PR required **5+ CI attempts** before passing. The `deploy/main-to-production-feb22` PR required **7+ attempts**. Same code, no changes between runs — pure flakiness.

### Failure Pattern (last 9 failed production CI runs)

| Run ID | Failed Jobs | Failed Tests | Flaky Tests | Passed |
|--------|-------------|--------------|-------------|--------|
| 22337961464 | Shard 1/4 | 2 (hidden-content) | 1 (home-tabs) | 58 |
| 22337522825 | Shard 1/4 | 2 | 0 | 59 |
| 22328513663 | Shard 1/4 | 2 (action-buttons) | 1 (home-tabs) | 56 |
| 22325295078 | Shard 1/4, 2/4 | 2 (tags) | 2 | 68 |
| 22323964163 | Shard 1/4 | 2 (action-buttons, library) | 2 | 52 |
| 22322740895 | Integration, Shard 1/4 | integration + e2e | 0 | - |
| 22319751236 | Shard 1/4, 3/4 | 1 (add-sources) + shard 1 | 0 | 26 |
| 22310699482 | Shard 1/4, 3/4 | 5 (mixed) | 1 | 49 |
| 22270056436 | Shard 1/4 | 3 (action-buttons, rewrite) | 1 | 50 |

**Shard 1/4 fails in 9/9 runs.** Other shards fail occasionally.

### Top Failing Test Files (by frequency)

1. **`hidden-content.spec.ts`** — Fails consistently (not flaky, genuinely broken)
2. **`action-buttons.spec.ts`** — Fails in ~50% of runs (markdown/plaintext toggle, save state)
3. **`home-tabs.spec.ts`** — Flaky in ~40% of runs (search submit timeout)
4. **`tags.spec.ts`** — Fails in ~30% of runs (input interaction, state after refresh)
5. **`library.spec.ts`** — Fails in ~25% of runs (card click navigation, events)
6. **`add-sources.spec.ts`** — Fails in ~20% of runs (failed source fetch)
7. **`rewrite.spec.ts`** — Fails in ~15% of runs (selection before submission)
8. **`suggestions.spec.ts`** — Flaky in ~15% of runs (AI suggestions pipeline)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — Documentation structure
- docs/docs_overall/architecture.md — System design, data flow, tech stack
- docs/docs_overall/project_workflow.md — Project execution workflow

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md — Testing rules, tiers, CI/CD workflows, sharding config
- docs/feature_deep_dives/testing_setup.md — Test configuration, directory structure, mocking patterns
- docs/docs_overall/environments.md — Environment configuration, secrets, workflow comparison
- docs/feature_deep_dives/error_handling.md — Error categorization, transient error handling

## Code Files Read

### Round 1
- `src/__tests__/e2e/specs/04-content-viewing/hidden-content.spec.ts` — Hidden content visibility tests
- `src/__tests__/e2e/specs/01-home/home-tabs.spec.ts` — Home page tabs, search submit
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` — Save, format toggle
- `src/__tests__/e2e/specs/04-content-viewing/tags.spec.ts` — Tag management
- `src/__tests__/e2e/specs/03-library/library.spec.ts` — User library
- `src/__tests__/e2e/specs/08-sources/add-sources.spec.ts` — Source management
- `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` — AI suggestions
- `src/__tests__/e2e/helpers/api-mocks.ts` — SSE streaming mock implementation
- `src/__tests__/e2e/helpers/wait-utils.ts` — Wait strategies
- `src/__tests__/e2e/helpers/test-data-factory.ts` — Test data creation
- `src/__tests__/e2e/helpers/error-utils.ts` — Error handling utilities
- `.github/workflows/ci.yml` — CI workflow
- `playwright.config.ts` — Playwright configuration
- `jest.integration.config.js` — Integration test config

### Round 2
- `src/lib/services/explanations.ts` — Root cause of hidden-content bug (lines 79-95 missing `delete_status` filter)
- `supabase/migrations/20260117174000_update_rls_delete_status.sql` — RLS policy (correctly filters, but bypassed by server client)
- `src/__tests__/e2e/helpers/pages/ResultsPage.ts` — 733 lines, 15+ methods missing post-interaction waits
- `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` — Missing destination waits in navigation methods
- `src/__tests__/e2e/helpers/pages/BasePage.ts` — Minimal, `navigate()` only waits for `domcontentloaded`
- `src/__tests__/e2e/helpers/pages/ImportPage.ts` — Missing processing state waits
- `src/__tests__/e2e/setup/global-setup.ts` — Seeds test data, shared between shards, non-atomic file writes
- `src/__tests__/e2e/setup/global-teardown.ts` — Non-deterministic cleanup, silent error handling
- `src/__tests__/e2e/setup/auth.setup.ts` — Auth session caching per-worker not per-shard
- Admin Page Objects (AdminReportsPage, AdminWhitelistPage, AdminContentPage, etc.) — Heavy `networkidle` usage

## Key Findings

### 1. hidden-content.spec.ts — GENUINELY BROKEN (not flaky)

The test creates a `delete_status: 'hidden'` explanation, then checks that it's not visible in page source. **It fails every time** because:
- The test navigates to `/results?explanation_id=<id>`
- Next.js SSR fetches the explanation server-side (possibly bypassing RLS or the `delete_status` filter)
- The content appears in the HTML source even though it's "hidden"
- `expect(pageSource).not.toContain('This content should never be visible')` correctly catches this

**Fix:** Either fix the RLS policy to filter `delete_status='hidden'` for all queries, or fix the results page server component to check `delete_status` before rendering.

### 2. home-tabs.spec.ts — FLAKY (timing issues)

- Line 83-100: "should submit search on Enter key"
- Mock is registered before `goto` (correct), but `waitForURL(/\/results\?q=/, { timeout: 10000 })` is too short
- In CI, the build + start + navigation can be slow; 10s may not be enough
- The `waitForLoadState('domcontentloaded')` doesn't guarantee all event listeners are attached

**Fix:** Increase timeout or use `page.waitForURL` with longer timeout. Add explicit wait for search input to be interactive.

### 3. action-buttons.spec.ts — FLAKY (multiple timing issues)

- Format toggle tests assume instant mode switching — no waits between toggle click and assertion
- Save button tests don't wait for API response completion
- `waitForStreamingComplete()` with 60s timeout creates variability

**Fix:** Add explicit waits for UI state transitions after each action.

### 4. tags.spec.ts — FLAKY (race conditions)

- `removeTag(0)` doesn't wait for removal to complete
- Immediately waits for changes panel toggle which may not appear yet
- Page refresh test doesn't wait for content reload before checking tag count

**Fix:** Add waits after tag operations, verify UI state after refresh.

### 5. Test Infrastructure Issues

#### 5a. Shard 1/4 Overloaded
Shard 1/4 consistently fails. Possible causes:
- Shard 1 gets the heaviest/most complex tests (alphabetical assignment)
- Shard 1 runs first and is most affected by database seeding race conditions
- All shards write to the same database without isolation

#### 5b. Test Data Conflicts Between Shards
- `global-setup.ts` seeds test data with upsert logic
- 4 shards run simultaneously against the same database
- Topic names like `[E2E TEST] Hidden Content Topic` aren't unique per shard
- File writes to `/tmp/e2e-tracked-explanation-ids.json` aren't atomic

#### 5c. `waitForLoadState('networkidle')` Unreliable in CI
- Used in `hidden-content.spec.ts` and elsewhere
- `networkidle` can hang indefinitely or resolve prematurely in CI
- Should use custom stability checks instead

#### 5d. Integration Test Mock State Leakage
- `jest.integration.config.js` uses `clearMocks: true` but `restoreMocks: false`
- Mock implementations persist across tests
- `jest.clearAllMocks()` only clears call history, not implementations

### 6. CI Configuration Issues

- **`--max-failures=5`**: Stops shard early after 5 failures, leaving remaining tests unrun. Makes it look like "only 5 failed" when the real number could be higher.
- **Retry config**: Production PRs get 3 retries (good), but `isProduction` detection depends on `BASE_URL` check, not branch name
- **Build vs runtime E2E_TEST_MODE**: Build step doesn't have `E2E_TEST_MODE` but runtime does — could cause inconsistencies

## Round 2 Deep Dive Findings

### 7. Hidden-Content Root Cause — APPLICATION BUG CONFIRMED

**Root cause traced:** `src/lib/services/explanations.ts:79-95` — `getExplanationByIdImpl()` queries:
```ts
const { data: results, error } = await supabase
  .from('explanations')
  .select()
  .eq('id', id)
  .limit(1);
```

**Missing:** `.eq('delete_status', 'visible')` — compare with `getRecentExplanations()` at line 172 which correctly adds this filter.

The RLS policy in `supabase/migrations/20260117174000_update_rls_delete_status.sql` correctly filters `delete_status = 'visible' OR is_admin`, but the server-side client (used by SSR) likely bypasses RLS via the service role key.

**Fix:** Add `.eq('delete_status', 'visible')` to the query at line 87, matching the pattern in `getRecentExplanations()`.

### 8. Page Object Model — Missing Post-Interaction Waits

Analysis of POM files reveals 15+ methods that perform actions without waiting for completion:

**ResultsPage.ts (733 lines):**
- `clickSaveToLibrary()` — no wait for API response
- `clickRewriteButton()` — no wait for rewrite panel
- `clickApplyTags()` — no wait for tag save API call
- `removeTag(index)` — no wait for removal to complete (causes tags.spec.ts failures)

**UserLibraryPage.ts:**
- `clickCardByIndex()` — no wait for navigation destination (causes library.spec.ts failures)
- `searchFromLibrary()` — no wait for search results to load

**ImportPage.ts:**
- `clickProcess()` — no wait for processing state change
- `clickPublish()` — no wait for publish completion

**BasePage.ts:**
- `navigate()` — only waits for `domcontentloaded`, not for app hydration or interactive state

### 9. `networkidle` Usage — PERVASIVE (80+ instances)

`waitForLoadState('networkidle')` is used **80+ times** across the codebase, concentrated in:
- Admin Page Objects: AdminReportsPage (5), AdminWhitelistPage (6), AdminContentPage (5), AdminCandidatesPage (6), AdminUsersPage (6), AdminBasePage (1)
- Admin specs: admin-elo-optimization (8), admin-evolution (7), admin-hall-of-fame (18), admin-evolution-visualization (7), admin-content (2), admin-candidates (1)
- Other specs: hidden-content (2), import-articles (8), auth.unauth (2)

**Note:** `wait-utils.ts` already has a comment at line 46-47 saying `networkidle` should be replaced, and `SearchPage.ts` already avoids it. But adoption is incomplete.

### 10. Shard Distribution Analysis

35 spec files with 177 tests across 4 shards (Playwright assigns alphabetically by default):

- **Shard 1/4**: Gets `01-auth/`, `01-home/`, `02-search/`, `03-library/`, early `04-content-viewing/` — contains ALL of the top failing tests (hidden-content, action-buttons, tags, library, home-tabs)
- **Shard 2/4**: Gets remaining `04-content-viewing/`, `05-*/`, `06-ai-suggestions/`
- **Shard 3/4**: Gets `06-import/`, `07-*/`, `08-sources/`
- **Shard 4/4**: Gets `09-admin/` (admin tests are heavy but independently stable)

This explains why Shard 1/4 fails in 9/9 runs — it has the densest concentration of flaky + broken tests.

### 11. Global Setup/Teardown Issues

**global-setup.ts:**
- Seeds test data that all 4 shards share (e.g., `[E2E TEST] Hidden Content Topic`)
- Writes to shared `/tmp/e2e-tracked-explanation-ids.json` — non-atomic, last shard overwrites
- Server readiness check only hits `/api/health` — no database connectivity validation
- Each shard runs global-setup independently → race conditions on shared data

**global-teardown.ts:**
- Cleanup wraps all errors in try/catch with silent `console.error` — failures go unnoticed
- No retry logic for transient database errors during cleanup
- No Pinecone cleanup timeout

### 12. Integration Test Mock Leakage (confirmed)

`jest.integration.config.js:72-73`:
```js
clearMocks: true,      // Only clears call history (spy.calls, spy.results)
restoreMocks: false,   // Keeps mock implementations across tests!
```

`jest.clearAllMocks()` (which `clearMocks: true` triggers) does NOT restore original implementations. A `jest.spyOn(module, 'fn').mockReturnValue(...)` in test A will persist into test B.

**Fix:** Change to `restoreMocks: true` at line 73.

## Categorized Root Causes

### Category A: Application Bug (fix the app)
1. **`hidden-content.spec.ts`** — `getExplanationByIdImpl()` missing `.eq('delete_status', 'visible')` in `src/lib/services/explanations.ts:87`. This is a real bug the test correctly catches. Fix: one-line code change.

### Category B: Timing / Race Conditions (fix POM + test waits)
2. **`home-tabs.spec.ts`** — `waitForURL` timeout 10s too short for CI
3. **`action-buttons.spec.ts`** — No transition waits after format toggle, no API response waits for save
4. **`tags.spec.ts`** — `removeTag()` in POM doesn't wait for removal; page refresh test doesn't wait for reload
5. **`library.spec.ts`** — `clickCardByIndex()` in POM doesn't wait for navigation destination
6. **`add-sources.spec.ts`** — Source fetch timeout variability
7. **`suggestions.spec.ts`** — Input race conditions, mock setup timing

### Category C: Infrastructure (fix CI/test setup)
8. **Shard 1/4 overloaded** — Alphabetical assignment puts all top-failing tests (01-home, 03-library, 04-content-viewing) in shard 1
9. **Test data conflicts** — 4 shards share same DB, same test data names, non-atomic `/tmp` file writes
10. **`networkidle` unreliable** — 80+ instances across codebase; can hang indefinitely or resolve prematurely in CI
11. **Mock state leakage** — `restoreMocks: false` in `jest.integration.config.js:73` lets mock implementations persist between tests
12. **`--max-failures=5`** — Stops shard early, hides true failure count
13. **Global setup race conditions** — Each shard runs global-setup independently, last shard overwrites shared `/tmp` files
14. **Silent cleanup failures** — `global-teardown.ts` swallows all errors, cleanup failures go unnoticed

## Recommendations for Reliability

### Phase 1: Quick Wins (eliminate guaranteed failures)
1. **Fix `getExplanationByIdImpl()`** — Add `.eq('delete_status', 'visible')` at `src/lib/services/explanations.ts:87`. One-line fix eliminates 2 consistent failures per run.
2. **Remove `--max-failures=5`** from `.github/workflows/ci.yml:261` — Get accurate failure data.
3. **Fix integration test mock config** — Change `restoreMocks: false` to `true` at `jest.integration.config.js:73`. One-line fix.

### Phase 2: Timing Fixes (address race conditions in specific tests)
4. **Increase timeouts** for `waitForURL` in `home-tabs.spec.ts` (10s → 30s)
5. **Add waits in ResultsPage POM** — After `clickSaveToLibrary()`, `removeTag()`, `clickApplyTags()`
6. **Add waits in UserLibraryPage POM** — After `clickCardByIndex()`, `searchFromLibrary()`
7. **Add transition waits** in `action-buttons.spec.ts` after format toggle clicks

### Phase 3: Infrastructure (systemic reliability)
8. **Replace `networkidle` with custom waits** — Start with the 2 instances in `hidden-content.spec.ts`, then POM files, then admin pages (80+ total, batch over time)
9. **Rebalance shard distribution** — Configure Playwright `shard` to distribute test weight more evenly instead of alphabetical
10. **Add shard-specific test data prefixes** — e.g., `[E2E TEST S1] Hidden Content Topic` to avoid cross-shard conflicts
11. **Fix global-setup/teardown** — Make file writes atomic, add DB connectivity validation to health check, add retry logic to cleanup

### Phase 4: Long-Term Reliability
12. **Implement `waitForAppStable()` helper** — Checks no pending network requests, no loading indicators, hydration complete
13. **Enhance BasePage.navigate()** — Wait for hydration/interactive state, not just `domcontentloaded`
14. **Add E2E test quarantine** — Auto-skip tests that fail >3 times in a week, track in GitHub issues

## Open Questions
1. ~~Is the hidden-content SSR issue an application bug?~~ **RESOLVED**: Yes, it's a real bug — `getExplanationByIdImpl()` is missing the `delete_status` filter.
2. Should we reduce the full E2E suite for production PRs (e.g., run critical + recently-changed tests instead of all 163)?
3. Are the 95 skipped tests in nightly (from 190 total) intentional? That's 50% skip rate.
4. Should we move from 4 shards to fewer with more retries, or keep 4 shards with better isolation?
5. Should we replace `networkidle` in all 80+ instances at once, or batch by priority (failing tests first, then admin pages)?
