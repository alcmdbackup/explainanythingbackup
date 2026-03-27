# Evaluate Test Coverage Evolution Improvements Plan

## Background
Evaluate current test coverage for the evolution system, then address important gaps. Also address any flakiness or code inefficiency that can benefit from refactors/consolidation.

## Requirements (from GH Issue #801)
- Evaluate how test coverage is currently for evolution
- Address any important coverage gaps
- Address any flakiness in evolution tests
- Address any code inefficiency that can benefit from refactors/consolidation

## Problem
The evolution system has solid unit test coverage (843 cases, 54 files) but significant gaps in integration testing (4 bug-specific files, no general workflow tests), E2E testing (only page load smoke tests), and test infrastructure (duplicated mocks, flaky timing patterns). Several critical RPCs (`sync_to_arena`, `cancel_experiment`) have zero real-DB test coverage, and ~73% of service tests verify mock wiring rather than business logic. Flakiness from 13 setTimeout hacks, race conditions in mock state, and unsafe env manipulation threatens CI reliability.

## Options Considered

### Option A: Fix flakiness + add integration tests only
- Pros: Focused, high-value, less code
- Cons: E2E gaps remain, no UI workflow verification

### Option B: Full coverage expansion (flakiness + integration + E2E + infrastructure)
- Pros: Comprehensive improvement, catches regressions at all tiers
- Cons: Large scope, higher effort

### Option C: Infrastructure-first (consolidate mocks, add helpers, then tests)
- Pros: Clean foundation before adding tests
- Cons: Delays actual coverage improvements

**Selected: Option B** — phased to deliver incremental value. Infrastructure improvements happen alongside test additions in each phase.

## Phased Execution Plan

### Phase 1: Flakiness Fixes + Test Infrastructure (foundation)

**1.1 Fix critical flakiness**
- `createEntityLogger.test.ts`: Add `flushPromises()` helper to replace 13 setTimeout(10) hacks.
  **Implementation**: `const flushPromises = () => new Promise(r => setImmediate(r));` — `setImmediate` runs after ALL microtasks (Promise.resolve chains) have settled, which is exactly what we need since `createEntityLogger` wraps `supabase.from().insert()` in `Promise.resolve().then()`. This is strictly more reliable than `setTimeout(r, 10)` because it waits for the microtask queue to drain rather than guessing a ms delay. If `setImmediate` is unavailable in test env, fallback: `const flushPromises = () => new Promise(r => setTimeout(r, 0));` (0ms setTimeout also runs after microtasks, just less semantic).
  **Tech debt note**: This is a pragmatic workaround. The ideal fix is changing `EntityLogger` methods to return `Promise<void>`, but that affects ~20+ call sites in the pipeline. Tracked as future refactor.
- `claimAndExecuteRun.test.ts`: Scope `isCountQuery` to `.select()` call chain by returning a **new chain object** from `.select({count:'exact', head:true})` that has `.in()` mocked to resolve with count data. The key change is that `.select()` returns a fresh object (not the shared mock), so the count state is scoped to that specific query chain and cannot leak to interleaved calls.
- `rankVariants.test.ts`: Use call counter for triage responses; assert pair exists anywhere (not position [0])
- `evolution-claim.integration.test.ts`: Wrap env manipulation in try/finally

**1.2 Fix medium flakiness**
- `generateVariants.test.ts`: Replace `Date.now()` with simple counter
- `buildRunContext.test.ts`: Replace `Math.random()` with deterministic counter
- `generateSeedArticle.test.ts`: Add bounds checking to `callIdx`

**1.3 Test infrastructure consolidation**

