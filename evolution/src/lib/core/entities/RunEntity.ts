// Run entity: evolution pipeline runs with strategy+experiment parents, variant+invocation children.

import type { SupabaseClient } from '@supabase/supabase-js';
import { Entity } from '../Entity';
import { METRIC_CATALOG } from '../metricCatalog';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionRunInsertSchema, type EvolutionRunFullDb } from '../../schemas';
import {
  computeRunCost,
  computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount,
  computeCostEstimationErrorPct, computeEstimatedCost, computeEstimationAbsErrorUsd,
  computeGenerationEstimationErrorPct, computeRankingEstimationErrorPct,
  computeParagraphRewriteEstimationErrorPct, computeParagraphRankEstimationErrorPct,
  computeAgentCostProjected, computeAgentCostActual,
  computeParallelDispatched, computeSequentialDispatched,
  computeMedianSequentialGfsaDurationMs, computeAvgSequentialGfsaDurationMs,
} from '../../metrics/computations/finalization';
import {
  computeMedianSentenceVerbatimRatio, computeP25SentenceVerbatimRatio,
  computeMinSentenceVerbatimRatio,
} from '../../metrics/computations/sentenceOverlapMetrics';

export class RunEntity extends Entity<EvolutionRunFullDb> {
  readonly type: EntityType = 'run';
  readonly table = 'evolution_runs';
  readonly statusField = 'status';
  readonly logQueryColumn = 'run_id';

  readonly parents: ParentRelation[] = [
    { parentType: 'strategy', foreignKey: 'strategy_id' },
    { parentType: 'experiment', foreignKey: 'experiment_id' },
    { parentType: 'prompt', foreignKey: 'prompt_id' },
  ];

