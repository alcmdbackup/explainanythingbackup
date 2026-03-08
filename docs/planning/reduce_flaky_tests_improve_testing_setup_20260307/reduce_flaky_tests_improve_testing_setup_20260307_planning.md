# Reduce Flaky Tests Improve Testing Setup Plan

## Background
Fix any flaky tests across the test suite, then look for ways to improve the test setup and test rules so that testing is faster and more reliable.

## Requirements (from GH Issue #670)
- Fix any flaky tests (E2E, integration, unit)
- Look for ways to improve test setup for faster execution
- Look for ways to improve test rules for more reliable testing
- Update testing documentation to reflect changes

## Problem

The test suite has three categories of issues: broken tests on main (hidden-content, report-content), flaky tests caused by SQL ambiguity (tags.spec.ts via `refresh_explanation_metrics`), and systemic gaps in test infrastructure (no mock cleanup in unit tests, no CI caching, incomplete ESLint rule coverage, no flaky test reporting). A prior project (fix_flaky_production_tests_20260224) addressed E2E flakiness but deferred unit/integration reliability, CI speed, and lint rule hardening. This project picks up those deferred items plus newly discovered issues from CI failure analysis.

## Options Considered

1. **Fix broken tests only** — Minimal scope, fixes immediate CI failures but doesn't improve reliability long-term
2. **Fix broken tests + infrastructure hardening** — Fix tests, add jest.config mock cleanup, CI caching, ESLint improvements. Best ROI.
3. **Full overhaul** — Everything in option 2 plus shard rebalancing, flaky test reporter, integration test refactoring. Too large for one project.

**Selected: Option 2** — Fix broken/flaky tests, then harden infrastructure for ongoing reliability and speed.

## Phased Execution Plan

### Phase 1: Fix Broken/Flaky E2E Tests ✅
Fix tests that are broken or flaky on main, identified from CI failure analysis.

**1a. hidden-content.spec.ts** ✅
- Change `topic_name` → `topic_title` (correct column name)
- Add upsert-or-find pattern to avoid duplicate topic creation failures
- Files: `src/__tests__/e2e/specs/04-content-viewing/hidden-content.spec.ts`

**1b. report-content.spec.ts** ✅
- Change submit button test from click+error-text to `toBeDisabled()` check (UI now disables button instead of showing validation error)
- Change `toBeEnabled()` to `toBeVisible()` in z-index test
- Files: `src/__tests__/e2e/specs/04-content-viewing/report-content.spec.ts`