> **Note on jest.mock() hoisting**: `jest.mock()` calls are hoisted by Jest's babel transform only when at the top level of a module. The existing `setupServiceTestMocks()` wraps `jest.mock()` inside a function, which means it does NOT get hoisted and is unreliable. This is why no test file currently uses it. **Instead of extending this function**, we will:
> - Create a shared Jest setup file `evolution/src/testing/jest.setup.evolution-services.ts` that contains top-level `jest.mock()` calls for the 7 common modules
> - Reference it via `setupFilesAfterFramework` in jest.config.js for evolution service tests (using a `projects` config or testPathPattern-based setup)
> - Alternatively, create a `__mocks__` directory approach or keep top-level `jest.mock()` calls in each file but extract the mock *implementations* (not the `jest.mock()` call itself) into shared constants in `service-test-mocks.ts`
> - **Decision**: Use the shared-constants approach — keep `jest.mock()` at top of each file (hoisted), but import mock factory functions from `service-test-mocks.ts` for the implementation callbacks. This is the safest pattern.

- Add `@deprecated` JSDoc to existing `setupServiceTestMocks()` (never used, hoisting-unsafe — prevent re-adoption)
- Add `MOCK_IMPLEMENTATIONS` object to `service-test-mocks.ts` with reusable factory functions for all 7 common mocks
- Add `TEST_UUIDS` constants to `service-test-mocks.ts`
- Add `setupServiceActionTest()` factory for beforeEach standardization (mock reset + Supabase client wiring)
- Migrate 5 service test files (evolutionActions, arenaActions, strategyRegistryActionsV2, variantDetailActions, evolutionVisualizationActions) to import shared implementations (~40 lines removed per file)

**1.4 Clean up skipped tests**
- Delete 3 obsolete V1 tests in `experimentMetrics.test.ts`
- Un-skip "computes eloPer$" test
- Rewrite "handles no checkpoint" → test empty `evolution_variants` scenario

**Files modified:** ~15 test files
**Verify:** `npm test` passes, `npm run test:integration` passes

---

### Phase 2: Unit Test Coverage Gaps

**2.1 New test files**
- `buildPrompts.test.ts` (6 test cases): prompt structure, feedback section, FORMAT_RULES injection, multiline text, edge cases
- `invocationActions.test.ts` (~15 test cases): listInvocations pagination/filtering, getInvocationDetail, UUID validation, DB errors
- `errors.test.ts` (3 test cases): constructor, inheritance, property access

**2.2 Missing action tests in evolutionActions.test.ts**
- `queueEvolutionRunAction`: 11 test cases (strategy validation, archived rejection, budget defaults, audit logging)
- `getEvolutionRunSummaryAction`: 9 test cases (Zod union V1/V2/V3, null handling, validation warning logs)
- `getEvolutionVariantsAction`: 7 test cases (elo ordering, empty result, DB errors)

**2.3 Pipeline edge cases**
- `extractFeedback.test.ts`: Add diversityScore=0.5 boundary test, all-format-failure scenario
- `rankVariants.test.ts`: Add calibrationOpponents=0 edge case
- `trackBudget.test.ts`: Add negative budgetUsd, double-release tests

**Files modified:** ~8 test files (3 new, 5 extended)
**Verify:** `npm test` passes, coverage increases

---

### Phase 3: Integration Tests (17 new tests)

