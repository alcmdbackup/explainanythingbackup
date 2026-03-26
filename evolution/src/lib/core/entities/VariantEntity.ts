// Variant entity: leaf entity with parent run, no children, single finalization metric (cost).

import type { SupabaseClient } from '@supabase/supabase-js';
import { Entity } from '../Entity';
import { METRIC_CATALOG } from '../metricCatalog';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionVariantInsertSchema, type EvolutionVariantFullDb } from '../../schemas';

export class VariantEntity extends Entity<EvolutionVariantFullDb> {
  readonly type: EntityType = 'variant';
  readonly table = 'evolution_variants';

  readonly parents: ParentRelation[] = [
    { parentType: 'run', foreignKey: 'run_id' },
  ];

  readonly children: ChildRelation[] = [];

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [
      { ...METRIC_CATALOG.cost, name: 'cost', label: 'Generation Cost', formatter: 'costDetailed',
        timing: 'at_finalization',
        description: 'Cost to generate this variant',
        compute: (ctx) => ctx.currentVariantCost ?? null },
    ],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'variant_content', label: 'Content', formatter: 'text' },
    { key: 'elo_score', label: 'Elo', formatter: 'integer', sortable: true },
    { key: 'generation_method', label: 'Method', formatter: 'text' },
    { key: 'is_winner', label: 'Winner', formatter: 'boolean' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'is_winner', type: 'toggle', label: 'Winners only' },
  ];

  readonly actions: EntityAction<EvolutionVariantFullDb>[] = [
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this variant?' },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'content', label: 'Content' },
  ];

  readonly insertSchema = evolutionVariantInsertSchema;

  detailLinks(row: EvolutionVariantFullDb): EntityLink[] {
    return [{ label: 'Run', entityType: 'run', entityId: row.run_id }];
  }

  async executeAction(
    key: string, id: string, db: SupabaseClient, payload?: Record<string, unknown>,
  ): Promise<void> {
    if (key === 'delete') {
      // Clean up arena comparisons referencing this variant (not a registered entity)
      await db.from('evolution_arena_comparisons').delete().or(`entry_a.eq.${id},entry_b.eq.${id}`);
    }
    return super.executeAction(key, id, db, payload);
  }
}
