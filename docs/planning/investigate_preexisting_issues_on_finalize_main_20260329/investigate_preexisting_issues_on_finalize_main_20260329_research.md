# Investigate Preexisting Issues On Finalize Main Research

## Problem Statement
Main branch has accumulated test failures that surface when running /finalize. Despite PRs being merged with CI passing (via fast-path change detection that skipped E2E), many tests are now failing. Need to identify all root causes — column mismatches from migrations, missing env vars, flaky tests, etc.

## Requirements (from GH Issue #NNN)
- Identify ALL causes of test failures on main branch
- Categorize: migration mismatches, flaky tests, missing env config, etc.
- Document fixes needed for each issue

## High Level Summary

Investigation identified **8 distinct failure categories** across 3 root cause types:
1. **Schema mismatches** (5 issues) — migrations renamed/dropped columns but code still references old names
2. **Missing CI env vars** (3 issues) — API keys not configured in staging GitHub environment
3. **Flaky tests** (3 issues) — timing/hydration races in E2E specs
4. **CI fast-path bug** — migrations-only PRs were classified as "fast" (skipping all tests) because `.sql` files don't match the code-change pattern

The most impactful are the schema mismatches, which cause ~17 evolution E2E tests to fail deterministically and block the admin seed step.

### How Failures Accumulated

Every schema mismatch involved a migration in one PR and code in a different PR. The enabling factors:

1. **Supabase silently ignores unknown columns on insert/upsert** — wrong column names never cause runtime errors, just silently lose data
2. **CI fast-path classified migration-only PRs as "no code changes"** — `.sql` files didn't match the `\.(ts|tsx|js|jsx|json|css)$` pattern, so E2E tests were skipped
3. **No CI check validates TypeScript interfaces against `database.types.ts`** — hand-written types (`PromptMetadata`, `StrategyListItem`, Zod schemas) can drift from the auto-generated DB types without detection

### Git History Per Issue

| Issue | Migration PR | Code Wrong Since | Same PR? | Was Code Ever Correct? | Root Cause |
|---|---|---|---|---|---|
| A1: `added_by`→`created_by` | #250 (Jan 16) | #270 (Jan 18) | No | Never | Seed script guessed wrong column name |
| A2: `prompts.title`→`name` | #811 (Mar 25) | Pre-existing types.ts | No | Yes (before rename) | Migration didn't update TS interface |
| A3: Dropped strategy cols | #800 (Mar 24) | #808 (Mar 25) | No | Mixed | Test created against already-dropped columns |
| A4: Factory wrong columns | #800 (Mar 23-24) | #808 (Mar 25) | No | Never | Factory written with wrong column names |
| A5: Teardown `title` | #811 (Mar 25) | #808 (Mar 25) | No | Yes (before rename) | Same as A2 |

**PR #808** is the worst offender — created the E2E factory and integration test with wrong column names against columns already dropped/renamed 1 day prior.

---

## Findings

### Category A: Schema Mismatches (Deterministic Failures)

#### A1. `admin_users.added_by` → should be `created_by`
- **Migration**: `20260115080637_create_admin_users.sql` defines column as `created_by`
- **Broken files**:
  - `scripts/seed-admin-test-user.ts:56` — `added_by: userId`
  - `scripts/add-admin.ts:21` — `added_by: USER_ID`
- **DB types confirm**: `src/lib/database.types.ts:87` has `created_by`
- **Fix exists** on `deploy/main-to-production-mar29` branch but never merged to main
- **Impact**: CI "Seed admin test user" step fails, blocking ALL E2E tests
- **Fix**: Change `added_by` to `created_by` in both scripts

#### A2. `evolution_prompts.title` → renamed to `name`
- **Migration**: `20260324000001_entity_evolution_phase0.sql:5` renames `title` to `name`
- **Broken files**:
  - `evolution/src/lib/types.ts:602` — `PromptMetadata` interface has `title: string` (should be `name`)
  - `evolution/src/lib/shared/hashStrategyConfig.test.ts:156` — test constructs `PromptMetadata` with `title:`
- **Note**: E2E specs and the E2E factory (`evolution-test-data-factory.ts:138`) correctly use `name` already
- **Impact**: Any code path using `PromptMetadata.title` will silently have wrong field name; type-level mismatch
- **Fix**: Rename `title` to `name` in `PromptMetadata` interface and update test

