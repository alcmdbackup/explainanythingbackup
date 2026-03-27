# Improve Test Coverage Evolution Research

## Problem Statement
The evolution dashboard needs extremely thorough unit, integration, and E2E test coverage across all admin pages, components, server actions, and pipeline services.

## Requirements (from GH Issue #NNN)
Comprehensive coverage of all evolution admin pages, tabs, actions, and services — including unit, integration, and E2E tests across all evolution dashboard components.

## High Level Summary

The evolution system currently has **1,628 test cases** across 83+ test files. Coverage is broad but has critical depth gaps:

- **Unit tests (1,157 cases):** Good coverage of pipeline logic, ratings, and schemas. Key gaps: `metricsActions.ts` has NO test file, `entityRegistry.ts` has NO tests, `GenerationAgent` and `RankingAgent` have no dedicated tests.
- **Component tests (414 cases):** 96% of components tested, but many tests are shallow (presence-only). `EvolutionErrorBoundary` and `EntityDetailPageClient` have zero tests. Strategy detail and prompt detail pages have no page-level tests.
- **Integration tests (57 cases):** 11 files cover RPCs and DB operations. Major gaps: no arena comparison workflow, no metrics recomputation with real DB, no full experiment lifecycle, no strategy CRUD integration, no cost analytics integration.
- **E2E tests (~17 cases across 7 specs):** 56% of admin pages have E2E coverage. No page objects for evolution. Missing specs for: prompts CRUD, variants list/detail, experiments list, invocation detail, arena detail. Tab content is never validated — only tab presence.

## Key Findings

### 1. Critical Missing Test Files
| File | Type | Impact |
|------|------|--------|
| `evolution/src/services/metricsActions.test.ts` | Unit | **NO TEST FILE** — 2 server actions completely untested |
| `evolution/src/lib/core/entityRegistry.test.ts` | Unit | **NO TEST FILE** — 8 exported functions, validation logic untested |
| `evolution/src/lib/core/agents/GenerationAgent.test.ts` | Unit | **NO TEST FILE** — parameter forwarding untested |
| `evolution/src/lib/core/agents/RankingAgent.test.ts` | Unit | **NO TEST FILE** — complex Map parameter forwarding untested |
| `evolution/src/components/evolution/EvolutionErrorBoundary.test.tsx` | Component | **NO TEST FILE** — error boundary untested |
| `evolution/src/components/evolution/EntityDetailPageClient.test.tsx` | Component | **NO TEST FILE** — config-driven detail page orchestrator untested |
| `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx` | Page | **NO TEST FILE** — strategy detail page untested |
| `src/app/admin/evolution/prompts/[promptId]/page.test.tsx` | Page | **NO TEST FILE** — prompt detail page untested |

### 2. Shallow Existing Tests (Need Deepening)
| File | Current | Missing Scenarios |
|------|---------|-------------------|
| Dashboard page test | 4 tests (presence only) | Auto-refresh, error states, metric accuracy, empty state, data formatting |
| Start experiment page test | 3 tests (presence only) | Form interaction, submission, validation, strategy selection |
| MetricsTab component | 3 tests | Cost breakdown, strategy effectiveness, match stats |
| RelatedRunsTab component | 2 tests | Run status display, cost/metrics, sorting, pagination |
| VariantDetailPanel component | 3 tests | Metadata fields, match count, creation timestamp |
| Runs list page | 6 tests | Filter change handlers, pagination interaction, error states |
| Strategies list page | 6 tests | Dialog open/close, CRUD actions, toast messages, validation |
| Prompts list page | 6 tests | Form interactions, CRUD operations, dialog management |

### 3. Server Action Test Quality Assessment
| File | Cases | Quality | Key Gaps |
|------|-------|---------|----------|
| evolutionActions.test.ts | 24 | ⭐⭐⭐⭐ | Pagination boundaries, concurrent ops |
| experimentActions.test.ts | 21 | ⭐⭐⭐⭐ | Batch partial failures, filter combinations |
| strategyRegistryActions.test.ts | 24 | ⭐⭐⭐⭐ | Config validation edge cases, concurrent updates |
| arenaActions.test.ts | 20 | ⭐⭐⭐⭐ | Pagination, cascading deletes, Elo edge cases |
| logActions.test.ts | 9 | ⭐⭐⭐ | Filter combinations, case sensitivity, large results |
| costAnalytics.test.ts | 19 | ⭐⭐⭐⭐ | Date/timezone handling, precision rounding |
| metricsActions.test.ts | **0** | **MISSING** | Everything — admin auth, input validation, stale recomputation, DB errors, batch operations |

