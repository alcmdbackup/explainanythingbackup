# Entity Agent Classes Evolution Research

## Problem Statement
Create extensible "entity" and "agent" class abstractions in the evolution pipeline codebase. The user wants to formalize the concepts of "entity" (a DB-backed domain object like run, experiment, strategy, variant, invocation) and "agent" (a pipeline operation like generation, ranking, evolution). An "agent invocation" is a particular call to an agent during a specific iteration of a run.

## Requirements (from GH Issue #805)
- Create formal "entity" abstraction that can be extended for different entity types
- Create formal "agent" abstraction that can be extended for different pipeline operations
- Agent invocations should represent a particular call to an agent
- Both abstractions should be extensible for future entity types and agent behaviors
- Detailed requirements to be refined during planning phase

## High Level Summary

The evolution codebase (186 files: 98 source, 88 test) currently uses a **purely functional architecture** with zero abstract classes, zero OOP inheritance (except error classes), and composition via interfaces + factory functions. Despite this, the codebase already has strong entity-awareness through:

1. **Two EntityType unions** — narrow (4 types for logging) and broad (7 types for metrics)
2. **A metric registry** keyed by EntityType with 3 lifecycle phases (execution, finalization, propagation)
3. **Generic UI components** (EntityListPage, EntityDetailHeader, EntityMetricsTab) that work across entity types
4. **An `executePhase` wrapper** that provides the "agent invocation" ceremony (budget tracking, error handling, cost recording)
5. **Three empty directories** (`evolution/src/lib/agents/`, `core/`, `v2/`) pre-scaffolded for class hierarchy

The V2 pipeline loop calls exactly 2 agents per iteration: `generateVariants()` and `rankPool()`. A third agent `evolveVariants()` exists but is dead code (implemented, never wired in). Eight additional agent type stubs exist from V1 (reflection, iterativeEditing, treeSearch, debate, etc.) with only type definitions, no implementations.

Introducing class abstractions is **low-risk**: no DI framework, no mocking of types/schemas, no test breakage from type changes. The codebase already uses classes for errors (5 classes) and caching (ComparisonCache).

## Key Findings

### 1. Current Entity System (No Base Class)

Entities are represented through:
- **Zod schemas** in `evolution/src/lib/schemas.ts` (781 lines) — InsertSchema + FullDbSchema pairs for 10 DB entities
- **EntityType union** in `evolution/src/lib/metrics/types.ts` — `'run' | 'invocation' | 'variant' | 'strategy' | 'experiment' | 'prompt' | 'arena_topic'`
- **EntityLogContext** in `evolution/src/lib/pipeline/infra/createEntityLogger.ts` — narrower 4-type union for logging
- **METRIC_REGISTRY** in `evolution/src/lib/metrics/registry.ts` — declarative metric definitions per entity type
- **evolution_metrics** EAV table — unified metric storage with `(entity_type, entity_id, metric_name)` unique constraint

Entity hierarchy:
```
Root entities (no parent): strategy, prompt, explanation
Middle tier (parent + children): experiment, run, variant, invocation
Leaf entities (no children): log, arena_comparison, budget_event, metric
```

### 2. Current Agent System (Plain Functions)

Agents are plain async functions called by the orchestrator via `executePhase()`:
- `generateVariants(text, iteration, llm, config, feedback?, logger?) → Variant[]`
- `rankPool(pool, ratings, matchCounts, newEntrantIds, llm, config, budgetFraction?, cache?, logger?) → RankResult`
- `evolveVariants(pool, ratings, iteration, llm, config, options?) → Variant[]` (dead code)

All share: `EvolutionLLMClient` interface, `EvolutionConfig`, optional `EntityLogger`, budget error handling via `BudgetExceededError`/`BudgetExceededWithPartialResults`.

The `executePhase()` wrapper in `runIterationLoop.ts` provides:
- Budget error catching (must check subclass before superclass due to inheritance)
- Cost delta calculation (`getTotalSpent()` before/after)
- Invocation row update (cost, success, error_message)
- Returns `PhaseResult<T>` with success/budgetExceeded/partialVariants flags

### 3. Agent Invocation Lifecycle

Per iteration, exactly 2 invocations are created:
1. `createInvocation(db, runId, iter, 'generation', ++executionOrder)` → UUID
2. `executePhase('generation', () => generateVariants(...), db, genInvId, costTracker, costBefore)`
3. `createInvocation(db, runId, iter, 'ranking', ++executionOrder)` → UUID
4. `executePhase('ranking', () => rankPool(...), db, rankInvId, costTracker, costBefore)`
5. Write execution metrics from METRIC_REGISTRY.run.duringExecution
6. Write dynamic `agentCost:{phase}` metrics

