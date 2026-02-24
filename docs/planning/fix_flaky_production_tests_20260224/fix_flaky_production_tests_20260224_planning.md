# Fix Flaky Production Tests Plan

## Background
Production deploy PRs trigger the full E2E test suite (163 tests across 4 shards), unlike PRs to main which only run 10 critical tests. The full suite exposes flakiness that critical-only runs mask. Recent production deploys required 5-7 CI re-runs of identical code before passing, blocking production deployments.

## Requirements (from GH Issue #548)
I want to fix flaky production tests as well as get recommendations on how to make them more reliable and faster going forward.

## Problem
Shard 1/4 fails in 9 out of 9 recent production CI runs. The root causes fall into three categories: (1) one genuinely broken test (`hidden-content.spec.ts`) caused by a real application bug where `getExplanationByIdImpl()` doesn't filter by `delete_status`, (2) six flaky test files with timing/race conditions due to missing waits in Page Object Model methods and individual tests, and (3) infrastructure issues including 80+ uses of the unreliable `networkidle` wait, shared temp files between shards, mock state leakage in integration tests, and `--max-failures=5` hiding the true failure count.

## Options Considered

### Option A: Fix only the top failing tests (minimal)
- Fix hidden-content bug, add waits to top 6 failing specs
- Pros: Fast, targeted
- Cons: Doesn't address systemic issues, new tests will be flaky too

### Option B: Fix tests + add enforcement rules (chosen)
- Fix all identified failures AND add 4 new testing rules with ESLint enforcement
- Add custom ESLint rule for `networkidle`, Claude hook for POM waits
- Pros: Fixes current failures AND prevents future ones
- Cons: More upfront work, `networkidle` migration is large (80+ instances)

### Option C: Option B + full networkidle migration
- Everything in B, plus replace all 80+ `networkidle` instances
- Pros: Complete cleanup
- Cons: Admin specs (currently skipped) don't need fixing now; too large for one PR

**Decision:** Option B — fix all identified failures, add enforcement, migrate `networkidle` only in failing/active tests. Defer admin page `networkidle` migration since those specs are `describe.skip`'d.

## Phased Execution Plan

### Phase 1: One-Line Fixes (eliminate guaranteed failures)

**1.1 Fix hidden-content application bug**
- File: `src/lib/services/explanations.ts:87`
- Change: Add `.eq('delete_status', 'visible')` to `getExplanationByIdImpl()` query
- Impact: Eliminates 2 consistent failures per CI run

**1.2 Fix integration test mock leakage**
- File: `jest.integration.config.js:73`
- Change: `restoreMocks: false` → `restoreMocks: true`
- Impact: Prevents mock implementations persisting between integration tests
- **Risk mitigation:** `restoreMocks: true` restores original implementations between tests. This WILL break 8 evolution integration test files that mock `instrumentation` at module level via `jest.mock()` factories (e.g., `jest.fn(() => NOOP_SPAN)`) and don't re-apply in `beforeEach`. Fix: Add instrumentation mock re-setup to `beforeEach` in each affected evolution file (`evolution-actions`, `evolution-agent-selection`, `evolution-cost-attribution`, `evolution-infrastructure`, `evolution-outline`, `evolution-pipeline`, `evolution-tree-search`, `evolution-visualization`). Run `npm run test:integration` after this change to verify.

**1.3 Remove `--max-failures=5` from CI**
- File: `.github/workflows/ci.yml:261`
- Change 1: Remove `--max-failures=5` from the Playwright command (or raise to `--max-failures=20` to bound worst-case CI time while still revealing most failures)
- Change 2: Add `timeout-minutes: 30` to the `e2e-full` job definition (line ~206). This is required — without it, removing the failure cap lets a broken shard run up to ~60 minutes.
- Impact: Get accurate failure data — see all failures, not just first 5

### Phase 2: Add 4 New Testing Rules + Enforcement

**2.1 Add rules to `docs/docs_overall/testing_overview.md`** (done)
- Rule 9: Never use `networkidle`
- Rule 10: Always unregister route mocks between tests
- Rule 11: Use per-shard/per-worker temp files
- Rule 12: POM methods must wait after actions

