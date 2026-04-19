// Declarative metric registry: defines all metrics per entity type, their timing, and compute functions.
//
// NOTE: This file is one of TWO parallel metric registries in the codebase. The other is
// `evolution/src/lib/core/entityRegistry.ts` (Entity-class-based). Both must be kept in
// sync manually until they're consolidated in a follow-up project.

import type { EntityType, EntityMetricRegistry, MetricDefBase } from './types';
import { DYNAMIC_METRIC_PREFIXES } from './types';
import {
  computeRunCost,
  computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount,
  computeCostEstimationErrorPct,
  computeEstimatedCost, computeEstimationAbsErrorUsd,
  computeGenerationEstimationErrorPct, computeRankingEstimationErrorPct,
  computeAgentCostProjected, computeAgentCostActual,
  computeParallelDispatched, computeSequentialDispatched,
  computeMedianSequentialGfsaDurationMs, computeAvgSequentialGfsaDurationMs,
} from './computations/finalization';
import {
  computeBestVariantElo, computeAvgVariantElo, computeInvocationVariantCount,
  computeFormatRejectionRate, computeTotalComparisons,
  computeInvocationEloDeltaVsParent,
} from './computations/finalizationInvocation';
import {
  aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount,
  aggregateBootstrapMean,
} from './computations/propagation';
import {
  formatCost, formatCostDetailed, formatElo, formatScore, formatPercent,
} from '@evolution/lib/utils/formatters';

// ─── Shared propagation defs (strategy & experiment both aggregate from child runs) ─

