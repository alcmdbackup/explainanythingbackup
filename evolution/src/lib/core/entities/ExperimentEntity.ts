// Experiment entity: groups runs by prompt, with same propagation metrics as strategy.

import type { SupabaseClient } from '@supabase/supabase-js';
import { Entity } from '../Entity';
import { METRIC_CATALOG } from '../metricCatalog';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionExperimentInsertSchema, type EvolutionExperimentFullDb } from '../../schemas';
import {
  aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount,
  aggregateBootstrapMean,
} from '../../metrics/computations/propagation';

export class ExperimentEntity extends Entity<EvolutionExperimentFullDb> {
  readonly type: EntityType = 'experiment';
  readonly table = 'evolution_experiments';
  readonly statusField = 'status';
  readonly logQueryColumn = 'experiment_id';
  readonly renameField = 'name';

  readonly parents: ParentRelation[] = [
    { parentType: 'prompt', foreignKey: 'prompt_id' },
  ];

  readonly children: ChildRelation[] = [
    { childType: 'run', foreignKey: 'experiment_id', cascade: 'delete' },
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
      { ...METRIC_CATALOG.total_reflection_cost,
        sourceEntity: 'run', sourceMetric: 'reflection_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_reflection_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'reflection_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_iterative_edit_cost,
        sourceEntity: 'run', sourceMetric: 'iterative_edit_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_iterative_edit_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'iterative_edit_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // (rename_agents_subagents_evolution_20260508 Phase 6) Removed iterative_edit_rank_cost
      // propagations — superseded by subagent:ranking.cost dynamic prefix.
      { ...METRIC_CATALOG.total_evaluation_cost,
        sourceEntity: 'run', sourceMetric: 'evaluation_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_evaluation_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'evaluation_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_debate_cost,
        sourceEntity: 'run', sourceMetric: 'debate_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_debate_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'debate_cost',
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
      { ...METRIC_CATALOG.avg_cost_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'cost_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_generation_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'generation_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_ranking_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'ranking_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // G7 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529).
      { ...METRIC_CATALOG.avg_paragraph_rewrite_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'paragraph_rewrite_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_paragraph_rank_estimation_error_pct,
        sourceEntity: 'run', sourceMetric: 'paragraph_rank_estimation_error_pct',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // Sequential Context-Aware Generation (debug_performance_paragraph_recombine_20260612).
      { ...METRIC_CATALOG.avg_coordinator_retry_rate,
        sourceEntity: 'run', sourceMetric: 'coordinator_retry_rate',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_coordinator_failure_rate,
        sourceEntity: 'run', sourceMetric: 'coordinator_failure_rate',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_excessive_parent_fallback_abort_rate,
        sourceEntity: 'run', sourceMetric: 'excessive_parent_fallback_abort_rate',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_prior_picks_sanitization_count,
        sourceEntity: 'run', sourceMetric: 'prior_picks_sanitization_count',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.total_prior_picks_truncation_count,
        sourceEntity: 'run', sourceMetric: 'prior_picks_truncation_count',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
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
      // Propose/approve criteria cost rollups (updated_criteria_agent_20260505)
      { ...METRIC_CATALOG.total_proposer_approver_criteria_cost,
        sourceEntity: 'run', sourceMetric: 'proposer_approver_criteria_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_proposer_approver_criteria_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'proposer_approver_criteria_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // Paragraph recombine cost rollups (rank_individual_paragraphs_evolution_20260525)
      { ...METRIC_CATALOG.total_paragraph_recombine_cost,
        sourceEntity: 'run', sourceMetric: 'paragraph_recombine_cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_paragraph_recombine_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'paragraph_recombine_cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      // Universal sentence-overlap rollup
      { ...METRIC_CATALOG.avg_median_sentence_verbatim_ratio,
        sourceEntity: 'run', sourceMetric: 'median_sentence_verbatim_ratio',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
    ],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['draft', 'running', 'completed', 'cancelled'] },
  ];

  readonly actions: EntityAction<EvolutionExperimentFullDb>[] = [
    { key: 'rename', label: 'Rename' },
    { key: 'cancel', label: 'Cancel', danger: true,
      confirm: 'Cancel this experiment?',
      visible: (row) => ['draft', 'running'].includes(row.status) },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this experiment and all its runs?',
      visible: (row) => ['completed', 'cancelled'].includes(row.status) },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'runs', label: 'Runs' },
    { id: 'logs', label: 'Logs' },
  ];

  readonly insertSchema = evolutionExperimentInsertSchema;

  detailLinks(row: EvolutionExperimentFullDb): EntityLink[] {
    return [{ label: 'Prompt', entityType: 'prompt', entityId: row.prompt_id }];
  }

  async executeAction(key: string, id: string, db: SupabaseClient, payload?: Record<string, unknown>): Promise<void> {
    if (key === 'cancel') {
      await db.from(this.table)
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }
    return super.executeAction(key, id, db, payload);
  }
}
