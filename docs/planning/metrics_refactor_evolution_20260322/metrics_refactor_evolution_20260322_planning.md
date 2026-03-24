# Metrics Refactor Evolution Plan

## Background
Refactor metrics so there is a standardized metrics table and approach for logging metrics. Different entities (e.g. runs, agent invocations) can log metrics. Metrics can be inherited from children to parents (e.g. via sum). Metrics can have confidence intervals calculated. There are standardized components to A) display metrics on list views and B) display metrics on tab within detail view for an entity - e.g. "metrics" tab attached to a run detail view in evolution.

## Requirements (from GH Issue #786)
- Standardized metrics table and approach for logging metrics
- Different entities (e.g. runs, agent invocations) can log metrics
- Metrics can be inherited from children to parents (e.g. via sum)
- Metrics can have confidence intervals calculated
- Standardized component to display metrics on list views
- Standardized component to display metrics on tab within detail view for an entity (e.g. "metrics" tab on run detail view in evolution)

## Problem
Evolution metrics are scattered across 6+ storage mechanisms: hardcoded columns on `evolution_strategies`, JSONB blob in `evolution_runs.run_summary`, SQL VIEWs/RPCs for cost aggregation, on-demand TypeScript computation for experiments, native columns on variants, and event-sourced explanation metrics. There is no unified table, no consistent logging API, no automatic parent-child inheritance, and confidence intervals — though supported by MetricGrid and bootstrap functions — are never surfaced to the UI. Each entity has bespoke metrics code with no shared patterns.

## Options Considered

### Metric Staleness Strategy
1. **Immutable snapshots** — Metrics captured at finalization never update. Simple but stale when variant ratings change post-completion (arena matches).
2. **DB triggers (synchronous)** — Trigger on variant mu change recomputes cascade immediately. Always consistent but adds write overhead during hot path.
3. **Lazy recompute with stale flags** ✅ — Mark metrics stale when source data changes; recompute on read. Zero write overhead, recomputation only when someone looks. Stale flags cascade (run → strategy → experiment).
4. **Async queue** — Background worker processes recompute jobs. Adds infrastructure complexity for marginal benefit over lazy recompute.

**Decision: Approach 3 (lazy recompute).** Stale flag on metrics rows, DB trigger only marks stale (no recomputation on write), server action recomputes on read if stale.

### Metrics Table Design
- **Single EAV table** ✅ — One `evolution_metrics` table with `(entity_type, entity_id, metric_name)` composite key. Flexible, no migrations for new metrics.
- **Per-entity tables** — Separate `run_metrics`, `strategy_metrics`, etc. More rigid but type-safe columns. Rejected: too many tables, schema changes for each new metric.

### What Goes in Metrics Table vs Native Columns
- **Operational state stays native** — Variant `mu/sigma/elo_score` (mutated during ranking), invocation `cost_usd` (written during execution for budget enforcement). These are live state needed during pipeline execution.
- **Cost metrics written incrementally** — Run-level cost metric is updated after each phase completes (same path for in-progress and completed runs). No status branching needed. This replaces `evolution_run_costs` VIEW and `get_run_total_cost()` RPC immediately — no dual-read period.
- **Elo/match metrics written at finalization** — These only exist once a run completes.
- **Strategy/experiment metrics propagated at finalization** — Aggregated from child run metrics.
- **Structured non-scalar data stays as JSONB** — `run_summary` fields like `muHistory`, `topVariants`, `metaFeedback` are arrays/objects, not scalar metrics.

### Elo and Cost Interaction with Metrics
- **Cost**: Source data lives on `evolution_agent_invocations.cost_usd` (native column). Metrics table stores aggregated run/strategy/experiment cost. Aggregation method: `sum`.
- **Elo**: Variant `mu/sigma` are live competitive state (native columns, NOT in metrics table). At run finalization, elo statistics (winner_elo, median_elo, p90_elo, max_elo) are computed and written as metrics rows. `sigma` on the metrics row carries the source variant's rating uncertainty for CI propagation. Strategy-level elo metrics get bootstrap CIs.
- **Staleness**: When a variant's mu changes post-completion (arena matches), a DB trigger marks dependent run/strategy/experiment elo metrics as stale. On next read, lazy recompute fires.

## Phased Execution Plan

### Phase 1: Schema & Core Infrastructure
**Goal:** Create the metrics table, TypeScript types, and basic read/write functions.

#### 1.1 Database Migration

**Note on deployment:** Create the `evolution_metrics` table and trigger in one migration. Drop legacy VIEWs/RPCs in a **separate follow-up migration** (Phase 6) after validating the new code path in production. This provides a rollback window — if new code has bugs, legacy infra still works.

```sql
CREATE TABLE evolution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt', 'arena_topic')),
  entity_id UUID NOT NULL,
  metric_name TEXT NOT NULL,          -- 'cost', 'winner_elo', 'median_elo', 'agentCost:generation', etc.
  value DOUBLE PRECISION NOT NULL,
  sigma DOUBLE PRECISION,             -- rating uncertainty from source variant (nullable)
  ci_lower DOUBLE PRECISION,          -- 95% CI lower bound (nullable)
  ci_upper DOUBLE PRECISION,          -- 95% CI upper bound (nullable)
  n INT DEFAULT 1,                    -- sample size / observation count
  origin_entity_type TEXT,            -- entity that produced this metric (self for aggregated)
  origin_entity_id UUID,              -- specific source entity (self for aggregated)
  aggregation_method TEXT,            -- 'sum', 'avg', 'max', 'min', 'count', 'bootstrap_mean', 'bootstrap_percentile', null (raw)
  source TEXT,                        -- 'pipeline', 'finalization', 'bootstrap', 'manual'
  stale BOOLEAN DEFAULT false,        -- lazy recompute flag
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_id, metric_name)
);

-- Primary access pattern: get all metrics for an entity
CREATE INDEX idx_metrics_entity ON evolution_metrics (entity_type, entity_id);
-- Leaderboard/comparison: get one metric across all entities of a type
CREATE INDEX idx_metrics_type_name ON evolution_metrics (entity_type, metric_name);
-- Cascade staleness: find metrics derived from a source entity
CREATE INDEX idx_metrics_origin ON evolution_metrics (origin_entity_type, origin_entity_id);
-- Recompute queue: find stale metrics
CREATE INDEX idx_metrics_stale ON evolution_metrics (stale) WHERE stale = true;

-- RLS (matches existing evolution table pattern including readonly_local)
ALTER TABLE evolution_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON evolution_metrics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY readonly_local ON evolution_metrics FOR SELECT USING (true);
REVOKE ALL ON evolution_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON evolution_metrics TO service_role;
GRANT SELECT ON evolution_metrics TO authenticated;
```