#### A3. Dropped `evolution_strategies` aggregate columns still referenced
- **Migration**: `20260323000004_drop_legacy_metrics.sql` dropped: `avg_final_elo`, `total_cost_usd`, `best_final_elo`, `worst_final_elo`, `run_count`
- **Broken files (types/interfaces)**:
  - `evolution/src/services/strategyRegistryActions.ts:24-26` — `StrategyListItem` has `run_count`, `total_cost_usd`, `avg_final_elo`
  - `evolution/src/lib/shared/hashStrategyConfig.ts:39-44` — `StrategyRow` has all 5 dropped columns
  - `evolution/src/lib/schemas.ts:55-59` — Zod schema has all 5 dropped columns
- **Broken files (UI)**:
  - `src/app/admin/evolution/strategies/page.tsx:57` — renders `row.avg_final_elo`
  - `src/app/admin/evolution/strategies/page.test.tsx:28` — fixture with `avg_final_elo: 1200`
  - `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx:30` — fixture with `avg_final_elo: 1500`
- **Broken files (integration tests)**:
  - `src/__tests__/integration/evolution-strategy-aggregates.integration.test.ts:50,81,121` — `.select('run_count, total_cost_usd, avg_final_elo, best_final_elo, worst_final_elo')` queries dropped columns directly
- **Broken files (unit tests)**:
  - `evolution/src/services/strategyRegistryActions.test.ts:74-76`
  - `evolution/src/lib/shared/hashStrategyConfig.test.ts:129-134`
- **Impact**: Integration tests fail against real DB; unit tests pass (mocked) but test wrong shape
- **Fix**: Remove dropped columns from all interfaces/schemas/UI, rewrite integration test to use `evolution_metrics` table

