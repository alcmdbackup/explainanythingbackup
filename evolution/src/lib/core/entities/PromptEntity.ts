// Prompt entity: root entity for evolution prompts (no metrics, no parent).

import type { SupabaseClient } from '@supabase/supabase-js';
import { Entity } from '../Entity';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionPromptInsertSchema, type EvolutionPromptFullDb } from '../../schemas';

export class PromptEntity extends Entity<EvolutionPromptFullDb> {
  readonly type: EntityType = 'prompt';
  readonly table = 'evolution_prompts';
  readonly renameField = 'name';
  readonly archiveColumn = 'status';
  readonly archiveValue = 'archived';

  readonly editConfig = {
    fields: [
      { key: 'prompt', label: 'Prompt Text', type: 'textarea' as const },
    ],
    defaults: (row: EvolutionPromptFullDb) => ({ prompt: row.prompt }),
  };

  readonly createConfig = {
    label: 'New Prompt',
    fields: [
      { key: 'name', label: 'Name', type: 'text' as const, required: true },
      { key: 'prompt', label: 'Prompt Text', type: 'textarea' as const, required: true },
    ],
  };

  readonly parents: ParentRelation[] = [];

  readonly children: ChildRelation[] = [
    { childType: 'experiment', foreignKey: 'prompt_id', cascade: 'restrict' },
    { childType: 'run', foreignKey: 'prompt_id', cascade: 'restrict' },
  ];

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'prompt', label: 'Prompt', formatter: 'text' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active', 'archived'] },
  ];

  readonly actions: EntityAction<EvolutionPromptFullDb>[] = [
    { key: 'rename', label: 'Rename' },
    { key: 'edit', label: 'Edit' },
    { key: 'archive', label: 'Archive',
      visible: (row) => row.status === 'active' },
    { key: 'unarchive', label: 'Unarchive',
      visible: (row) => row.status === 'archived' },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this prompt? Only possible if no experiments or runs reference it.' },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
  ];

  readonly insertSchema = evolutionPromptInsertSchema;

  detailLinks(_row: EvolutionPromptFullDb): EntityLink[] {
    return [];
  }

  async executeAction(key: string, id: string, db: SupabaseClient): Promise<void> {
    if (key === 'unarchive') {
      await db.from(this.table).update({ status: 'active', archived_at: null }).eq('id', id);
      return;
    }
    return super.executeAction(key, id, db);
  }
}
