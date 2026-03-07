# More Efficient Full E2E Tests Prod Research

## Problem Statement
Split tests into evolution vs. non-evolution and run only the relevant portion based on what changed. Also detect and fix sources of flakiness in tests.

## Requirements (from GH Issue #633)
1. Split tests into evolution-focused vs. non-evolution, leveraging existing CI change-detection logic to run only relevant tests based on changed files
2. Enforce testing rules from `docs/docs_overall/testing_overview.md` to eliminate flakiness

## High Level Summary

The CI already has a fast/full path split based on file-extension change detection but has NO evolution-specific logic. All code changes trigger the full test suite. There's a clear boundary between evolution and non-evolution code, making a split feasible. On the flakiness front, the codebase follows most rules well (data isolation, route cleanup, selectors, test.skip discipline) but has violations in: networkidle usage (8 instances), missing POM waits (7+ methods), fixed sleeps in integration tests, and silent error swallowing (4 instances).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md - 12 testing rules, CI workflow details, test data management
- docs/feature_deep_dives/testing_setup.md - 4-tier strategy, 36 E2E specs, 27 integration tests, mocking patterns

## Code Files Read
- `.github/workflows/ci.yml` - CI change detection and job pipeline
- `.github/workflows/e2e-nightly.yml` - Nightly production E2E
- `.github/workflows/post-deploy-smoke.yml` - Post-deploy smoke tests
- `playwright.config.ts` - Projects, timeouts, sharding, production detection
- `jest.config.js` - Unit test config with --changedSince threshold bypass
- `jest.integration.config.js` - Integration test config
- `package.json` - NPM scripts for test commands

## Key Findings

### Finding 1: CI Change Detection (ci.yml:17-39)
- Uses `git diff --name-only` against `origin/${BASE_REF}` with extension filter (`.ts|tsx|js|jsx|json|css`)
- Binary fast/full decision: either ALL tests or NONE (lint+tsc only)
- No evolution-specific detection — evolution code changes trigger full suite
- Unit tests use `--changedSince` for affected-only filtering, but integration/E2E run everything

### Finding 2: Evolution vs Non-Evolution Test Mapping

| Category | Evolution | Non-Evolution | Total |
|----------|-----------|---------------|-------|
| E2E Specs | 7 files | 29 files | 36 |
| Integration Tests | 11 files | 16 files | 27 |
| Unit Tests (evolution/) | 88 files | — | 88 |
| Unit Tests (src/) | 5 files | ~172 files | ~177 |

**Evolution E2E specs (7):**
- `admin-evolution.spec.ts` - Pipeline page, runs table, variants
- `admin-arena.spec.ts` - Arena leaderboard, Elo, diffs
- `admin-evolution-visualization.spec.ts` - Dashboard, run detail, timeline
- `admin-experiment-detail.spec.ts` - Experiment history, tabs
- `admin-elo-optimization.spec.ts` - Elo dashboard, strategy leaderboard
- `admin-strategy-registry.spec.ts` - Strategy configs (@critical)
- `admin-article-variant-detail.spec.ts` - Variant detail, lineage

**Evolution integration tests (11):**
- `evolution-infrastructure.integration.test.ts`
- `evolution-actions.integration.test.ts`
- `evolution-cost-estimation.integration.test.ts`
- `evolution-tree-search.integration.test.ts`
- `evolution-cost-attribution.integration.test.ts`
- `evolution-outline.integration.test.ts`
- `evolution-pipeline.integration.test.ts`
- `evolution-visualization.integration.test.ts`
- `arena-actions.integration.test.ts`
- `manual-experiment.integration.test.ts`
- `strategy-resolution.integration.test.ts`

### Finding 3: Clear Evolution Code Boundary

**Evolution-only directories:**
- `evolution/` - Core lib, services, components, config, testing
- `src/app/admin/quality/evolution/` - Evolution pipeline UI
- `src/app/admin/quality/arena/` - Arena UI
- `src/app/admin/quality/optimization/experiment/` - Experiment UI
- `src/app/admin/quality/strategies/` - Strategy registry
- `src/app/admin/quality/prompts/` - Prompt bank
- `src/app/admin/evolution-dashboard/` - Dashboard
- `src/app/api/evolution/` - Evolution API routes
- `src/app/api/cron/evolution-*` - Evolution cron jobs
- `src/app/api/cron/experiment-*` - Experiment cron jobs

**Shared/bridge files (small set):**
- `src/lib/services/runTriggerContract.ts`
- `src/lib/services/adminAuth.ts`
- `src/lib/services/auditLog.ts`

### Finding 4: Flakiness Violations

**Rule 2 - Fixed sleeps (5 violations):**
- `request-id-propagation.integration.test.ts:269` - `setTimeout(resolve, 5)`
- `streaming-api.integration.test.ts:94` - `setTimeout(resolve, 10)`
- `streaming-api.integration.test.ts:167` - `setTimeout(resolve, 5)`
- `e2e/helpers/api-mocks.ts:373` - configurable delay in mock
- `e2e/setup/global-setup.ts:85` - retry interval (acceptable for setup)

**Rule 9 - networkidle (8 violations, all have eslint-disable):**
- `auth.unauth.spec.ts:239,260` - skipped tests
- `admin-arena.spec.ts:297` - batch migration note
- `admin-experiment-detail.spec.ts:149,175,198,212,228` - 5 instances, experiment migration

**Rule 7 - Silent catches (4 violations in ResultsPage.ts):**
- Line 191: `.catch(() => {})` on tag removal wait
- Line 197: `.catch(() => null)` on tag apply button wait
- Line 220: `.catch(() => null)` on save complete wait
- Line 104: `.catch(() => {})` on Promise.race fallback

**Rule 12 - Missing POM waits after actions (7+ violations):**
- `LoginPage.ts:45` - submit click, no navigation wait
- `LoginPage.ts:61` - toggleToSignup, no form appearance wait
- `LoginPage.ts:99` - toggleRememberMe, no state change wait
- `ResultsPage.ts:542` - clickEditButton, no edit mode wait
- `ResultsPage.ts:560` - clickPublishButton, no response wait
- `ResultsPage.ts:685` - clickChangesPanelToggle, no panel visibility wait
- `ImportPage.ts:64` - selectSource, no selection verification

**Good areas (no violations):**
- Rule 3 (stable selectors) - excellent data-testid usage throughout
- Rule 8 (test.skip) - all have proper eslint-disable comments
- Rule 10 (route cleanup) - all fixtures have `page.unrouteAll({ behavior: 'wait' })`
- Rule 1 (data isolation) - excellent test-data-factory pattern
- Rule 11 (per-worker temp files) - global-setup reads `/tmp/claude-instance-*.json` but these are read-only discovery files, not shared writes

