# Evaluate Test Coverage Evolution Improvements Research

## Problem Statement
Evaluate current test coverage for the evolution system, then address important gaps. Also address any flakiness or code inefficiency that can benefit from refactors/consolidation.

## Requirements (from GH Issue #801)
- Evaluate how test coverage is currently for evolution
- Address any important coverage gaps
- Address any flakiness in evolution tests
- Address any code inefficiency that can benefit from refactors/consolidation

## High Level Summary

The evolution system has **51 source files** and **54 test files** with **843 test cases** — solid baseline coverage. However, research across 3 rounds (12 agents) identified several concrete improvement areas:

1. **Coverage gaps**: 3 untested source files (invocationActions, buildPrompts, errors), 4 untested actions in evolutionActions.ts, 5 skipped tests in experimentMetrics (3 should be deleted, 1 un-skipped, 1 rewritten)
2. **Flakiness**: createEntityLogger.test.ts has 13 setTimeout(10) timing hacks; evolution-claim.integration.test.ts has unsafe process.env manipulation without try/finally
3. **Test quality**: ~73% of service tests verify mock wiring rather than business logic; integration tests are bug-specific with no general workflow tests
4. **Code duplication**: 9 service test files duplicate identical mock setup (~60 lines removable); 24 UUID validation tests follow identical pattern; inline chain mocks duplicated across 6 files

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
- evolution/src/lib/pipeline/loop/extractFeedback.ts — feedback from comparisons
- evolution/src/lib/pipeline/infra/createEntityLogger.ts — fire-and-forget DB logging
- evolution/src/lib/pipeline/infra/createLLMClient.ts — retry + cost tracking
- evolution/src/lib/pipeline/infra/trackBudget.ts — reserve-before-spend
- evolution/src/lib/pipeline/infra/trackInvocations.ts — phase tracking
- evolution/src/lib/pipeline/infra/errors.ts — BudgetExceededWithPartialResults (UNTESTED)
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — V1-compat persistence
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
- evolution/src/services/invocationActions.ts — invocation queries (UNTESTED)
- evolution/src/services/logActions.ts — multi-entity log queries
- evolution/src/services/costAnalytics.ts — cost aggregations
- evolution/src/services/strategyRegistryActionsV2.ts — strategy CRUD
- evolution/src/services/variantDetailActions.ts — variant detail
- evolution/src/services/evolutionVisualizationActions.ts — dashboard data
- evolution/src/services/adminAction.ts — admin action factory
- evolution/src/services/shared.ts — ActionResult, UUID validation
- evolution/src/experiments/evolution/experimentMetrics.ts — metrics computation
- evolution/src/experiments/evolution/analysis.ts — deprecated manual analysis
- evolution/src/testing/evolution-test-helpers.ts — DB helpers, factories, mocks
- evolution/src/testing/service-test-mocks.ts — Supabase mock patterns
- evolution/src/testing/schema-fixtures.ts — typed fixture factories
- evolution/src/testing/v2MockLlm.ts — mock LLM client
- evolution/src/testing/executionDetailFixtures.ts — agent detail fixtures

### Integration Tests (4 files)
- src/__tests__/integration/evolution-claim.integration.test.ts — 9 tests, Bug #1
- src/__tests__/integration/evolution-budget-constraint.integration.test.ts — 12 tests, Bug #6
- src/__tests__/integration/evolution-experiment-completion.integration.test.ts — 5 tests, Bug #4
- src/__tests__/integration/evolution-run-costs.integration.test.ts — 3 tests, cost helpers

### E2E Tests (1 file)
- src/__tests__/e2e/specs/09-admin/admin-evolution-v2.spec.ts — 4 smoke tests

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
| `queueEvolutionRunAction` | 103-176 | Strategy validation, budget defaults, audit logging |
| `getEvolutionRunSummaryAction` | 316-338 | Zod union validation, null handling, warning logs |
| `getEvolutionVariantsAction` | 302-314 | Elo ordering, empty result handling |
| (+ partial gaps in tested actions) | — | Cost enrichment logic, strategy name joins |