#### 1.2 Stale Flag Trigger
```sql
-- When a completed run's variant mu OR sigma changes, mark dependent metrics stale
CREATE FUNCTION mark_elo_metrics_stale()
RETURNS TRIGGER AS $$
DECLARE
  v_strategy_id UUID;
  v_experiment_id UUID;
BEGIN
  IF (NEW.mu IS DISTINCT FROM OLD.mu OR NEW.sigma IS DISTINCT FROM OLD.sigma)
     AND EXISTS (SELECT 1 FROM evolution_runs WHERE id = NEW.run_id AND status = 'completed')
  THEN
    -- Mark run-level elo metrics stale
    UPDATE evolution_metrics SET stale = true, updated_at = now()
    WHERE entity_type = 'run' AND entity_id = NEW.run_id
      AND metric_name IN ('winner_elo', 'median_elo', 'p90_elo', 'max_elo');

    -- Mark strategy-level metrics stale
    SELECT strategy_id, experiment_id INTO v_strategy_id, v_experiment_id
    FROM evolution_runs WHERE id = NEW.run_id;

    IF v_strategy_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'strategy' AND entity_id = v_strategy_id
        AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
          'avg_median_elo', 'avg_p90_elo', 'best_max_elo');
    END IF;

    IF v_experiment_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'experiment' AND entity_id = v_experiment_id
        AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
          'avg_median_elo', 'avg_p90_elo', 'best_max_elo');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only fire on mu/sigma changes (trigger columns match IF condition)
CREATE TRIGGER variant_rating_changed
  AFTER UPDATE OF mu, sigma ON evolution_variants
  FOR EACH ROW
  EXECUTE FUNCTION mark_elo_metrics_stale();
```

**Note on trigger frequency:** During pipeline execution, variant mu updates fire this trigger for every ranking match, but the `status = 'completed'` guard means the IF block is skipped (run is 'running'). Post-completion arena matches fire infrequently. The redundant UPDATEs to the same stale rows are idempotent and cheap (UPDATE of already-true boolean is a no-op at the storage level).

#### 1.3 TypeScript Types, Registry & Computation Functions

The metrics system is split across several files to separate concerns: types, registry (declarative), and computations (logic).

**File structure:**
```
evolution/src/lib/metrics/
├── types.ts                          # MetricDef types, MetricName, MetricRow, context types
├── registry.ts                       # METRIC_REGISTRY — declarative, references compute fns
├── computations/
│   ├── execution.ts                  # computeRunCost, computeAgentCost
│   ├── finalization.ts               # computeWinnerElo, computeMedianElo, computeVariantCount, ...
│   ├── finalizationInvocation.ts     # computeBestVariantElo, computeAvgVariantElo
│   └── propagation.ts               # aggregateSum, aggregateMax, aggregateAvg, aggregateBootstrapMean, aggregateCount
├── writeMetrics.ts                   # UPSERT with timing validation
├── readMetrics.ts                    # Read + lazy recompute
├── recomputeMetrics.ts              # Stale recomputation
└── index.ts                          # Barrel exports
```

**File:** `evolution/src/lib/metrics/types.ts`

```typescript
import { z } from 'zod';

// ─── Entity & Metric Name Types ─────────────────────────────────

export const ENTITY_TYPES = ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt', 'arena_topic'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const AGGREGATION_METHODS = ['sum', 'avg', 'max', 'min', 'count', 'bootstrap_mean', 'bootstrap_percentile'] as const;
export type AggregationMethod = typeof AGGREGATION_METHODS[number];

// Type-safe metric names — typos caught at compile time
export const STATIC_METRIC_NAMES = [
  // Run
  'cost', 'winner_elo', 'median_elo', 'p90_elo', 'max_elo',
  'total_matches', 'decisive_rate', 'variant_count',
  // Invocation
  'best_variant_elo', 'avg_variant_elo',
  // Strategy/Experiment aggregates
  'run_count', 'total_cost', 'avg_cost_per_run',
  'avg_final_elo', 'best_final_elo', 'worst_final_elo',
  'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
  'avg_matches_per_run', 'avg_decisive_rate',
  'total_variant_count', 'avg_variant_count',
] as const;
export type StaticMetricName = typeof STATIC_METRIC_NAMES[number];
export type DynamicMetricName = `agentCost:${string}`;
export type MetricName = StaticMetricName | DynamicMetricName;

// Dynamic metric prefixes for runtime validation
export const DYNAMIC_METRIC_PREFIXES = ['agentCost:'] as const;

// ─── Metric Definition Types ────────────────────────────────────
// Separate interfaces per timing phase. A metric can only be in one phase
// (enforced structurally via EntityMetricRegistry).

interface MetricDefBase {
  name: MetricName;
  label: string;
  category: 'cost' | 'rating' | 'match' | 'count';
  formatter: 'cost' | 'costDetailed' | 'elo' | 'score' | 'percent' | 'integer';
  description?: string;
  listView?: boolean;
}

// Metrics written during pipeline execution (e.g., cost after each phase)
export interface ExecutionMetricDef extends MetricDefBase {
  compute: (ctx: ExecutionContext) => number;
}

// Metrics written once when a run completes
export interface FinalizationMetricDef extends MetricDefBase {
  compute: (ctx: FinalizationContext) => number | null;
}

// Metrics aggregated from child entity metrics after finalization
export interface PropagationMetricDef extends MetricDefBase {
  sourceMetric: MetricName;        // required: which child metric to aggregate
  sourceEntity: EntityType;        // required: which entity type to read from
  aggregate: (rows: MetricRow[]) => MetricValue;  // the aggregation function
  aggregationMethod: AggregationMethod;  // stored on the metrics row (not derived from fn.name)
}

// Union for display/query purposes (doesn't carry compute fn)
export type MetricDef = MetricDefBase;

// ─── Registry Structure ─────────────────────────────────────────
// Separate arrays per timing phase — a metric CANNOT appear in two phases.

export interface EntityMetricRegistry {
  duringExecution: ExecutionMetricDef[];
  atFinalization: FinalizationMetricDef[];
  atPropagation: PropagationMetricDef[];
}

// ─── Computation Contexts ───────────────────────────────────────

export interface ExecutionContext {
  costTracker: V2CostTracker;
  phaseName: string;
}

export interface FinalizationContext {
  result: EvolutionResult;
  ratings: Map<string, Rating>;
  pool: TextVariation[];
  matchHistory: V2Match[];
  invocations: AgentInvocationRow[];  // for invocation-level metrics
  // Set per-entity when iterating invocations/variants in finalization loop:
  currentInvocationId?: string;       // set when writing invocation metrics
  currentVariantCost?: number | null;  // set when writing variant metrics
}

// ─── DB Row Schema (Zod) ────────────────────────────────────────

export const MetricRowSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
  metric_name: z.string().min(1).max(200),
  value: z.number(),
  sigma: z.number().nullable(),
  ci_lower: z.number().nullable(),
  ci_upper: z.number().nullable(),
  n: z.number().int().min(0),
  origin_entity_type: z.string().nullable(),
  origin_entity_id: z.string().uuid().nullable(),
  aggregation_method: z.enum(AGGREGATION_METHODS).nullable(),
  source: z.string().nullable(),
  stale: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MetricRow = z.infer<typeof MetricRowSchema>;

// Re-export MetricValue for UI compatibility
export { type MetricValue } from '@evolution/experiments/evolution/experimentMetrics';

// ─── Conversions ────────────────────────────────────────────────

export function toMetricValue(row: MetricRow): MetricValue { ... }
export function toMetricItem(row: MetricRow, formatter: (v: number) => string, label?: string): MetricItem { ... }
```

**File:** `evolution/src/lib/metrics/computations/execution.ts`

Compute functions for metrics written during pipeline execution:

```typescript
import type { ExecutionContext } from '../types';

export function computeRunCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getTotalSpent();
}

export function computeAgentCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getPhaseCosts()[ctx.phaseName] ?? 0;
}
```

**File:** `evolution/src/lib/metrics/computations/finalization.ts`

Compute functions for metrics written at run completion:

```typescript
import type { FinalizationContext } from '../types';
import { toEloScale, DEFAULT_MU } from '@evolution/lib/shared/computeRatings';

export function computeWinnerElo(ctx: FinalizationContext): number | null {
  const winner = ctx.pool.reduce((best, v) =>
    (ctx.ratings.get(v.id)?.mu ?? 0) > (ctx.ratings.get(best.id)?.mu ?? 0) ? v : best);
  const mu = ctx.ratings.get(winner.id)?.mu;
  return mu != null ? toEloScale(mu) : null;
}

export function computeMedianElo(ctx: FinalizationContext): number | null {
  const elos = ctx.pool.map(v => toEloScale(ctx.ratings.get(v.id)?.mu ?? DEFAULT_MU)).sort((a, b) => a - b);
  return elos.length > 0 ? elos[Math.floor(elos.length * 0.5)] : null;
}

export function computeP90Elo(ctx: FinalizationContext): number | null { ... }
export function computeMaxElo(ctx: FinalizationContext): number | null { ... }
export function computeTotalMatches(ctx: FinalizationContext): number { return ctx.matchHistory.length; }
export function computeDecisiveRate(ctx: FinalizationContext): number | null { ... }
export function computeVariantCount(ctx: FinalizationContext): number { return ctx.pool.length; }
```

**File:** `evolution/src/lib/metrics/computations/finalizationInvocation.ts`

Compute functions for invocation-level metrics at finalization:

```typescript
export function computeBestVariantElo(ctx: FinalizationContext, invocationId: string): number | null { ... }
export function computeAvgVariantElo(ctx: FinalizationContext, invocationId: string): number | null { ... }
export function computeInvocationVariantCount(ctx: FinalizationContext, invocationId: string): number | null { ... }
```

**File:** `evolution/src/lib/metrics/computations/propagation.ts`

Reusable aggregation functions for propagated metrics:

```typescript
import type { MetricRow, MetricValue } from '../types';
import { bootstrapMeanCI, toMetricValue } from '...';

// Simple aggregators
export function aggregateSum(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((s, r) => s + r.value, 0), sigma: null, ci: null, n: rows.length };
}

export function aggregateAvg(rows: MetricRow[]): MetricValue {
  const sum = rows.reduce((s, r) => s + r.value, 0);
  return { value: rows.length > 0 ? sum / rows.length : 0, sigma: null, ci: null, n: rows.length };
}

export function aggregateMax(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((m, r) => Math.max(m, r.value), -Infinity), sigma: null, ci: null, n: rows.length };
}

export function aggregateMin(rows: MetricRow[]): MetricValue {
  return { value: rows.reduce((m, r) => Math.min(m, r.value), Infinity), sigma: null, ci: null, n: rows.length };
}

export function aggregateCount(rows: MetricRow[]): MetricValue {
  return { value: rows.length, sigma: null, ci: null, n: rows.length };
}

// Bootstrap aggregators (produce CIs)
export function aggregateBootstrapMean(rows: MetricRow[]): MetricValue {
  return bootstrapMeanCI(rows.map(toMetricValue));
}
```

**File:** `evolution/src/lib/metrics/registry.ts`

Declarative registry — references compute functions, no inline logic:

```typescript
import type { EntityMetricRegistry, EntityType } from './types';
import { computeRunCost, computeAgentCost } from './computations/execution';
import { computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount } from './computations/finalization';
import { computeBestVariantElo, computeAvgVariantElo,
  computeInvocationVariantCount } from './computations/finalizationInvocation';
import { aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount,
  aggregateBootstrapMean } from './computations/propagation';

export const METRIC_REGISTRY: Record<EntityType, EntityMetricRegistry> = {
  run: {
    duringExecution: [
      { name: 'cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: computeRunCost },
      // Dynamic agentCost:* metrics handled separately (not in static registry)
    ],
    atFinalization: [
      { name: 'winner_elo', label: 'Winner Elo', category: 'rating', formatter: 'elo',
        compute: computeWinnerElo },
      { name: 'median_elo', label: 'Median Elo', category: 'rating', formatter: 'elo',
        compute: computeMedianElo },
      { name: 'p90_elo', label: 'P90 Elo', category: 'rating', formatter: 'elo',
        compute: computeP90Elo },
      { name: 'max_elo', label: 'Max Elo', category: 'rating', formatter: 'elo',
        listView: true, compute: computeMaxElo },
      { name: 'total_matches', label: 'Total Matches', category: 'match', formatter: 'integer',
        compute: computeTotalMatches },
      { name: 'decisive_rate', label: 'Decisive Rate', category: 'match', formatter: 'percent',
        listView: true, compute: computeDecisiveRate },
      { name: 'variant_count', label: 'Variants', category: 'count', formatter: 'integer',
        listView: true, compute: computeVariantCount },
    ],
    atPropagation: [],
  },
  invocation: {
    duringExecution: [],
    atFinalization: [
      { name: 'best_variant_elo', label: 'Best Variant Elo', category: 'rating', formatter: 'elo',
        description: 'Highest elo among variants produced by this invocation',
        compute: (ctx) => computeBestVariantElo(ctx, ctx.currentInvocationId) },
      { name: 'avg_variant_elo', label: 'Avg Variant Elo', category: 'rating', formatter: 'elo',
        description: 'Average elo of variants produced by this invocation',
        compute: (ctx) => computeAvgVariantElo(ctx, ctx.currentInvocationId) },
      { name: 'variant_count', label: 'Variants Produced', category: 'count', formatter: 'integer',
        description: 'Number of variants created by this invocation',
        compute: (ctx) => computeInvocationVariantCount(ctx, ctx.currentInvocationId) },
    ],
    atPropagation: [],
  },
  variant: {
    duringExecution: [],
    atFinalization: [
      { name: 'cost', label: 'Generation Cost', category: 'cost', formatter: 'costDetailed',
        description: 'Cost to generate this variant (from native cost_usd column)',
        compute: (ctx) => ctx.currentVariantCost ?? null },
    ],
    atPropagation: [],
  },
  strategy: {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [
      // Count
      { name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer', listView: true,
        sourceMetric: 'cost', sourceEntity: 'run', aggregate: aggregateCount, aggregationMethod: 'count' },
      // Cost
      { name: 'total_cost', label: 'Total Cost', category: 'cost', formatter: 'cost', listView: true,
        sourceMetric: 'cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
      { name: 'avg_cost_per_run', label: 'Avg Cost/Run', category: 'cost', formatter: 'cost',
        sourceMetric: 'cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // Rating — from run.winner_elo
      { name: 'avg_final_elo', label: 'Avg Winner Elo', category: 'rating', formatter: 'elo', listView: true,
        sourceMetric: 'winner_elo', sourceEntity: 'run', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { name: 'best_final_elo', label: 'Best Winner Elo', category: 'rating', formatter: 'elo', listView: true,
        sourceMetric: 'winner_elo', sourceEntity: 'run', aggregate: aggregateMax, aggregationMethod: 'max' },
      { name: 'worst_final_elo', label: 'Worst Winner Elo', category: 'rating', formatter: 'elo',
        sourceMetric: 'winner_elo', sourceEntity: 'run', aggregate: aggregateMin, aggregationMethod: 'min' },
      // Rating — from run.median_elo, run.p90_elo, run.max_elo
      { name: 'avg_median_elo', label: 'Avg Median Elo', category: 'rating', formatter: 'elo',
        sourceMetric: 'median_elo', sourceEntity: 'run', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { name: 'avg_p90_elo', label: 'Avg P90 Elo', category: 'rating', formatter: 'elo',
        sourceMetric: 'p90_elo', sourceEntity: 'run', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { name: 'best_max_elo', label: 'Best Max Elo', category: 'rating', formatter: 'elo',
        sourceMetric: 'max_elo', sourceEntity: 'run', aggregate: aggregateMax, aggregationMethod: 'max' },
      // Match
      { name: 'total_matches', label: 'Total Matches', category: 'match', formatter: 'integer',
        sourceMetric: 'total_matches', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
      { name: 'avg_matches_per_run', label: 'Avg Matches/Run', category: 'match', formatter: 'integer',
        sourceMetric: 'total_matches', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { name: 'avg_decisive_rate', label: 'Avg Decisive Rate', category: 'match', formatter: 'percent',
        sourceMetric: 'decisive_rate', sourceEntity: 'run', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      // Count
      { name: 'total_variant_count', label: 'Total Variants', category: 'count', formatter: 'integer',
        sourceMetric: 'variant_count', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
      { name: 'avg_variant_count', label: 'Avg Variants/Run', category: 'count', formatter: 'integer',
        sourceMetric: 'variant_count', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
    ],
  },
  experiment: {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [
      // Identical to strategy — both aggregate from child run metrics
      // (same entries as strategy.atPropagation above)
      // In implementation: extract shared defs into a const and spread into both
    ],
  },
  prompt: { duringExecution: [], atFinalization: [], atPropagation: [] },
  arena_topic: { duringExecution: [], atFinalization: [], atPropagation: [] },
};

// ─── Build-time validation ──────────────────────────────────────
// Runs at module load — fails fast if a metric name appears in two phases

function validateRegistry() {
  for (const [entityType, registry] of Object.entries(METRIC_REGISTRY)) {
    // 1. No duplicate metric names within an entity's phases
    const allNames = [
      ...registry.duringExecution,
      ...registry.atFinalization,
      ...registry.atPropagation,
    ].map(d => d.name);
    const dupes = allNames.filter((n, i) => allNames.indexOf(n) !== i);
    if (dupes.length > 0) {
      throw new Error(`Duplicate metrics in ${entityType}: ${dupes.join(', ')}`);
    }

    // 2. Every propagation def's sourceMetric must exist in the source entity's registry
    for (const def of registry.atPropagation) {
      const sourceRegistry = METRIC_REGISTRY[def.sourceEntity];
      const sourceNames = [
        ...sourceRegistry.duringExecution,
        ...sourceRegistry.atFinalization,
        ...sourceRegistry.atPropagation,
      ].map(d => d.name);
      const isDynamic = DYNAMIC_METRIC_PREFIXES.some(p => def.sourceMetric.startsWith(p));
      if (!isDynamic && !sourceNames.includes(def.sourceMetric)) {
        throw new Error(
          `${entityType}.${def.name}: sourceMetric '${def.sourceMetric}' not found in ${def.sourceEntity} registry`
        );
      }
    }
  }
}
validateRegistry();

// ─── Registry Helpers ───────────────────────────────────────────

// Get all metric defs for an entity (flat, for display/query)
export function getAllMetricDefs(entityType: EntityType): MetricDefBase[] {
  const r = METRIC_REGISTRY[entityType];
  return [...r.duringExecution, ...r.atFinalization, ...r.atPropagation];
}

export function getListViewMetrics(entityType: EntityType): MetricDefBase[] {
  return getAllMetricDefs(entityType).filter(d => d.listView);
}

export function getMetricDef(entityType: EntityType, metricName: string): MetricDefBase | undefined {
  return getAllMetricDefs(entityType).find(d => d.name === metricName);
}

export function isValidMetricName(entityType: EntityType, metricName: string): boolean {
  if (getAllMetricDefs(entityType).some(d => d.name === metricName)) return true;
  return DYNAMIC_METRIC_PREFIXES.some(prefix => metricName.startsWith(prefix));
}

// Formatter lookup
export const FORMATTERS: Record<MetricDefBase['formatter'], (v: number) => string> = {
  cost: formatCost,
  costDetailed: formatCostDetailed,
  elo: formatElo,
  score: formatScore,
  percent: formatPercent,
  integer: (v) => String(Math.round(v)),
};

// Zod schema for DB row — source of truth
export const MetricRowSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
  metric_name: z.string().min(1).max(200),
  value: z.number(),
  sigma: z.number().nullable(),
  ci_lower: z.number().nullable(),
  ci_upper: z.number().nullable(),
  n: z.number().int().min(0),
  origin_entity_type: z.string().nullable(),
  origin_entity_id: z.string().uuid().nullable(),
  aggregation_method: z.enum(AGGREGATION_METHODS).nullable(),
  source: z.string().nullable(),
  stale: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type MetricRow = z.infer<typeof MetricRowSchema>;

// Reuse existing MetricValue from experimentMetrics.ts for UI compatibility
// Re-export from here so consumers have a single import path
export { type MetricValue } from '@evolution/experiments/evolution/experimentMetrics';

// Conversion: MetricRow → MetricValue (for MetricGrid)
export function toMetricValue(row: MetricRow): MetricValue {
  return {
    value: row.value,
    sigma: row.sigma,
    ci: row.ci_lower != null && row.ci_upper != null ? [row.ci_lower, row.ci_upper] : null,
    n: row.n,
  };
}

// Conversion: MetricRow → MetricItem (for MetricGrid rendering)
// Requires a formatter to convert numeric value to display ReactNode
export function toMetricItem(row: MetricRow, formatter: (v: number) => string, label?: string): MetricItem {
  return {
    label: label ?? row.metric_name,
    value: formatter(row.value),
    ci: row.ci_lower != null && row.ci_upper != null ? [row.ci_lower, row.ci_upper] : undefined,
    n: row.n,
  };
}
```

**File:** `evolution/src/lib/metrics/writeMetrics.ts`
```typescript
import { METRIC_REGISTRY, getAllMetricDefs } from './registry';
import type { MetricName, MetricTiming, EntityType, MetricRow } from './types';

// Write one or more metrics for an entity (UPSERT with last-write-wins)
// ON CONFLICT (entity_type, entity_id, metric_name) DO UPDATE SET value = EXCLUDED.value, ...
// THROWS on failure — metrics are critical, unlike trackInvocations which swallows errors.
// timing parameter is REQUIRED — validates each metric belongs to the declared phase.
export async function writeMetrics(
  db: SupabaseClient,
  rows: Partial<MetricRow>[],
  timing: MetricTiming,
): Promise<void>;

// Write a single metric (convenience wrapper) — metricName is typed as MetricName
export async function writeMetric(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  metricName: MetricName,          // typed — catches typos at compile time
  value: number,
  timing: MetricTiming,            // required — which phase is writing
  opts?: { sigma?: number; ci_lower?: number; ci_upper?: number; n?: number;
           origin_entity_type?: string; origin_entity_id?: string;
           aggregation_method?: AggregationMethod }
): Promise<void>;
```

**Timing validation in writeMetrics:**
```typescript
// Runtime check: metric must belong to the declared timing phase
for (const row of rows) {
  const entityType = row.entity_type as EntityType;
  const registry = METRIC_REGISTRY[entityType];
  const phase = { during_execution: 'duringExecution', at_finalization: 'atFinalization',
    at_propagation: 'atPropagation' }[timing] as keyof EntityMetricRegistry;
  const allowedDefs = registry[phase];
  const isDynamic = DYNAMIC_METRIC_PREFIXES.some(p => row.metric_name!.startsWith(p));

  if (!isDynamic && !allowedDefs.some(d => d.name === row.metric_name)) {
    // Check if it exists in a different phase — give a clear error
    const allDefs = getAllMetricDefs(entityType);
    const found = allDefs.find(d => d.name === row.metric_name);
    if (found) {
      throw new Error(`Metric '${row.metric_name}' belongs to a different phase but writeMetrics was called with '${timing}'`);
    }
    throw new Error(`Unknown metric '${row.metric_name}' for entity '${entityType}'`);
  }
}
```