  readonly children: ChildRelation[] = [
    { childType: 'variant', foreignKey: 'run_id', cascade: 'delete' },
    { childType: 'invocation', foreignKey: 'run_id', cascade: 'delete' },
  ];

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [
      // listView: false on cost — RunsTable's base column shows it with budget warning UI.
      { ...METRIC_CATALOG.cost, compute: computeRunCost },
      // Per-purpose cost split — written live by createLLMClient via writeMetricMax
      // (race-fixed Postgres GREATEST upsert). compute returns 0 because the value is
      // persisted directly via writeMetricMax; if anything ever triggers a registry-driven
      // recompute, GREATEST will keep the larger live-written value.
      { ...METRIC_CATALOG.generation_cost, compute: () => 0 },
      { ...METRIC_CATALOG.ranking_cost, compute: () => 0 },
      { ...METRIC_CATALOG.reflection_cost, compute: () => 0 },
      { ...METRIC_CATALOG.iterative_edit_cost, compute: () => 0 },
      // (removed) iterative_edit_rank_cost — superseded by subagent:ranking.cost.
      { ...METRIC_CATALOG.iterative_edit_drift_rate, compute: () => 0 },
      { ...METRIC_CATALOG.iterative_edit_recovery_success_rate, compute: () => 0 },
      { ...METRIC_CATALOG.iterative_edit_accept_rate, compute: () => 0 },
      { ...METRIC_CATALOG.evaluation_cost, compute: () => 0 },
      { ...METRIC_CATALOG.debate_cost, compute: () => 0 },
      { ...METRIC_CATALOG.seed_cost, compute: () => 0 },
      // Proposer/Approver criteria agent (updated_criteria_agent_20260505)
      { ...METRIC_CATALOG.proposer_approver_criteria_cost, compute: () => 0 },
      { ...METRIC_CATALOG.proposer_approver_drift_rate, compute: () => 0 },
      { ...METRIC_CATALOG.proposer_approver_accept_rate, compute: () => 0 },
      { ...METRIC_CATALOG.proposer_approver_mirror_agreement_rate, compute: () => 0 },
      // Paragraph Recombine agent (rank_individual_paragraphs_evolution_20260525)
      { ...METRIC_CATALOG.paragraph_recombine_cost, compute: () => 0 },
      { ...METRIC_CATALOG.paragraph_slot_match_persist_failures, compute: () => 0 },
      // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — coherence-pass
      // umbrella cost + silent-rejection observability counter.
      { ...METRIC_CATALOG.paragraph_recombine_coherence_cost, compute: () => 0 },
      { ...METRIC_CATALOG.coherence_pass_silent_rejection_count, compute: () => 0 },
      // Sequential Context-Aware Generation (debug_performance_paragraph_recombine_20260612).
      // Default compute returns 0; actual values written by the agent during execution + at
      // finalization extractors when invocations carry the new sequential execution_detail.
      { ...METRIC_CATALOG.coordinator_retry_rate, compute: () => 0 },
      { ...METRIC_CATALOG.coordinator_failure_rate, compute: () => 0 },
      { ...METRIC_CATALOG.excessive_parent_fallback_abort_rate, compute: () => 0 },
      { ...METRIC_CATALOG.parent_fallback_rate, compute: () => 0 },
      { ...METRIC_CATALOG.prior_picks_sanitization_count, compute: () => 0 },
      { ...METRIC_CATALOG.prior_picks_truncation_count, compute: () => 0 },
    ],
    atFinalization: [
      { ...METRIC_CATALOG.winner_elo, compute: computeWinnerElo },
      { ...METRIC_CATALOG.median_elo, compute: computeMedianElo },
      { ...METRIC_CATALOG.p90_elo, compute: computeP90Elo },
      { ...METRIC_CATALOG.max_elo, compute: computeMaxElo },
      { ...METRIC_CATALOG.total_matches, compute: computeTotalMatches },
      { ...METRIC_CATALOG.decisive_rate, compute: computeDecisiveRate },
      { ...METRIC_CATALOG.variant_count, compute: computeVariantCount },
      // Cost estimate accuracy (cost_estimate_accuracy_analysis_20260414)
      { ...METRIC_CATALOG.cost_estimation_error_pct, compute: computeCostEstimationErrorPct },
      { ...METRIC_CATALOG.estimated_cost, compute: computeEstimatedCost },
      { ...METRIC_CATALOG.estimation_abs_error_usd, compute: computeEstimationAbsErrorUsd },
      { ...METRIC_CATALOG.generation_estimation_error_pct, compute: computeGenerationEstimationErrorPct },
      { ...METRIC_CATALOG.ranking_estimation_error_pct, compute: computeRankingEstimationErrorPct },
      // G7 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): per-phase
      // paragraph_recombine estimation-error rollups.
      { ...METRIC_CATALOG.paragraph_rewrite_estimation_error_pct, compute: computeParagraphRewriteEstimationErrorPct },
      { ...METRIC_CATALOG.paragraph_rank_estimation_error_pct, compute: computeParagraphRankEstimationErrorPct },
      { ...METRIC_CATALOG.agent_cost_projected, compute: computeAgentCostProjected },
      { ...METRIC_CATALOG.agent_cost_actual, compute: computeAgentCostActual },
      { ...METRIC_CATALOG.parallel_dispatched, compute: computeParallelDispatched },
      { ...METRIC_CATALOG.sequential_dispatched, compute: computeSequentialDispatched },
      { ...METRIC_CATALOG.median_sequential_gfsa_duration_ms, compute: computeMedianSequentialGfsaDurationMs },
      { ...METRIC_CATALOG.avg_sequential_gfsa_duration_ms, compute: computeAvgSequentialGfsaDurationMs },
      // Sentence-overlap distribution (universal, all variant-producing agents)
      { ...METRIC_CATALOG.median_sentence_verbatim_ratio, compute: computeMedianSentenceVerbatimRatio },
      { ...METRIC_CATALOG.p25_sentence_verbatim_ratio, compute: computeP25SentenceVerbatimRatio },
      { ...METRIC_CATALOG.min_sentence_verbatim_ratio, compute: computeMinSentenceVerbatimRatio },
      // paragraph_recombine_agent_with_coherence_pass_evolution_20260620 — slot-level
      // provenance ratio percentiles. Compute returns 0 as placeholder; finalization
      // extractor wires the real percentile from execution_detail.slots[*].rewrites[*].provenanceRatio.
      { ...METRIC_CATALOG.slot_provenance_ratio_p25, compute: () => 0 },
      { ...METRIC_CATALOG.slot_provenance_ratio_p50, compute: () => 0 },
    ],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'status', label: 'Status', formatter: 'statusBadge', sortable: true },
    { key: 'strategy_name', label: 'Strategy', formatter: 'text' },
    { key: 'iterations', label: 'Iterations', formatter: 'integer' },
  ];

  readonly listFilters: FilterDef[] = [
    // B011-S3: include 'claimed' (worker-claim state read by the cancel-action visible
    // predicate) and 'cancelled' (cancel-handler write target) so users can filter for
    // those real states.
    { field: 'status', type: 'select', options: ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'] },
  ];

  readonly actions: EntityAction<EvolutionRunFullDb>[] = [
    { key: 'cancel', label: 'Kill', danger: true,
      confirm: 'Kill this run?',
      visible: (row) => ['pending', 'claimed', 'running'].includes(row.status) },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this run and all its variants/invocations?',
      visible: (row) => ['completed', 'failed', 'cancelled'].includes(row.status) },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'elo', label: 'Elo' },
    { id: 'lineage', label: 'Lineage' },
    { id: 'variants', label: 'Variants' },
    { id: 'logs', label: 'Logs' },
  ];

  readonly insertSchema = evolutionRunInsertSchema;

  detailLinks(row: EvolutionRunFullDb): EntityLink[] {
    const links: EntityLink[] = [];
    if (row.strategy_id) links.push({ label: 'Strategy', entityType: 'strategy', entityId: row.strategy_id });
    if (row.experiment_id) links.push({ label: 'Experiment', entityType: 'experiment', entityId: row.experiment_id });
    return links;
  }

  // B001-S3 + B007-S3: forward `payload` to super.executeAction so cascade-delete
  // invariants (`_visited` Set + `_skipStaleMarking` flag) propagate correctly. The
  // previous 3-arg signature dropped the payload, breaking cycle protection across
  // recursive descendant deletes.
  async executeAction(key: string, id: string, db: SupabaseClient, payload?: Record<string, unknown>): Promise<void> {
    if (key === 'cancel') {
      await db.from(this.table)
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }
    return super.executeAction(key, id, db, payload);
  }
}
