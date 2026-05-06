// Tactic entity: thin DB entity for tactic identity + metrics tracking.
// Tactic prompts live in code (getTacticDef()); this entity provides UUIDs for metrics and admin UI.

import { Entity } from '../Entity';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';

/** Minimal DB row shape for evolution_tactics (no prompt columns). */
export interface EvolutionTacticRow {
  id: string;
  name: string;
  label: string;
  agent_type: string;
  category: string | null;
  is_predefined: boolean;
  status: string;
  created_at: string;
}

export class TacticEntity extends Entity<EvolutionTacticRow> {
  readonly type: EntityType = 'tactic';
  readonly table = 'evolution_tactics';
  readonly insertSchema = undefined;

  readonly parents: ParentRelation[] = [];

  readonly children: ChildRelation[] = [];

  // Tactic metrics are computed by computeTacticMetrics() — a separate path from the standard
  // propagateMetrics() which is typed to strategy/experiment. The defs below mirror the flat
  // METRIC_REGISTRY['tactic'].atFinalization entries in registry.ts:217-226 so that
  // createMetricColumns('tactic') on the list page and EntityMetricsTab on the detail page can
  // read the formatter/label/listView metadata. `compute: () => null` is never called — values
  // come from the evolution_metrics table via getMetricsForEntities.
  //
  // NOTE — dual-registry duplication (existing tech debt): registry.ts also declares these
  // 8 defs. Keep both in sync until a follow-up project consolidates to a single source.
  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [
      { name: 'avg_elo', label: 'Avg Elo', category: 'rating', formatter: 'elo',
        timing: 'at_finalization', description: 'Mean Elo across all variants produced by this tactic',
        listView: true, compute: () => null },
      { name: 'avg_elo_delta', label: 'Elo Delta', category: 'rating', formatter: 'elo',
        timing: 'at_finalization', description: 'Mean (Elo - 1200) vs baseline across variants',
        listView: true, compute: () => null },
      { name: 'best_elo', label: 'Best Elo', category: 'rating', formatter: 'elo',
        timing: 'at_finalization', description: 'Highest Elo among variants produced by this tactic',
        listView: false, compute: () => null },
      { name: 'win_rate', label: 'Win Rate', category: 'rating', formatter: 'percent',
        timing: 'at_finalization', description: 'Fraction of this tactic’s variants flagged is_winner=true',
        listView: true, compute: () => null },
      { name: 'total_variants', label: 'Variants', category: 'count', formatter: 'integer',
        timing: 'at_finalization', description: 'Total variants produced across all completed runs',
        listView: true, compute: () => null },
      { name: 'total_cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
        timing: 'at_finalization', description: 'Sum of variant-level cost across all runs',
        listView: false, compute: () => null },
      { name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer',
        timing: 'at_finalization', description: 'Distinct completed runs that used this tactic',
        listView: true, compute: () => null },
      { name: 'winner_count', label: 'Winners', category: 'count', formatter: 'integer',
        timing: 'at_finalization', description: 'Count of variants flagged is_winner=true',
        listView: false, compute: () => null },
    ],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'label', label: 'Label', formatter: 'text' },
    { key: 'agent_type', label: 'Agent Type', formatter: 'text' },
    { key: 'category', label: 'Category', formatter: 'text' },
    { key: 'is_predefined', label: 'System', formatter: 'boolean' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active', 'archived'] },
    { field: 'agent_type', type: 'select', options: ['generate_from_previous_article'] },
  ];

  readonly actions: EntityAction<EvolutionTacticRow>[] = [
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this tactic and its metrics?',
      visible: (row: EvolutionTacticRow) => !row.is_predefined },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'variants', label: 'Variants' },
    { id: 'runs', label: 'Runs' },
    { id: 'by-prompt', label: 'By Prompt' },
  ];

  detailLinks(_row: EvolutionTacticRow): EntityLink[] {
    return [];
  }
}