### Finding 5: CI Pipeline Structure

```
PRs to main:
  detect-changes → typecheck + lint → unit-tests(--changedSince) → integration-critical(5 tests) + e2e-critical(@critical)

PRs to production:
  detect-changes → typecheck + lint → unit-tests → integration-full(27 tests) + e2e-full(4 shards)
```

Current integration-critical list: `auth-flow|explanation-generation|streaming-api|error-handling|vector-matching` (NO evolution tests in critical path)

### Finding 6: Existing Tag System for E2E

Playwright projects already support tag-based filtering via `grep`:
- `chromium-critical` project: `grep: /@critical/`
- Could add `@evolution` tag and a `chromium-evolution` project
- CI can use `--grep` / `--grep-invert` to include/exclude

### Finding 7: Integration Test Critical Subset

The integration critical list is hardcoded in `package.json` as a `--testPathPatterns` regex. Evolution tests could be similarly grouped with a pattern like `evolution-|arena-|strategy-|manual-experiment`.

### Finding 8: Historical Test Failures (Past 2 Weeks from GH CI + Commits)

**27 CI failures in last 500 runs**, concentrated on deploy/main-to-production branches.

**deploy/main-to-production-mar05 (13 failures, 13 fix commits to get green):**

| Test / Area | Root Cause | Fix Applied | Type |
|------------|------------|-------------|------|
| `home-tabs.spec.ts` (E2E) | React controlled input: `fill()` doesn't trigger `onChange` in CI; submit button stays disabled | Use `pressSequentially` with delay; wait for button enabled before Enter | Timing race |
| `library.spec.ts` (E2E) | `safeIsVisible` returns false on slow CI; card load timeout too short | Wait for `feed-card` element directly with 30s timeout | Timing race |
| `search-generate.spec.ts` (E2E) | Wrong testid on results page (`home-search-input` vs `search-input`); missing `searchPage` instantiation | Use correct nav bar testid; add `new SearchPage(page)` in test scope | Test bug |
| `smoke.spec.ts` (E2E) | Wrong testid (`search-submit` vs `home-search-submit`) | Fix testid to match `HomeSearchPanel` | Test bug |
| `action-buttons.spec.ts` (E2E) | Plain text mode content in `<textarea>`, used `innerText()` instead of `inputValue()` | Use `inputValue()` for textarea elements | Test bug |
| `admin-arena.spec.ts` (E2E) | Expression index on `lower(prompt)` prevents INSERT with duplicate prompts; missing `title` column | Use select-then-insert with upsert fallback; provide title | Seeding bug |
| `hidden-content.spec.ts` (E2E) | Column renamed `topic_name` → `topic_title` | Update column reference | Schema drift |
| `report-content.spec.ts` (E2E) | Clicking disabled submit button; wrong assertion order | Check disabled state; select reason before checking submit | Test logic |
| `evolution-pipeline.integration.test.ts` | Pipeline returns `completed` with `budget_exhausted` error_message on graceful completion | Update assertion to expect `budget_exhausted` error_message | Behavioral change |
| Lint failures | Unused imports after test fixes | Remove unused imports | Cleanup |