#### A4. `evolution-test-data-factory.ts` — 4 wrong column names
- **File**: `src/__tests__/e2e/helpers/evolution-test-data-factory.ts`
- **Wrong columns**:
  | Factory Function | Line | Wrong Column | Correct Column |
  |---|---|---|---|
  | `createTestVariant` | 233 | `content` | `variant_content` |
  | `createTestVariant` | 231 | `iteration` | `generation` |
  | `createTestRun` | 188 | `config` | *(column doesn't exist)* |
  | `createTestExperiment` | 279 | `strategy_id` | *(column doesn't exist on `evolution_experiments`)* |
- **DB types confirm** these columns don't exist in `database.types.ts`
- **Note**: Individual E2E specs that do direct inserts (not via factory) use correct column names
- **Impact**: Any E2E test using `createTestVariant()`, `createTestRun()`, or `createTestExperiment()` fails
- **Fix**: Update factory to use correct column names; remove non-existent column inserts

#### A5. `cleanupAllTrackedEvolutionData is not a function` (global teardown)
- Observed in E2E nightly runs — global teardown fails to import/call this function
- Likely related to the factory file having other issues (A4) or an export mismatch
- **Impact**: Test cleanup fails, leaving test data in DB

---

### Category B: Missing CI Environment Variables

#### B1. `DEEPSEEK_API_KEY` not in CI
- `src/lib/services/llms.ts:180` throws if missing when DeepSeek model path is exercised
- Not in any `ci.yml` job's `env:` block
- `jest.setup.js` does NOT set it (unlike `ANTHROPIC_API_KEY`)
- Individual unit tests set it per-test, so unit tests pass
- **Impact**: Integration tests exercising DeepSeek model paths fail
- **Fix**: Add `DEEPSEEK_API_KEY` to CI staging secrets + `ci.yml` env blocks
- **Note**: Previously identified in planning doc `optimize_elo_over_fixed_budget_20260204/_planning.md:1663` but never implemented

#### B2. `ANTHROPIC_API_KEY` not in CI
- `src/lib/services/llms.ts:258` throws if missing when Claude model path is exercised
- `jest.setup.js:8` sets `ANTHROPIC_API_KEY=test-anthropic-key` for unit tests
- Not in `ci.yml` env blocks
- **Impact**: Low — only triggers if integration/E2E tests exercise Claude model paths
- **Fix**: Add to CI staging secrets if needed

#### B3. `OPENROUTER_API_KEY` not in CI
- `src/lib/services/llms.ts:231` throws if missing for `openai/gpt-oss-20b` model
- **Impact**: Low — only if tests exercise this specific model
- **Fix**: Add to CI staging secrets if needed

---

### Category C: Flaky Tests (Non-Deterministic)

#### C1. `global-error.spec.ts:110` — Page not hydrating
- Test: "should not show error boundary when no error occurs"
- Page shows raw RSC streaming payload instead of rendered HTML
- Fails on some runs, passes on retry
- Firefox more susceptible than Chromium
- **Impact**: 1 flaky test, sometimes causes retry
- **Fix**: Add `waitForLoadState` or more robust hydration check

#### C2. `home-tabs.spec.ts:44` — Search input state lost (Firefox-only)
- Test: "should preserve state when switching tabs"
- Search input value resets to empty after tab switch
- Only observed on Firefox nightly runs
- **Impact**: 1 flaky test, Firefox only
- **Fix**: Investigate React state management during tab switch in Firefox

#### C3. `search-generate.spec.ts:112` — Streaming content timing
- Test: "should display full content after streaming completes"
- Content check returns false despite element being visible
- Passes on retry
- **Impact**: 1 flaky test
- **Fix**: Improve wait condition for streaming completion

---

### Category F: CI Fast-Path Bug (Fixed)

#### F1. Migrations-only PRs skip all tests
- **File**: `.github/workflows/ci.yml:40`
- The change-detection logic checks for code changes via `grep -E '\.(ts|tsx|js|jsx|json|css)$'`
- `.sql` migration files don't match this pattern
- A PR with ONLY migration files gets `path=fast`, skipping unit/integration/E2E tests entirely
- The `has_migrations` output was set but never used to prevent fast-path classification
- **Fix applied**: Added check — if no code changes but migrations exist, force `path=full`
- **Impact**: Future migration-only PRs will now run the full test suite

---

### Category D: Backend Errors During E2E (Symptoms of Above)

These are downstream effects of Category A issues:
- `Error in adminAction:getEvolutionRunsAction` (repeated ~20+ times)
- `Error in adminAction:getExperiment` (repeated ~12 times)
- `Error in adminAction:createStrategy`
- `Error refreshing explanation metrics` / `Function refreshExplanationMetrics failed`

All likely caused by schema mismatches when server actions query tables with stale column references.

---

### Category E: Non-Fatal Warnings (Informational)

- `[ResultsPage.waitForStreamingComplete.indicator] waitFor attached timed out after 5000ms`
- `[ResultsPage.getTagCount] waitFor visible timed out after 10000ms`
- Handled gracefully (tests continue), but indicate slow streaming/tag rendering

---

## Impact Summary

| # | Issue | Severity | Tests Affected | Deterministic? |
|---|---|---|---|---|
| A1 | `added_by` → `created_by` | **Critical** | ALL E2E (blocks seed) | Yes |
| A2 | `prompts.title` → `name` | Medium | Type mismatch, 1 test | Yes |
| A3 | Dropped strategy columns | **High** | ~10 files, 1 integration suite | Yes |
| A4 | Factory wrong columns | **High** | All factory-dependent E2E | Yes |
| A5 | Teardown import error | Medium | Cleanup fails | Yes |
| B1 | Missing DEEPSEEK_API_KEY | Medium | Evolution integration | Yes |
| B2 | Missing ANTHROPIC_API_KEY | Low | Claude model paths | Yes |
| B3 | Missing OPENROUTER_API_KEY | Low | gpt-oss-20b paths | Yes |
| C1 | global-error hydration | Low | 1 test | No (flaky) |
| C2 | home-tabs Firefox | Low | 1 test (Firefox) | No (flaky) |
| C3 | search-generate timing | Low | 1 test | No (flaky) |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md
- evolution/docs/architecture.md
- docs/docs_overall/debugging.md

## Code Files Read
- scripts/seed-admin-test-user.ts
- scripts/add-admin.ts
- supabase/migrations/20260115080637_create_admin_users.sql
- supabase/migrations/20260324000001_entity_evolution_phase0.sql
- supabase/migrations/20260323000004_drop_legacy_metrics.sql
- src/lib/database.types.ts
- evolution/src/lib/types.ts
- evolution/src/lib/schemas.ts
- evolution/src/lib/shared/hashStrategyConfig.ts
- evolution/src/lib/shared/hashStrategyConfig.test.ts
- evolution/src/services/strategyRegistryActions.ts
- evolution/src/services/strategyRegistryActions.test.ts
- src/app/admin/evolution/strategies/page.tsx
- src/app/admin/evolution/strategies/page.test.tsx
- src/app/admin/evolution/strategies/[strategyId]/page.test.tsx
- src/__tests__/integration/evolution-strategy-aggregates.integration.test.ts
- src/__tests__/e2e/helpers/evolution-test-data-factory.ts
- src/__tests__/e2e/helpers/test-data-factory.ts
- src/__tests__/e2e/setup/global-setup.ts
- src/__tests__/e2e/setup/global-teardown.ts
- .github/workflows/ci.yml (fast-path bug fixed — migrations now force full path)
- src/lib/services/llms.ts
- jest.setup.js
- jest.integration-setup.js
- .env.example
- playwright.config.ts