### 4. Integration Test Gaps
| Missing Scenario | Priority | Description |
|-----------------|----------|-------------|
| Arena comparison workflow | HIGH | Entry sync → comparison → Elo updates → leaderboard |
| Full experiment lifecycle | HIGH | Create → add runs → claim → execute → finalize → complete |
| Metrics recomputation | HIGH | Stale detection → recompute → verify fresh values |
| Strategy CRUD | MEDIUM | Create → update → archive → delete with run associations |
| Cost tracking cascade | MEDIUM | Invocation costs → run costs → strategy costs → experiment costs |
| Visualization data aggregation | MEDIUM | Dashboard metrics, Elo history, lineage graphs |
| Variant detail actions | MEDIUM | Content queries, parent/child hierarchy, archival |
| Concurrent claim | LOW | Multiple runners competing for single run (SKIP LOCKED) |

### 5. E2E Test Gaps
| Missing Page/Flow | Priority | Description |
|------------------|----------|-------------|
| Prompts CRUD | HIGH | Create, edit, archive, delete prompts via UI |
| Variants list + detail | HIGH | List rendering, filtering, detail page navigation |
| Experiments list | MEDIUM | List rendering, status filtering, row navigation |
| Invocation detail | MEDIUM | Execution details, metrics, logs tabs |
| Arena topic detail | MEDIUM | Topic metadata, entry leaderboard, comparisons |
| Tab content validation | HIGH | All detail pages: tab content, not just tab presence |
| Filter interaction | HIGH | Status, test content, pagination across all list pages |
| Form validation | MEDIUM | Required fields, error states, submission errors |

### 6. Test Infrastructure Gaps
| Gap | Impact | Recommendation |
|-----|--------|----------------|
| No E2E page objects for evolution | Tests couple directly to DOM selectors | Create AdminEvolutionPage, AdminRunsPage, etc. |
| No factory for arena comparisons | Can't seed comparison data for tests | Add createTestArenaComparison() |
| No factory for evolution logs | Can't test log query/filtering | Add createTestEvolutionLog() |
| No factory for budget events | Budget tracking tests lack seeding | Add createTestBudgetEvent() |
| No LLM error scenarios in v2MockLlm | Can't test error recovery paths | Add mockLlmError(), mockLlmTimeout() |
| No pool/state builder | Can't test evolution state mutations | Add createInitialPipelineState() |

### 7. Metrics System Deep Dive
The metrics system has moderately good coverage for computation functions but critical gaps:
- `metricsActions.ts` (server actions) — **0% coverage**, needs ~30 test cases
- `recomputeMetrics.ts` — ~70% coverage, missing error handling and aggregation verification
- `registry.ts` — ~60% coverage, missing error paths and formatter validation
- `readMetrics.ts` — ~50% coverage, missing chunking boundary tests (100 IDs)
- Computation files (execution, finalization, propagation) — 80-100% coverage

### 8. Current Test Counts by Category
| Category | Files | Test Cases | Describe Blocks |
|----------|-------|------------|-----------------|
| Unit (pipeline, services, lib) | 60 | 1,157 | 291 |
| Component (shared + tabs + variant) | 34 | 265 | 62 |
| Admin page-level | 24 | 149 | 27 |
| Integration | 11 | 57 | 11 |
| E2E | 7 | ~17 | 7 |
| **Total** | **136** | **~1,645** | **398** |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — Testing rules, tiers, CI/CD workflows
- docs/feature_deep_dives/testing_setup.md — Four-tier strategy, config, mocking patterns, test utilities
- docs/docs_overall/environments.md — Environment config, test types, CI pipelines
- evolution/docs/architecture.md — V2 pipeline: entry points, 3-op loop, budget tracking, arena
- docs/feature_deep_dives/evolution_logging.md — Entity hierarchy, logger factory, LogsTab
- docs/feature_deep_dives/evolution_metrics.md — Metrics computation, bootstrap CIs

## Code Files Read

