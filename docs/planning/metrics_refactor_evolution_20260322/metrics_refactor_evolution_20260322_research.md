# Metrics Refactor Evolution Research

## Problem Statement
Refactor metrics so there is a standardized metrics table and approach for logging metrics. Different entities (e.g. runs, agent invocations) can log metrics. Metrics can be inherited from children to parents (e.g. via sum). Metrics can have confidence intervals calculated. There are standardized components to A) display metrics on list views and B) display metrics on tab within detail view for an entity - e.g. "metrics" tab attached to a run detail view in evolution.

## Requirements (from GH Issue #786)
- Standardized metrics table and approach for logging metrics
- Different entities (e.g. runs, agent invocations) can log metrics
- Metrics can be inherited from children to parents (e.g. via sum)
- Metrics can have confidence intervals calculated
- Standardized component to display metrics on list views
- Standardized component to display metrics on tab within detail view for an entity (e.g. "metrics" tab on run detail view in evolution)

## High Level Summary

The evolution system currently has metrics scattered across 6+ tables, JSONB blobs, SQL views/RPCs, and in-memory TypeScript computations. There is no unified metrics table — metrics are stored as hardcoded columns (evolution_strategies), JSONB summaries (evolution_runs.run_summary), computed on-demand (experiment metrics), or tracked via event sourcing (userExplanationEvents). The closest existing pattern to a standardized metrics table is the `MetricsBag` TypeScript type (string-keyed map of `MetricValue` with CI support) and the `content_quality_scores` EAV table (one row per dimension per entity).

### Key Findings

1. **Entity hierarchy**: Experiment → Run → Invocation → LLM Call, with Variants as children of Runs. Strategy and Prompt are referenced entities.

