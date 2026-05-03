// Invocation entity: leaf entity tracking agent execution within a run.

import { Entity } from '../Entity';
import { METRIC_CATALOG } from '../metricCatalog';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionAgentInvocationInsertSchema, type EvolutionAgentInvocationFullDb } from '../../schemas';

/** Backward-compat alias map for renamed agent_name values. Used by URL-param
 *  coercion paths so user-saved bookmarks with the V1 names continue to match
 *  rows after the rename. Per Phase 6.1.1a fix (Decisions §5 documented the
 *  rename; this map is the migration bridge for saved URLs).
 *
 *  When extending: add a new entry whenever an agent_name value is renamed.
 *  The map is many-to-one — any number of legacy aliases can resolve to a single
 *  canonical name. */
export const LEGACY_AGENT_NAME_ALIASES: Readonly<Record<string, string>> = {
  iterativeEditing: 'iterative_editing',
};

/** Normalize a single agent_name filter value, replacing any V1 alias with
 *  its V2 canonical name. Returns the input unchanged when no alias matches. */
export function normalizeLegacyAgentName(value: string): string {
  return LEGACY_AGENT_NAME_ALIASES[value] ?? value;
}
import {
  computeBestVariantElo, computeAvgVariantElo, computeInvocationVariantCount,
  computeInvocationEloDeltaVsParent,
} from '../../metrics/computations/finalizationInvocation';

export class InvocationEntity extends Entity<EvolutionAgentInvocationFullDb> {
  readonly type: EntityType = 'invocation';
  readonly table = 'evolution_agent_invocations';

  readonly parents: ParentRelation[] = [
    { parentType: 'run', foreignKey: 'run_id' },
  ];

  readonly children: ChildRelation[] = [];

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [
      { ...METRIC_CATALOG.best_variant_elo,
        compute: (ctx) => computeBestVariantElo(ctx, ctx.currentInvocationId ?? null) },
      { ...METRIC_CATALOG.avg_variant_elo,
        compute: (ctx) => computeAvgVariantElo(ctx, ctx.currentInvocationId ?? null) },
      { ...METRIC_CATALOG.variant_count, label: 'Variants Produced',
        description: 'Number of variants created by this invocation',
        compute: (ctx) => computeInvocationVariantCount(ctx, ctx.currentInvocationId ?? null) },
      { ...METRIC_CATALOG.elo_delta_vs_parent,
        compute: (ctx) => computeInvocationEloDeltaVsParent(ctx, ctx.currentInvocationId ?? null) },
    ],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'agent_name', label: 'Agent', formatter: 'text' },
    { key: 'iteration', label: 'Iteration', formatter: 'integer' },
    { key: 'success', label: 'Success', formatter: 'boolean' },
    { key: 'cost_usd', label: 'Cost', formatter: 'cost' },
    { key: 'duration_ms', label: 'Duration', formatter: 'integer' },
  ];

  readonly listFilters: FilterDef[] = [
    // B006-S3: replaced legacy phase labels (generation/ranking/evolution/reflection/...)
    // with the actual snake_case agent_name values written by V2 agents. Selecting any
    // of the old options returned 0 rows. Sorted A-Z for UI consistency.
    { field: 'agent_name', type: 'select', options: [
      'create_seed_article',
      'generate_from_previous_article',
      'iterative_editing',
      'merge_ratings',
      'reflect_and_generate_from_previous_article',
      'swiss_ranking',
    ] },
  ];

  readonly actions: EntityAction<EvolutionAgentInvocationFullDb>[] = [];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'detail', label: 'Execution Detail' },
  ];

  readonly insertSchema = evolutionAgentInvocationInsertSchema;

  detailLinks(row: EvolutionAgentInvocationFullDb): EntityLink[] {
    return [{ label: 'Run', entityType: 'run', entityId: row.run_id }];
  }
}