### Evolution Admin Pages (17 page files)
- src/app/admin/evolution-dashboard/page.tsx — Dashboard with MetricGrid + RunsTable
- src/app/admin/evolution/runs/page.tsx — Runs list with EntityListPage
- src/app/admin/evolution/runs/[runId]/page.tsx — Run detail with 5 tabs
- src/app/admin/evolution/variants/page.tsx — Variants list
- src/app/admin/evolution/variants/[variantId]/page.tsx — Variant detail (server component)
- src/app/admin/evolution/experiments/page.tsx — Experiments list
- src/app/admin/evolution/experiments/[experimentId]/page.tsx — Experiment detail (server component)
- src/app/admin/evolution/invocations/page.tsx — Invocations list
- src/app/admin/evolution/invocations/[invocationId]/page.tsx — Invocation detail (server component)
- src/app/admin/evolution/strategies/page.tsx — Strategies list (RegistryPage)
- src/app/admin/evolution/strategies/[strategyId]/page.tsx — Strategy detail (client, **NO TEST**)
- src/app/admin/evolution/prompts/page.tsx — Prompts list (RegistryPage)
- src/app/admin/evolution/prompts/[promptId]/page.tsx — Prompt detail (client, **NO TEST**)
- src/app/admin/evolution/arena/page.tsx — Arena topics list
- src/app/admin/evolution/arena/[topicId]/page.tsx — Arena topic detail (server component)
- src/app/admin/evolution/arena/entries/[entryId]/page.tsx — Redirect to variant detail
- src/app/admin/evolution/start-experiment/page.tsx — Multi-step experiment wizard

### Evolution Server Actions (12 files)
- evolution/src/services/evolutionActions.ts — 11 actions (runs CRUD, variants, cost, logs, kill)
- evolution/src/services/experimentActions.ts — 8 actions (create, list, cancel, batch)
- evolution/src/services/strategyRegistryActions.ts — 7 actions (CRUD, clone, archive)
- evolution/src/services/arenaActions.ts — 13 actions (topics, entries, prompts)
- evolution/src/services/invocationActions.ts — 2 actions (list, detail)
- evolution/src/services/logActions.ts — 1 action (entity logs with filters)
- evolution/src/services/evolutionVisualizationActions.ts — 3 actions (dashboard, Elo history, lineage)
- evolution/src/services/variantDetailActions.ts — 5 actions (detail, parents, children, matches, lineage)
- evolution/src/services/metricsActions.ts — 2 actions (**NO TEST FILE**)
- evolution/src/services/costAnalytics.ts — 5 actions (cost summary, daily, by model/user, backfill)
- evolution/src/services/adminAction.ts — Factory wrapper
- evolution/src/services/shared.ts — UUID validation utilities

### Evolution Pipeline Code (untested files)
- evolution/src/lib/core/agents/GenerationAgent.ts — 25 lines, delegates to generateVariants()
- evolution/src/lib/core/agents/RankingAgent.ts — 40 lines, delegates to rankPool()
- evolution/src/lib/core/entityRegistry.ts — 102 lines, singleton registry with 8 exports
- evolution/src/lib/pipeline/infra/errors.ts — 15 lines, BudgetExceededWithPartialResults

### Evolution Components (untested)
- evolution/src/components/evolution/EvolutionErrorBoundary.tsx — Simple error display + retry button
- evolution/src/components/evolution/EntityDetailPageClient.tsx — Config-driven detail page shell

### Test Infrastructure
- evolution/src/testing/evolution-test-helpers.ts — 18 functions: DB factories, mock LLM, cleanup
- evolution/src/testing/service-test-mocks.ts — Chainable Supabase mock, setupServiceActionTest()
- evolution/src/testing/v2MockLlm.ts — Label/pair-based LLM response routing
- evolution/src/testing/executionDetailFixtures.ts — 10 agent detail fixtures
- evolution/src/testing/schema-fixtures.ts — 10 Zod-validated factory functions
- src/__tests__/e2e/helpers/evolution-test-data-factory.ts — E2E factories with auto-tracking cleanup
- src/__tests__/e2e/fixtures/admin-auth.ts — Admin auth fixture for E2E

## Open Questions
1. What's the target test coverage percentage? (currently ~85% file coverage, variable depth)
2. Should E2E page objects be created for evolution pages, or continue inline selector approach?
3. Should integration tests for arena comparisons use real LLM judge calls or mock them?
4. Are there any planned schema changes that would affect test writing?
