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

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [],
    // Tactic metrics are computed by computeTacticMetrics() — a separate path from
    // the standard propagateMetrics() which is typed to strategy/experiment.
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
