// Prompt entity: root entity for evolution prompts (no metrics, no parent).

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
    { childType: 'experiment', foreignKey: 'prompt_id', cascade: 'delete' },
    { childType: 'run', foreignKey: 'prompt_id', cascade: 'delete' },
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
    { field: 'status', type: 'select', options: ['active'] },
  ];

  readonly actions: EntityAction<EvolutionPromptFullDb>[] = [
    { key: 'rename', label: 'Rename' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this prompt and all its experiments/runs?' },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
  ];

  readonly insertSchema = evolutionPromptInsertSchema;

  detailLinks(_row: EvolutionPromptFullDb): EntityLink[] {
    return [];
  }

  // No custom actions — delete cascade handled by base class
}
