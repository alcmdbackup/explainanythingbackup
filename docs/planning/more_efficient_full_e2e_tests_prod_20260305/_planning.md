# Refined Prioritized Action Plan — Test Efficiency & Flakiness

## Context

This plan refines the original Section X prioritized plan from the research document.
Rounds 6-7 found that **75% of reported issues were FALSE POSITIVES** (12 of 16 verified claims).
This plan removes all false positives, downgrades partially-true items, and adds newly verified issues from Round 7.

---

## Items REMOVED (False Positives from Sections U and Y)

The following were in the original plan but are **confirmed false positives** and excluded:

| Item | Why Removed |
|------|-------------|
| `save-blocking.spec.ts:151` while loop stale counts | `.toPass()` retries full callback, re-fetches DOM each time |
| `home-tabs.spec.ts` goto without waitForLoadState | Every `goto('/')` IS followed by `waitForLoadState('domcontentloaded')` |
| `search-generate.spec.ts:28` Promise.all race | `search()` is synchronous fill+click, no debounce issue |
| CI `--shard` conflicts with `--project` | Playwright handles both flags correctly; they are orthogonal |
| CI `unit-tests` deadlocks docs-only PRs | GitHub Actions skips jobs with unmet `if` conditions cleanly |
| `ResultsPage.ts:191` tag removal `.catch` | Intentional best-effort animation wait with eslint-disable justification |
| `ResultsPage.ts:197` apply button `.catch` | Same — best-effort button-hide animation wait |
| `suggestions-test-helpers.ts:237` infinite polling | Has `while (Date.now() - startTime < timeout)` with 30s default |
| `suggestions-test-helpers.ts:307` double-click race | Uses single click with `force: true`, then retry. Standard pattern. |
| `test-data-factory.ts:305` appendFileSync corruption | appendFileSync is atomic for small writes on Linux/ext4 |
| `global-teardown.ts:161` Promise.all needs allSettled | Inner `deleteVectorsForExplanation()` never rejects; errors caught internally |
| `global-setup.ts:110-115` `.single()` without error | Error implicitly handled; `.single()` returns null, code checks `if (existingAssoc)` |

## Items DOWNGRADED (Partially True)

| Item | Status | Rationale | New Priority |
|------|--------|-----------|-------------|
| `mockReturnExplanationTimeout` never-resolving promise | Managed by `unrouteAll` cleanup in fixtures | LOW — monitor only |
| `auth.ts:31-36` cached session validation | JWT is self-validating; server-side revocation risk negligible in CI | LOW — no action needed |

---

## Milestone 1: Fill Race + NetworkIdle (Highest ROI)

**Goal:** Fix the two patterns responsible for ~74% of historical CI failures.
**Estimated LOC:** ~64
**Files touched together, no dependencies on other milestones.**

### 1A. React fill() race — Add blur() after high-risk fill() calls (20 instances)

These are the proven #1 source of flakiness. `fill()` on React controlled inputs doesn't reliably trigger `onChange` in CI.

| File | Lines | Count |
|------|-------|-------|
| `e2e/specs/home-tabs.spec.ts` | 50, 77, 93, 116, 132, 239, 258 | 7 |
| `e2e/specs/errors.spec.ts` | 157 | 1 |
| `e2e/specs/add-sources.spec.ts` | 51, 86, 114, 146, 177, 188 | 6 |
| `e2e/specs/library.spec.ts` | 111 | 1 |
| `e2e/specs/report-content.spec.ts` | 164 | 1 |
| `e2e/specs/content-boundaries.spec.ts` | 196 | 1 |
| `e2e/specs/admin-arena.spec.ts` | 252 | 1 |
| `e2e/specs/user-interactions.spec.ts` | 139 | 1 |

**Pattern:** After each `fill()`, add `await input.blur()` and where a button enable depends on the value, add `await expect(button).toBeEnabled()`.

### 1B. Replace 8 networkidle with domcontentloaded + element waits

| File | Line | Replacement Element |
|------|------|-------------------|
| `admin-experiment-detail.spec.ts` | 150 | `text=Experiment History` |
| `admin-experiment-detail.spec.ts` | 176 | `text=Rating Optimization` |
| `admin-experiment-detail.spec.ts` | 199 | `button:has-text("Analysis")` |
| `admin-experiment-detail.spec.ts` | 213 | `th:has-text("Run ID")` |
| `admin-experiment-detail.spec.ts` | 229 | `text=Rating Optimization` |
| `admin-arena.spec.ts` | 298 | `[data-testid="leaderboard-table"]` |
| `auth.unauth.spec.ts` | 240, 260 | localStorage check (skipped tests, low priority) |

---

## Milestone 2: POM Wait Methods + Route Registration