**Prerequisites & isolation strategy:**
- All evolution integration tests use `evolutionTablesExist()` guard (from `evolution-test-helpers.ts`) at the top of each describe block to auto-skip if evolution tables are not migrated
- Each test uses `cleanupEvolutionData(supabase, { runIds, strategyIds, promptIds })` in `afterAll`/`afterEach` for FK-safe cleanup (order: invocations → variants → arena_comparisons → runs → experiments → strategies → prompts)
- Tests that modify shared state (I2 concurrent claims, I14 cancel cascade) use unique test-prefixed data and do NOT share rows across test cases
- **CI timeout**: CI allocates 30 minutes for evolution integration tests. The 17 new tests add ~3-5 minutes (most are single-query assertions against real DB). I2 (concurrent claims) is the slowest (~10s for 5 parallel calls). Total estimated: ~8 minutes, well within the 30-minute budget.
- **Integration cleanup helper**: The existing `cleanupEvolutionData()` in `evolution-test-helpers.ts` only handles invocations, variants, runs, strategies, and prompts. For I13/I14 (experiment lifecycle) and I17 (logging), we must extend it to also clean `evolution_logs`, `evolution_arena_comparisons`, and `evolution_experiments` in the correct FK order.
- **Service role auth**: All integration tests use `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS (confirmed by existing `evolution-run-costs.integration.test.ts` pattern)

**3.1 Run Lifecycle (I1–I4)**
- I1: Full pipeline pending→completed with mocked LLM
- I2: Concurrent claim race condition (5 parallel runners)
- I3: Run failure with LLM error mid-pipeline
- I4: Admin kill action on running run

**3.2 Content & Arena (I5–I7)**
- I5: Content resolution from explanation_id
- I6: Content resolution from prompt_id (seed generation)
- I7: Arena entry loading for prompt-based run

**3.3 Strategy (I8–I9)**
- I8: Strategy config hash find-or-create idempotency
- I9: Strategy aggregate updates across 3 sequential runs

**3.4 Finalization (I10–I12)**
- I10: Variant upsert with local vs arena filtering
- I11: Arena sync retry on transient failure
- I12: Arena-only pool completion

**3.5 Experiment Lifecycle (I13–I14)**
- I13: Experiment auto-complete with 3 runs (NOT EXISTS)
- I14: cancel_experiment RPC cascade

**3.6 RPCs (I15–I16)**
- I15: sync_to_arena RPC upsert + ON CONFLICT
- I16: sync_to_arena over-limit rejection (201 entries)

**3.7 Logging (I17)**
- I17: Structured entity logger writes to evolution_logs with denormalized FKs

**Files created:** ~8-10 new integration test files in `src/__tests__/integration/`
**Verify:** `npm run test:integration` passes

---

### Phase 4: E2E Test Infrastructure + First Tests

**4.1 E2E data factory**
- Create `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` with:
  - `createTestStrategy()`, `createTestPrompt()`, `createTestRun()`, `createTestVariant()`
  - FK-safe cleanup with per-worker tracking files at `/tmp/e2e-tracked-evolution-ids-worker-{index}.txt`
  - `cleanupAllTrackedEvolutionData()` for defense-in-depth
  - Uses `SUPABASE_SERVICE_ROLE_KEY` (same as existing `test-data-factory.ts`)
- **FK-safe deletion order** (explicit, matching Postgres constraints):
  1. `evolution_arena_comparisons` (references variants via entry_a/entry_b, ON DELETE CASCADE)
  2. `evolution_agent_invocations` (references runs via run_id) — note: `llmCallTracking.evolution_invocation_id` has ON DELETE SET NULL, so deletion is safe but may trigger SET NULL cascade per-row
  3. `evolution_logs` (denormalized FKs to runs, experiments, strategies — nullable, no hard FK constraint)
  4. `evolution_variants` (references runs via run_id, references evolution_explanations via evolution_explanation_id)
  5. `evolution_explanations` (referenced by variants — must delete AFTER variants)
  6. `evolution_runs` (references experiments, strategies, prompts)
  7. `evolution_experiments` (references prompts)
  8. `evolution_strategies` (no inbound FKs after runs deleted)
  9. `evolution_prompts` (no inbound FKs after runs/experiments deleted)
- **Integration with `global-teardown.ts`**: Add Step 6b after existing Step 6:
  ```typescript
  // Step 6b: Clean tracked evolution data (defense-in-depth)
  try {
    const { cleanupAllTrackedEvolutionData } = await import('../helpers/evolution-test-data-factory');
    const count = await cleanupAllTrackedEvolutionData();
    if (count > 0) console.log(`   ✓ Cleaned ${count} tracked evolution records`);
  } catch (error) {
    console.error('❌ Step 6b (tracked evolution cleanup) failed:', error);
  }
  ```

**4.2 Add data-testid selectors to components**
- `status-filter`, `archived-toggle`, `runs-pagination` on runs list page
- `tab-overview`, `tab-elo`, `tab-lineage`, `tab-variants`, `tab-logs` on run detail tabs
- `strategy-status-badge`, `leaderboard-table` on arena/strategy pages
- Component files to modify: `EntityListPage.tsx` (filter bar), `EntityDetailTabs.tsx` (tab buttons), `RunsTable.tsx` (pagination), `EvolutionStatusBadge.tsx` (badge testid)

**4.2b Tag all new E2E specs with `@evolution`**
- All new spec files must use `{ tag: '@evolution' }` on their top-level `test.describe`
- This ensures they run under the `npm run test:e2e:evolution` CI job for evolution-only PRs
- Existing CI workflow already routes `@evolution` tagged specs via `--grep=@evolution`

**4.3 First E2E tests (T0, T1, T3, T7, T10, T11, T17, T18, T23)**
- T0: Experiment wizard → runs verification → mocked completion
- T1: Dashboard metric cards with seeded data
- T3: Dashboard empty state
- T7: Run list row click → detail navigation
- T10: Run detail breadcrumb navigation
- T11: Deep link + refresh
- T17: Strategy detail config/metrics/description
- T18: Strategy detail tab navigation
- T23: Experiments list page renders

**Files created:** 1 new factory file, ~4-5 new spec files
**Verify:** `npm run test:e2e` passes with `@evolution` tag

---

### Phase 5: Remaining E2E Tests

**5.1 Dashboard & Runs (T2, T4, T5, T6, T8, T9)**
- T2: Dashboard error state
- T4: Runs status filter
- T5: Runs archived toggle
- T6: Runs pagination (60 seeded runs — tests 2 pages without excessive setup)
- T8: Run detail all 5 tabs
- T9: Run detail status badges for all statuses

**5.2 Strategies (T12–T16, T19)**
- T12: Strategy status filter
- T13: Strategy edit form pre-fill
- T14: Strategy clone action
- T15: Strategy archive/unarchive toggle
- T16: Strategy delete with confirmation
- T19: Strategy detail status badge styling

**5.3 Arena, Experiments, Invocations (T20–T25)**
- T20: Arena topic list with filters
- T21: Arena leaderboard sort
- T22: Arena entry expansion
- T24: Experiment detail tabs
- T25: Invocations list with pagination

**Files created/modified:** ~5-6 spec files
**Verify:** `npm run test:e2e` passes with full suite

---

### Phase 6: Documentation + Cleanup

- Update `docs/docs_overall/testing_overview.md` with new test statistics and any new rules
- Update `docs/feature_deep_dives/testing_setup.md` with evolution test patterns, new helpers, E2E factory docs
- Remove any remaining dead code or deprecated test patterns
- Final full test run: `npm run test:all` + `npm run test:e2e`

## Testing

### Tests to Write
- **Unit**: ~50 new test cases (buildPrompts, invocationActions, errors, action gaps, pipeline edges)
- **Integration**: 17 new test files (~150 test cases total)
- **E2E**: 26 new test cases across ~8 spec files

### Tests to Modify
- 13 tests in createEntityLogger.test.ts (flushPromises)
- 2 tests in rankVariants.test.ts (response ordering)
- 1 test in claimAndExecuteRun.test.ts (isCountQuery race)
- 2 tests in evolution-claim.integration.test.ts (try/finally)
- 5 tests in experimentMetrics.test.ts (delete 3, un-skip 1, rewrite 1)
- 5 service test files (mock consolidation)

### Verification
- Each phase verified independently before moving to next
- `npm test` (unit), `npm run test:integration`, `npm run test:e2e` at each phase gate
- lint + tsc + build must pass after each phase
- **Coverage note**: CI uses `--changedSince` which disables threshold checks. Coverage improvements are verified locally via `npm run test:coverage` (full run), not enforced in CI. This is acceptable since the goal is gap-filling, not threshold enforcement.

### Rollback Strategy
- Each phase is committed separately; revert individual phase commits if needed
- New test files can be deleted without affecting existing tests
- If new tests introduce flakiness, disable with `test.skip` + GitHub issue link (per testing rule #8)
- Mock infrastructure changes (Phase 1.3) are backward-compatible — old inline mocks continue to work alongside new shared constants
- E2E factory (Phase 4.1) is additive — existing `test-data-factory.ts` is unchanged

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` — updated test statistics (new counts), any new testing rules
- `docs/feature_deep_dives/testing_setup.md` — new evolution test patterns, E2E factory, consolidated mock helpers
