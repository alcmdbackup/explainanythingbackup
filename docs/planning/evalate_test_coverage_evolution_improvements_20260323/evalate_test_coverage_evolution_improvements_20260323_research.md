# Evaluate Test Coverage Evolution Improvements Research

## Problem Statement
Evaluate current test coverage for the evolution system, then address important gaps. Also address any flakiness or code inefficiency that can benefit from refactors/consolidation.

## Requirements (from GH Issue #801)
- Evaluate how test coverage is currently for evolution
- Address any important coverage gaps
- Address any flakiness in evolution tests
- Address any code inefficiency that can benefit from refactors/consolidation

## High Level Summary

The evolution system has **51 source files**, **54 test files** with **843 test cases**, and **76 React components** (91% tested). Research across 6 rounds (24 agents) identified concrete improvement areas across flakiness, coverage gaps, testing infrastructure, integration tests, and E2E lifecycle tests.

### Current State
- **Unit tests**: 843 cases across 54 files — solid baseline
- **Integration tests**: 4 files, all bug-specific (no general workflow tests)
- **E2E tests**: 4 smoke tests (page loads only, no user workflows)
- **Component tests**: 69/76 components tested (91%)
- **Pipeline coverage**: 80-95% per module (see Finding 8)
- **RPCs**: 3/6 tested, 3 untested (sync_to_arena, cancel_experiment, update_strategy_aggregates)

### Key Improvement Areas
1. **Flakiness fixes** (13 setTimeout hacks, 3 race conditions, 2 env leaks)
2. **Coverage gaps** (3 untested files, 4 untested actions, 5 skipped tests, 2 untested RPCs)
3. **Testing infrastructure** (mock consolidation, E2E data factory, shared helpers)
4. **Integration tests** (6 new workflow tests: watchdog, arena sync, experiment lifecycle, etc.)
5. **E2E tests** (11 new tests for run management, strategy CRUD, dashboard, run detail tabs)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read

