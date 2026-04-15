// Strategy entity: root entity owning propagation metrics aggregated from child runs.

import { Entity } from '../Entity';
import { METRIC_CATALOG } from '../metricCatalog';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionStrategyInsertSchema, type EvolutionStrategyFullDb } from '../../schemas';
import {
  aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount,
  aggregateBootstrapMean,
} from '../../metrics/computations/propagation';

export class StrategyEntity extends Entity<EvolutionStrategyFullDb> {
  readonly type: EntityType = 'strategy';
  readonly table = 'evolution_strategies';
  readonly statusField = 'status';
  readonly logQueryColumn = 'strategy_id';
  readonly renameField = 'name';

  readonly editConfig = {
    fields: [
      { key: 'description', label: 'Description', type: 'textarea' as const },
    ],
    defaults: (row: EvolutionStrategyFullDb) => ({ description: row.description }),
  };

  readonly createConfig = {
    label: 'New Strategy',
    fields: [
      { key: 'name', label: 'Name', type: 'text' as const, required: true },
      { key: 'description', label: 'Description', type: 'textarea' as const },
      { key: 'generationModel', label: 'Generation Model', type: 'text' as const, required: true },
      { key: 'judgeModel', label: 'Judge Model', type: 'text' as const, required: true },
      { key: 'iterations', label: 'Iterations', type: 'number' as const, required: true },
      { key: 'budgetUsd', label: 'Budget (USD)', type: 'number' as const },
    ],
  };

  readonly parents: ParentRelation[] = [];

  readonly children: ChildRelation[] = [
    { childType: 'run', foreignKey: 'strategy_id', cascade: 'delete' },
  ];

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [
      { ...METRIC_CATALOG.run_count,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateCount, aggregationMethod: 'count' },
      { ...METRIC_CATALOG.total_cost,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_generation_cost,
        sourceEntity: 'run', sourceMetric: 'generation_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_generation_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'generation_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_ranking_cost,
        sourceEntity: 'run', sourceMetric: 'ranking_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_ranking_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'ranking_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_seed_cost,
        sourceEntity: 'run', sourceMetric: 'seed_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_seed_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'seed_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_final_elo,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { ...METRIC_CATALOG.best_final_elo,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateMax, aggregationMethod: 'max' },
      { ...METRIC_CATALOG.worst_final_elo,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateMin, aggregationMethod: 'min' },
      { ...METRIC_CATALOG.avg_median_elo,
        sourceEntity: 'run', sourceMetric: 'median_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { ...METRIC_CATALOG.avg_p90_elo,
        sourceEntity: 'run', sourceMetric: 'p90_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { ...METRIC_CATALOG.best_max_elo,
        sourceEntity: 'run', sourceMetric: 'max_elo',
        aggregate: aggregateMax, aggregationMethod: 'max' },
      { ...METRIC_CATALOG.total_matches,
        sourceEntity: 'run', sourceMetric: 'total_matches',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_matches_per_run,
        sourceEntity: 'run', sourceMetric: 'total_matches',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_decisive_rate,
        sourceEntity: 'run', sourceMetric: 'decisive_rate',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_variant_count,
        sourceEntity: 'run', sourceMetric: 'variant_count',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_variant_count,
        sourceEntity: 'run', sourceMetric: 'variant_count',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // Cost estimate accuracy (cost_estimate_accuracy_analysis_20260414)
      // User decision: aggregateAvg for cost metrics (bootstrap CI reserved for elo/quality).
      { ...METRIC_CATALOG.avg_cost_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'cost_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_generation_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'generation_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_ranking_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'ranking_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_estimation_abs_error_usd,
        sourceEntity: 'run', sourceMetric: 'estimation_abs_error_usd',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_estimated_cost,
        sourceEntity: 'run', sourceMetric: 'estimated_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_estimated_cost,
        sourceEntity: 'run', sourceMetric: 'estimated_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_agent_cost_projected,
        sourceEntity: 'run', sourceMetric: 'agent_cost_projected',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_agent_cost_actual,
        sourceEntity: 'run', sourceMetric: 'agent_cost_actual',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_parallel_dispatched,
        sourceEntity: 'run', sourceMetric: 'parallel_dispatched',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_sequential_dispatched,
        sourceEntity: 'run', sourceMetric: 'sequential_dispatched',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_median_sequential_gfsa_duration_ms,
        sourceEntity: 'run', sourceMetric: 'median_sequential_gfsa_duration_ms',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
    ],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'label', label: 'Config', formatter: 'text' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
    { key: 'pipeline_type', label: 'Type', formatter: 'text' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active'] },
    { field: 'pipeline_type', type: 'select', options: ['full', 'single'] },
  ];

  readonly actions: EntityAction<EvolutionStrategyFullDb>[] = [
    { key: 'rename', label: 'Rename' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this strategy and all its runs?' },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'runs', label: 'Runs' },
    { id: 'logs', label: 'Logs' },
  ];

  readonly insertSchema = evolutionStrategyInsertSchema;

  detailLinks(_row: EvolutionStrategyFullDb): EntityLink[] {
    return [];
  }

  // No custom actions — delete cascade handled by base class
}