### Finding 2: Skipped Tests — experimentMetrics.test.ts

5 skipped tests from V1→V2 migration (commit 468bb45d, 2026-03-17):

| Test | Recommendation | Reason |
|------|---------------|--------|
| "maps RPC stats to MetricsBag" | DELETE | RPC removed in V2 |
| "extracts variant ratings from checkpoint" | DELETE | Checkpoint table dropped |
| "uses checkpoint fallback" | DELETE | Both RPC + checkpoint gone |
| "computes eloPer$ when cost > 0" | UN-SKIP | Formula still in V2 code, mock is V2-compatible |
| "handles no checkpoint gracefully" | REWRITE | Change to test empty variants scenario |

### Finding 3: Flakiness — Timing & Environment Issues

**Critical: createEntityLogger.test.ts (13 setTimeout hacks)**
- Logger uses fire-and-forget pattern (returns void, promise chain detached)
- Tests use `await new Promise(r => setTimeout(r, 10))` to wait for microtasks
- **Fix**: Return Promise<void> from logger methods so tests can `await logger.info(...)`
- All 13 tests vulnerable to race conditions

**High: evolution-claim.integration.test.ts (unsafe env manipulation)**
- Lines 79-91, 93-105: `process.env.EVOLUTION_MAX_CONCURRENT_RUNS` set/restored without try/finally
- If assertion fails, env var leaks to subsequent tests
- **Fix**: Wrap in try/finally blocks

**Medium: Other timing patterns**
- `generateVariants.test.ts` line 84: `Date.now()` for call order tracking
- `runIterationLoop.test.ts` line 56: `Math.random()` in mock IDs
- `buildRunContext.test.ts` line 49: Same random ID pattern

### Finding 4: Test Quality — Mock Wiring vs. Business Logic

~73% of service test assertions verify mock chain calls (`.toHaveBeenCalledWith()`) rather than output correctness. Key gaps:

- **evolutionActions.test.ts**: Cost enrichment Map logic untested; strategy name joins untested
- **arenaActions.test.ts**: Entry count aggregation (countMap) entirely untested
- **experimentActionsV2.test.ts**: 22/30 tests mock helper functions; transaction rollback untested
- **No general integration tests** for: run state transitions, variant persistence, strategy resolution, arena sync

### Finding 5: Code Duplication — Consolidation Opportunities

**Mock setup duplication (9 files, ~60 lines removable):**
- Same 4 `jest.mock()` calls repeated in every service test
- `setupServiceTestMocks()` exists but doesn't cover logger/headers/auditLog
- **Fix**: Extend with `{ includeLoggerAndHeaders: true, includeAuditLog: true }` options

**UUID validation tests (24 identical tests across 8 files):**
- "rejects invalid [field]Id" pattern repeated verbatim
- **Fix**: Extract `testInvalidUuidRejection()` helper

**Inline chain mocks (6 files, 20+ instances):**
- Manual `{ select: jest.fn().mockReturnThis(), ... }` instead of using `createSupabaseChainMock()`
- **Fix**: Extract `createInlineChainMock()` helper

**Auth integration tests (6 identical blocks):**
- "all actions fail when auth rejects" copied across files
- **Fix**: Extract `testAuthIntegration()` helper

**Source code: error handling (35 instances across 7 service files):**
- `if (error) throw error;` pattern repeated
- **Fix**: Extract `assertNoError()` utility in `services/shared.ts`

## Open Questions

1. **createEntityLogger refactor scope**: Changing logger to return Promise<void> affects all callers. Should we audit call sites first or use the pragmatic `flushPromises()` helper?
2. **Integration test depth**: Should we add real-DB workflow tests for run lifecycle, or keep integration tests focused on specific bugs/RPCs?
3. **Service test strategy**: Should we push toward testing actual data transformations (with real objects flowing through) rather than mock wiring, or is the current approach acceptable given the adminAction wrapper pattern?