**1c. Fix `explanationid` ambiguity in `refresh_explanation_metrics` RPC** ✅
- Create new migration qualifying all column references with table aliases in subqueries
- The RETURNS TABLE `explanationid` column clashed with `userLibrary.explanationid` and `userExplanationEvents.explanationid`
- This caused tags.spec.ts flakiness (metrics RPC error → tags don't load → 10s timeout)
- Files: `supabase/migrations/20260307000001_fix_metrics_ambiguous_column.sql`
- Rollback: The migration uses `CREATE OR REPLACE FUNCTION` which is idempotent. To revert, re-run the original function definition from `20251109053825_fix_drift.sql` lines 391-438. The function signature is unchanged (same params and return type), so no dependent code changes needed. Note: `RESET search_path` from migration `20260114121410` uses default search_path, which is also the default when CREATE OR REPLACE omits a SET clause — no conflict.

### Phase 2: Jest Config Mock Cleanup
Add global mock cleanup to unit test config to prevent mock state leaking between tests.

**2a. Add `clearMocks: true` to jest.config.js**
- Safe change — clears mock call history between tests
- Integration config already has this
- Files: `jest.config.js`

**2b. Add `restoreMocks: true` to jest.config.js**
- Requires fixing 17 unit test files that set `mockReturnValue` at module level without `beforeEach` re-initialization
- These files will break because `restoreMocks` undoes `mockReturnValue` after each test
- Fix pattern: move mock setup from module scope into `beforeEach` blocks
- Files: `jest.config.js` + these 17 unit test files:
  - `src/app/error/page.test.tsx`
  - `src/app/admin/evolution/runs/page.test.tsx`
  - `src/app/admin/evolution/start-experiment/page.test.tsx`
  - `src/app/admin/evolution/invocations/page.test.tsx`
  - `src/app/admin/evolution/analysis/_components/ExperimentHistory.test.tsx`
  - `src/app/admin/evolution/variants/page.test.tsx`
  - `src/app/admin/evolution/prompts/[promptId]/page.test.tsx`
  - `src/app/admin/evolution/experiments/page.test.tsx`
  - `src/app/admin/evolution/experiments/[experimentId]/ReportTab.test.tsx`
  - `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailTabs.test.tsx`
  - `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.test.tsx`
  - `src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.test.tsx`
  - `src/editorFiles/lexicalEditor/preprocessing.fixtures.test.ts`
  - `src/editorFiles/aiSuggestion.golden.test.ts`
  - `src/editorFiles/aiSuggestion.pipeline.test.ts`
  - `src/editorFiles/markdownASTdiff/markdownASTdiff.fixtures.test.ts`
  - `src/reducers/pageLifecycleReducer.test.ts`
  - Note: 4 integration test files (experiment-metrics, evolution-cron-gate, strategy-resolution, manual-experiment) were excluded — they run under `jest.integration.config.js` which already has `restoreMocks: true`

### Phase 3: CI Pipeline Speed Improvements
Add caching to CI workflow for faster runs (~2-3 min savings per full run).

**3a. Next.js build cache**
- Cache `.next/cache` between CI runs
- Cache key: `nextjs-cache-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`
- Restore key fallback: `nextjs-cache-${{ runner.os }}-` (partial match allows reuse across dependency changes)
- Saves 45-60s per full run
- Files: `.github/workflows/ci.yml`

**3b. TypeScript incremental cache**
- Modify existing `tsconfig.ci.json` to add `incremental: true` and `tsBuildInfoFile`
- Note: `tsc --noEmit` ignores `incremental` — must use `tsc --incremental --noEmit` explicitly in CI command, or use `emitDeclarationOnly` approach
- Cache key: `tsc-cache-${{ runner.os }}-${{ hashFiles('tsconfig.ci.json', 'package-lock.json') }}`
- Saves 15-20s per run
- Files: `.github/workflows/ci.yml`, `tsconfig.ci.json`

**3c. Jest cache preservation**
- Set explicit `cacheDirectory: '/tmp/jest-cache'` in jest.config.js and cache that path
- Cache key: `jest-cache-${{ runner.os }}-${{ hashFiles('package-lock.json') }}`
- Saves 10-15s per run
- Files: `.github/workflows/ci.yml`

### Phase 4: ESLint Rule Improvements
Harden existing rules and add new ones for flakiness prevention.

**4a. Add tests for existing flakiness rules**
- 0/5 flakiness rules currently have tests
- Add colocated test files following the design-system rule pattern (e.g., `eslint-rules/no-networkidle.test.js`)
- Rules: `no-networkidle`, `no-wait-for-timeout`, `no-silent-catch`, `no-test-skip`, `max-test-timeout`
- Files: `eslint-rules/no-networkidle.test.js`, `eslint-rules/no-wait-for-timeout.test.js`, etc.

**4b. Extend `no-wait-for-timeout` to catch `await new Promise(r => setTimeout(r, N))`**
- Currently only catches `page.waitForTimeout()` — misses the Promise/setTimeout pattern (6 uncaught instances)
- Add AST visitor for `AwaitExpression > NewExpression[callee.name="Promise"]` with `setTimeout` callback
- This consolidates the setTimeout pattern into the existing rule (no separate `no-fixed-sleep` rule needed)
- Files: `eslint-rules/no-wait-for-timeout.js`, `eslint-rules/no-wait-for-timeout.test.js`

**4c. New rule: `no-hardcoded-tmpdir`**
- Catches `/tmp/` paths without worker index (7 hardcoded instances found)
- Enforces Rule 11 (per-worker temp files)
- Files: `eslint-rules/no-hardcoded-tmpdir.js`, `eslint-rules/no-hardcoded-tmpdir.test.js`, `eslint-rules/index.js`, `eslint.config.mjs`

### Phase 5: Documentation Updates
Update testing docs to reflect all changes made.

- `docs/docs_overall/testing_overview.md` — New ESLint rules, mock cleanup settings
- `docs/feature_deep_dives/testing_setup.md` — Jest config changes, CI caching
- `docs/planning/reduce_flaky_tests_improve_testing_setup_20260307/_progress.md` — Execution tracking

## Deferred (out of scope)
- **Shard rebalancing** — 30% variance between E2E shards (suggestions.spec.ts bottleneck in Shard 2)
- **Flaky test reporter** — Custom Playwright reporter to surface tests passing only after retries (~150 LOC)
- **Integration test refactoring** — Fix 8 files with `clearAllMocks` vs `resetAllMocks` issues and test order dependencies
- **search-generate.spec.ts POM hardening** — `waitForStreamingComplete()` cascading race conditions (already fixed by commit `a15ae2cf`)
- **POM enforcement pattern** — Comprehensive Page Object Model enforcement

## Testing

### Automated
- All existing E2E tests must pass (especially hidden-content, report-content, tags)
- All existing unit tests must pass after jest.config.js changes
- New ESLint rule tests must pass
- CI workflow changes verified by running CI on PR

### Manual Verification
- Verify `refresh_explanation_metrics` RPC works correctly in dev Supabase after migration
- Verify CI run times decrease after caching changes
- Verify ESLint catches the new patterns correctly

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` — New ESLint rules, mock cleanup settings, updated rule list
- `docs/feature_deep_dives/testing_setup.md` — Jest config changes, CI caching, known issues updates
- `docs/feature_deep_dives/testing_pipeline.md` — No changes expected
- `docs/docs_overall/debugging.md` — No changes expected
