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

## Open Questions

1. Should evolution E2E tests run on PRs to main when only evolution code changes? Or just on PRs to production?
2. Should the CI detect "evolution-only" changes at a finer grain (e.g., `evolution/` or `src/app/admin/quality/evolution*`) or use a simpler tag-based approach?
3. For integration tests on main PRs, should we add an `integration-evolution-critical` job, or just expand the existing critical list?
4. Should the networkidle eslint-disables be fixed now or tracked as separate work?
5. Should admin spec seeding be refactored to use factory pattern with timestamps (high effort, high value)?
6. Should shared test data per-describe be refactored to per-test isolation (may increase test runtime significantly)?