2. **Current metrics storage is fragmented**:
   - Strategy aggregates: hardcoded columns updated via `update_strategy_aggregates` RPC (Welford's incremental avg)
   - Run metrics: `run_summary` JSONB blob written at finalization
   - Experiment metrics: computed on-demand via `computeExperimentMetrics()`, not persisted
   - Invocation costs: per-row `cost_usd` column, aggregated via `evolution_run_costs` VIEW
   - Variant ratings: per-row `mu`, `sigma`, `elo_score` columns

3. **MetricsBag type is the best foundation**: Already supports `MetricValue { value, sigma, ci, n }` with bootstrap CI computation (`bootstrapMeanCI`, `bootstrapPercentileCI`). Template literal keys for dynamic metrics (`agentCost:${string}`).

4. **MetricGrid component already supports CI display**: Renders `[lo, hi]` ranges, flags n=2 with warning asterisk. Currently ZERO usages pass CI data — feature is ready but unused.

5. **Cost tracking is dual**: `llmCallTracking` (per-API-call, platform-wide) and `evolution_agent_invocations` (per-phase, evolution-specific). Linked via `evolution_invocation_id` FK. No duplication — invocation cost = delta from in-memory tracker.

6. **Aggregation patterns vary by level**:
   - Invocation → Run: SUM (via SQL VIEW)
   - Run → Strategy: Incremental AVG, SUM, MAX, MIN (via SQL RPC)
   - Run → Experiment: MAX, SUM (via TypeScript, on-demand)
   - No backward propagation — metrics only flow upward

7. **Non-evolution metrics systems** (explanation views/saves, content quality scores) have fundamentally different semantics and should remain separate. The evolution metrics refactor should focus on the evolution entity hierarchy.

8. **Existing UI components are well-structured**: MetricGrid (10 usages), EntityDetailHeader, EntityDetailTabs, EntityListPage, EntityTable — all generic and extensible. The standardized metrics display should build on these.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution Docs
- evolution/docs/evolution/experimental_framework.md — MetricsBag, bootstrap CIs, run summary V3 schema
- evolution/docs/evolution/strategy_experiments.md — strategy aggregates, experiment lifecycle, ExperimentMetrics
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill ratings, Elo conversion, ranking pipeline
- evolution/docs/evolution/data_model.md — DB schema for all evolution tables
- evolution/docs/evolution/cost_optimization.md — budget tracking, cost tiers
- evolution/docs/evolution/visualization.md — muHistory rendering, UI patterns
- evolution/docs/evolution/reference.md — file inventory

### Code Files Read

#### Metrics Computation
- `evolution/src/experiments/evolution/experimentMetrics.ts` — MetricsBag, MetricValue, bootstrap CIs, aggregateMetrics, computeRunMetrics
- `evolution/src/lib/shared/computeRatings.ts` — OpenSkill ratings, toEloScale, computeEloPerDollar
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — buildRunSummary, strategy aggregate updates, arena sync
- `evolution/src/lib/pipeline/manageExperiments.ts` — computeExperimentMetrics (on-demand)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — muHistory accumulation, cost tracking per phase
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — ranking phase metrics (match stats, convergence)

#### Cost Tracking
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — V2CostTracker (reserve/spend/release pattern)
- `evolution/src/lib/pipeline/infra/trackInvocations.ts` — createInvocation/updateInvocation
- `evolution/src/services/costAnalytics.ts` — getCostSummaryAction, getDailyCostsAction, getCostByModelAction
- `src/config/llmPricing.ts` — model pricing table, calculateLLMCost
- `src/lib/services/llms.ts` — saveLlmCallTracking, onUsage callback

#### Server Actions
- `evolution/src/services/evolutionActions.ts` — getEvolutionRunSummaryAction, getEvolutionCostBreakdownAction
- `evolution/src/services/experimentActionsV2.ts` — getExperimentAction (with metrics), listExperimentsAction
- `evolution/src/services/strategyRegistryActionsV2.ts` — listStrategiesAction (with aggregates)
- `evolution/src/services/evolutionVisualizationActions.ts` — getEvolutionDashboardDataAction, getEvolutionRunEloHistoryAction
- `evolution/src/services/invocationActions.ts` — listInvocationsAction

#### UI Components
- `evolution/src/components/evolution/MetricGrid.tsx` — Reusable grid with CI support (10 usages)
- `evolution/src/components/evolution/tabs/MetricsTab.tsx` — Run metrics display (overview + tables)
- `evolution/src/components/evolution/EntityDetailHeader.tsx` — Shared detail page header
- `evolution/src/components/evolution/EntityDetailTabs.tsx` — Tab bar with URL sync
- `evolution/src/components/evolution/EntityListPage.tsx` — List wrapper with filters/pagination
- `evolution/src/components/evolution/EntityTable.tsx` — Generic sortable table
- `evolution/src/components/evolution/RunsTable.tsx` — Specialized runs table with budget visualization
- `evolution/src/components/evolution/index.ts` — Barrel exports
- `evolution/src/lib/utils/formatters.ts` — formatCost, formatElo, formatDuration, formatEloCIRange, etc.

#### Types
- `evolution/src/lib/types.ts` — EvolutionRunSummary (V1/V2/V3 schemas), DiffMetrics, EloAttribution, AgentAttribution, 11 ExecutionDetail types, EvolutionResult

#### DB Schema
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — Consolidated evolution schema
- `supabase/migrations/20260322000007_evolution_prod_convergence.sql` — Production convergence
- `supabase/migrations/20260322000002_fix_experiment_auto_completion.sql` — complete_experiment_if_done RPC
- `supabase/migrations/20260116061036_add_llm_cost_tracking.sql` — llmCallTracking table
- `supabase/migrations/20260228000001_add_llm_cost_security.sql` — daily_cost_rollups, budget RPCs

#### Tests
- `evolution/src/experiments/evolution/experimentMetrics.test.ts` — Bootstrap CI tests (some skipped)
- `evolution/src/components/evolution/MetricGrid.test.tsx` — Grid rendering, CI display, low-n warning
- `evolution/src/components/evolution/tabs/MetricsTab.test.tsx` — Tab rendering, empty/error states
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — Run summary building, match stats
- `evolution/src/lib/pipeline/manageExperiments.test.ts` — Experiment creation, metrics computation
- `evolution/src/services/experimentActionsV2.test.ts` — Action wrappers, budget validation
- `src/lib/services/metrics.test.ts` — Explanation metrics event tracking
- `src/__tests__/integration/metrics-aggregation.integration.test.ts` — Integration (partially skipped)

## Current Architecture Map

### DB Tables with Metrics
| Table | Metrics Storage | Aggregation |
|-------|----------------|-------------|
| `evolution_strategies` | Hardcoded columns (run_count, total_cost_usd, avg/best/worst_final_elo) | RPC `update_strategy_aggregates` |
| `evolution_runs` | JSONB `run_summary` (matchStats, topVariants, strategyEffectiveness, muHistory) | Built in TypeScript at finalization |
| `evolution_variants` | Columns (mu, sigma, elo_score, match_count, is_winner) | Independent, not aggregated |
| `evolution_agent_invocations` | Column (cost_usd) + JSONB (execution_detail) | SUM via VIEW `evolution_run_costs` |
| `evolution_experiments` | None stored | Computed on-demand via TypeScript |
| `llmCallTracking` | Columns (estimated_cost_usd, tokens) | VIEW `daily_llm_costs` |
| `explanationMetrics` | Columns (total_views, total_saves, save_rate) | RPCs for increment/refresh |
| `content_quality_scores` | EAV rows (dimension, score) | None (queried directly) |

### Entity Hierarchy & Metric Inheritance
```
Strategy ←──── Run (strategy_id FK)
                ├── Invocation (run_id FK) → cost SUM → Run total cost
                └── Variant (run_id FK) → winner mu → Strategy avg_final_elo

Experiment ←── Run (experiment_id FK) → max elo, SUM cost → Experiment metrics

Prompt ←────── Variant (prompt_id FK, arena)
```

### Existing Patterns to Build On
1. **MetricsBag + MetricValue**: String-keyed map with `{ value, sigma, ci, n }` — best foundation for standardized metrics
2. **content_quality_scores EAV**: One row per (entity, dimension, score) — closest DB pattern to standardized table
3. **MetricGrid component**: Already supports CI display, multiple variants/sizes — needs no changes for display
4. **Bootstrap CI functions**: `bootstrapMeanCI` and `bootstrapPercentileCI` with seeded PRNG — production-ready

### Gaps to Address
1. No unified metrics table — metrics scattered across columns, JSONB, computed values
2. No standardized metric logging API — each entity writes metrics differently
3. No automatic parent inheritance — aggregation is manual per-entity
4. CI support exists in MetricGrid but no server action computes/returns CIs to the UI
5. Experiment metrics not persisted — recomputed on every page load
6. `duration_ms` on invocations exists but is never populated
7. No standardized "metrics tab" pattern — MetricsTab is run-specific, not generic

## Open Questions

1. Should the standardized metrics table be a single EAV table (entity_type + entity_id + metric_name + value) or per-entity tables?
2. Should existing hardcoded metric columns (e.g., `evolution_strategies.avg_final_elo`) be migrated to the new table or kept as denormalized views?
3. Should metric inheritance (child→parent aggregation) happen at write time (triggers/RPCs), read time (computed views), or async (background jobs)?
4. Should the `run_summary` JSONB be decomposed into metrics table rows, or kept as-is with the metrics table supplementing it?
5. What's the migration strategy for existing data? Backfill or forward-only?
6. Should non-evolution metrics (explanation views, quality scores) adopt the same system eventually?