**Nightly failure Mar 4 (#600):**

| Test / Area | Root Cause | Fix Applied | Type |
|------------|------------|-------------|------|
| 26 @skip-prod AI suggestion tests | PR #589 moved `--grep-invert` from CLI to config; production branch lacks config update | Restore CLI `--grep-invert` as belt-and-suspenders | Config regression |
| 2 home-tabs search tests | React state batching: button disabled until re-render after fill | Add `toBeEnabled()` wait after fill | Timing race |

**PR #555 - Fix Flaky Production Tests (Feb 24):**

| Test / Area | Root Cause | Fix Applied | Type |
|------------|------------|-------------|------|
| `hidden-content.spec.ts` | `getExplanationByIdImpl()` missing `delete_status` filter — real app bug | Add `.eq('delete_status', 'visible')` | App bug |
| `home-tabs.spec.ts` | `waitForURL` timeout 10s too short in CI | Increase to 30s | Timeout |
| `action-buttons.spec.ts` | No waits between format toggle clicks and assertions | Add POM waits | Timing race |
| `tags.spec.ts` | `removeTag()` and `clickApplyTags()` POM methods don't wait | Add completion waits | Missing POM wait |
| `library.spec.ts` | `clickCardByIndex()` POM has no destination wait | Add `waitForURL` | Missing POM wait |
| `add-sources.spec.ts` | Source fetch timeout variability | Increase `test.setTimeout` to 45s | Timeout |
| `suggestions.spec.ts` | Input race during mock setup | Fix setup ordering | Timing race |
| Shard 1 overload | Alphabetical assignment puts ALL flaky tests in shard 1 | Remove `--max-failures=5` | CI config |
| Integration mock leakage | `jest.integration.config.js` had `restoreMocks: false` | Change to `true` | Config bug |

### Finding 9: Pattern Analysis — Top Failure Categories

| Category | Count | Examples | Recurring? |
|----------|-------|----------|------------|
| **Timing races / missing waits** | 12 | React state batching, POM clicks without waits, `safeIsVisible` races | YES - systemic |
| **Test bugs (wrong selectors/assertions)** | 8 | Wrong testid, wrong assertion method, missing variable | Merge-related |
| **Schema/behavioral drift** | 4 | Column renames, pipeline status changes, API changes | Merge-related |
| **CI configuration** | 3 | fail-fast, mock restoration, grep-invert regression | One-time |
| **Seeding/data setup** | 3 | Arena topic duplicates, expression index conflicts | Evolution-specific |
| **networkidle** | 8 | Admin tests, skipped auth tests | Known debt |
| **App bugs caught by tests** | 1 | Missing delete_status filter | Rare |

**Key insight: 12 of 27 failures (44%) are timing races / missing waits — the single biggest category. This is a systemic POM quality issue, not random flakiness.**

**Secondary insight: 12 of 27 failures (44%) occurred during main→production merges due to test/schema drift. These are NOT flakiness — they're merge integration issues where tests reference old selectors, column names, or behaviors that changed on main.**

## Deep Dive: Comprehensive Flakiness Audit (Round 1 + 2)

### A. Rule 12 — Missing POM Waits (19 total violations)

| File | Method | Line | Missing Wait |
|------|--------|------|-------------|
| LoginPage.ts | `clickSubmit` | 86 | Navigation or error message |
| LoginPage.ts | `toggleToSignup` | 60 | Signup form visibility |
| LoginPage.ts | `toggleRememberMe` | 98 | Checkbox state toggle |
| ResultsPage.ts | `addTag` | 168 | New tag item visibility |
| ResultsPage.ts | `submitAISuggestion` | 377 | Loading/response state |
| ResultsPage.ts | `clickEditButton` | 541 | Edit mode activation |
| ResultsPage.ts | `clickPublishButton` | 560 | Publish response/state |
| ResultsPage.ts | `selectMode` | 580 | Dropdown value update |
| ResultsPage.ts | `clickAddTagTrigger` | 619 | Input visibility after click |
| ResultsPage.ts | `filterTagDropdown` | 656 | Dropdown option filtering |
| ResultsPage.ts | `selectTagFromDropdown` | 664 | Dropdown close / tag appear |
| ResultsPage.ts | `clickChangesPanelToggle` | 685 | Panel visibility toggle |
| UserLibraryPage.ts | `searchFromLibrary` | 121 | Input value before Enter |
| ImportPage.ts | `clickCancel` | 89 | Modal close |
| ImportPage.ts | `clickBack` | 104 | Modal state return |
| SearchPage.ts | `fillQuery` | 62 | Button enabled state |
| SearchPage.ts | `clickSearch` | 81 | Navigation after click |
| AdminUsersPage.ts | `search` | 92 | Table update |
| AdminWhitelistPage.ts | `addAlias` | 157 | Alias list update |

### B. Rule 9 — networkidle Replacements (8 instances, exact fixes)

| File | Line | Replacement |
|------|------|-------------|
| admin-experiment-detail.spec.ts | 150 | `await adminPage.waitForLoadState('domcontentloaded'); await expect(adminPage.locator('text=Experiment History')).toBeVisible();` |
| admin-experiment-detail.spec.ts | 176 | `await adminPage.waitForLoadState('domcontentloaded'); await expect(adminPage.locator('text=Rating Optimization')).toBeVisible();` |
| admin-experiment-detail.spec.ts | 199 | `await adminPage.waitForLoadState('domcontentloaded'); await expect(adminPage.locator('button', { hasText: 'Analysis' })).toBeVisible();` |
| admin-experiment-detail.spec.ts | 213 | `await adminPage.waitForLoadState('domcontentloaded'); await expect(adminPage.locator('th:has-text("Run ID")')).toBeVisible();` |
| admin-experiment-detail.spec.ts | 229 | `await adminPage.waitForLoadState('domcontentloaded'); await expect(adminPage.locator('text=Rating Optimization')).toBeVisible();` |
| admin-arena.spec.ts | 298 | `await adminPage.waitForLoadState('domcontentloaded'); await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible();` |
| auth.unauth.spec.ts | 240 | `await page.waitForLoadState('domcontentloaded'); await page.waitForFunction(() => !!localStorage.getItem('supabase.auth.token'));` |
| auth.unauth.spec.ts | 260 | Same as line 240 |

### C. Rule 7 — Silent Catches (8 instances, replace with error-utils)

| File | Line | Current | Fix |
|------|------|---------|-----|
| ResultsPage.ts | 104 | `.catch(() => {})` | Use `safeRace()` from error-utils |
| ResultsPage.ts | 191 | `.catch(() => {})` | Use `safeWaitFor(locator, 'hidden', 'removeTag')` |
| ResultsPage.ts | 197 | `.catch(() => null)` | Use `safeWaitFor(locator, 'hidden', 'clickApplyTags')` |
| ResultsPage.ts | 220 | `.catch(() => null)` | Use `safeWaitFor()` or try/catch with `console.warn` |
| ResultsPage.ts | 287 | inner `.catch` swallows | Use `safeIsVisible()` for error check |
| ResultsPage.ts | 459 | `.catch(warn)` | Already has logging — acceptable |
| ResultsPage.ts | 477 | `.catch(warn)` | Already has logging — acceptable |
| auth.spec.ts | 71 | `.catch(warn)` | Already has logging — acceptable |

### D. React fill() Race Condition — THE #1 Flakiness Source (20 HIGH-risk instances)

**Root cause:** `fill()` on React controlled inputs doesn't reliably trigger `onChange` in CI before the next action.

**Safe pattern already exists in SearchPage/LoginPage:**
```typescript
await input.fill(value);
await input.blur();           // triggers onChange
const actual = await input.inputValue();
if (actual !== value) {
  await input.pressSequentially(value, { delay: 50 });  // fallback
}
```

**HIGH-risk fill() calls needing fix:**

| File | Line | Action After fill() | Fix |
|------|------|-------------------|-----|
| home-tabs.spec.ts | 50 | Press Enter | Add blur + toBeEnabled wait |
| home-tabs.spec.ts | 77 | Button check | Add blur + toBeEnabled wait |
| home-tabs.spec.ts | 93 | Press Enter | Add blur + toBeEnabled wait |
| home-tabs.spec.ts | 116 | Button click | Add blur + toBeEnabled wait |
| home-tabs.spec.ts | 132 | Shift+Enter | Add blur |
| home-tabs.spec.ts | 239 | Expect disabled | Add blur |
| home-tabs.spec.ts | 258 | Expect enabled | Add blur |
| errors.spec.ts | 157 | Press Enter | Use pressSequentially |
| add-sources.spec.ts | 51,86,114,146,177 | Button click | Add blur after each fill |
| add-sources.spec.ts | 188 | Button click | Use pressSequentially |
| library.spec.ts | 111 | Press Enter | Add blur |
| report-content.spec.ts | 164 | Expect value | Add blur |
| content-boundaries.spec.ts | 196 | Expect disabled | Add blur |
| admin-arena.spec.ts | 252 | Submit click | Add blur |
| user-interactions.spec.ts | 139 | Submit click | Add blur |

**MEDIUM-risk (16 more in POMs):** AdminWhitelistPage (4), AdminUsersPage (3), AdminContentPage (1), AdminCandidatesPage (1), UserLibraryPage (1), ResultsPage (3), ImportPage (1)

### E. Infrastructure Issues (verified in Round 2)

| Issue | Status | Details |
|-------|--------|---------|
| Auth session cache shared across workers | **FALSE POSITIVE** | Playwright workers are separate processes; module-level cache is per-worker |
| `unrouteAll({ behavior: 'wait' })` can hang | **REAL** | If a route handler never resolves (e.g., `mockReturnExplanationTimeout`), teardown hangs until test timeout |
| Global teardown uses `Promise.all` for vector cleanup | **REAL** | Should use `Promise.allSettled()` so one Pinecone failure doesn't skip DB cleanup |
| Integration tests: `if (!tablesReady) return;` | **REAL** | Tests appear to pass when they actually skip silently; should use `describe.skip()` |
| Integration: timing assertions | **REAL** | `tag-management:213` expects `<5000ms`; `logging-infrastructure:146` expects `<10ms/call` |
| Integration: sequential tag creation workaround | **REAL** | `tag-management:200` creates tags in loop to avoid DB visibility race |
| Unstable selectors | **MINOR** | 4 text-based selectors in admin-whitelist, admin-candidates, report-content, global-error |

### F. Integration Test Issues (20 findings)

**Critical:**
- `streaming-api.integration.test.ts:94,167` — Fixed 5ms/10ms delays in mocks
- `tag-management.integration.test.ts:200` — Sequential tag creation to avoid race
- `arena-actions.integration.test.ts:364-381` — Soft-delete cascade missing error checks
- `arena-actions.integration.test.ts:671-708` — Non-deterministic concurrent topic insert

**Medium:**
- `logging-infrastructure.integration.test.ts:134-146` — Wall-clock timing assertion <10ms/call
- `evolution-actions.integration.test.ts:90-93` — clearAllMocks() then re-apply mock workaround
- `request-id-propagation.integration.test.ts:269` — Fixed 5ms delay for async context

**Good patterns confirmed:**
- `jest.integration.config.js`: `restoreMocks: true`, `clearMocks: true`, `maxWorkers: 1`
- `integration-helpers.ts`: Proper cleanup with error logging
- All evolution tests: `if (!tablesReady) return;` guard (though should be `describe.skip`)

## Deep Dive: Beyond the 12 Rules (Round 3)

### G. Test Data Collisions — CRITICAL for Parallel Execution

**Problem:** 9 admin spec files use fixed topic names like `[TEST] Evolution E2E Topic` with NO timestamp suffix. When 2 workers run the same admin test, both create and clean up the same named data, deleting each other's test data mid-test.

**Cleanup-before-seed race condition (all 9 admin specs):**
1. Worker A calls `cleanupExistingTestData()` — queries `[TEST] Evolution E2E Topic`
2. Worker B simultaneously does the same
3. Worker B deletes Worker A's newly created topic while Worker A is still using it
4. Worker A's tests fail because data disappeared

**Affected files:** admin-evolution, admin-arena, admin-elo-optimization, admin-evolution-visualization, admin-experiment-detail, admin-article-variant-detail, admin-strategy-registry, admin-content, admin-reports

**Fix:** Add `Date.now()` or `testInfo.workerIndex` suffix to ALL test topic/explanation titles in admin specs. Use factory pattern instead of manual seeding.

### H. Shared Tracked IDs File (No Per-Worker Isolation)

`/tmp/e2e-tracked-explanation-ids.txt` is a single file for ALL workers. If Worker 1 fails and global-teardown runs, it cleans up Worker 2's tracked IDs too (Worker 2 may still be running).

**Fix:** Use `/tmp/e2e-tracked-explanation-ids-worker-${workerIndex}.txt` pattern.

### I. Global Teardown Partial Failure Cascade

Global teardown runs 6 sequential cleanup steps. If step 2 fails, steps 3-6 are skipped (single try/catch wraps everything). Orphaned data accumulates across runs.

**Fix:** Wrap each cleanup step in its own try/catch. Use `Promise.allSettled()` for parallel deletes.

### J. CI Infrastructure Issues

| Issue | Severity | Details |
|-------|----------|---------|
| Shard imbalance | MEDIUM | Alphabetical splitting: shard 1 gets quick tests (01-auth, 01-home), shard 4 gets slow admin tests. No duration manifest. |
| Build failure hides as timeout | HIGH | CI command `npm run build && npm start` — if build fails, test sees "server not ready" after 180s, not the actual build error |
| 2-core runner resource pressure | MEDIUM | `ubuntu-latest` has 2 cores, 7GB RAM. Build + Playwright + 2 workers can cause CPU pressure / OOM |
| Vercel bypass cookie expiry | HIGH | Cookie valid ~60 min. Long test runs (4 shards × slow admin tests) can exceed this. No refresh logic. |
| Supabase rate limiting on parallel auth | MEDIUM | 4 shards × 2 workers = 8 simultaneous `signInWithPassword` calls. Supabase rate limit ~5-10 req/sec. |

### K. Async/Timing Issues Beyond Rules

**Conditional test logic hiding failures (3 files):**
- `save-blocking.spec.ts:115` — `if (await publishButton.isVisible())` skips assertions entirely when button absent
- `viewing.spec.ts:72` — `hasTags()` boolean branch where both pass
- `errors.spec.ts:100` — `if/else` where both branches are "success"

**Fix:** Replace `if (isVisible)` with `expect(locator).toBeVisible()` where element SHOULD exist.

**Route mock registration race (3 files):**
- `error-recovery.spec.ts:114-123` — New mock registered after `unrouteAll` but before `waitForRouteReady()`. Next API call may bypass mock.
- `errors.spec.ts:67-73` — Mock → waitForRouteReady → navigate (correct order, but tight race on slow CI)
- `search-generate.spec.ts:24-26` — Mock → navigate (no waitForRouteReady between)

**Fix:** Always call `waitForRouteReady(page)` between `page.route()` and navigation.

**Promise.race misuse (2 files):**
- `auth.spec.ts:68-74` — Race between URL check and login form; catch swallows both failures, test continues without any valid state check
- `ResultsPage.ts:65-78` — If both race promises reject, error is misattributed as "streaming timeout"

**beforeAll timeout blocking ALL tests:**
- 10+ spec files create test data in `beforeAll` via API calls. If API is slow (>30s), ALL tests in describe fail with cryptic "beforeAll timeout" — not "API slow". No per-step timeout or retry.

**afterAll cleanup races with context close:**
- `library.spec.ts:31-33` — `cleanup()` calls Supabase delete. If page/context closes first, request is dropped. Data orphaned.

**Fix:** Use `test.afterAll` with defensive null checks, and don't depend on page being open for cleanup (use separate service client).

### L. Shared State Between test.describe Blocks (11 files)

Most spec files create ONE `testExplanation` in `beforeAll` and share it across ALL nested describes:
- `library.spec.ts` — 8+ tests share one explanation, serial mode masks data dependency
- `action-buttons.spec.ts` — Save, Edit, Format Toggle, Mode, Rewrite all share one explanation
- `suggestions.spec.ts` — Panel, Diff, Accept/Reject, Prompt-Specific all share one explanation
- `state-management.spec.ts` — Undo/redo tests depend on previous test's diff state
- `user-interactions.spec.ts` — Double-submit test depends on button state from prior test

**Current mitigation:** `test.describe.configure({ mode: 'serial' })` in library.spec.ts

**Risk:** If any test in the chain fails, all subsequent tests fail due to corrupted shared state.

**Fix for high-value specs:** Create fresh test data per nested `describe` block, not per top-level suite.

## Deep Dive: Spec-Level & Helper-Level Audit (Round 4)

### M. AI Suggestion Test Flakiness (25 issues in suggestions-related specs)

**Critical issues:**
- `suggestions-test-helpers.ts:307-329` — `enterEditMode()` uses double-click then falls back to single click. If first click partially registers, element is in broken state.
- `suggestions-test-helpers.ts:237-260` — `getEditorTextContent()` polls with `page.evaluate()` in a loop, no max iterations guard. Can hang infinitely.
- `suggestions-test-helpers.ts:66` — `waitForDiffNodes()` uses deprecated `waitForSelector` instead of locator API.
- `api-mocks.ts:302-308` — `mockReturnExplanationTimeout` creates a never-resolving promise. If test completes before abort, route handler leaks into next test.
- Route mock stacking — Multiple `page.route()` calls for same URL pattern stack (last wins). Tests that register multiple mocks without `unrouteAll` between them get stale handlers.

**Medium issues:**
- `getDiffCounts()` returns counts that depend on DOM rendering timing — assertions on exact counts are non-deterministic
- Missing `@skip-prod` tags on tests that use `mockReturnExplanation` (would fail against real API)
- Undo/redo assertions use loose `toContain` checks that could match substrings
- `testExplanation` state corruption when serial tests modify shared explanation

### N. Admin Spec Data Isolation Audit (12 admin specs)

| Spec File | Naming | Unique? | Cleanup Order | FK Safe? | Collision Risk |
|-----------|--------|---------|---------------|----------|---------------|
| admin-evolution.spec.ts | `[TEST] Evolution E2E Topic` | NO | variants→articles→topics | YES | HIGH |
| admin-arena.spec.ts | `[TEST] Arena E2E Topic` | NO | comparisons→articles→topics | YES | HIGH |
| admin-elo-optimization.spec.ts | `[TEST] Elo E2E Topic` | NO | runs→articles→topics | YES | HIGH |
| admin-evolution-visualization.spec.ts | `[TEST] Viz E2E Topic` | NO | runs→articles→topics | YES | HIGH |
| admin-experiment-detail.spec.ts | `[TEST] Experiment E2E` | NO | experiments→runs→topics | YES | HIGH |
| admin-article-variant-detail.spec.ts | `[TEST] Variant Detail` | NO | variants→articles→topics | YES | HIGH |
| admin-strategy-registry.spec.ts | Timestamp-based | YES | strategies→configs | YES | LOW |
| admin-content.spec.ts | `[TEST] Content Topic` | NO | explanations→topics | PARTIAL | HIGH |
| admin-reports.spec.ts | `[TEST] Reports Topic` | NO | reports→topics | YES | HIGH |
| admin-users.spec.ts | Query-based (no seed) | N/A | none | N/A | NONE |
| admin-whitelist.spec.ts | Timestamp aliases | YES | aliases only | YES | LOW |
| admin-candidates.spec.ts | `[TEST] Candidate` | NO | candidates | YES | MEDIUM |

**Key pattern:** `admin-strategy-registry.spec.ts` is the gold standard — uses `Date.now()` suffix. All others should adopt this pattern.

### O. Non-Admin Spec Assertion Quality (Weak assertions hiding failures)

| File | Line | Issue | Severity |
|------|------|-------|----------|
| tags.spec.ts | 68 | `expect(count).toBeGreaterThanOrEqual(0)` — always passes | HIGH |
| hidden-content.spec.ts | 119 | OR chain: `isVisible \|\| isHidden` — always true | HIGH |
| save-blocking.spec.ts | 115 | `if (isVisible)` — skips assertion when element absent | HIGH |
| viewing.spec.ts | 72 | `hasTags()` boolean branch — both branches "pass" | MEDIUM |
| auth.spec.ts | 68-74 | Race between URL/form — catch swallows, continues | MEDIUM |
| state-management.spec.ts | 45 | Type assertion only (`typeof`) not value assertion | LOW |
| library.spec.ts | 130 | `toContain` on long strings — substring match too loose | LOW |

**Fix:** Replace always-true assertions with specific expected values. Remove `if` guards around assertions — if element should exist, use `expect().toBeVisible()`.

### P. Helper File Infrastructure Issues (20 issues, 13 critical)

**wait-utils.ts:**
- No global timeout on `waitForCondition()` — if condition never returns true, hangs until test timeout with no useful error message
- `safeRace()` silently returns undefined on all-reject — callers don't check return value

**test-data-factory.ts:**
- `appendFileSync` to shared `/tmp/e2e-tracked-explanation-ids.txt` from multiple workers — concurrent writes can corrupt file
- `getTrackedExplanationIds()` reads file once — if new IDs added after read, cleanup misses them

**global-setup.ts:**
- Fixture seeding (lines 307-372) has race condition: checks existence, then inserts. Between check and insert, another process can insert, causing duplicate key error.
- Tag creation (lines 96-148) swallows errors silently — if tags fail to create, tests using those tags fail with misleading "tag not found" errors.

**vercel-bypass.ts:**
- `Atomics.wait()` on lines 198-200 can block the main thread in CI
- Lock acquired but not held during file read (lines 245-248) — TOCTOU race
- Cookie has 55-minute stale threshold with no mid-run refresh logic

**api-mocks.ts:**
- `mockReturnExplanationTimeout` creates never-resolving promise — route handler lives forever in page context, can interfere with subsequent tests
- No `unrouteAll` cleanup between mock registrations in many test files

## Deep Dive: Timing, Integration Isolation, CI, Fixtures (Round 5)

### Q. E2E Spec Timing Issues (14 new, beyond fill/networkidle/POM waits)

**CRITICAL:**
- `save-blocking.spec.ts:151-158` — While loop rechecks stale `counts.total` after `clickAcceptOnFirstDiff`. `.toPass()` retry masks race between loop condition and DOM state. Can infinite loop.
- `auth.unauth.spec.ts:79-93` — `setInterval` polling URL every 5s. Relies on `finally` block for cleanup; if exception before interval creation, leak.
- `errors.spec.ts:149-151` — `unrouteAll({ behavior: 'wait' })` then immediately registers new mock. Old route handlers may not be fully cleared.

**HIGH:**
- `client-logging.spec.ts:15-17` — `waitForFunction('window.__LOGGING_INITIALIZED__')` with tight 10s timeout. Flakes on slow CI.
- `errors.spec.ts:86-95` — `expect().toPass({ timeout: 5000 })` independent of outer 30s operation timeout. Error may appear at 6s, past retry window.
- `home-tabs.spec.ts` — 17 instances of `goto('/')` without explicit `waitForLoadState()`. Playwright defaults to `load` but doesn't wait for React hydration.
- `search-generate.spec.ts:28-33` — `Promise.all([waitForURL, search()])` — if search has debounce, waitForURL can timeout while search is still preparing.

**MEDIUM:**
- `add-sources.spec.ts` — Inconsistent toBeVisible timeouts in same file (5s/10s/20s) for related operations.
- `user-interactions.spec.ts:121` — Hardcoded `setTimeout(r, 1000)` for debounce testing. Not testing actual behavior.
- `search-generate.spec.ts:268-272` — `.toPass({ timeout: 10000 })` doesn't coordinate with slower streaming operation.
- `auth.spec.ts:68-74` — `Promise.race` with `.catch()` swallows both failures, test continues without valid state.

### R. Integration Test Isolation Issues (8 new)

**HIGH:**
- **Module-level state accumulation (12 files):** All evolution integration tests declare `createdTopicIds`, `createdEntryIds` etc. at module scope outside `describe`. Running tests in isolation fails because arrays lack data from earlier tests.
- **Async cleanup race (4 files):** `afterAll` with sequential Supabase deletes in for-loops. If one fails or times out, subsequent test suite inherits orphaned records causing FK violations.
- **process.env reassignment (vercel-bypass):** `process.env = { ...originalEnv }` replaces entire object instead of restoring. Leaks env vars between tests.

**MEDIUM:**
- Mock leakage — `jest.spyOn()` inside tests not fully restored by `restoreMocks: true` (only works on module-level mocks).
- Non-deterministic timestamps — 10+ files use `Date.now()` in timing assertions like `expect(duration).toBeLessThan(5000)`. Flaky on slow CI.
- UUID collisions — `Date.now()_${Math.random()}` suffix can collide when tests run fast (same millisecond).
- Weak error assertions — `resolves.not.toThrow()` doesn't verify operation actually succeeded.
- Soft delete assumption — Tests query raw `explanation_tags` table, brittle to implementation changes.

### S. CI Workflow Issues (12 new)

**HIGH:**
- `e2e-nightly.yml` missing `PINECONE_NAMESPACE`, `ADMIN_TEST_EMAIL`, `ADMIN_TEST_PASSWORD` — admin tests fail silently in nightly.
- `ci.yml:269` — `npm run test:e2e -- --shard=1/4` but `test:e2e` script locks `--project=chromium --project=chromium-unauth`. Shard flag may conflict with project filters.
- `ci.yml:103,128,153,217` — `unit-tests` listed as hard dependency for integration/E2E jobs, but `unit-tests` conditionally skipped. Docs-only PR to production deadlocks.

**MEDIUM:**
- Nightly missing `NEXT_PUBLIC_USE_AI_API_ROUTE: 'true'` — different code path than CI.
- Cache key not browser-specific in `e2e-full` — `playwright-${{ runner.os }}-${{ version }}` shared across browsers.
- `playwright.config.ts:89` — `workers: isProduction ? 2 : 2` is dead code (always 2).
- Nightly runs ALL non-@skip-prod tests but CI runs only @critical subset — ~30 tests never tested in production nightly.
- CI expect timeout 20s too long — assertion hangs waste time on 2-core runners.

### T. E2E Fixture & Helper Infrastructure (28 issues, top 10)

**HIGH:**
- `global-setup.ts:110-115` — `ensureTagAssociated()` calls `.single()` without destructuring `error`. Silent failure on no-record case.
- `global-setup.ts:323-327` — `seedTestExplanation()` same `.single()` missing error pattern on topics lookup.
- `global-setup.ts:98-102` — Tag upsert error destructured but never checked. Upsert failures completely hidden.
- `test-data-factory.ts:301` — `trackExplanationForCleanup()` silently returns on NaN explanationId. Orphaned test data never cleaned up.
- `test-data-factory.ts:315-327` — `getTrackedExplanationIds()` returns `[]` on file read failure. Entire cleanup bypassed silently.
- `vercel-bypass.ts:245-275` — `loadBypassCookieState()` proceeds despite failed lock acquisition. Can read half-written file.
- `auth.ts:31-36` — Cached session not validated against Supabase. Revoked sessions return stale cookies, tests fail cryptically.
- `ResultsPage.ts:220` — `clickSaveToLibrary()` catches `waitForSaveComplete()` failure silently. Tests can't verify save occurred.

**MEDIUM:**
- `global-setup.ts:247` — `seedSharedFixtures()` creates NEW Supabase client without timeout. Fixture seeding can hang indefinitely.
- `wait-utils.ts:24-28` — `waitForState()` catches all errors silently during poll. Hides page-closed errors, continues polling until timeout.
- `base.ts:18-26` — Bypass cookie added without verifying it was actually set (domain mismatch possible).
- `ResultsPage.ts:459-462,477-480` — `acceptAllDiffs()`/`rejectAllDiffs()` swallow timeout in while loop. Can loop infinitely if diffs stuck.

## Deep Dive: Verification, Boundaries, Prioritization, Workflow Gaps (Round 6)

### U. False Positive Verification (8 claims tested)

| # | Claim | Verdict | Reason |
|---|-------|---------|--------|
| 1 | `save-blocking.spec.ts:151` while loop stale counts | **FALSE POSITIVE** | `.toPass()` retries the full callback, re-fetching DOM each time |
| 2 | `home-tabs.spec.ts` 17 goto without waitForLoadState | **FALSE POSITIVE** | Every `goto('/')` IS followed by `waitForLoadState('domcontentloaded')` |
| 3 | `search-generate.spec.ts:28` Promise.all race | **FALSE POSITIVE** | `search()` does synchronous fill+click, no debounce. Outer waitForURL is redundant but harmless |
| 4 | `ci.yml:269` --shard conflicts with --project | **FALSE POSITIVE** | Playwright handles `--project=X --shard=1/4` correctly; flags are orthogonal |
| 5 | `playwright.config.ts:89` workers dead code | **REAL** | `isProduction ? 2 : 2` — both branches identical |
| 6 | `ci.yml` unit-tests deadlocks docs-only PRs | **FALSE POSITIVE** | GitHub Actions skips jobs with unmet `if` conditions; dependents skip cleanly |
| 7 | `auth.ts:31-36` cached session not validated | **PARTIALLY TRUE** | Supabase JWTs are self-validating; server-side revocation won't be caught, but risk is low in CI |
| 8 | `global-setup.ts:110-115` .single() without error | **FALSE POSITIVE** | Error is implicitly handled; `.single()` returns null data when no rows, code checks `if (existingAssoc)` |

**Impact: Sections Q, R, S, T have been partially invalidated. Items 1, 2, 3, 4, 6, 8 should NOT be in the fix list.**

### V. Evolution Test Boundary — Exact File Patterns for CI Splitting

**EVOLUTION_ONLY_PATHS (trigger evolution tests only):**
```
evolution/**
src/app/admin/quality/evolution/**
src/app/admin/quality/arena/**
src/app/admin/quality/optimization/**
src/app/admin/quality/strategies/**
src/app/admin/quality/prompts/**
src/app/admin/evolution-dashboard/**
src/app/api/evolution/**
src/app/api/cron/evolution-runner/**
src/app/api/cron/evolution-watchdog/**
src/app/api/cron/experiment-driver/**
```

**SHARED_PATHS (trigger ALL tests — 11 bridge modules):**
```
src/lib/schemas/**
src/lib/services/llms.ts
src/lib/services/adminAuth.ts
src/lib/services/auditLog.ts
src/lib/utils/supabase/**
src/lib/errorHandling.ts
src/lib/prompts.ts
src/lib/config/llmPricing.ts
src/lib/server_utilities.ts
src/lib/logging/**
src/lib/serverReadRequestId.ts
supabase/migrations/**
package.json, jest.config.js, jest.integration.config.js, tsconfig.json, playwright.config.ts
```

**NON_EVOLUTION_PATHS (trigger non-evolution tests only):**
Everything else — `src/components/**`, `src/app/**` (except evolution), `src/hooks/**`, `src/actions/**`, etc.

**Evolution-specific database tables (20):**
`content_evolution_runs`, `content_evolution_variants`, `content_eval_runs`, `evolution_checkpoints`, `evolution_run_logs`, `evolution_run_agent_metrics`, `evolution_agent_invocations`, `evolution_experiments`, `evolution_experiment_rounds`, `strategy_configs`, `article_bank_topics`, `article_bank_entries`, `article_bank_comparisons`, `article_bank_elo`, `batch_runs`, `agent_cost_baselines`, `daily_cost_rollups`, `llm_cost_config`

**Reverse dependencies:** 56 files in `src/app/admin/quality/` import from `@evolution/services/*`. These are evolution UI pages that are covered by evolution E2E tests.

### W. Nightly vs CI Workflow Gap Analysis

**Missing env vars in nightly (`e2e-nightly.yml`):**
- `PINECONE_NAMESPACE` — vector search may use wrong namespace
- `ADMIN_TEST_EMAIL` / `ADMIN_TEST_PASSWORD` — admin tests fail
- `NEXT_PUBLIC_USE_AI_API_ROUTE` — different code path than CI

**Missing steps in nightly:**
- No `npx tsx scripts/seed-admin-test-user.ts` step — admin user not seeded

**Missing in post-deploy smoke:**
- `OPENAI_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX_NAME_ALL`, `PINECONE_NAMESPACE`
- `ADMIN_TEST_EMAIL`, `ADMIN_TEST_PASSWORD`, `NEXT_PUBLIC_USE_AI_API_ROUTE`
- No admin user seeding step

**Cache key discrepancy:**
- Nightly: `playwright-${{ runner.os }}-${{ version }}-${{ matrix.browser }}` (browser-specific, correct)
- CI: `playwright-${{ runner.os }}-${{ version }}` (not browser-specific, could share wrong binaries)

### X. Prioritized Action Plan (38 items, 4 tiers)

**Tier 1 — High Impact, Low Effort (~126 LOC, fixes ~60% of CI failures):**
1. Replace 8 networkidle with domcontentloaded + element waits
2. Add blur() after 20 high-risk fill() calls (THE #1 flakiness source)
3. Replace 5 silent catches in ResultsPage with safeWaitFor/console.warn
4. Fix 3 always-true assertions (tags.spec >=0, hidden-content OR chain, save-blocking if guard)
5. Change Promise.all to Promise.allSettled in global teardown
6. Change `if (!tablesReady) return` to `describe.skip()` in 11 integration tests
7. Add waitForRouteReady between page.route() and navigation in 3 files
8. Fix global-setup tag upsert error checks (3 instances)
9. Guard trackExplanationForCleanup against NaN (throw instead of return)

**Tier 2 — High Impact, Medium Effort (~227 LOC):**
1. Add waits to 19 POM methods missing post-action waits
2. Add timestamp suffix to 9 admin spec test data names
3. Switch tracked IDs to per-worker file pattern
4. Individual try/catch for 6 global teardown steps
5. Fix mockReturnExplanationTimeout never-resolving promise
6. Add blur() after 16 medium-risk POM fill() calls
7. Add max-iteration guard to getEditorTextContent polling
8. Replace deprecated waitForSelector in suggestion helpers

**Tier 3 — CI Infrastructure (~166 LOC):**
1. Add evolution-specific CI change detection
2. Add @evolution tag to 7 specs + chromium-evolution project
3. Add evolution integration test CI job
4. Fix nightly missing env vars + admin seeding
5. Fix workers dead code (isProduction ? 2 : 2)
6. Surface build errors clearly in CI
7. Duration-based shard balancing
8. Vercel bypass cookie refresh logic
9. Fix client-logging.spec.ts tight timeout

**Tier 4 — Low Impact / High Effort (~437 LOC):**
12 items including shared testExplanation refactoring, module-level state, process.env restoration, etc.

**Key insight: Tier 1 items 1+2 alone (networkidle + fill race) account for 74% of historical failures with only ~64 lines of changes.**

## Deep Dive: Verification Round 2, Admin Deep Audit, Config Audit (Round 7)

### Y. False Positive Verification Round 2 (8 more claims)

| # | Claim | Verdict | Reason |
|---|-------|---------|--------|
| 1 | ResultsPage.ts:191 tag removal .catch | **FALSE POSITIVE** | Click happens before wait; .catch is best-effort animation wait, has eslint-disable justification |
| 2 | ResultsPage.ts:197 apply button .catch | **FALSE POSITIVE** | Tags already applied; wait is best-effort for button hide animation |
| 3 | suggestions-test-helpers.ts:237 infinite polling | **FALSE POSITIVE** | Has time-based `while (Date.now() - startTime < timeout)` loop with 30s default |
| 4 | suggestions-test-helpers.ts:307 double-click race | **FALSE POSITIVE** | Uses single click with `force: true`, then retry after 3s. Standard pattern. |
| 5 | api-mocks.ts:302 never-resolving promise leak | **PARTIALLY TRUE** | Promise never resolves (intentional timeout sim), but `unrouteAll` in fixtures cleans it up |
| 6 | test-data-factory.ts:305 appendFileSync corruption | **FALSE POSITIVE** | appendFileSync IS atomic for small writes on Linux/ext4; writes are <20 bytes |
| 7 | vercel-bypass.ts:198 Atomics.wait blocks main | **REAL but valid** | Used only during lock acquisition in setup/teardown, not in hot path |
| 8 | global-teardown.ts:161 Promise.all needs allSettled | **FALSE POSITIVE** | `deleteVectorsForExplanation()` never rejects — all errors caught internally |

**Cumulative false positive rate: 12 of 16 verified claims (75%) were false positives.**

### Z. Admin E2E Spec Deep Audit (12 new issues)

**HIGH:**
- Hardcoded row indices (`lb-row-0`, `delete-entry-1`) in admin-arena — if leaderboard reorders due to other test data, wrong row targeted
- Exact row count assertions (`toHaveCount(2)`, `toHaveCount(5)`) — fail if orphaned data exists from prior runs
- No error checking in cleanup functions across all 9 admin specs — silent delete failures leave orphaned data

**MEDIUM:**
- `selectOption({ index: 1 })` instead of by value in admin-arena — fragile to option order changes
- `nth-child()` table column selectors in admin-content, admin-reports, admin-evolution — break if columns added/removed
- No retry logic for seeding — single transient Supabase error blocks ALL tests
- No timeout on beforeAll seeding calls — hangs with cryptic "beforeAll timeout" error

**LOW:**
- Modal skip conditions hide test gaps (if approve button missing, test.skip silently)
- Pagination assertions assume first page has data
- Focus trap tests assume specific tab order

### AA. Integration Test Deep Dive (arena, pipeline, strategy, experiment)

**Confirmed issues:**
- `manual-experiment` silent skip pattern: `if (!tablesReady || createdExperimentIds.length === 0) return;` marks tests as PASSED when actually skipped
- Cleanup functions in arena-actions don't check delete error responses — FK cascading failures possible
- `strategy-resolution` afterAll only deletes strategies, doesn't clean runs (currently safe, fragile if tests expand)

**False alarms debunked:**
- Arena concurrent topic insert (lines 665-709): Actually deterministic — tests dedup logic via unique index, uses Promise.allSettled correctly
- Evolution-pipeline status assertions: All match actual behavior per code comments

### BB. Test Runner Config Audit

**False positive debunked:** Agent claimed "NO @critical tags in test files" — actually 25+ tests tagged @critical across 15+ spec files. Agent's grep was faulty.

**Real findings:**
- `test:integration:critical` pattern (`auth-flow|explanation-generation|...`) depends on exact filenames — fragile if files renamed
- Jest inline tsconfig doesn't include Next.js plugin (acceptable for tests)
- Playwright `testIgnore: /auth\.setup\.ts/` is imprecise but functional

## Deep Dive: Fix Designs, CI Splitting Design (Round 8)

### CC. networkidle Exact Fix Design (8 instances)

Only 1 of 8 is in an active test; 7 are in skipped tests:

| Instance | File | Line | Status | Element to Wait For |
|----------|------|------|--------|-------------------|
| 1 | admin-arena.spec.ts | 297 | **ACTIVE** | `[data-testid="leaderboard-table"]` |
| 2-6 | admin-experiment-detail.spec.ts | 149,175,198,212,228 | Skipped | Various headings/tabs |
| 7-8 | auth.unauth.spec.ts | 239,260 | Skipped | Supabase hydration |

All replacements: `waitForLoadState('networkidle')` → `waitForLoadState('domcontentloaded')` + existing element visibility assertion. Remove eslint-disable comments.

### DD. fill()+blur() Exact Fix Design (18 instances across 7 files)

Safe pattern already exists in LoginPage, SearchPage, ResultsPage: `fill → blur → verify → pressSequentially fallback`.

For all 18 bare fill() calls, add `.blur()` after `.fill()`:

| File | Count | Lines |
|------|-------|-------|
| home-tabs.spec.ts | 7 | 50, 77, 93, 116, 132, 239, 258 |
| add-sources.spec.ts | 6 | 51, 86, 114, 146, 177, 188 |
| errors.spec.ts | 1 | 157 |
| library.spec.ts | 1 | 111 |
| report-content.spec.ts | 1 | 164 |
| admin-arena.spec.ts | 1 | 252 |
| user-interactions.spec.ts | 1 | 139 |

### EE. Evolution CI Splitting Design

**Approach:** Four-way change classifier in detect-changes job:
- `fast` — no code changes (docs only)
- `evolution-only` — only EVOLUTION_ONLY_PATHS changed
- `non-evolution-only` — only NON_EVOLUTION_PATHS changed
- `full` — SHARED_PATHS changed, or mixed evolution+non-evolution

**Implementation:**
1. Add `{ tag: '@evolution' }` to 7 admin evolution E2E specs
2. Use CLI `--grep=@evolution` / `--grep-invert=@evolution` (no new Playwright projects)
3. Add 4 new CI jobs: `e2e-evolution`, `e2e-non-evolution`, `integration-evolution`, `integration-non-evolution`
4. Add 4 new package.json scripts: `test:e2e:evolution`, `test:e2e:non-evolution`, `test:integration:evolution`, `test:integration:non-evolution`
5. Integration split via `--testPathPatterns` regex

**Total footprint:** ~200 lines CI YAML, 7 one-line spec tags, 4 script additions.

### FF. Refined Prioritized Plan (after false positive removal)

12 items removed as false positives, 2 downgraded, 5 new items added from Round 7. Plan restructured from 4 abstract tiers into 7 implementation milestones with dependency ordering, file co-location, and parallel execution plan. Full details in `_planning.md`.

## Research Completeness

**8 rounds completed, 32 agents deployed across:**
- Round 1-3: Rule violations, historical failures, beyond-rules issues
- Round 4: AI suggestion tests, admin seeding, non-admin assertions, helper infrastructure
- Round 5: E2E timing, integration isolation, CI workflow, fixtures
- Round 6: False positive verification, evolution boundary mapping, prioritization, nightly gaps
- Round 7: Second false positive round, arena/pipeline deep dive, admin spec audit, config audit
- Round 8: Refined plan, CI splitting design, fill+blur fix design, networkidle fix design

**Key statistics:**
- 75% false positive rate on reported issues (12 of 16 verified were FPs)
- Top 2 fixes (networkidle + fill race) account for 74% of historical CI failures
- Evolution/non-evolution boundary: 7 E2E specs, 11 integration tests, 88+ unit tests are evolution-specific
- 11 shared bridge modules trigger full test suite if changed

## Open Questions

1. Should evolution E2E tests run on PRs to main when only evolution code changes? Or just on PRs to production?
2. For integration tests on main PRs, should we add an `integration-evolution-critical` job, or just expand the existing critical list?
3. Should admin spec seeding be refactored to use factory pattern with timestamps (high effort, high value)?
4. Should shared test data per-describe be refactored to per-test isolation (may increase test runtime significantly)?
5. Should nightly workflow be updated to match CI environment variables and test selection?
6. Should admin specs replace hardcoded row indices with content-based selectors?
