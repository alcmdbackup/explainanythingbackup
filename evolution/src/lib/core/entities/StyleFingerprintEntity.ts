// Style fingerprint entity: a DB-first, user-authored description of a writer's style,
// computed over a SET of articles and injected into generation prompts + the judging
// rubric. Mirrors CriteriaEntity (DB-first, soft-delete via deleted_at, is_test_content
// auto-classified by a BEFORE trigger).
//
// IMPORTANT — soft-delete override: the base Entity.executeAction('delete') performs a
// HARD delete with child cascade, which would also ON DELETE CASCADE-wipe the article
// junction and orphan run snapshots. We override 'delete' to set deleted_at instead, so
// every dispatch path (registry or direct action) is safe.

import type { SupabaseClient } from '@supabase/supabase-js';
import { Entity } from '../Entity';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionStyleFingerprintInsertSchema, type EvolutionStyleFingerprintFullDb } from '../../schemas';

export class StyleFingerprintEntity extends Entity<EvolutionStyleFingerprintFullDb> {
  readonly type: EntityType = 'style_fingerprint';
  readonly table = 'evolution_style_fingerprints';
  readonly renameField = 'name';

  readonly editConfig = {
    fields: [
      { key: 'description', label: 'Description', type: 'textarea' as const },
    ],
    defaults: (row: EvolutionStyleFingerprintFullDb) => ({
      description: row.description,
    }),
  };

  readonly createConfig = {
    label: 'New Style Fingerprint',
    fields: [
      { key: 'name', label: 'Name', type: 'text' as const, required: true },
      { key: 'description', label: 'Description', type: 'textarea' as const },
    ],
  };

  readonly parents: ParentRelation[] = [];

  // The article-set junction is NOT an Entity child (its rows are not an EntityType with
  // their own Entity class) — it is managed by styleFingerprintActions and cleaned up by
  // the ON DELETE CASCADE FK. Keep children empty.
  readonly children: ChildRelation[] = [];

  // Mirrors METRIC_REGISTRY['style_fingerprint'] (dual-registry pattern).
  readonly metrics: EntityMetricRegistry = {
    duringExecution: [
      { name: 'total_extraction_cost', label: 'Total Extraction Cost', category: 'cost', formatter: 'cost',
        listView: true, timing: 'during_execution',
        description: 'Total cost of extraction LLM calls for this fingerprint', compute: () => 0 },
    ],
    atFinalization: [],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'description', label: 'Description', formatter: 'text' },
    { key: 'article_count', label: 'Articles', formatter: 'text' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active'] },
  ];

  readonly actions: EntityAction<EvolutionStyleFingerprintFullDb>[] = [
    { key: 'rename', label: 'Rename' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Soft-delete this style fingerprint? Strategies referencing it will fall back to no-style enforcement; historical runs keep their snapshot.' },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'articles', label: 'Articles' },
    { id: 'runs', label: 'Runs' },
    { id: 'metrics', label: 'Metrics' },
  ];

  readonly insertSchema = evolutionStyleFingerprintInsertSchema;

  detailLinks(_row: EvolutionStyleFingerprintFullDb): EntityLink[] {
    return [];
  }

  // Soft-delete override: never hard-delete (would cascade the article junction +
  // orphan run snapshots). 'rename' and any other key fall through to the base impl.
  async executeAction(
    key: string, id: string, db: SupabaseClient, payload?: Record<string, unknown>,
  ): Promise<void> {
    if (key === 'delete') {
      await db.from(this.table)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }
    return super.executeAction(key, id, db, payload);
  }
}