Each invocation is tracked in `evolution_agent_invocations` table with: run_id, agent_name, iteration, execution_order, success, cost_usd, duration_ms, error_message, execution_detail (JSONB).

### 4. Server Action Duplication

50+ server actions wrapped by `adminAction()` factory across 9 service files. Heavily duplicated patterns:
- **Pagination**: 5+ independent implementations of same limit/offset/range logic
- **UUID validation**: 30+ identical `validateUuid()` calls
- **Batch enrichment**: 4+ identical fetch-and-map patterns
- **Archive operations**: 5 nearly identical archive implementations
- **Filter chains**: 4+ services with identical conditional filter application

### 5. DB Entity CRUD Patterns

| Entity | Create | Update | Query | Archive/Delete |
|--------|--------|--------|-------|----------------|
| Run | Via experiment or direct queue | Claim (RPC), heartbeat, status transitions, finalize | List with filters, get with joins | Mark failed/cancelled |
| Experiment | Direct or batch (with runs) | Status transitions (draft→running→completed/cancelled) | List with status filter | Cancel via RPC |
| Strategy | Direct or upsert-by-hash | Name/description/status, aggregate metrics | List with filters | Archive (soft) or delete if 0 runs |
| Variant | In-memory via `createVariant()`, persisted at finalize | Immutable after creation (append-only) | List, detail, lineage chain, arena load | Implicit via archived_at |
| Invocation | Per-phase per-iteration | Cost/success/detail after phase completes | List, detail | Immutable |

### 6. Risk Assessment

- **Risk level**: LOW — no DI framework, no type mocking, classes already used for errors/cache
- **Test impact**: 0 files mock types.ts or schemas.ts; 50-100 test assertions need review
- **Barrel exports**: 4 files need mechanical updates
- **Constraint**: Zod schemas must remain (validation layer); classes wrap around schemas, not replace them
- **Empty scaffolding directories exist**: `evolution/src/lib/agents/`, `core/`, `v2/`

### 7. Design Pattern Recommendations (from research)

**For Entity abstraction**:
- Use **factory functions returning interfaces** (matches existing patterns)
- Keep Zod schemas as source of truth for validation
- Entity class would own: CRUD operations, metric registry reference, logging, status transitions
- Entity subclasses: Run, Experiment, Strategy, Variant, Invocation (each with entity-specific lifecycle methods)

**For Agent abstraction**:
- Use **abstract class with template method** (`run()` wraps `execute()`)
- `run()` encapsulates: budget error handling, cost delta, invocation tracking, logging ceremony
- `execute()` is overridden per agent (generation, ranking, evolution)
- Agent subclasses: GenerationAgent, RankingAgent, (future: EvolutionAgent, etc.)

**Hybrid approach recommended**: Factory functions for entity creation, abstract class for agent execution ceremony.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/minicomputer_deployment.md

## Code Files Read

### Type System & Schemas
- evolution/src/lib/types.ts (659 lines) — Core types: Variant, ExecutionContext, ReadonlyPipelineState, AgentName (11 types), AgentResult, AgentExecutionDetail (11-variant discriminated union), EvolutionRunSummary, error classes
- evolution/src/lib/schemas.ts (781 lines) — Zod schemas: 10 DB entity InsertSchema/FullDbSchema pairs, internal pipeline schemas, V1/V2/V3 run summary auto-migration
- evolution/src/lib/metrics/types.ts (146 lines) — EntityType (7 types), MetricDef variants, ExecutionContext/FinalizationContext for metrics, MetricRow DB schema

### Pipeline Loop
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — evolveArticle() main loop, executePhase() wrapper
- evolution/src/lib/pipeline/loop/generateVariants.ts — Generation agent: 3 parallel strategies, format validation
- evolution/src/lib/pipeline/loop/rankVariants.ts — Ranking agent: triage + Swiss fine-ranking
- evolution/src/lib/pipeline/loop/extractFeedback.ts — evolveVariants() (dead code, never called)
- evolution/src/lib/pipeline/loop/buildPrompts.ts — Prompt construction helpers

