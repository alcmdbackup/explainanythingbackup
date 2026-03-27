# Improve Agent Template Evolution Research

## Problem Statement
We want to ensure we have a well-thought-out and extensible template for future agents which extends Entity. It should handle metrics and logging, declare parent variant(s) and child variants as output. It should also have a well-structured detail view that can be shown on invocation detail.

## Requirements (from GH Issue #815)
- Create a well-thought-out and extensible agent template that extends Entity
- Handle metrics and logging within the agent template
- Declare parent variant(s) as input and child variants as output
- Provide a well-structured detail view for invocation detail pages

## High Level Summary

The evolution pipeline has a clean Agent base class (`Agent<TInput, TOutput>`) with a template method pattern, but it has **significant gaps** between what's declared/designed and what's actually implemented. The infrastructure (DB columns, Zod schemas, UI components) is ready for rich agent metadata, but the runtime pipeline never populates it. There are 11 execution detail types pre-defined for future agents, but only 2 agents exist (Generation and Ranking). The evolve phase function exists but is orphaned (never called). The agent template needs to be extended to enforce: execution detail population, duration tracking, variant I/O declarations, and structured detail views.

## Key Findings

### 1. Agent Base Class Architecture (Agent.ts)

The `Agent<TInput, TOutput>` abstract class uses a **template method pattern**:
- `run()` (sealed) wraps `execute()` with invocation tracking, cost attribution, budget error handling, and logging
- Subclasses implement `execute(input: TInput, ctx: AgentContext): Promise<TOutput>`
- Three abstract members required: `name`, `executionDetailSchema`, `execute()`

**AgentContext** provides: `db`, `runId`, `iteration`, `executionOrder`, `logger`, `costTracker`, `config`

**AgentResult<T>** returns: `success`, `result`, `cost`, `invocationId`, `budgetExceeded?`, `partialResult?`

### 2. Entity Base Class Architecture (Entity.ts)

The `Entity<TRow>` abstract class enforces subclass declarations via abstract members:
- Identity: `type`, `table`
- Relationships: `parents: ParentRelation[]`, `children: ChildRelation[]`
- Metrics: `metrics: EntityMetricRegistry` (3 timing phases: duringExecution, atFinalization, atPropagation)
- List view: `listColumns`, `listFilters`, `actions`
- Detail view: `detailTabs`, `detailLinks()`
- Schema: `insertSchema`

The entity registry validates at startup that all propagation source metrics exist and no duplicate metric names exist.

### 3. Critical Gap: execution_detail Never Populated

**The #1 finding.** The `execution_detail` JSONB column on `evolution_agent_invocations` is NEVER populated by any code path:
- `Agent.run()` calls `updateInvocation()` at 4 locations but NEVER passes `execution_detail`
- `generateVariants()` returns `Variant[]` without constructing `GenerationExecutionDetail`
- `rankPool()` returns `RankResult` without constructing `RankingExecutionDetail`
- Schemas exist for 11 detail types but none are instantiated at runtime

**Recommended fix**: Have `execute()` return `{ result: TOutput; detail?: unknown }` so `run()` can pass detail to `updateInvocation()`.

### 4. Critical Gap: duration_ms Never Tracked

The `duration_ms` column exists in the DB schema and is displayed in the UI, but `Agent.run()` never measures or records execution time. Fix: add `Date.now()` timing in `run()`.

### 5. Variant I/O Not Formalized

Agents don't formally declare their variant input/output contracts:
- **Generation**: takes original text (no parent variants), produces 0-3 variants with `parentIds: []`
- **Ranking**: takes pool + ratings, produces RankResult (no new variants)
- **Evolution** (orphaned): takes pool + ratings, selects top-2 by mu as parents, produces 0-4 variants with `parentIds: [parent0.id, parent1.id]`

No TypeScript type captures: "this agent takes N parents selected by X criteria and produces M children."

### 6. evolveVariants() Is Orphaned

The `evolveVariants()` function in `extractFeedback.ts` implements mutation + crossover + creative exploration but is **never called** in `runIterationLoop.ts`. The current loop is only generate→rank. The `EvolutionExecutionDetail` schema exists but is unused.

### 7. Pre-Defined Future Agent Types (9 of 11 Unimplemented)

The codebase defines execution detail schemas and TypeScript types for 11 agent types:

| Type | Status | detailType |
|------|--------|------------|
| Generation | **Active** | `generation` |
| Ranking | **Active** | `ranking` |
| Evolution | Orphaned function exists | `evolution` |
| IterativeEditing | Schema only | `iterativeEditing` |
| Reflection | Schema only | `reflection` |
| Debate | Schema only | `debate` |
| SectionDecomposition | Schema only | `sectionDecomposition` |
| TreeSearch | Schema only | `treeSearch` |
| OutlineGeneration | Schema only | `outlineGeneration` |
| Proximity | Schema only | `proximity` |
| MetaReview | Schema only | `metaReview` |