### Source Files (51 total in evolution/src/)
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — orchestrator with heartbeat
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — main generate→rank loop
- evolution/src/lib/pipeline/loop/generateVariants.ts — 3 parallel LLM strategies
- evolution/src/lib/pipeline/loop/rankVariants.ts — triage + Swiss ranking
- evolution/src/lib/pipeline/loop/buildPrompts.ts — prompt template builder (UNTESTED)
- evolution/src/lib/pipeline/loop/extractFeedback.ts — evolve variants with feedback
- evolution/src/lib/pipeline/infra/createEntityLogger.ts — fire-and-forget DB logging
- evolution/src/lib/pipeline/infra/createLLMClient.ts — retry + cost tracking
- evolution/src/lib/pipeline/infra/trackBudget.ts — reserve-before-spend
- evolution/src/lib/pipeline/infra/trackInvocations.ts — phase tracking
- evolution/src/lib/pipeline/infra/errors.ts — BudgetExceededWithPartialResults (UNTESTED)
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — V1-compat persistence + arena sync
- evolution/src/lib/pipeline/setup/buildRunContext.ts — context resolution
- evolution/src/lib/pipeline/setup/generateSeedArticle.ts — title→article generation
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts — config hashing
- evolution/src/lib/shared/computeRatings.ts — OpenSkill Bayesian rating
- evolution/src/lib/shared/enforceVariantFormat.ts — format validation
- evolution/src/lib/shared/classifyErrors.ts — transient vs fatal
- evolution/src/lib/shared/hashStrategyConfig.ts — SHA256 config identity
- evolution/src/lib/ops/watchdog.ts — stale run detection
- evolution/src/lib/ops/orphanedReservations.ts — budget cleanup
- evolution/src/services/evolutionActions.ts — 11 actions, 4 untested
- evolution/src/services/arenaActions.ts — arena CRUD
- evolution/src/services/experimentActionsV2.ts — experiment lifecycle
- evolution/src/services/invocationActions.ts — invocation queries (NO TEST FILE)
- evolution/src/services/logActions.ts — multi-entity log queries
- evolution/src/services/costAnalytics.ts — cost aggregations
- evolution/src/services/strategyRegistryActionsV2.ts — strategy CRUD
- evolution/src/services/variantDetailActions.ts — variant detail
- evolution/src/services/evolutionVisualizationActions.ts — dashboard data
- evolution/src/services/adminAction.ts — admin action factory
- evolution/src/services/shared.ts — ActionResult, UUID validation
- evolution/src/experiments/evolution/experimentMetrics.ts — metrics computation
- evolution/src/testing/* — 5 test helper files

### Integration Tests (4 files)
- src/__tests__/integration/evolution-claim.integration.test.ts — 9 tests, Bug #1
- src/__tests__/integration/evolution-budget-constraint.integration.test.ts — 12 tests, Bug #6
- src/__tests__/integration/evolution-experiment-completion.integration.test.ts — 5 tests, Bug #4
- src/__tests__/integration/evolution-run-costs.integration.test.ts — 3 tests, cost helpers

### E2E Tests
- src/__tests__/e2e/specs/09-admin/admin-evolution-v2.spec.ts — 4 smoke tests
- src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts — 15 feature tests (pattern reference)

### Migration/RPC Files
- supabase/migrations/20260322000006_evolution_fresh_schema.sql — core RPCs + views + RLS
- supabase/migrations/20260322000007_evolution_prod_convergence.sql — production migration
- supabase/migrations/20260323000001_generalize_evolution_logs.sql — log generalization
- supabase/migrations/20260323000002_fix_stale_claim_expiry.sql — watchdog fix

### CI/Config Files
- .github/workflows/ci.yml — evolution-aware path detection
- jest.config.js — coverage thresholds (41% branches, 35% functions, 42% lines)
- jest.integration.config.js — integration test config
- playwright.config.ts — E2E config with @evolution tag support

## Key Findings

### Finding 1: Coverage Gaps — Untested Files & Functions

**Untested source files:**
| File | Exports | Importance |
|------|---------|-----------|
| `services/invocationActions.ts` | 2 actions (listInvocations, getInvocationDetail) | HIGH — admin UI dependency |
| `lib/pipeline/loop/buildPrompts.ts` | buildEvolutionPrompt() | HIGH — used by generateVariants + extractFeedback |
| `lib/pipeline/infra/errors.ts` | BudgetExceededWithPartialResults class | MEDIUM — 15 lines, simple inheritance |

**Untested actions in evolutionActions.ts:**
| Action | Lines | What's Missing |
|--------|-------|---------------|
| `queueEvolutionRunAction` | 103-176 | Strategy validation, budget defaults, audit logging — 11 test cases needed |
| `getEvolutionRunSummaryAction` | 316-338 | Zod union validation (V1/V2/V3), null handling, warning logs — 9 test cases |
| `getEvolutionVariantsAction` | 302-314 | Elo ordering, empty result handling — 7 test cases |
| (+ partial gaps in tested actions) | — | Cost enrichment logic, strategy name joins |

**Untested components (4 with business logic):**
| Component | Lines | What's Missing |
|-----------|-------|---------------|
| `EntityDetailPageClient.tsx` | 117 | Config-driven rendering, data loading, error handling |
| `[strategyId]/page.tsx` | 127 | Async data loading, error states, tab navigation |
| `[promptId]/page.tsx` | 88 | Data fetching, metric formatting |
| `InvocationDetailContent.tsx` | 83 | Cost formatting, success/failed badges |

### Finding 2: Skipped Tests — experimentMetrics.test.ts

5 skipped tests from V1→V2 migration (commit 468bb45d, 2026-03-17):

| Test | Recommendation | Reason |
|------|---------------|--------|
| "maps RPC stats to MetricsBag" | DELETE | RPC `compute_run_variant_stats` removed in V2 |
| "extracts variant ratings from checkpoint" | DELETE | `evolution_checkpoints` table dropped |
| "uses checkpoint fallback" | DELETE | Both RPC + checkpoint gone |
| "computes eloPer$ when cost > 0" | UN-SKIP | Formula still in V2 code, mock is V2-compatible |
| "handles no checkpoint gracefully" | REWRITE | Change to test empty `evolution_variants` scenario |

### Finding 3: Flakiness — Critical Issues

**CRITICAL: createEntityLogger.test.ts (13 setTimeout hacks)**
- Logger uses fire-and-forget pattern (returns void, promise chain detached)
- Tests use `await new Promise(r => setTimeout(r, 10))` to wait for microtasks
- **Fix**: Return `Promise<void>` from logger methods so tests can `await logger.info(...)`. If refactor scope too large, use `flushPromises()` helper as pragmatic workaround.

**HIGH: claimAndExecuteRun.test.ts (isCountQuery race condition)**
- Line 40: `isCountQuery` shared mutable state across mock chain calls
- If `.select({count:'exact'})` and `.in()` calls interleave, flag may be wrong value
- **Fix**: Scope count query state to specific `.select()` call chain by returning a new chain object

**HIGH: rankVariants.test.ts (2 flaky patterns)**
- Lines 260-278: Response order dependency — triage consumes LLM responses positionally but call order is non-deterministic
- Lines 300-317: Assumes first match is v0 vs v1 — Swiss pairing may shuffle
- **Fix**: Use call counter instead of positional array; assert pair exists anywhere in matches, not at position [0]

**HIGH: evolution-claim.integration.test.ts (unsafe env manipulation)**
- Lines 79-91, 93-105: `process.env.EVOLUTION_MAX_CONCURRENT_RUNS` set/restored without try/finally
- **Fix**: Wrap in try/finally blocks

**MEDIUM: Other patterns**
- `generateVariants.test.ts` line 84: `Date.now()` in callOrder array (unused but confusing) — replace with simple counter
- `buildRunContext.test.ts` line 49: `Math.random()` in mock invocation IDs — replace with deterministic counter
- `generateSeedArticle.test.ts` line 6: describe-level `callIdx` — add bounds checking

### Finding 4: Test Quality — Mock Wiring vs. Business Logic

~73% of service test assertions verify mock chain calls rather than output correctness:

- **evolutionActions.test.ts**: Cost enrichment Map logic untested; strategy name joins untested
- **arenaActions.test.ts**: Entry count aggregation (countMap) entirely untested
- **experimentActionsV2.test.ts**: 22/30 tests mock helper functions; transaction rollback untested

### Finding 5: Code Duplication — Consolidation Opportunities

**Mock setup duplication (9 files, ~60 lines removable):**
- Same 4-7 `jest.mock()` calls repeated in every service test
- `setupServiceTestMocks()` exists but doesn't cover logger/headers/auditLog
- **Fix**: Extend with `{ includeLoggerAndHeaders: true, includeAuditLog: true }` options

**UUID validation tests (24 identical tests across 8 files):**
- "rejects invalid [field]Id" pattern repeated verbatim
- **Fix**: Extract `testInvalidUuidRejection()` helper

**Auth integration tests (6 identical blocks):**
- "all actions fail when auth rejects" copied across files
- **Fix**: Extract `testAuthIntegration()` helper

**Test UUID constants (7+ files):**
- Same `VALID_UUID = '550e8400-...'` defined independently
- **Fix**: Export `TEST_UUIDS` from `service-test-mocks.ts`

**Source code: error handling (35 instances across 7 service files):**
- `if (error) throw error;` pattern repeated
- **Fix**: Extract `assertNoError()` utility in `services/shared.ts`

### Finding 6: Untested RPCs and DB Objects

| Name | Type | Tested? | Priority |
|------|------|---------|----------|
| `claim_evolution_run` | RPC | YES | — |
| `get_run_total_cost` | RPC | YES | — |
| `complete_experiment_if_done` | RPC | YES | — |
| `sync_to_arena` | RPC | **NO** | HIGH — upserts variants + inserts arena comparisons |
| `cancel_experiment` | RPC | **NO** | HIGH — atomic experiment + run cancellation |
| `update_strategy_aggregates` | RPC | **MOCKED ONLY** | MEDIUM — running mean, best/worst elo |
| `evolution_run_costs` | VIEW | YES | — |
| `evolution_run_logs` | VIEW | **NO** | LOW — backwards-compat alias |

### Finding 7: Integration Test Opportunities

6 new real-DB integration tests designed:

**A. Run State Transitions** (pending → running → completed/failed)
- Setup: strategy + prompt + pending run
- Call: `claimAndExecuteRun()` with mocked LLM
- Assert: status flow, heartbeat, winner selection, variant persistence, run_summary schema

**B. Watchdog** (stale run detection)
- Setup: runs in various states (fresh heartbeat, stale heartbeat, null heartbeat, completed)
- Call: `runWatchdog(supabase, threshold)`
- Assert: correct runs marked failed, runner_id cleared, error_message JSON structure, pending/completed untouched

**C. Strategy Config Resolution**
- Setup: valid strategy, run referencing it
- Call: `buildRunContext()`
- Assert: config fields match, defaults applied, missing strategy returns error

**D. Experiment Lifecycle** (create → add runs → complete when all done)
- Setup: experiment + 2 strategies + 2 runs
- Assert: draft→running on first run, stays running until all complete, auto-completes

**E. Arena Sync** (variant upsert + match insertion)
- Call: `sync_to_arena()` RPC directly
- Assert: ON CONFLICT upsert, max 200 entries/1000 matches limits, draw normalization

**F. cancel_experiment** (atomic cancellation)
- Assert: experiment cancelled, pending/claimed/running runs failed, completed runs untouched

### Finding 8: Pipeline Unit Test Completeness

| Module | Score | Key Gaps |
|--------|-------|----------|
| generateVariants | 95% | Missing: empty strategiesPerRound config |
| rankVariants | 85% | Missing: calibrationOpponents=0, tournamentTopK > pool size |
| evolveVariants/extractFeedback | 80% | Missing: diversityScore >= 0.5 boundary, all-format-failure scenario |
| persistRunResults | 88% | Missing: identical-mu winner tie-breaking, non-23505 error codes |
| trackBudget | 92% | Missing: negative budgetUsd, double-release |

### Finding 9: E2E Test Opportunities

11 new E2E tests designed across 4 areas:

**Run Management** (3 tests): Filter by status, archive run, pagination
**Strategy Management** (2 tests): Create strategy, archive/unarchive
**Dashboard** (2 tests): Aggregated metrics display, empty state
**Run Detail** (4 tests): Metrics tab, variants tab, logs tab with pagination, Elo chart

Key infrastructure needed:
- New `evolution-test-data-factory.ts` with `createTestRun()`, `createTestStrategy()`, `createTestPrompt()`, `createTestVariant()`
- FK-safe cleanup with per-worker tracking files
- Integration with global teardown for defense-in-depth cleanup

### Finding 10: CI/Coverage Configuration

- CI has evolution-aware path detection (separate evolution-only test path)
- E2E uses `@evolution` tag for 4 spec files
- Coverage thresholds are global (41% branches, 35% functions, 42% lines) — no evolution-specific thresholds
- Coverage artifacts uploaded but no codecov integration for regression detection
- `--changedSince` mode disables threshold checks (most PRs bypass)

## Open Questions

1. **createEntityLogger refactor scope**: Changing logger to return Promise<void> affects all callers (~20+ call sites in pipeline). Should we audit call sites first, or use `flushPromises()` as pragmatic workaround and plan the refactor separately?
2. **Integration test depth**: The 6 designed integration tests cover critical workflows but require ~1000 lines and real DB access. Should we implement all 6 or prioritize watchdog + arena sync?
3. **E2E data factory**: Should the evolution E2E factory go in existing `test-data-factory.ts` or a new `evolution-test-data-factory.ts`?
4. **Coverage thresholds**: Should we add evolution-specific coverage thresholds, or rely on the global ones?
