// Central metric catalog: single source of truth for metric definitions (name, label, category, formatter, timing).
// Entities reference catalog entries and add entity-specific behavior (compute functions, aggregation rules).

import type { CatalogMetricDef, MetricFormatter } from './types';
import {
  formatCost, formatCostDetailed, formatElo, formatScore, formatPercent,
} from '@evolution/lib/utils/formatters';

export const METRIC_CATALOG = {
  // === Execution-phase metrics ===
  cost: {
    name: 'cost', label: 'Cost', category: 'cost', formatter: 'cost',
    timing: 'during_execution', listView: false,
    description: 'Total LLM spend for this entity. Run-list shows it via the custom Spent column with budget warning + progress bar (RunsTable base column), not via createRunsMetricColumns.',
  },
  generation_cost: {
    name: 'generation_cost', label: 'Generation Cost', category: 'cost', formatter: 'cost',
    timing: 'during_execution', listView: true,
    description: 'LLM spend on generation calls in this run',
  },
  ranking_cost: {
    name: 'ranking_cost', label: 'Ranking Cost', category: 'cost', formatter: 'cost',
    timing: 'during_execution', listView: true,
    description: 'LLM spend on ranking calls in this run (incl. SwissRankingAgent + binary-search comparisons)',
  },
  seed_cost: {
    name: 'seed_cost', label: 'Seed Cost', category: 'cost', formatter: 'cost',
    timing: 'during_execution', listView: true,
    description: 'LLM spend on seed article generation (seed_title + seed_article calls in CreateSeedArticleAgent)',
  },

  // === Finalization-phase metrics ===
  winner_elo: {
    name: 'winner_elo', label: 'Winner Elo', category: 'rating', formatter: 'elo',
    timing: 'at_finalization',
    description: 'Elo of the highest-rated variant',
  },
  median_elo: {
    name: 'median_elo', label: 'Median Elo', category: 'rating', formatter: 'elo',
    timing: 'at_finalization',
    description: '50th percentile Elo across all variants',
  },
  p90_elo: {
    name: 'p90_elo', label: 'P90 Elo', category: 'rating', formatter: 'elo',
    timing: 'at_finalization',
    description: '90th percentile Elo across all variants',
  },
  max_elo: {
    name: 'max_elo', label: 'Max Elo', category: 'rating', formatter: 'elo',
    timing: 'at_finalization', listView: true,
    description: 'Highest Elo in the run',
  },
  total_matches: {
    name: 'total_matches', label: 'Matches', category: 'match', formatter: 'integer',
    timing: 'at_finalization',
    description: 'Total pairwise comparisons performed',
  },
  decisive_rate: {
    name: 'decisive_rate', label: 'Decisive Rate', category: 'match', formatter: 'percent',
    timing: 'at_finalization', listView: true,
    description: 'Fraction of matches with confidence > 0.6',
  },
  variant_count: {
    name: 'variant_count', label: 'Variants', category: 'count', formatter: 'integer',
    timing: 'at_finalization', listView: true,
    description: 'Number of variants produced',
  },
  best_variant_elo: {
    name: 'best_variant_elo', label: 'Best Variant Elo', category: 'rating', formatter: 'elo',
    timing: 'at_finalization',
    description: 'Highest Elo among variants produced by this invocation',
  },
  avg_variant_elo: {
    name: 'avg_variant_elo', label: 'Avg Variant Elo', category: 'rating', formatter: 'elo',
    timing: 'at_finalization',
    description: 'Average Elo of variants produced by this invocation',
  },
  format_rejection_rate: {
    name: 'format_rejection_rate', label: 'Format Rejection Rate', category: 'count', formatter: 'percent',
    timing: 'at_finalization',
    description: 'Fraction of generation strategies that failed format validation',
  },
  total_comparisons: {
    name: 'total_comparisons', label: 'Total Comparisons', category: 'match', formatter: 'integer',
    timing: 'at_finalization',
    description: 'Total pairwise comparisons performed by this ranking invocation',
  },

  // === Propagation-phase metrics (derived — entities override name/label) ===
  run_count: {
    name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer',
    timing: 'at_propagation', listView: true,
    description: 'Number of completed child runs',
  },
  total_cost: {
    name: 'total_cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
    timing: 'at_propagation', listView: true,
    description: 'Sum of cost across all child runs',
  },
  avg_cost_per_run: {
    name: 'avg_cost_per_run', label: 'Avg Cost/Run', category: 'cost', formatter: 'cost',
    timing: 'at_propagation',
    description: 'Average cost per child run',
  },
  total_generation_cost: {
    name: 'total_generation_cost', label: 'Total Generation Cost', category: 'cost', formatter: 'cost',
    timing: 'at_propagation', listView: true,
    description: 'Sum of generation_cost across all child runs',
  },
  avg_generation_cost_per_run: {
    name: 'avg_generation_cost_per_run', label: 'Avg Generation Cost/Run', category: 'cost', formatter: 'cost',
    timing: 'at_propagation',
    description: 'Average generation_cost per child run',
  },
  total_ranking_cost: {
    name: 'total_ranking_cost', label: 'Total Ranking Cost', category: 'cost', formatter: 'cost',
    timing: 'at_propagation', listView: true,
    description: 'Sum of ranking_cost across all child runs',
  },
  avg_ranking_cost_per_run: {
    name: 'avg_ranking_cost_per_run', label: 'Avg Ranking Cost/Run', category: 'cost', formatter: 'cost',
    timing: 'at_propagation',
    description: 'Average ranking_cost per child run',
  },
  total_seed_cost: {
    name: 'total_seed_cost', label: 'Total Seed Cost', category: 'cost', formatter: 'cost',
    timing: 'at_propagation', listView: true,
    description: 'Sum of seed_cost across all child runs',
  },
  avg_seed_cost_per_run: {
    name: 'avg_seed_cost_per_run', label: 'Avg Seed Cost/Run', category: 'cost', formatter: 'cost',
    timing: 'at_propagation',
    description: 'Average seed_cost per child run',
  },
  avg_final_elo: {
    name: 'avg_final_elo', label: 'Avg Winner Elo', category: 'rating', formatter: 'elo',
    timing: 'at_propagation', listView: true,
    description: 'Bootstrap mean of winner_elo across child runs',
  },
  best_final_elo: {
    name: 'best_final_elo', label: 'Best Winner Elo', category: 'rating', formatter: 'elo',
    timing: 'at_propagation', listView: true,
    description: 'Max winner_elo across child runs',
  },
  worst_final_elo: {
    name: 'worst_final_elo', label: 'Worst Winner Elo', category: 'rating', formatter: 'elo',
    timing: 'at_propagation',
    description: 'Min winner_elo across child runs',
  },
  avg_median_elo: {
    name: 'avg_median_elo', label: 'Avg Median Elo', category: 'rating', formatter: 'elo',
    timing: 'at_propagation',
    description: 'Bootstrap mean of median_elo across child runs',
  },
  avg_p90_elo: {
    name: 'avg_p90_elo', label: 'Avg P90 Elo', category: 'rating', formatter: 'elo',
    timing: 'at_propagation',
    description: 'Bootstrap mean of p90_elo across child runs',
  },
  best_max_elo: {
    name: 'best_max_elo', label: 'Best Max Elo', category: 'rating', formatter: 'elo',
    timing: 'at_propagation',
    description: 'Max of max_elo across child runs',
  },
  avg_matches_per_run: {
    name: 'avg_matches_per_run', label: 'Avg Matches/Run', category: 'match', formatter: 'integer',
    timing: 'at_propagation',
    description: 'Average total_matches per child run',
  },
  avg_decisive_rate: {
    name: 'avg_decisive_rate', label: 'Avg Decisive Rate', category: 'match', formatter: 'percent',
    timing: 'at_propagation',
    description: 'Bootstrap mean of decisive_rate across child runs',
  },
  total_variant_count: {
    name: 'total_variant_count', label: 'Total Variants', category: 'count', formatter: 'integer',
    timing: 'at_propagation',
    description: 'Sum of variant_count across child runs',
  },
  avg_variant_count: {
    name: 'avg_variant_count', label: 'Avg Variants/Run', category: 'count', formatter: 'integer',
    timing: 'at_propagation',
    description: 'Average variant_count per child run',
  },
} as const satisfies Record<string, CatalogMetricDef>;

export type CatalogMetricName = keyof typeof METRIC_CATALOG;

// ─── Formatter lookup ───────────────────────────────────────────

export const METRIC_FORMATTERS: Record<MetricFormatter, (v: number) => string> = {
  cost: formatCost,
  costDetailed: formatCostDetailed,
  elo: formatElo,
  score: formatScore,
  percent: formatPercent,
  integer: (v) => String(Math.round(v)),
};
