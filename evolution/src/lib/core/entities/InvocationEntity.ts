// Invocation entity: leaf entity tracking agent execution within a run.

import { Entity } from '../Entity';
import { METRIC_CATALOG } from '../metricCatalog';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionAgentInvocationInsertSchema, type EvolutionAgentInvocationFullDb } from '../../schemas';
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
    { field: 'agent_name', type: 'select', options: [
      'generation', 'ranking', 'evolution', 'reflection', 'iterativeEditing',
      'treeSearch', 'sectionDecomposition', 'debate', 'proximity', 'metaReview',
      'outlineGeneration', 'flowCritique',
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