**Goal:** Eliminate the systemic "click without waiting" pattern across POMs.
**Estimated LOC:** ~120
**Depends on:** Nothing. Can run in parallel with Milestone 1.

### 2A. Add post-action waits to 19 POM methods

| POM File | Methods Needing Waits |
|----------|----------------------|
| `LoginPage.ts` | `clickSubmit` (nav wait), `toggleToSignup` (form visible), `toggleRememberMe` (state) |
| `ResultsPage.ts` | `addTag`, `submitAISuggestion`, `clickEditButton`, `clickPublishButton`, `selectMode`, `clickAddTagTrigger`, `filterTagDropdown`, `selectTagFromDropdown`, `clickChangesPanelToggle` |
| `UserLibraryPage.ts` | `searchFromLibrary` (input value) |
| `ImportPage.ts` | `clickCancel` (modal close), `clickBack` (modal state) |
| `SearchPage.ts` | `fillQuery` (button enabled), `clickSearch` (navigation) |
| `AdminUsersPage.ts` | `search` (table update) |
| `AdminWhitelistPage.ts` | `addAlias` (alias list update) |

### 2B. Add blur() after 16 medium-risk POM fill() calls

Files: `AdminWhitelistPage` (4), `AdminUsersPage` (3), `AdminContentPage` (1), `AdminCandidatesPage` (1), `UserLibraryPage` (1), `ResultsPage` (3), `ImportPage` (1)

### 2C. Add waitForRouteReady between page.route() and navigation (3 files)

| File | Issue |
|------|-------|
| `error-recovery.spec.ts:114-123` | Mock registered after unrouteAll but before waitForRouteReady |
| `errors.spec.ts:67-73` | Tight race on slow CI |
| `search-generate.spec.ts:24-26` | No waitForRouteReady between route and navigate |

---

## Milestone 3: Admin Spec Robustness (NEW from Round 7)

**Goal:** Fix verified brittle patterns in admin E2E specs.
**Estimated LOC:** ~100
**Depends on:** Nothing. Can run in parallel with Milestones 1-2.

### 3A. Replace hardcoded row indices with content-based selectors

Admin specs use `lb-row-0`, `delete-entry-1` etc. If leaderboard reorders due to other test data, wrong row is targeted.

**Files:** `admin-arena.spec.ts`, other admin specs using `nth-child()` or row indices.

**Fix:** Use selectors that match row content (e.g., `row:has-text("test topic name")`) instead of positional indices.

### 3B. Replace exact row count assertions with range/minimum assertions

Current `toHaveCount(2)` and `toHaveCount(5)` fail if orphaned data exists from prior runs.

**Fix:** Use `toHaveCount` only when test fully controls data, otherwise use `expect(count).toBeGreaterThanOrEqual(expectedMin)` with a meaningful minimum.

### 3C. Add error checking to admin spec cleanup functions

All 9 admin specs have cleanup functions that silently ignore delete failures, leaving orphaned data that causes subsequent run failures.

**Files:** `admin-evolution.spec.ts`, `admin-arena.spec.ts`, `admin-elo-optimization.spec.ts`, `admin-evolution-visualization.spec.ts`, `admin-experiment-detail.spec.ts`, `admin-article-variant-detail.spec.ts`, `admin-strategy-registry.spec.ts`, `admin-content.spec.ts`, `admin-reports.spec.ts`

**Fix:** Check error response from each delete call, log warnings on failure.

### 3D. Replace selectOption by index with selectOption by value

`admin-arena.spec.ts` uses `selectOption({ index: 1 })` which breaks if option order changes.

**Fix:** Use `selectOption({ value: 'expected_value' })` or `selectOption({ label: 'Expected Label' })`.

---

## Milestone 4: Test Data Isolation + Fixture Hardening

**Goal:** Prevent cross-worker data collisions and silent fixture failures.
**Estimated LOC:** ~90
**Depends on:** Milestone 3 (admin cleanup fixes should land first to avoid conflict).

### 4A. Add timestamp/workerIndex suffix to 9 admin spec test data names

Current: `[TEST] Evolution E2E Topic` (shared, collision-prone).
Target: `[TEST] Evolution E2E Topic ${Date.now()}-w${workerIndex}`.

**Files:** Same 9 admin specs as 3C.

### 4B. Switch tracked IDs to per-worker file pattern

Current: `/tmp/e2e-tracked-explanation-ids.txt` (shared).
Target: `/tmp/e2e-tracked-explanation-ids-worker-${workerIndex}.txt`.

**Files:** `test-data-factory.ts`, `global-teardown.ts`

**How workerIndex reaches the factory:** Pass `workerInfo.workerIndex` from Playwright fixtures as a parameter to `trackExplanationForCleanup()`, or set `process.env.TEST_WORKER_INDEX` in the worker fixture setup. The factory is a plain helper module (not a fixture), so it needs the index injected.