**2.2 Add ESLint rule: `no-networkidle`**
- File: `eslint-rules/no-networkidle.js` (new)
- Detects `waitForLoadState('networkidle')` calls in E2E files
- **AST pattern note:** Unlike `no-wait-for-timeout` which only checks method name, this rule must check BOTH the method name (`waitForLoadState`) AND the first argument value (`'networkidle'`). `waitForLoadState('domcontentloaded')` is fine and must NOT be flagged.
- Register in `eslint-rules/index.js`
- Add to the existing `**/e2e/**/*.ts` config block in `eslint.config.mjs` (same block as `no-wait-for-timeout` and `no-silent-catch`) — don't create a duplicate block
- Existing 80+ violations get `// eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration` with tracking issue number
- Add eslint-disable comments via script (not manually) to avoid review noise

**2.3 Update Claude hook: `check-test-patterns.sh`**
- Add check for `networkidle` pattern
- Add check for POM files missing waits after click/submit (heuristic: `async click*` or `async submit*` methods without `waitFor` in body)

**2.4 Fix missing `eslint-disable` on existing `test.skip` violations**
- 6 admin spec files have `test.skip`/`describe.skip` without required `eslint-disable` comment
- Files: `admin-elo-optimization.spec.ts:124`, `admin-evolution.spec.ts:97`, `admin-hall-of-fame.spec.ts:200,342,458`, `admin-evolution-visualization.spec.ts:126`

### Phase 3: Fix Flaky Tests (timing/race conditions)

**3.1 Fix `hidden-content.spec.ts` — replace `networkidle`**
- Lines 102, 128: Replace `waitForLoadState('networkidle')` with `waitForSelector` for specific content elements
- 2 instances

**3.2 Fix `home-tabs.spec.ts` — increase timeout**
- Line ~90: Change `waitForURL` timeout from 10s → 30s
- Add explicit wait for search input to be interactive before typing

**3.3 Fix `action-buttons.spec.ts` — add transition waits**
- Add waits after format toggle clicks (wait for content format to change)
- Add API response wait after save button click

**3.4 Fix `tags.spec.ts` — fix POM `removeTag()` + test waits**
- Fix `ResultsPage.removeTag()` to wait for tag removal to complete
- Fix `ResultsPage.clickApplyTags()` to wait for API response
- Add page reload wait in refresh test before checking tag count

**3.5 Fix `library.spec.ts` — fix POM `clickCardByIndex()`**
- Fix `UserLibraryPage.clickCardByIndex()` to wait for navigation destination
- Fix `UserLibraryPage.searchFromLibrary()` to wait for results

**3.6 Fix `add-sources.spec.ts` — timeout variability**
- Increase source fetch timeout for CI
- Add explicit wait for source validation response

**3.7 Fix `suggestions.spec.ts` — mock setup timing**
- Ensure mock registration completes before page navigation
- Add waits for suggestion panel to be interactive

**3.8 Note: `rewrite.spec.ts` — no longer exists**
- Research identified `rewrite.spec.ts` as failing ~15% of runs, but this file no longer exists
- Rewrite tests are now in `action-buttons.spec.ts` (rewrite button tests) and `regenerate.spec.ts` (rewrite options dropdown)
- Both are already addressed in Phase 3.3 and Phase 2.4 (regenerate.spec.ts has a `test.skip` with proper `eslint-disable`)

### Phase 4: Fix Silent Error Swallowing (Rule 7 violations)

**4.1 Fix `ResultsPage.ts` — 12 empty catch blocks**
- Replace bare `catch {}` with `safeWaitFor()` / `safeIsVisible()` from `error-utils.ts`
- Methods: `getTags()`, `getTagsCount()`, `hasRewriteButton()`, `hasEditButton()`, `getErrorMessage()`, `getWarningMessage()`, `waitForStreamComplete()`, `cancelAddTag()`

**4.2 Fix `test-data-factory.ts` — 7 empty catch blocks**
- Add `console.warn()` with context to all catch blocks
- Track which IDs fail cleanup for debugging

**4.3 Fix `global-setup.ts` — 3 empty catch blocks**
- Log file parse errors, server readiness failures
- Add error type checking (not all errors are "non-critical")

