// Declarative metric registry: defines all metrics per entity type, their timing, and compute functions.

import type { EntityType, EntityMetricRegistry, MetricDefBase } from './types';
import { DYNAMIC_METRIC_PREFIXES } from './types';
import { computeRunCost } from './computations/execution';
import {
  computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount,
} from './computations/finalization';
import {
  computeBestVariantElo, computeAvgVariantElo, computeInvocationVariantCount,
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
  { name: 'total_matches' as const, label: 'Total Matches', category: 'match', formatter: 'integer',
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
];

// ─── Registry ───────────────────────────────────────────────────

export const METRIC_REGISTRY: Record<EntityType, EntityMetricRegistry> = {
  run: {
    duringExecution: [
      { name: 'cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
        listView: false, compute: computeRunCost },
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
    atPropagation: [...SHARED_PROPAGATION_DEFS],
  },
  experiment: {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [...SHARED_PROPAGATION_DEFS],
  },
  prompt: { duringExecution: [], atFinalization: [], atPropagation: [] },
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
