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
- `createEntityLogger.test.ts`: Add `flushPromises()` helper to replace 13 setTimeout(10) hacks
- `claimAndExecuteRun.test.ts`: Scope `isCountQuery` to `.select()` call chain
- `rankVariants.test.ts`: Use call counter for triage responses; assert pair exists anywhere (not position [0])
- `evolution-claim.integration.test.ts`: Wrap env manipulation in try/finally

**1.2 Fix medium flakiness**
- `generateVariants.test.ts`: Replace `Date.now()` with simple counter
- `buildRunContext.test.ts`: Replace `Math.random()` with deterministic counter
- `generateSeedArticle.test.ts`: Add bounds checking to `callIdx`

**1.3 Test infrastructure consolidation**
- Extend `setupServiceTestMocks()` with `{ includeLoggerAndHeaders, includeAuditLog }` options
- Add `TEST_UUIDS` constants to `service-test-mocks.ts`
- Add `setupServiceActionTest()` factory for beforeEach standardization
- Migrate 5 service test files to use consolidated mocks (~60 lines removed)

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
- Create `evolution-test-data-factory.ts` with:
  - `createTestStrategy()`, `createTestPrompt()`, `createTestRun()`, `createTestVariant()`
  - FK-safe cleanup with per-worker tracking files
  - `cleanupAllTrackedEvolutionData()` for defense-in-depth
- Integrate with `global-teardown.ts`

**4.2 Add data-testid selectors to components**
- `status-filter`, `archived-toggle`, `runs-pagination` on runs list
- `tab-overview`, `tab-elo`, `tab-lineage`, `tab-variants`, `tab-logs` on run detail
- `strategy-status-badge`, `leaderboard-table` on arena/strategy pages

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
- T6: Runs pagination (120 seeded runs)
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

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` — updated test statistics (new counts), any new testing rules
- `docs/feature_deep_dives/testing_setup.md` — new evolution test patterns, E2E factory, consolidated mock helpers