**4.4 Fix `vercel-bypass.ts` — 3 empty catch blocks**
- Check error codes (ENOENT vs unexpected) before ignoring
- Log unexpected errors

### Phase 5: Infrastructure Improvements

**5.1 Fix shared temp files between shards and workers**

**Problem:** Playwright workers within a shard are threads in the same Node.js process — they share the same `process.pid`. With `workers: 2`, two workers concurrently doing read-modify-write on the same JSON file creates a TOCTOU race condition (both read [1,2], one writes [1,2,3], the other overwrites with [1,2,4], losing ID 3).

**Solution:** Switch from JSON read-modify-write to an **append-only line-delimited format** that is safe for concurrent writes:
- `test-data-factory.ts:15` — Change `TRACKED_IDS_FILE` to `/tmp/e2e-tracked-explanation-ids.txt`
- `trackExplanationForCleanup(id)`: Replace `readFileSync` → push → `writeFileSync` with `fs.appendFileSync(TRACKED_IDS_FILE, id + '\n')`. Append is atomic on POSIX for small writes (<PIPE_BUF bytes = 4096).
- `getTrackedExplanationIds()`: Read file, split by `\n`, filter empty lines, deduplicate
- `clearTrackedExplanationIds()`: Delete the file (or truncate)
- Same pattern for `/tmp/e2e-tracked-report-ids.txt`
- **Do NOT rename `/tmp/e2e-prod-test-data.json`** — this is written once by global-setup before workers start and read once by teardown. No race condition here.
- **Update `global-teardown.ts`:** `cleanupAllTrackedExplanations()` already reads from a single file — the append-only format handles both shard and worker isolation without globbing. Each shard process has its own file path on its own CI runner. For local development (single process), all workers safely append to the same file.

**5.2 Add `page.unrouteAll()` to test fixtures**

**Important:** `auth.ts` does NOT extend `base.ts` — both independently import `test` from `@playwright/test`. Adding `unrouteAll` only to `base.ts` would miss 19+ spec files that import from `auth.ts`.

**Fix: Add `unrouteAll` to BOTH fixture files:**

1. File: `src/__tests__/e2e/fixtures/base.ts:39` — Add between `await use(page)` and `await page.close()`:
   ```ts
   await use(page);
   await page.unrouteAll({ behavior: 'wait' });  // Clean up route mocks
   await page.close();
   ```

2. File: `src/__tests__/e2e/fixtures/auth.ts:138` — Add after `await use(page)` (auth.ts currently has no page.close()):
   ```ts
   await use(page);
   await page.unrouteAll({ behavior: 'wait' });  // Clean up route mocks
   ```

3. File: `src/__tests__/e2e/fixtures/admin-auth.ts:152` — Add between `await use(page)` and `await context.close()`:
   ```ts
   await use(page);
   await page.unrouteAll({ behavior: 'wait' });  // Clean up route mocks
   await context.close();
   ```

- This ensures ALL specs get route cleanup: unauthenticated (via `base.ts`), authenticated (via `auth.ts`), and admin (via `admin-auth.ts`)
- Prevents route handler accumulation across tests within the same worker

**5.3 Shard rebalancing**
- Shard 1/4 fails 9/9 runs because Playwright's alphabetical assignment puts ALL top-failing tests (01-auth, 01-home, 02-search, 03-library, 04-content-viewing) in shard 1
- After fixing individual tests (Phase 3), shard 1 will still be the heaviest. Any new test in folders 01-04 recreates the hotspot.
- **Fix:** Add a `playwright.config.ts` shard configuration that distributes by test weight instead of alphabetical. Playwright doesn't support custom shard assignment natively, but we can:
  - Option A: Rename test directories to spread load (e.g., `04-content-viewing` → `50-content-viewing`) — simple but fragile
  - Option B: Use Playwright's `testMatch` per-project config to manually assign spec files to "virtual shards" — more control but harder to maintain
  - Option C: Accept alphabetical assignment but monitor shard timing after Phase 3 fixes. If shard 1 still takes >2x longer than other shards, revisit.