**IMPORTANT:** `global-teardown.ts` must be updated to glob for ALL per-worker files (`/tmp/e2e-tracked-explanation-ids-worker-*.txt`) and aggregate IDs from all of them before cleanup. Without this glob update, NO tracked IDs will be cleaned up after the switch.

### 4C. Individual try/catch for global teardown cleanup steps

Current: Single try/catch wraps 6 sequential steps; one failure skips the rest.
Target: Each step in its own try/catch so cleanup is best-effort across all steps.

**Files:** `global-teardown.ts`

### 4D. Fix global-setup tag upsert error checks (3 instances)

Tag upsert errors are destructured but never checked. Upsert failures are completely hidden.

**Files:** `global-setup.ts:98-102`, `global-setup.ts:110-115`, `global-setup.ts:323-327`

### 4E. Guard trackExplanationForCleanup against NaN

Current: Silently returns on NaN explanationId, orphaning test data.
Target: Throw error on NaN to surface the bug immediately.

**Files:** `test-data-factory.ts:301`

---

## Milestone 5: Integration Test Hygiene

**Goal:** Fix silent skips and timing fragility in integration tests.
**Estimated LOC:** ~60
**Depends on:** Nothing. Can run in parallel with all other milestones.

### 5A. Change `if (!tablesReady) return` to `describe.skip()` in 11 integration tests

Tests currently appear to PASS when they actually skip silently. This masks real failures.

**Files:** All 11 evolution integration test files.

**Fix:** Replace the `if (!tablesReady) return;` guard at the top of each `it()` block with a `describe`-level conditional skip using Jest's API (NOT Vitest's `describe.skipIf` which is unavailable).

**IMPORTANT:** `checkTables()` is async but `describe` blocks are synchronous. The check must run at **module scope** using top-level await (supported in Jest 30 ESM mode) BEFORE the describe block is registered — NOT inside `beforeAll`:
```typescript
// Top-level await at module scope (Jest 30 ESM)
const tablesReady = await checkTables();
const describeOrSkip = tablesReady ? describe : describe.skip;
describeOrSkip('Evolution Pipeline', () => {
  // beforeAll/beforeEach/it blocks as normal — no per-test tablesReady checks
});
```
If top-level await is unavailable (CJS mode), wrap the entire file body in an async IIFE that calls `checkTables()` then registers the describe block.

### 5B. Fix silent skip pattern in manual-experiment and others (NEW from Round 7)

`if (!tablesReady || createdExperimentIds.length === 0) return;` marks tests as PASSED when skipped.

**Files:** `manual-experiment.integration.test.ts` and similar patterns.

### 5C. Replace fixed timing assertions with relative thresholds

| File | Current | Fix |
|------|---------|-----|
| `logging-infrastructure:146` | `<10ms/call` | Use `<100ms/call` or relative to baseline |
| `tag-management:213` | `<5000ms` | Use generous threshold or skip in CI |

---

## Milestone 6: CI Infrastructure — Evolution Split

**Goal:** Run only relevant tests based on changed files.
**Estimated LOC:** ~166
**Depends on:** Milestones 1-4 should land first so the split tests are already more stable.

### 6A. Add evolution-specific change detection to ci.yml

Use the verified path patterns from Section V to classify changes:
- `EVOLUTION_ONLY_PATHS` -> run evolution tests only
- `SHARED_PATHS` -> run all tests
- Everything else -> run non-evolution tests only

**Additional paths to include (from review):**
- `src/app/admin/quality/optimization/` — evolution optimization UI (add to EVOLUTION_ONLY_PATHS)

**Unit test handling on split paths:** Update `unit-tests` job `if` condition to also run on `evolution-only` and `non-evolution-only` paths. Current condition `path == 'full'` means unit tests are skipped on split paths. Change to:
```yaml
if: needs.detect-changes.outputs.path != 'fast'
```

**Transition plan for existing full jobs:** REMOVE `e2e-full` and `integration-full` jobs entirely. Replace with `e2e-evolution` + `e2e-non-evolution` and `integration-evolution` + `integration-non-evolution`. When `path=full`, both split pairs run, providing identical coverage. Add `if` conditions that include both the split path AND full path:
```yaml
if: github.base_ref == 'production' && (path == 'evolution-only' || path == 'full')
```

**Behavioral change (intentional improvement):** The old `e2e-full`/`integration-full` jobs had NO path condition — they ran on ALL production PRs including docs-only changes. The new split jobs correctly skip on `path=fast`. This is an improvement (no need to run E2E for docs-only PRs to production), but should be noted in the PR description.

### 6B. Add @evolution tag to 7 E2E specs (CLI --grep, NO new Playwright project)