### Pipeline Infrastructure
- evolution/src/lib/pipeline/infra/createEntityLogger.ts — EntityLogger factory, EntityLogContext, EntityType (4 types)
- evolution/src/lib/pipeline/infra/trackInvocations.ts — createInvocation/updateInvocation
- evolution/src/lib/pipeline/infra/trackBudget.ts — V2CostTracker factory (reserve-before-spend)
- evolution/src/lib/pipeline/infra/createLLMClient.ts — V2 LLM client with retry + cost tracking
- evolution/src/lib/pipeline/infra/errors.ts — BudgetExceededWithPartialResults
- evolution/src/lib/pipeline/infra/types.ts — EvolutionConfig, EvolutionResult, V2Match types

### Pipeline Setup & Finalize
- evolution/src/lib/pipeline/setup/buildRunContext.ts — Strategy resolution, content resolution, arena loading
- evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts — Hash-based strategy upsert
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — Run completion, variant upsert, metric propagation, arena sync
- evolution/src/lib/pipeline/claimAndExecuteRun.ts — Claim RPC, heartbeat, error marking

### Metrics System
- evolution/src/lib/metrics/registry.ts — METRIC_REGISTRY: 31 static metrics, 3 lifecycle phases per entity
- evolution/src/lib/metrics/computations/propagation.ts — Child-to-parent metric aggregation (bootstrap CIs)
- evolution/src/lib/metrics/recomputeMetrics.ts — Stale metric refresh with SKIP LOCKED
- evolution/src/lib/metrics/writeMetrics.ts — UPSERT with timing validation
- evolution/src/lib/metrics/readMetrics.ts — Batch read with chunking

### Services
- evolution/src/services/adminAction.ts — Factory wrapping 50+ actions with auth/context/error handling
- evolution/src/services/shared.ts — validateUuid, ActionResult type
- evolution/src/services/evolutionActions.ts — Run CRUD (11+ actions)
- evolution/src/services/experimentActions.ts — Experiment CRUD (8 actions)
- evolution/src/services/strategyRegistryActions.ts — Strategy CRUD (7+ actions)
- evolution/src/services/arenaActions.ts — Arena/prompt actions (13+ actions)
- evolution/src/services/invocationActions.ts — Invocation list/detail (2 actions)
- evolution/src/services/variantDetailActions.ts — Variant queries (4+ actions)
- evolution/src/services/logActions.ts — Multi-entity log queries (1 action)
- evolution/src/services/metricsActions.ts — Metric queries with lazy stale recomputation

### Shared Utilities
- evolution/src/lib/shared/computeRatings.ts — OpenSkill rating, ComparisonCache class
- evolution/src/lib/shared/enforceVariantFormat.ts — Format validation rules
- evolution/src/lib/shared/hashStrategyConfig.ts — SHA-256 config hashing
- evolution/src/lib/shared/classifyErrors.ts — Transient vs permanent error classification

### UI Components
- evolution/src/components/evolution/index.ts — 20+ component barrel exports
- evolution/src/components/evolution/EntityListPage.tsx — Generic `<T>` list with filters/pagination
- evolution/src/components/evolution/EntityDetailHeader.tsx — Generic detail header with rename/badges/links
- evolution/src/components/evolution/EntityDetailTabs.tsx — URL-synced tab container
- evolution/src/components/evolution/tabs/EntityMetricsTab.tsx — Entity-parameterized metrics display
- evolution/src/components/evolution/tabs/LogsTab.tsx — Multi-entity log viewer
- evolution/src/components/evolution/RegistryPage.tsx — Config-driven CRUD page

### Testing
- evolution/src/testing/v2MockLlm.ts — Mock LLM with label/position/pair response routing
- evolution/src/testing/service-test-mocks.ts — Chainable Supabase mocks
- evolution/src/testing/evolution-test-helpers.ts — Test data factories, mock clients
- evolution/src/testing/executionDetailFixtures.ts — 10 agent execution detail fixtures
- evolution/src/testing/schema-fixtures.ts — Valid schema insert factories

### Barrel Exports
- evolution/src/lib/index.ts — Main library API (types, rating, comparison, format, strategy)
- evolution/src/lib/pipeline/index.ts — Pipeline V2 API (evolveArticle, claimAndExecuteRun, finalize, arena, experiments)

## Open Questions

1. **Scope of Entity class**: Should it encompass CRUD operations (wrapping server actions) or just type/behavior definitions?
2. **Agent class vs factory function**: Given the functional codebase, is an abstract class the right pattern or should agents be factory-created objects implementing an interface?
3. **Migration strategy**: Should this be a gradual refactor (coexist with current functions) or a clean break?
4. **V1 agent stubs**: Should the 8 legacy agent type stubs be cleaned up or preserved for future use?
5. **Empty directories**: Were `evolution/src/lib/agents/`, `core/`, `v2/` scaffolded intentionally for this work?