**UPSERT semantics:** `ON CONFLICT DO UPDATE SET value = EXCLUDED.value, sigma = EXCLUDED.sigma, ...` (last-write-wins). This is correct for incremental cost writes (absolute value, not additive) and finalization writes (single writer per run). Concurrent writes to the same metric row are safe — both write the same final value since the pipeline is single-threaded per run.

**Error handling philosophy:** Unlike `trackInvocations.ts` which swallows DB errors (observability can't crash the pipeline), metrics writes **throw on failure**. Metrics are a core data path, not optional instrumentation. If a metric write fails, the pipeline should fail — a run with missing metrics is worse than a failed run that can be retried.

**File:** `evolution/src/lib/metrics/readMetrics.ts`
```typescript
// Read all metrics for an entity, recomputing stale ones first
export async function getEntityMetrics(db: SupabaseClient, entityType: EntityType, entityId: string): Promise<MetricRow[]>;

// Read a specific metric for an entity
export async function getMetric(db: SupabaseClient, entityType: EntityType, entityId: string, metricName: string): Promise<MetricRow | null>;

// Read specific metrics across many entities (for list views)
// Uses .in() with chunking for large ID lists (max 100 per query to avoid Supabase limits)
export async function getMetricsForEntities(
  db: SupabaseClient, entityType: EntityType, entityIds: string[], metricNames: string[]
): Promise<Map<string, MetricRow[]>>;
```

**File:** `evolution/src/lib/metrics/recomputeMetrics.ts`
```typescript
// Recompute stale metrics for an entity
// Uses SELECT ... FOR UPDATE on stale rows to prevent thundering herd:
// if two concurrent readers find stale=true, only one acquires the lock and recomputes;
// the other waits briefly then reads the fresh values.
export async function recomputeStaleMetrics(db: SupabaseClient, entityType: EntityType, entityId: string, staleRows: MetricRow[]): Promise<void>;

// Entity-specific recomputation logic
async function recomputeRunEloMetrics(db: SupabaseClient, runId: string): Promise<void>;
async function recomputeStrategyEloMetrics(db: SupabaseClient, strategyId: string): Promise<void>;
async function recomputeExperimentEloMetrics(db: SupabaseClient, experimentId: string): Promise<void>;
```

**Thundering herd protection:** `recomputeStaleMetrics` acquires a row-level lock via:
```sql
SELECT id FROM evolution_metrics
WHERE entity_type = $1 AND entity_id = $2 AND stale = true
FOR UPDATE SKIP LOCKED;
```
If another request already holds the lock (is recomputing), SKIP LOCKED returns no rows, and the reader falls through to read current (possibly still stale) values. The next request will see fresh data. This is safe because recomputation is idempotent.

### Phase 2: Write Metrics During Execution & Finalization
**Goal:** Write cost metrics incrementally during pipeline execution; write elo/match metrics at finalization.

#### 2.1 Incremental Cost Metrics (During Execution)
Modify `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — after each phase's `updateInvocation()` call, loop over the registry:

```typescript
import { METRIC_REGISTRY } from '@evolution/lib/metrics/registry';

// In executePhase(), after updateInvocation():
const ctx: ExecutionContext = { costTracker, phaseName };
for (const def of METRIC_REGISTRY.run.duringExecution) {
  const value = def.compute(ctx);
  await writeMetric(db, 'run', runId, def.name, value, 'during_execution');
}
// Dynamic agentCost:* (not in static registry):
await writeMetric(db, 'run', runId, `agentCost:${phaseName}`,
  costTracker.getPhaseCosts()[phaseName] ?? 0, 'during_execution');
```

Pipeline code is a generic loop — adding a new execution metric means adding one entry to the registry with its compute function. Zero pipeline changes needed.

#### 2.2 Run Finalization Metrics (Elo, Match Stats, Invocation, Variant)
Modify `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — registry-driven loop:

```typescript
import { METRIC_REGISTRY } from '@evolution/lib/metrics/registry';

// After buildRunSummary() and persisting run_summary JSONB:
const finCtx: FinalizationContext = { result, ratings, pool, matchHistory, invocations };

// Run-level finalization metrics
for (const def of METRIC_REGISTRY.run.atFinalization) {
  const value = def.compute(finCtx);
  if (value != null) {
    await writeMetric(db, 'run', runId, def.name, value, 'at_finalization');
  }
}

// Invocation-level finalization metrics (generation invocations only)
for (const inv of genInvocations) {
  const invCtx = { ...finCtx, currentInvocationId: inv.id };
  for (const def of METRIC_REGISTRY.invocation.atFinalization) {
    const value = def.compute(invCtx);
    if (value != null) {
      await writeMetric(db, 'invocation', inv.id, def.name, value, 'at_finalization');
    }
  }
}

// Variant-level finalization metrics
for (const v of pool) {
  const varCtx = { ...finCtx, currentVariantCost: v.costUsd };
  for (const def of METRIC_REGISTRY.variant.atFinalization) {
    const value = def.compute(varCtx);
    if (value != null) {
      await writeMetric(db, 'variant', v.id, def.name, value, 'at_finalization');
    }
  }
}
```

Same pattern everywhere — the pipeline iterates the registry and calls `def.compute(ctx)`. Compute logic lives in `computations/*.ts`, not in the pipeline code.

#### 2.3 Propagation (Strategy & Experiment)
Replace `update_strategy_aggregates` RPC and `computeExperimentMetrics()` with a single generic function driven by the registry:

```typescript
import { METRIC_REGISTRY } from '@evolution/lib/metrics/registry';

// Generic propagation — works for any entity with atPropagation defs
async function propagateMetrics(
  db: SupabaseClient,
  entityType: EntityType,   // 'strategy' or 'experiment'
  entityId: string,
  childRunIds: string[],
) {
  if (childRunIds.length === 0) return;

  const propDefs = METRIC_REGISTRY[entityType].atPropagation;
  if (propDefs.length === 0) return;

  // Collect all unique source metrics needed
  const sourceMetricNames = [...new Set(propDefs.map(d => d.sourceMetric))];

  // Batch-fetch child run metrics
  const runMetrics = await getMetricsForEntities(db, 'run', childRunIds, sourceMetricNames);
  const collect = (name: MetricName) =>
    [...runMetrics.values()].flatMap(ms => ms.filter(m => m.metric_name === name));

  // Loop over registry — each def has its own aggregate function
  for (const def of propDefs) {
    const sourceRows = collect(def.sourceMetric);
    if (sourceRows.length === 0) continue;
    const aggregated = def.aggregate(sourceRows);
    await writeMetric(db, entityType, entityId, def.name, aggregated.value, 'at_propagation', {
      ci_lower: aggregated.ci?.[0], ci_upper: aggregated.ci?.[1],
      n: aggregated.n, aggregation_method: def.aggregationMethod,
    });
  }
}

// Called from persistRunResults.ts after run finalization:
await propagateMetrics(db, 'strategy', run.strategy_id, runIdsForStrategy);
await propagateMetrics(db, 'experiment', run.experiment_id, runIdsForExperiment);
```

**Key insight:** No hardcoded metric names in the propagation code. Each `PropagationMetricDef` carries its `sourceMetric`, `sourceEntity`, and `aggregate` function. Adding a new aggregate metric = one registry entry + one aggregation function (or reuse `aggregateSum`/`aggregateMax`/etc.).

### Phase 3: Lazy Recompute Infrastructure
**Goal:** Implement stale detection and on-read recomputation.

#### 3.1 Server Action: getEntityMetricsAction

Follows the project's `withLogging` + `serverReadRequestId` wrapping pattern:

```typescript
import { withLogging, serverReadRequestId } from '@/lib/utils/logging';

const _getEntityMetrics = withLogging(async function getEntityMetrics(
  entityType: EntityType,
  entityId: string,
) {
  // Validate input with Zod
  const parsed = z.object({
    entityType: z.enum(ENTITY_TYPES),
    entityId: z.string().uuid(),
  }).parse({ entityType, entityId });

  const metrics = await db.from('evolution_metrics')
    .select('*')
    .eq('entity_type', parsed.entityType)
    .eq('entity_id', parsed.entityId);

  const staleMetrics = (metrics.data ?? []).filter(m => m.stale);
  if (staleMetrics.length > 0) {
    await recomputeStaleMetrics(db, parsed.entityType, parsed.entityId, staleMetrics);
    // Re-read fresh values
    const fresh = await db.from('evolution_metrics')
      .select('*')
      .eq('entity_type', parsed.entityType)
      .eq('entity_id', parsed.entityId);
    return { success: true, data: fresh.data };
  }

  return { success: true, data: metrics.data };
});

export const getEntityMetricsAction = serverReadRequestId(_getEntityMetrics);
```

#### 3.2 Recomputation Functions
Each entity type has a recompute function that re-derives metrics from source data:

- `recomputeRunEloMetrics(runId)` — reads variant mu/sigma, recomputes elo percentiles
- `recomputeStrategyEloMetrics(strategyId)` — reads run winner_elo metrics, recomputes with bootstrap CIs
- `recomputeExperimentEloMetrics(experimentId)` — reads run winner_elo metrics, recomputes max/total

After recomputation, clear the stale flag:
```typescript
await db.from('evolution_metrics')
  .update({ stale: false, updated_at: new Date().toISOString() })
  .eq('entity_type', entityType)
  .eq('entity_id', entityId)
  .in('metric_name', recomputedNames);
```

### Phase 4: Generic EntityMetricsTab Component
**Goal:** Every entity detail page gets a standardized "Metrics" tab.

#### 4.1 EntityMetricsTab Component
**File:** `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`

```typescript
interface EntityMetricsTabProps {
  entityType: EntityType;
  entityId: string;
}

export function EntityMetricsTab({ entityType, entityId }: EntityMetricsTabProps) {
  // 1. Fetch metrics via getEntityMetricsAction
  // 2. Look up each metric's MetricDef from METRIC_REGISTRY (fall back to defaults for dynamic metrics)
  // 3. Group by def.category (cost, rating, match, count, efficiency)
  // 4. Convert each MetricRow to MetricItem using toMetricItem(row, FORMATTERS[def.formatter], def.label)
  // 5. Render each category group as a labeled MetricGrid section with CI data populated
  // 6. Show aggregation_method badge for inherited metrics (where aggregation_method != null)
}
```

**Replaces existing MetricsTab.tsx:** The current `evolution/src/components/evolution/tabs/MetricsTab.tsx` is run-specific (hardcoded to fetch run summary + cost breakdown). The new `EntityMetricsTab` is generic and replaces it. Remove the old `MetricsTab.tsx` in Phase 4 and update the barrel export in `index.ts`.

#### 4.2 Metric Categorization
Categorization, labels, and formatters are all driven by `METRIC_REGISTRY` — no prefix conventions needed. For dynamic metrics (e.g., `agentCost:generation`), fall back to category `'cost'` and formatter `'cost'` based on the `DYNAMIC_METRIC_PREFIXES` pattern.

#### 4.3 Detail Page Integration
Add "Metrics" tab to each entity detail page:

| Entity | Current Tabs | New Tabs |
|---|---|---|
| Run | Overview, Elo, Lineage, Variants, Logs | **Metrics**, Elo, Lineage, Variants, Logs |
| Variant | (none) | **Metrics**, Content, Lineage |
| Invocation | (none) | **Metrics**, Execution Detail |
| Strategy | (none) | **Metrics**, Configuration, Runs |
| Experiment | Overview, Analysis, Runs | **Metrics**, Analysis, Runs |
| Prompt | (none) | **Metrics**, Prompt Text |
| Arena Topic | (none) | **Metrics**, Leaderboard |

For entities without tabs, add `EntityDetailTabs` with "Metrics" as the default tab.

**Existing MetricGrid usage to migrate** (move from header/inline into Metrics tab):
- `VariantDetailContent.tsx` — MetricGrid in header (Agent, Generation, Rating, Matches)
- `invocations/[invocationId]/page.tsx` — MetricGrid in header (Agent, Iteration, Cost, Duration)
- `strategies/[strategyId]/page.tsx` — MetricGrid inline (Run Count, Total Cost, Avg/Best/Worst Elo)
- `prompts/[promptId]/page.tsx` — MetricGrid inline (Status, Created)
- `arena/[topicId]/page.tsx` — MetricGrid in "Topic Details" section
- `ExperimentDetailContent.tsx` — MetricGrid in Overview tab
- `ExperimentAnalysisCard.tsx` — MetricGrid in Analysis tab (keep as-is, not a Metrics tab)

### Phase 5: List View Metric Columns
**Goal:** Standard way to surface key metrics in entity list views.

#### 5.1 Batch Metric Fetching for Lists
Server actions for list pages use the registry to determine which metrics to fetch:

```typescript
// In getEvolutionRunsAction or similar
const runs = await db.from('evolution_runs').select('*');
const runIds = runs.map(r => r.id);

// Registry-driven: fetch only metrics marked listView: true
const listMetrics = getListViewMetrics('run').map(d => d.name);
const metrics = await getMetricsForEntities(db, 'run', runIds, listMetrics);

// Attach metrics map to each run
return runs.map(r => ({ ...r, metrics: metrics.get(r.id) ?? [] }));
```

#### 5.2 Metric Column Helper
```typescript
import type { ColumnDef } from '@evolution/components/evolution';
import { getListViewMetrics, FORMATTERS, type MetricDef } from '@evolution/lib/metrics';

// Generate all list-view columns for an entity type from the registry
export function createMetricColumns<T extends { metrics?: MetricRow[] }>(
  entityType: EntityType,
): ColumnDef<T>[] {
  return getListViewMetrics(entityType).map(def => ({
    key: `metric_${def.name}`,
    header: def.label,
    align: 'right' as const,
    sortable: false,
    render: (item: T) => {
      const m = item.metrics?.find(m => m.metric_name === def.name);
      return m != null ? FORMATTERS[def.formatter](m.value) : '—';
    },
  }));
}

// Single column from a MetricDef (for custom ordering or overrides)
export function createMetricColumn<T extends { metrics?: MetricRow[] }>(
  def: MetricDef,
): ColumnDef<T> { ... }
```

**Note:** Uses the actual `ColumnDef<T>` type from `EntityTable.tsx` (which includes `key`, `header`, `align`, `sortable`, `render`), not a parallel definition. All labels, formatters, and which metrics appear in list views are driven by `METRIC_REGISTRY`.

#### 5.3 Key Metrics Per List View (from METRIC_REGISTRY `listView: true`)

| Entity List | Metric Columns (auto-generated from registry) |
|---|---|
| Runs | cost, max_elo, decisive_rate, variant_count |
| Strategies | run_count, total_cost, avg_final_elo, best_final_elo |
| Experiments | run_count, total_cost, max_elo |
| Variants | (keep native columns — mu/sigma are live state) |
| Invocations | (keep native cost_usd — source data) |

### Phase 6: Legacy Cleanup & Renames
**Goal:** Remove replaced infrastructure and clean up V2 naming. Deployed as a **separate migration** from Phase 1 after validating new code path.

#### 6.1 Rename V2 Action Files
Drop the `V2` suffix — V1 versions no longer exist, the suffix just creates confusion.

| Old Name | New Name | Importers (18 non-doc files) |
|---|---|---|
| `evolution/src/services/experimentActionsV2.ts` | `evolution/src/services/experimentActions.ts` | 14 files |
| `evolution/src/services/experimentActionsV2.test.ts` | `evolution/src/services/experimentActions.test.ts` | — |
| `evolution/src/services/strategyRegistryActionsV2.ts` | `evolution/src/services/strategyRegistryActions.ts` | 4 files |
| `evolution/src/services/strategyRegistryActionsV2.test.ts` | `evolution/src/services/strategyRegistryActions.test.ts` | — |

**Important:** Do the rename FIRST in Phase 6 before other modifications. Run `tsc` after rename to verify all imports resolved. All code modifications in Phases 2-5 use the V2 filenames (since Phase 6 runs last).

Files needing import path updates for experimentActions:
- `src/app/admin/evolution/_components/ExperimentForm.tsx`
- `src/app/admin/evolution/_components/ExperimentStatusCard.tsx`
- `src/app/admin/evolution/_components/ExperimentHistory.tsx`
- `src/app/admin/evolution/_components/ExperimentHistory.test.tsx`
- `src/app/admin/evolution/experiments/[experimentId]/page.tsx`
- `src/app/admin/evolution/experiments/[experimentId]/page.test.tsx`
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx`
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.tsx`
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.test.tsx`
- `src/app/admin/evolution/experiments/[experimentId]/RunsTab.tsx`
- `evolution/src/components/evolution/tabs/RelatedRunsTab.tsx`
- `evolution/src/components/evolution/tabs/RelatedRunsTab.test.tsx`
- `src/__tests__/integration/evolution-budget-constraint.integration.test.ts`

Files needing import path updates for strategyRegistryActions:
- `src/app/admin/evolution/strategies/page.tsx`
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx`

Note: Planning docs in `docs/planning/` reference V2 names but don't need import updates (historical).

#### 6.2 Remove Legacy Infrastructure (Separate Migration)
| Legacy | Replacement | Action |
|---|---|---|
| `evolution_strategies` aggregate columns (avg_final_elo, total_cost_usd, best/worst_final_elo, run_count) | Metrics table rows | Drop columns |
| `update_strategy_aggregates` RPC | `propagateToStrategy()` in TypeScript | Drop RPC |
| `evolution_run_costs` VIEW | Metrics row `(run, cost)` | Drop VIEW |
| `get_run_total_cost()` RPC | Read from metrics table | Drop RPC |
| `computeExperimentMetrics()` on-demand | Persisted experiment metrics rows | Remove function |
| `computeRunMetrics()` in experimentMetrics.ts | Metrics rows written at finalization | Remove function |
| `run_summary` scalar metrics (matchStats fields) | Metrics table rows | Remove from JSONB, keep muHistory/topVariants/metaFeedback |
| `MetricsTab.tsx` (run-specific) | `EntityMetricsTab.tsx` (generic) | Remove old component |
| `MetricsTab.test.tsx` | `EntityMetricsTab.test.tsx` | Remove old test |
| `RunMetricsTab.tsx` (`src/app/admin/evolution/runs/[runId]/RunMetricsTab.tsx`) | Direct use of `EntityMetricsTab` in run detail page | Remove wrapper |

#### 6.3 What Stays
| Component | Reason |
|---|---|
| `evolution_variants.mu/sigma/elo_score` | Live mutable state during ranking |
| `evolution_agent_invocations.cost_usd` | Source data for budget enforcement |
| `llmCallTracking` | Platform-wide, separate concern |
| `run_summary` JSONB (muHistory, topVariants, metaFeedback, strategyEffectiveness) | Non-scalar structured data |
| Bootstrap CI functions (`bootstrapMeanCI`, `bootstrapPercentileCI`) | Still used for strategy/experiment aggregation |
| `MetricGrid` component | Foundation for EntityMetricsTab display |
| `MetricValue` type (in experimentMetrics.ts) | Re-exported from metrics/types.ts for backwards compat |

#### 6.4 Migration Strategy
- **Forward-only, no backfill**: New runs write to metrics table during execution (cost) and at finalization (elo/match). Historical runs without metrics rows simply show no metrics — acceptable since legacy data in strategy columns and run_summary JSONB is being dropped anyway.
- **Two-phase deployment**: Phase 1 migration adds new table + trigger. Phase 6 migration (deployed after validation) drops legacy VIEWs/RPCs/columns. This provides a rollback window.

## Testing

### Unit Tests

**`evolution/src/lib/metrics/computations/execution.test.ts`:**
- `computeRunCost` returns costTracker.getTotalSpent()
- `computeAgentCost` returns phase cost for named phase, 0 for unknown phase

**`evolution/src/lib/metrics/computations/finalization.test.ts`:**
- `computeWinnerElo` returns toEloScale of highest-mu variant, null for empty pool
- `computeMedianElo` correct for odd/even pool sizes, null for empty
- `computeP90Elo` correct percentile calculation
- `computeMaxElo` returns highest elo, null for empty pool
- `computeTotalMatches` returns matchHistory.length
- `computeDecisiveRate` correct ratio, null for zero matches
- `computeVariantCount` returns pool.length

**`evolution/src/lib/metrics/computations/finalizationInvocation.test.ts`:**
- `computeBestVariantElo` extracts variant IDs from execution_detail, looks up elos
- `computeAvgVariantElo` correct average, null for invocation with no successful variants
- `computeInvocationVariantCount` counts successful variants only

**`evolution/src/lib/metrics/computations/propagation.test.ts`:**
- `aggregateSum` correct for multiple rows, returns 0 for empty
- `aggregateAvg` correct, returns 0 for empty (no division-by-zero)
- `aggregateMax` correct, returns -Infinity for empty (caller guards with length check)
- `aggregateMin` correct, returns Infinity for empty
- `aggregateCount` returns row count
- `aggregateBootstrapMean` returns MetricValue with CI bounds for 2+ values, null CI for 1 value

**`evolution/src/lib/metrics/registry.test.ts`:**
- `validateRegistry` passes for the current registry (import-time validation)
- `validateRegistry` throws when a duplicate metric name is introduced across phases
- `validateRegistry` throws when sourceMetric references a non-existent metric
- `getAllMetricDefs` returns flat array from all phases
- `getListViewMetrics` returns only defs with listView=true
- `getMetricDef` finds by name, returns undefined for unknown
- `isValidMetricName` returns true for static names, true for dynamic prefixed names, false for unknown

**`evolution/src/lib/metrics/writeMetrics.test.ts`:**
- UPSERT inserts new row, updates existing row (last-write-wins)
- Batch write with multiple rows
- Throws on DB error (not swallowed)
- Validates entity_type against enum
- Handles null sigma/ci fields correctly
- **Timing validation:** rejects metric written with wrong timing (e.g., 'winner_elo' with 'during_execution')
- **Timing validation:** accepts metric written with correct timing
- **Timing validation:** accepts dynamic agentCost:* in during_execution

**`evolution/src/lib/metrics/readMetrics.test.ts`:**
- Read all metrics for entity returns complete set
- Read single metric returns correct row or null
- Batch read for list views (getMetricsForEntities) returns grouped map
- Batch read chunks large ID lists (>100 IDs)
- Returns empty array/map for entity with no metrics

**`evolution/src/lib/metrics/recomputeMetrics.test.ts`:**
- Detects stale rows and triggers recomputation
- `recomputeRunEloMetrics`: reads variant mu/sigma, computes correct percentiles
- `recomputeStrategyEloMetrics`: reads run winner_elos, computes bootstrap CIs
- `recomputeExperimentEloMetrics`: computes max_elo across runs
- Clears stale flag after successful recompute
- Thundering herd: concurrent calls with SKIP LOCKED — only one recomputes
- Division-by-zero guard for avg_cost_per_run with zero run count
- Empty variant/run arrays handled gracefully (no metrics written, no errors)

**`evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` (update existing):**
- After executePhase(), verifies writeMetric called with run cost
- After executePhase(), verifies writeMetric called with per-agent cost
- Cost metric value matches costTracker.getTotalSpent()

**`evolution/src/components/evolution/tabs/EntityMetricsTab.test.tsx`:**
- Renders MetricGrid with metrics grouped by category
- Shows CI ranges when ci_lower/ci_upper present
- Shows loading state while fetching
- Shows empty state for entity with no metrics
- Displays aggregation_method badge for inherited metrics
- Formats cost metrics with formatCost, elo with formatElo

### Integration Tests

**`src/__tests__/integration/evolution-metrics-table.integration.test.ts`:**
- Full write/read cycle: write metrics, read back, verify values
- UPSERT overwrites existing metric correctly
- Batch read returns correct grouping
- Propagation: write run metrics → propagate to strategy → verify strategy metrics with CIs

**`src/__tests__/integration/evolution-metrics-staleness.integration.test.ts`:**
- Trigger fires on variant mu UPDATE for completed run
- Trigger does NOT fire for non-completed run (status='running')
- Trigger does NOT fire if only non-mu columns change
- Trigger fires when sigma changes (without mu change)
- Stale flag cascades: variant change → run stale → strategy stale → experiment stale
- Lazy recompute: read stale metric → recompute fires → fresh values returned
- Concurrent recompute: two simultaneous reads → only one recomputes (SKIP LOCKED)

### Existing Tests to Update
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — Add assertions for elo/match metrics writes
- `evolution/src/services/experimentActionsV2.test.ts` — Update to read from metrics table instead of on-demand computation
- `evolution/src/experiments/evolution/experimentMetrics.test.ts` — Keep bootstrap tests, remove computeRunMetrics tests (replaced by direct writes)

### E2E Impact
- Admin evolution detail pages will have restructured tabs — existing E2E specs touching run/strategy/experiment detail pages need tab selector updates
- Runs list page gains new metric columns — E2E assertions on column count/content may need updates
- Run Playwright E2E specs against new tab structure before merging

### Manual Verification
- Run a pipeline end-to-end → verify metrics rows created during execution (cost) and at finalization (elo)
- View run detail page → verify Metrics tab shows all metrics with correct formatting
- View strategy detail page → verify CI ranges display on elo metrics
- Simulate variant mu change on completed run → verify stale flag → verify lazy recompute on page load
- View runs list page → verify metric columns populated from metrics table

## Documentation Updates
- `docs/feature_deep_dives/evolution_metrics.md` — Primary doc for the new system (created during /initialize)
- `evolution/docs/evolution/experimental_framework.md` — Update metrics computation section, reference new table
- `evolution/docs/evolution/strategy_experiments.md` — Update strategy aggregates section, remove RPC docs
- `evolution/docs/evolution/visualization.md` — Update UI component references
- `evolution/docs/evolution/data_model.md` — Add evolution_metrics table documentation

## Key Files Modified

### New Files
- `evolution/src/lib/metrics/types.ts` — MetricDef types, MetricName, MetricRow, context types
- `evolution/src/lib/metrics/registry.ts` — METRIC_REGISTRY (declarative, references compute fns)
- `evolution/src/lib/metrics/computations/execution.ts` — computeRunCost, computeAgentCost
- `evolution/src/lib/metrics/computations/finalization.ts` — computeWinnerElo, computeMedianElo, etc.
- `evolution/src/lib/metrics/computations/finalizationInvocation.ts` — computeBestVariantElo, etc.
- `evolution/src/lib/metrics/computations/propagation.ts` — aggregateSum, aggregateMax, aggregateBootstrapMean, etc.
- `evolution/src/lib/metrics/writeMetrics.ts` — UPSERT with timing validation
- `evolution/src/lib/metrics/readMetrics.ts` — Read + lazy recompute
- `evolution/src/lib/metrics/recomputeMetrics.ts` — Stale recomputation
- `evolution/src/lib/metrics/index.ts` — Barrel exports
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx`
- `evolution/src/services/metricsActions.ts`
- `supabase/migrations/XXXXXXXX_evolution_metrics_table.sql`
- `supabase/migrations/YYYYYYYY_drop_legacy_metrics.sql` (Phase 6, separate)

### Modified Files
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Add incremental cost metric writes after each phase
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Add elo/match metrics writes, call propagateToStrategy/Experiment
- `evolution/src/services/evolutionActions.ts` — Use metrics table for cost/elo data
- `evolution/src/services/experimentActionsV2.ts` — Use persisted metrics instead of on-demand computation (renamed in Phase 6)
- `evolution/src/services/strategyRegistryActionsV2.ts` — Use metrics table for strategy aggregates (renamed in Phase 6)
- `evolution/src/components/evolution/index.ts` — Export EntityMetricsTab, remove MetricsTab export
- `src/app/admin/evolution/runs/[runId]/page.tsx` — Replace Overview with Metrics tab
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` — Add tabs with Metrics
- `src/app/admin/evolution/invocations/[invocationId]/page.tsx` — Add tabs with Metrics
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — Add tabs with Metrics
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx` — Rename Overview to Metrics
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — Add tabs with Metrics
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — Add tabs with Metrics
- `src/app/admin/evolution/runs/page.tsx` — Add metric columns
- `src/app/admin/evolution/strategies/page.tsx` — Use metric columns
- `src/app/admin/evolution/experiments/page.tsx` — Add metric columns

### Renamed (Phase 6)
| Old | New | Import updates |
|---|---|---|
| `evolution/src/services/experimentActionsV2.ts` | `experimentActions.ts` | 14 files (see Phase 6.1) |
| `evolution/src/services/experimentActionsV2.test.ts` | `experimentActions.test.ts` | — |
| `evolution/src/services/strategyRegistryActionsV2.ts` | `strategyRegistryActions.ts` | 4 files (see Phase 6.1) |
| `evolution/src/services/strategyRegistryActionsV2.test.ts` | `strategyRegistryActions.test.ts` | — |

### Removed (Phase 6)
- `update_strategy_aggregates` RPC
- `evolution_run_costs` VIEW
- `get_run_total_cost()` RPC
- `computeExperimentMetrics()` function
- `computeRunMetrics()` function
- `MetricsTab.tsx` (replaced by EntityMetricsTab.tsx)
- Strategy aggregate columns (dropped in migration, no backfill)