- **Recommended:** Option C — fix the flaky tests first (Phase 3), then measure. The shard imbalance matters most when tests fail; with fixes applied, pass time should be similar across shards.

**5.4 Batch `networkidle` → custom waits in non-admin files**
- Replace in `hidden-content.spec.ts` (2 instances) — Phase 3.1
- Replace in `import-articles.spec.ts` (8 instances)
- Replace in `auth.unauth.spec.ts` (2 instances)
- Admin page POMs/specs (60+ instances) — deferred, tests are `describe.skip`'d
- Add `eslint-disable` comments to all remaining instances

## Rollback Plan

Each phase can be reverted independently:
- **Phase 1.1** (hidden-content fix): Revert the `.eq('delete_status', 'visible')` line. Low risk — this is a bug fix, reverting re-exposes the bug but doesn't break tests.
- **Phase 1.2** (restoreMocks): Revert line 73 in `jest.integration.config.js` back to `restoreMocks: false`. **Trigger:** If integration tests fail on 3+ files after the change, revert this line first and investigate individually.
- **Phase 1.3** (--max-failures): Re-add `--max-failures=5` to `ci.yml`. **Trigger:** If CI time exceeds 20 minutes per shard.
- **Phase 2** (ESLint rules): Remove the rule from `eslint.config.mjs` and `eslint-rules/index.js`. No test behavior impact.
- **Phases 3-5** (test/infrastructure fixes): Revert individual file changes. Each spec fix is independent.

**Rollback criteria:** If any phase causes MORE CI failures than before (baseline: 2-5 failures per run in shard 1), revert that phase immediately.

## Testing

### Verification Strategy
1. **Run integration tests** after Phase 1.2 (restoreMocks change) — `npm run test:integration` — must pass before proceeding
2. **Run full E2E suite locally** after Phase 3 to confirm flaky tests now pass
3. **Create intermediate CI checkpoint:** Push to a PR targeting `main` after Phases 1-3 to run critical tests in CI (fast feedback)
4. **Create final PR targeting production** after all phases — triggers full 4-shard CI run
5. **Compare CI pass rate** — goal is first-attempt pass (vs current 5-7 attempts)
6. **Note:** Local runs use different timeout/retry/parallelism settings than CI (local: 30s timeout, 0 retries; CI: 60s timeout, 2 retries). Local passes do not guarantee CI passes — the intermediate CI checkpoint (step 3) catches this.

### Specific Test Verification
- `hidden-content.spec.ts` — should pass consistently after Phase 1.1 + 3.1
- `home-tabs.spec.ts` — should pass consistently after Phase 3.2
- `action-buttons.spec.ts` — should pass consistently after Phase 3.3
- `tags.spec.ts` — should pass consistently after Phase 3.4
- `library.spec.ts` — should pass consistently after Phase 3.5
- Integration tests — run `npm run test:integration` after Phase 1.2

### ESLint Verification
- Run `npx eslint src/__tests__/e2e/ --rule 'flakiness/no-networkidle: error'` after Phase 2.2
- Verify all existing `networkidle` instances have `eslint-disable` comments
- Verify new rule catches violations in new code

## Enforcement Summary

| Rule | Enforcement Mechanism | Catch Point |
|------|-----------------------|-------------|
| Rule 9: No `networkidle` | ESLint `flakiness/no-networkidle` | Lint (CI + IDE) |
| Rule 10: Unregister route mocks | Fixture teardown in `base.ts` + `auth.ts` (after `use()`) | Runtime (automatic) |
| Rule 11: Per-worker temp files | Claude hook warning + code review | Edit-time + review |
| Rule 12: POM waits after actions | Claude hook heuristic check | Edit-time |
| Rules 1-8 (existing) | Existing ESLint rules + Claude hook | Lint + edit-time |

## Documentation Updates

- `docs/docs_overall/testing_overview.md` — 4 new rules added (9-12), enforcement table
- `docs/feature_deep_dives/testing_setup.md` — Update POM patterns section with wait-after-action examples
- `docs/docs_overall/environments.md` — Update CI section to reflect `--max-failures` removal
- `docs/feature_deep_dives/error_handling.md` — No changes needed (error-utils.ts patterns unchanged)