Additionally, `flowCritique` is in `agentNameEnum` but has NO corresponding schema (gap).

### 8. Invocation Detail UI Is Raw JSON

`InvocationExecutionDetail.tsx` renders execution_detail as `JSON.stringify(detail, null, 2)` in a collapsible `<pre>` block. No agent-specific rendering, no structured views, no status highlighting. The existing UI dispatch pattern uses conditional rendering based on `activeTab` state (pattern a), which could be extended to dispatch on `detailType` for agent-specific components.

### 9. Agent Registration Checklist (Files to Touch)

Adding a new agent type requires changes in **7 files**:

1. `evolution/src/lib/schemas.ts` — agentNameEnum + execution detail schema + discriminated union
2. `evolution/src/lib/types.ts` — AgentName type + ExecutionDetail interface + union type
3. `evolution/src/testing/executionDetailFixtures.ts` — test fixture + allFixtures array
4. `evolution/src/lib/core/agents/NewAgent.ts` — new Agent subclass file
5. `evolution/src/lib/core/entities/InvocationEntity.ts` — listFilters agent_name options
6. `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — instantiation in iteration loop
7. `evolution/src/lib/index.ts` — barrel export

### 10. Metric System and Agent Interaction

The metrics system is entity-based. Metrics are declared on Entity subclasses, not on agents:
- **InvocationEntity** declares 3 generic finalization metrics (`best_variant_elo`, `avg_variant_elo`, `variant_count`) that apply to all invocations regardless of agent type. These depend on `execution_detail` to identify which variants an invocation produced — currently broken because execution_detail is never populated.
- **Dynamic prefix pattern**: `agentCost:${phaseName}` writes per-agent cost to `evolution_metrics` as run-level metrics. Written by the loop, not by agents.
- **No agent-specific metrics**: There's no mechanism for GenerationAgent to declare a `format_rejection_rate` metric or RankingAgent to declare `total_comparisons`. InvocationEntity has a flat list with no agent-name scoping.

**Key insight from discussion**: Every agent execution IS an invocation row (1:1 mapping). Agents are natural extensions of InvocationEntity for metrics. The solution is to let agents declare `invocationMetrics` that are merged into InvocationEntity's metric registry at startup. This keeps the entity registry as the single source of truth while letting agents own their metrics.

**Why alternatives were rejected**:
- Agent declares metrics independently, writes in `run()` → bypasses entity registry, breaks UI display, validation, and propagation. Creates a shadow metric system.
- InvocationEntity gets all agent-specific metrics with `detailType` checks → becomes a god object. Adding an agent means editing InvocationEntity. Violates open/closed principle.

### 11. Logging Architecture

`Agent.run()` logs start/complete via `ctx.logger` (EntityLogger injected through AgentContext). The EntityLogger writes to `evolution_logs` table with denormalized ancestor FKs (run_id, experiment_id, strategy_id). Level filtering via `EVOLUTION_LOG_LEVEL` env var. All DB writes are fire-and-forget. Agents can also log within `execute()` via `ctx.logger` for domain-specific events. No structural changes needed — just add `durationMs` to completion log and warn on schema validation failure.

### 12. TypeScript Enforcement Patterns Available

The codebase uses strong patterns that can be applied to agents:
- **Abstract members** on Entity enforce compile-time declarations
- **Zod discriminated unions** enforce runtime schema validation
- **Entity registry** validates relationships and metric consistency at startup
- **`satisfies` keyword** on METRIC_CATALOG ensures type conformance
- **Generic type parameters** on Agent<TInput, TOutput> enforce I/O contracts

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/architecture.md — Pipeline execution flow, 3-op loop, agent integration
- evolution/docs/agents/overview.md — Agent operations, format validation, invocations
- evolution/docs/reference.md — File inventory, CLI, config, testing, admin UI
- evolution/docs/data_model.md — DB schema, evolution_agent_invocations table
- evolution/docs/strategies_and_experiments.md — Strategy system, experiment lifecycle
- evolution/docs/entities.md — Entity relationships diagram
- evolution/docs/README.md — Reading order, system overview
- evolution/docs/cost_optimization.md — Budget tracking, cost tracker, spending gate
- evolution/docs/rating_and_comparison.md — OpenSkill ratings, ranking pipeline
- evolution/docs/arena.md — Cross-run arena comparison system

## Code Files Read

### Core Agent & Entity Infrastructure
- `evolution/src/lib/core/Agent.ts` — Abstract Agent base class with run()/execute() template method
- `evolution/src/lib/core/Agent.test.ts` — Agent test patterns with mock subclass
- `evolution/src/lib/core/Entity.ts` — Abstract Entity base class with abstract declarations
- `evolution/src/lib/core/types.ts` — AgentContext, AgentResult, ParentRelation, ChildRelation
- `evolution/src/lib/core/entityRegistry.ts` — Lazy-init entity registry with startup validation
- `evolution/src/lib/core/metricCatalog.ts` — 25 metric definitions, METRIC_FORMATTERS

### Concrete Agents
- `evolution/src/lib/core/agents/GenerationAgent.ts` — Wraps generateVariants()
- `evolution/src/lib/core/agents/RankingAgent.ts` — Wraps rankPool()

### Concrete Entities
- `evolution/src/lib/core/entities/RunEntity.ts` — Run entity with 1+7+0 metrics
- `evolution/src/lib/core/entities/InvocationEntity.ts` — Invocation entity with 0+3+0 metrics
- `evolution/src/lib/core/entities/VariantEntity.ts` — Variant entity (leaf)
- `evolution/src/lib/core/entities/StrategyEntity.ts` — Strategy entity with propagation metrics
- `evolution/src/lib/core/entities/ExperimentEntity.ts` — Experiment entity
- `evolution/src/lib/core/entities/PromptEntity.ts` — Prompt entity (no metrics)
- `evolution/src/lib/core/entities/entities.test.ts` — Entity declaration tests

### Pipeline Functions
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Main evolution loop, agent orchestration
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — Generation phase implementation
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — Ranking phase implementation
- `evolution/src/lib/pipeline/loop/extractFeedback.ts` — Orphaned evolveVariants() function
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Run finalization, variant persistence
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Pipeline context setup

### Schemas & Types
- `evolution/src/lib/schemas.ts` — All Zod schemas including 11 execution detail schemas
- `evolution/src/lib/types.ts` — All TypeScript types including AgentExecutionDetail union

### Infrastructure
- `evolution/src/lib/pipeline/infra/trackInvocations.ts` — createInvocation/updateInvocation
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — V2CostTracker implementation
- `evolution/src/lib/pipeline/infra/createEntityLogger.ts` — EntityLogger factory
- `evolution/src/lib/pipeline/infra/errors.ts` — BudgetExceededWithPartialResults

### Metrics System
- `evolution/src/lib/metrics/writeMetrics.ts` — UPSERT metrics with timing validation
- `evolution/src/lib/metrics/readMetrics.ts` — Batch query with chunking
- `evolution/src/lib/metrics/recomputeMetrics.ts` — Stale metric detection
- `evolution/src/lib/metrics/types.ts` — MetricName, MetricTiming types

### Testing
- `evolution/src/testing/executionDetailFixtures.ts` — Fixtures for all 10+ detail types
- `evolution/src/testing/evolution-test-helpers.ts` — Mock factories for agents, LLM, cost tracker

### UI Components
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — Invocation detail page
- `src/app/admin/evolution/invocations/[invocationId]/InvocationExecutionDetail.tsx` — Raw JSON renderer
- `evolution/src/components/evolution/EntityDetailTabs.tsx` — Tab bar with URL sync
- `evolution/src/components/evolution/EntityDetailHeader.tsx` — Detail page header
- `evolution/src/components/evolution/MetricGrid.tsx` — Metric display grid

### Shared Utilities
- `evolution/src/lib/shared/textVariationFactory.ts` — createVariant() factory (in types.ts)

## Open Questions

1. **Should Agent extend Entity?** Entity has rich declaration infrastructure (metrics, tabs, parents/children). But agents are instantiated per-invocation while entities are singletons. Should Agent compose Entity features rather than extend it?

2. **Execute return type change**: Should `execute()` return `{ result: TOutput; detail: TDetail }` (breaking change) or should detail be an optional field on AgentResult (backward compatible)?

3. **Variant I/O formalization**: Should agents declare a static `variantContract` property describing parent selection and child production, or is this better captured in the execution detail schema?

4. **Evolution phase activation**: Should this project also wire up the orphaned `evolveVariants()` as an `EvolutionAgent`, or is that a separate project?

5. **UI detail components**: Should each agent type provide its own React component for rendering execution detail (registered in a map), or should a single component dispatch on `detailType`?

6. **flowCritique gap**: Should the missing `flowCritique` execution detail schema be created, or should `flowCritique` be removed from `agentNameEnum`?
