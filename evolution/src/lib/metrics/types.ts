// Type definitions for the evolution metrics system: entity types, metric names, DB row schema, and contexts.

import { z } from 'zod';
import type { ReactNode } from 'react';
import type { TextVariation, AgentExecutionDetail } from '../types';
import type { Rating } from '../shared/computeRatings';
import type { EvolutionResult, V2Match } from '../pipeline/infra/types';
import type { MetricValue } from './experimentMetrics';
import type { AgentName } from '../core/agentNames';

// ─── Entity & Metric Name Types ─────────────────────────────────

export const ENTITY_TYPES = ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt', 'tactic'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const AGGREGATION_METHODS = ['sum', 'avg', 'max', 'min', 'count', 'bootstrap_mean', 'bootstrap_percentile'] as const;
export type AggregationMethod = typeof AGGREGATION_METHODS[number];

export type MetricTiming = 'during_execution' | 'at_finalization' | 'at_propagation';

// Type-safe metric names — typos caught at compile time
export const STATIC_METRIC_NAMES = [
  // Run (live during-execution)
  'cost', 'generation_cost', 'ranking_cost', 'reflection_cost', 'seed_cost',
  'iterative_edit_cost',
  // Run (live during-execution) — operational health for iterative_editing
  'iterative_edit_drift_rate',
  'iterative_edit_recovery_success_rate',
  'iterative_edit_accept_rate',
  // Run (at-finalization)
  'winner_elo', 'median_elo', 'p90_elo', 'max_elo',
  'total_matches', 'decisive_rate', 'variant_count', 'cost_estimation_error_pct',
  // Run (at-finalization) — cost estimate accuracy (cost_estimate_accuracy_analysis_20260414)
  'estimated_cost',
  'generation_estimation_error_pct',
  'ranking_estimation_error_pct',
  'estimation_abs_error_usd',
  'agent_cost_projected',
  'agent_cost_actual',
  'parallel_dispatched',
  'sequential_dispatched',
  'median_sequential_gfsa_duration_ms',
  'avg_sequential_gfsa_duration_ms',
  // Invocation
  'best_variant_elo', 'avg_variant_elo', 'format_rejection_rate', 'total_comparisons',
  'elo_delta_vs_parent',
  // Strategy/Experiment aggregates
  'run_count', 'total_cost', 'avg_cost_per_run',
  'total_generation_cost', 'avg_generation_cost_per_run',
  'total_ranking_cost', 'avg_ranking_cost_per_run',
  'total_reflection_cost', 'avg_reflection_cost_per_run',
  'total_iterative_edit_cost', 'avg_iterative_edit_cost_per_run',
  'total_seed_cost', 'avg_seed_cost_per_run',
  'avg_final_elo', 'best_final_elo', 'worst_final_elo',
  'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
  'avg_matches_per_run', 'avg_decisive_rate',
  'total_variant_count', 'avg_variant_count',
  // Strategy/Experiment aggregates — cost estimate accuracy
  'avg_cost_estimation_error_pct',
  'avg_generation_estimation_error_pct',
  'avg_ranking_estimation_error_pct',
  'avg_estimation_abs_error_usd',
  'avg_estimated_cost',
  'total_estimated_cost',
  'avg_agent_cost_projected',
  'avg_agent_cost_actual',
  'avg_parallel_dispatched',
  'avg_sequential_dispatched',
  'avg_median_sequential_gfsa_duration_ms',
  // Tactic metrics
  'avg_elo', 'avg_elo_delta', 'best_elo', 'win_rate',
  'total_variants', 'winner_count',
] as const;
export type StaticMetricName = typeof STATIC_METRIC_NAMES[number];
/**
 * Dynamic per-agent-class cost metric prefix. Used by `experimentMetrics.ts` ONLY
 * for aggregating invocation `cost_usd` by `agent_name` (e.g. `agentCost:generate_from_previous_article`).
 *
 * Per-LLM-call cost attribution uses static `*_cost` names via `COST_METRIC_BY_AGENT`
 * in `evolution/src/lib/core/agentNames.ts`. The two namespaces are orthogonal.
 */
export type DynamicMetricName =
  | `agentCost:${string}`
  /** Phase 5: per-agent, per-dimension mean ELO delta. `eloAttrDelta:<agentName>:<dimensionValue>`. */
  | `eloAttrDelta:${string}`
  /** Phase 5: per-agent ELO-delta histogram bucket. `eloAttrDeltaHist:<agentName>:<bucketStart>:<bucketEnd>`. */
  | `eloAttrDeltaHist:${string}`;
export type MetricName = StaticMetricName | DynamicMetricName;

// Dynamic metric prefixes for runtime validation
export const DYNAMIC_METRIC_PREFIXES = [
  'agentCost:',
  'eloAttrDelta:',
  'eloAttrDeltaHist:',
] as const;

