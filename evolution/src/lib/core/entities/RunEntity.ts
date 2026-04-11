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
} from '../../metrics/computations/finalization';

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
      { ...METRIC_CATALOG.seed_cost, compute: () => 0 },
    ],
    atFinalization: [
      { ...METRIC_CATALOG.winner_elo, compute: computeWinnerElo },
      { ...METRIC_CATALOG.median_elo, compute: computeMedianElo },
      { ...METRIC_CATALOG.p90_elo, compute: computeP90Elo },
      { ...METRIC_CATALOG.max_elo, compute: computeMaxElo },
      { ...METRIC_CATALOG.total_matches, compute: computeTotalMatches },
      { ...METRIC_CATALOG.decisive_rate, compute: computeDecisiveRate },
      { ...METRIC_CATALOG.variant_count, compute: computeVariantCount },
    ],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'status', label: 'Status', formatter: 'statusBadge', sortable: true },
    { key: 'strategy_name', label: 'Strategy', formatter: 'text' },
    { key: 'iterations', label: 'Iterations', formatter: 'integer' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['pending', 'running', 'completed', 'failed'] },
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

  async executeAction(key: string, id: string, db: SupabaseClient): Promise<void> {
    if (key === 'cancel') {
      await db.from(this.table)
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }
    return super.executeAction(key, id, db);
  }
}