const SHARED_PROPAGATION_DEFS: EntityMetricRegistry['atPropagation'] = [
  // Count
  { name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer', listView: true,
    sourceMetric: 'cost', sourceEntity: 'run', aggregate: aggregateCount, aggregationMethod: 'count' },
  // Cost
  { name: 'total_cost', label: 'Total Cost', category: 'cost', formatter: 'cost', listView: true,
    sourceMetric: 'cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_cost_per_run', label: 'Avg Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  // Per-purpose cost split (mirrors total_cost / avg_cost_per_run pattern)
  { name: 'total_generation_cost', label: 'Total Generation Cost', category: 'cost', formatter: 'cost', listView: true,
    sourceMetric: 'generation_cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_generation_cost_per_run', label: 'Avg Generation Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'generation_cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'total_ranking_cost', label: 'Total Ranking Cost', category: 'cost', formatter: 'cost', listView: true,
    sourceMetric: 'ranking_cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_ranking_cost_per_run', label: 'Avg Ranking Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'ranking_cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'total_seed_cost', label: 'Total Seed Cost', category: 'cost', formatter: 'cost', listView: true,
    sourceMetric: 'seed_cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_seed_cost_per_run', label: 'Avg Seed Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'seed_cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  // Rating — from run.winner_elo
  { name: 'avg_final_elo', label: 'Avg Winner Elo', category: 'rating', formatter: 'elo', listView: true,
    sourceMetric: 'winner_elo', sourceEntity: 'run', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
  { name: 'best_final_elo', label: 'Best Winner Elo', category: 'rating', formatter: 'elo', listView: true,
    sourceMetric: 'winner_elo', sourceEntity: 'run', aggregate: aggregateMax, aggregationMethod: 'max' },
  { name: 'worst_final_elo', label: 'Worst Winner Elo', category: 'rating', formatter: 'elo',
    sourceMetric: 'winner_elo', sourceEntity: 'run', aggregate: aggregateMin, aggregationMethod: 'min' },
  // Rating — from other run elo metrics
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
  // Cost estimate accuracy — use aggregateAvg (user decision: bootstrap CI reserved for elo/quality).
  { name: 'avg_cost_estimation_error_pct', label: 'Avg Estimation Error %', category: 'cost', formatter: 'percent', listView: true,
    sourceMetric: 'cost_estimation_error_pct', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_generation_estimation_error_pct', label: 'Avg Generation Error %', category: 'cost', formatter: 'percent',
    sourceMetric: 'generation_estimation_error_pct', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_ranking_estimation_error_pct', label: 'Avg Ranking Error %', category: 'cost', formatter: 'percent',
    sourceMetric: 'ranking_estimation_error_pct', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_estimation_abs_error_usd', label: 'Avg Abs Error', category: 'cost', formatter: 'costDetailed',
    sourceMetric: 'estimation_abs_error_usd', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'total_estimated_cost', label: 'Total Estimated Cost', category: 'cost', formatter: 'cost',
    sourceMetric: 'estimated_cost', sourceEntity: 'run', aggregate: aggregateSum, aggregationMethod: 'sum' },
  { name: 'avg_estimated_cost', label: 'Avg Estimated Cost/Run', category: 'cost', formatter: 'cost',
    sourceMetric: 'estimated_cost', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  // Budget-floor observables
  { name: 'avg_agent_cost_projected', label: 'Avg Projected Agent Cost', category: 'cost', formatter: 'costDetailed',
    sourceMetric: 'agent_cost_projected', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_agent_cost_actual', label: 'Avg Actual Agent Cost', category: 'cost', formatter: 'costDetailed',
    sourceMetric: 'agent_cost_actual', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_parallel_dispatched', label: 'Avg Parallel Dispatched', category: 'count', formatter: 'integer',
    sourceMetric: 'parallel_dispatched', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_sequential_dispatched', label: 'Avg Sequential Dispatched', category: 'count', formatter: 'integer',
    sourceMetric: 'sequential_dispatched', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
  { name: 'avg_median_sequential_gfsa_duration_ms', label: 'Avg Median Seq GFSA Duration (ms)', category: 'count', formatter: 'integer',
    sourceMetric: 'median_sequential_gfsa_duration_ms', sourceEntity: 'run', aggregate: aggregateAvg, aggregationMethod: 'avg' },
];

// ─── Registry ───────────────────────────────────────────────────

export const METRIC_REGISTRY: Record<EntityType, EntityMetricRegistry> = {
  run: {
    duringExecution: [
      { name: 'cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
        listView: false, compute: computeRunCost },
      // Per-purpose cost split — written live by createLLMClient via writeMetricMax
      // (race-fixed Postgres GREATEST upsert). compute returns 0 because the value is
      // persisted directly via writeMetricMax; if anything ever triggers a registry-driven
      // recompute, GREATEST will keep the larger live-written value.
      { name: 'generation_cost', label: 'Generation Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: () => 0 },
      { name: 'ranking_cost', label: 'Ranking Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: () => 0 },
      { name: 'seed_cost', label: 'Seed Cost', category: 'cost', formatter: 'cost',
        listView: true, compute: () => 0 },
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
      { name: 'cost_estimation_error_pct', label: 'Estimation Error %', category: 'cost', formatter: 'percent',
        listView: true, compute: computeCostEstimationErrorPct },
      // Cost estimate accuracy (cost_estimate_accuracy_analysis_20260414)
      { name: 'estimated_cost', label: 'Estimated Cost', category: 'cost', formatter: 'cost',
        compute: computeEstimatedCost },
      { name: 'estimation_abs_error_usd', label: 'Estimation Abs Error', category: 'cost', formatter: 'costDetailed',
        compute: computeEstimationAbsErrorUsd },
      { name: 'generation_estimation_error_pct', label: 'Generation Estimation Error %', category: 'cost', formatter: 'percent',
        compute: computeGenerationEstimationErrorPct },
      { name: 'ranking_estimation_error_pct', label: 'Ranking Estimation Error %', category: 'cost', formatter: 'percent',
        compute: computeRankingEstimationErrorPct },
      // Budget-floor observables (passed through FinalizationContext from runIterationLoop)
      { name: 'agent_cost_projected', label: 'Projected Agent Cost', category: 'cost', formatter: 'costDetailed',
        compute: computeAgentCostProjected },
      { name: 'agent_cost_actual', label: 'Actual Agent Cost (measured)', category: 'cost', formatter: 'costDetailed',
        compute: computeAgentCostActual },
      { name: 'parallel_dispatched', label: 'Parallel Dispatched', category: 'count', formatter: 'integer',
        compute: computeParallelDispatched },
      { name: 'sequential_dispatched', label: 'Sequential Dispatched', category: 'count', formatter: 'integer',
        compute: computeSequentialDispatched },
      { name: 'median_sequential_gfsa_duration_ms', label: 'Median Seq GFSA Duration (ms)', category: 'count', formatter: 'integer',
        compute: computeMedianSequentialGfsaDurationMs },
      { name: 'avg_sequential_gfsa_duration_ms', label: 'Avg Seq GFSA Duration (ms)', category: 'count', formatter: 'integer',
        compute: computeAvgSequentialGfsaDurationMs },
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
      { name: 'format_rejection_rate', label: 'Format Rejection Rate', category: 'count', formatter: 'percent',
        description: 'Fraction of generation strategies that failed format validation',
        compute: (ctx) => computeFormatRejectionRate(ctx, ctx.currentInvocationId ?? null) },
      { name: 'total_comparisons', label: 'Total Comparisons', category: 'match', formatter: 'integer',
        description: 'Total pairwise comparisons performed by this ranking invocation',
        compute: (ctx) => computeTotalComparisons(ctx, ctx.currentInvocationId ?? null) },
      { name: 'elo_delta_vs_parent', label: 'ELO Δ vs. Parent', category: 'rating', formatter: 'elo',
        description: 'Produced variant ELO minus parent ELO (live — stale-cascade fires on parent rating changes)',
        compute: (ctx) => computeInvocationEloDeltaVsParent(ctx, ctx.currentInvocationId ?? null) },
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
    atPropagation: [...SHARED_PROPAGATION_DEFS],
  },
  experiment: {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [...SHARED_PROPAGATION_DEFS],
  },
  prompt: { duringExecution: [], atFinalization: [], atPropagation: [] },
  tactic: { duringExecution: [], atFinalization: [], atPropagation: [] },
};

// ─── Build-time validation ──────────────────────────────────────

export function validateRegistry(): void {
  for (const [entityType, registry] of Object.entries(METRIC_REGISTRY)) {
    const allNames = [
      ...registry.duringExecution,
      ...registry.atFinalization,
      ...registry.atPropagation,
    ].map(d => d.name);
    const dupes = allNames.filter((n, i) => allNames.indexOf(n) !== i);
    if (dupes.length > 0) {
      throw new Error(`Duplicate metrics in ${entityType}: ${dupes.join(', ')}`);
    }

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
          `${entityType}.${def.name}: sourceMetric '${def.sourceMetric}' not found in ${def.sourceEntity} registry`,
        );
      }
    }
  }
}
validateRegistry();

// ─── Registry Helpers ───────────────────────────────────────────

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

// ─── Formatter lookup ───────────────────────────────────────────

export const FORMATTERS: Record<MetricDefBase['formatter'], (v: number) => string> = {
  cost: formatCost,
  costDetailed: formatCostDetailed,
  elo: formatElo,
  score: formatScore,
  percent: formatPercent,
  integer: (v) => String(Math.round(v)),
};