Tag files: `admin-evolution.spec.ts`, `admin-arena.spec.ts` (has TWO top-level describes — tag both), `admin-evolution-visualization.spec.ts`, `admin-experiment-detail.spec.ts`, `admin-elo-optimization.spec.ts`, `admin-strategy-registry.spec.ts`, `admin-article-variant-detail.spec.ts`

Use CLI `--grep=@evolution` / `--grep-invert=@evolution` for filtering. Do NOT add a new Playwright project — CLI flags are simpler and avoid duplicating device configs. Note: `--grep-invert` applies globally across all projects in a run (not per-project), which is correct since no unauth test uses @evolution.

**grepInvert interaction:** In production, `playwright.config.ts` sets `grepInvert: /@skip-prod/`. CLI `--grep-invert` may OVERRIDE rather than union with config `grepInvert`. To be safe, the `test:e2e:non-evolution` script must include BOTH patterns:
```
playwright test --project=chromium --grep-invert="@evolution|@skip-prod" --project=chromium-unauth
```
This ensures both `@evolution` AND `@skip-prod` tests are excluded regardless of Playwright's override vs union behavior.

### 6C. Add evolution integration test CI job

Create `test:integration:evolution` script in package.json with pattern:
`evolution-|arena-|strategy-|manual-experiment`

### 6D. Fix nightly missing env vars + admin seeding

Add to `e2e-nightly.yml`: `PINECONE_NAMESPACE`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `NEXT_PUBLIC_USE_AI_API_ROUTE`, and the `seed-admin-test-user.ts` step.

---

## Milestone 7: Low-Priority Cleanup

**Goal:** Address minor verified issues. Do opportunistically or as part of nearby changes.
**No timeline pressure.**

| Item | File(s) | Notes |
|------|---------|-------|
| Fix `isProduction ? 2 : 2` dead code | `playwright.config.ts:89` | Trivial one-liner |
| Fix 3 always-true assertions | `tags.spec.ts:68`, `hidden-content.spec.ts:119`, `save-blocking.spec.ts:115` | Replace with specific expected values |
| Replace deprecated `waitForSelector` in suggestion helpers | `suggestions-test-helpers.ts:66` | Use locator API |
| Surface build errors in CI | `ci.yml` | Separate build step from start |
| Duration-based shard balancing | `ci.yml` | Add timing manifest |
| Vercel bypass cookie refresh | `vercel-bypass.ts` | Add mid-run refresh for long tests |
| Fix `client-logging.spec.ts` tight 10s timeout | `client-logging.spec.ts:15-17` | Increase to 30s |
| Conditional test logic hiding failures | `viewing.spec.ts:72`, `errors.spec.ts:100` | Replace if/else with explicit assertions |
| `auth.spec.ts:68-74` Promise.race catch | `auth.spec.ts` | Add proper state verification after race |
| Add retry logic for admin beforeAll seeding | All admin specs | Wrap seeding in retry with timeout |
| Browser-specific cache key in CI | `ci.yml` | Match nightly pattern |

---

## Parallel Execution Summary

```
Week 1:  [Milestone 1: fill+networkidle] [Milestone 5: integration hygiene]
         [Milestone 2: POM waits]         [Milestone 3: admin robustness]

Week 2:  [Milestone 4: data isolation]    (depends on M3 landing)
         [Milestone 6: CI evolution split] (depends on M1-4 for stability)

Ongoing: [Milestone 7: low-priority cleanup]
```

## Rollback Plan

If CI splitting (Milestone 6) causes issues after merging:

1. **Quick revert (single commit):** Revert the detect-changes script to output only `fast`/`full`. Restore `e2e-full`/`integration-full` jobs with original conditions. Remove the 4 split jobs. The @evolution tags on specs are harmless and can stay.

2. **Partial rollback:** If only integration splitting fails, revert `integration-evolution`/`integration-non-evolution` jobs and restore `integration-full`. E2E split can remain if working.

3. **Verification before merge:** Run `npx playwright test --project=chromium --grep=@evolution --list` and `--grep-invert=@evolution --list` to verify the union equals the full test count. Run `npx jest --listTests` with both testPathPatterns to verify no files fall through cracks.

## Expected Impact

| Milestone | Historical Failure % Addressed | Effort |
|-----------|-------------------------------|--------|
| M1: fill + networkidle | ~74% of timing failures | ~64 LOC |
| M2: POM waits + routes | ~15% of timing failures | ~120 LOC |
| M3: Admin robustness | Prevents orphan-cascade failures | ~100 LOC |
| M4: Data isolation | Prevents cross-worker collisions | ~90 LOC |
| M5: Integration hygiene | Eliminates silent false-passes | ~60 LOC |
| M6: CI evolution split | ~40% runtime reduction on non-evolution PRs | ~166 LOC |
| M7: Cleanup | Minor quality improvements | Varies |