/**
 * B041: true when the metric name is one of the dynamic-prefix families above. The
 * stale-cascade (`Entity.markParentMetricsStale`) consults this in addition to the
 * static propagation defs so dynamic-prefix rows (`eloAttrDelta:*`, `agentCost:*`,
 * `eloAttrDeltaHist:*`) get marked stale on variant rating drift.
 *
 * Keep the helper co-located with the prefix array so adding a new dynamic family is a
 * 1-line addition that automatically extends both writeMetrics validation AND the
 * stale-cascade.
 */
export function isDynamicMetricName(name: string): boolean {
  return DYNAMIC_METRIC_PREFIXES.some((p) => name.startsWith(p));
}

// ─── Metric Definition Types ────────────────────────────────────

export interface MetricDefBase {
  name: MetricName;
  label: string;
  category: 'cost' | 'rating' | 'match' | 'count';
  formatter: 'cost' | 'costDetailed' | 'elo' | 'score' | 'percent' | 'percentValue' | 'integer';
  description?: string;
  listView?: boolean;
}

export interface ExecutionMetricDef extends MetricDefBase {
  compute: (ctx: ExecutionContext) => number;
}

export interface FinalizationMetricDef extends MetricDefBase {
  compute: (ctx: FinalizationContext) => MetricValue | number | null;
}

/** Type guard to distinguish MetricValue from bare number returns. */
export function isMetricValue(v: MetricValue | number | null): v is MetricValue {
  return v !== null && typeof v === 'object' && 'value' in v;
}

export interface PropagationMetricDef extends MetricDefBase {
  sourceMetric: MetricName;
  sourceEntity: EntityType;
  aggregate: (rows: MetricRow[]) => MetricValue;
  aggregationMethod: AggregationMethod;
}

export type MetricDef = MetricDefBase;

// ─── Registry Structure ─────────────────────────────────────────

export interface EntityMetricRegistry {
  duringExecution: ExecutionMetricDef[];
  atFinalization: FinalizationMetricDef[];
  atPropagation: PropagationMetricDef[];
}

// ─── Computation Contexts ───────────────────────────────────────

export interface ExecutionContext {
  costTracker: { getTotalSpent(): number; getPhaseCosts(): Partial<Record<AgentName, number>> };
  phaseName: AgentName;
}

/** Observable numerics captured during pipeline execution that the finalization
 *  context carries through so they can be written as first-class metrics. These
 *  come from in-memory state in `runIterationLoop.ts` (not derivable from
 *  persisted run data alone). */
export interface BudgetFloorObservables {
  /** Pre-dispatch `estimateAgentCost` output (USD). */
  initialAgentCostEstimate: number;
  /** Runtime feedback: average cost of successful parallel GFSA agents (USD).
   *  Null when parallel produced zero successful agents. */
  actualAvgCostPerAgent: number | null;
  /** Number of GFSA agents dispatched in the parallel phase. */
  parallelDispatched: number;
  /** Number of GFSA agents dispatched in the sequential phase. */
  sequentialDispatched: number;
  /** Median / mean wall-clock duration of sequential GFSA invocations (ms).
   *  Null when there were zero sequential invocations. */
  medianSequentialGfsaDurationMs: number | null;
  avgSequentialGfsaDurationMs: number | null;
}

export interface FinalizationContext {
  result: EvolutionResult;
  ratings: Map<string, Rating>;
  pool: TextVariation[];
  matchHistory: V2Match[];
  invocationDetails?: Map<string, AgentExecutionDetail>;
  currentInvocationId?: string;
  currentVariantCost?: number | null;
  budgetFloorObservables?: BudgetFloorObservables;
}

// ─── DB Row Schema (Zod) ────────────────────────────────────────

// The MetricRow shape uses `uncertainty` (application-layer field name).
// DB column is still named `sigma` (RENAME DDL blocked by CI safety check);
// readMetrics.ts + metricsActions.ts rename `sigma`→`uncertainty` at the query boundary.
export const MetricRowSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
  metric_name: z.string().min(1).max(200),
  value: z.number(),
  uncertainty: z.number().nullable(),
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
export { type MetricValue } from './experimentMetrics';

// ─── MetricItem re-export ────────────────────────────────────────

export type { MetricItem } from '@evolution/components/evolution';

// ─── Conversions ────────────────────────────────────────────────

export function toMetricValue(row: MetricRow): MetricValue {
  return {
    value: row.value,
    uncertainty: row.uncertainty,
    ci: row.ci_lower != null && row.ci_upper != null ? [row.ci_lower, row.ci_upper] : null,
    n: row.n,
  };
}

export function toMetricItem(
  row: MetricRow,
  formatter: (v: number) => string,
  label?: string,
): { label: string; value: ReactNode; ci?: [number, number]; n?: number } {
  return {
    label: label ?? row.metric_name,
    value: formatter(row.value),
    ci: row.ci_lower != null && row.ci_upper != null ? [row.ci_lower, row.ci_upper] : undefined,
    n: row.n,
  };
}
