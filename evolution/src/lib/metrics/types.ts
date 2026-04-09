// Type definitions for the evolution metrics system: entity types, metric names, DB row schema, and contexts.

import { z } from 'zod';
import type { ReactNode } from 'react';
import type { TextVariation, AgentExecutionDetail } from '../types';
import type { Rating } from '../shared/computeRatings';
import type { EvolutionResult, V2Match } from '../pipeline/infra/types';
import type { MetricValue } from './experimentMetrics';
import type { AgentName } from '../core/agentNames';

// ─── Entity & Metric Name Types ─────────────────────────────────

export const ENTITY_TYPES = ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const AGGREGATION_METHODS = ['sum', 'avg', 'max', 'min', 'count', 'bootstrap_mean', 'bootstrap_percentile'] as const;
export type AggregationMethod = typeof AGGREGATION_METHODS[number];

export type MetricTiming = 'during_execution' | 'at_finalization' | 'at_propagation';

// Type-safe metric names — typos caught at compile time
export const STATIC_METRIC_NAMES = [
  // Run (live during-execution)
  'cost', 'generation_cost', 'ranking_cost',
  // Run (at-finalization)
  'winner_elo', 'median_elo', 'p90_elo', 'max_elo',
  'total_matches', 'decisive_rate', 'variant_count',
  // Invocation
  'best_variant_elo', 'avg_variant_elo', 'format_rejection_rate', 'total_comparisons',
  // Strategy/Experiment aggregates
  'run_count', 'total_cost', 'avg_cost_per_run',
  'total_generation_cost', 'avg_generation_cost_per_run',
  'total_ranking_cost', 'avg_ranking_cost_per_run',
  'avg_final_elo', 'best_final_elo', 'worst_final_elo',
  'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
  'avg_matches_per_run', 'avg_decisive_rate',
  'total_variant_count', 'avg_variant_count',
] as const;
export type StaticMetricName = typeof STATIC_METRIC_NAMES[number];
/**
 * Dynamic per-agent-class cost metric prefix. Used by `experimentMetrics.ts` ONLY
 * for aggregating invocation `cost_usd` by `agent_name` (e.g. `agentCost:generate_from_seed_article`).
 *
 * Per-LLM-call cost attribution uses static `*_cost` names via `COST_METRIC_BY_AGENT`
 * in `evolution/src/lib/core/agentNames.ts`. The two namespaces are orthogonal.
 */
export type DynamicMetricName = `agentCost:${string}`;
export type MetricName = StaticMetricName | DynamicMetricName;

// Dynamic metric prefixes for runtime validation
export const DYNAMIC_METRIC_PREFIXES = ['agentCost:'] as const;

// ─── Metric Definition Types ────────────────────────────────────

export interface MetricDefBase {
  name: MetricName;
  label: string;
  category: 'cost' | 'rating' | 'match' | 'count';
  formatter: 'cost' | 'costDetailed' | 'elo' | 'score' | 'percent' | 'integer';
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

export interface FinalizationContext {
  result: EvolutionResult;
  ratings: Map<string, Rating>;
  pool: TextVariation[];
  matchHistory: V2Match[];
  invocationDetails?: Map<string, AgentExecutionDetail>;
  currentInvocationId?: string;
  currentVariantCost?: number | null;
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
export { type MetricValue } from './experimentMetrics';

// ─── MetricItem re-export ────────────────────────────────────────

export type { MetricItem } from '@evolution/components/evolution';

// ─── Conversions ────────────────────────────────────────────────

export function toMetricValue(row: MetricRow): MetricValue {
  return {
    value: row.value,
    sigma: row.sigma,
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
