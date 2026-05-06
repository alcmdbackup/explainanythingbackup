// Criteria entity: user-defined evaluation criteria used by the
// EvaluateCriteriaThenGenerateFromPreviousArticleAgent. DB-first user-defined
// (NOT code-first like Tactic). Soft-delete via deleted_at; rubric JSONB column
// (evaluation_guidance) of {score, description} anchor pairs.

import { Entity } from '../Entity';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import { evolutionCriteriaInsertSchema, type EvolutionCriteriaFullDb } from '../../schemas';

export class CriteriaEntity extends Entity<EvolutionCriteriaFullDb> {
  readonly type: EntityType = 'criteria';
  readonly table = 'evolution_criteria';
  readonly renameField = 'name';

  readonly editConfig = {
    fields: [
      { key: 'description', label: 'Description', type: 'textarea' as const },
      { key: 'min_rating', label: 'Min Rating', type: 'number' as const, required: true },
      { key: 'max_rating', label: 'Max Rating', type: 'number' as const, required: true },
      // evaluation_guidance is rendered by a custom RubricEditor component (Phase 1H).
      { key: 'evaluation_guidance', label: 'Evaluation Guidance', type: 'rubric' as const },
    ],
    defaults: (row: EvolutionCriteriaFullDb) => ({
      description: row.description,
      min_rating: row.min_rating,
      max_rating: row.max_rating,
      evaluation_guidance: row.evaluation_guidance,
    }),
  };

  readonly createConfig = {
    label: 'New Criteria',
    fields: [
      { key: 'name', label: 'Name', type: 'text' as const, required: true },
      { key: 'description', label: 'Description', type: 'textarea' as const },
      { key: 'min_rating', label: 'Min Rating', type: 'number' as const, required: true },
      { key: 'max_rating', label: 'Max Rating', type: 'number' as const, required: true },
      { key: 'evaluation_guidance', label: 'Evaluation Guidance', type: 'rubric' as const },
    ],
  };

  readonly parents: ParentRelation[] = [];

  // No DB-FK children — variants reference criteria via UUID arrays
  // (criteria_set_used / weakest_criteria_ids) without FK enforcement, so
  // soft-delete preserves referential integrity at the application layer.
  readonly children: ChildRelation[] = [];

  // Mirrors METRIC_REGISTRY['criteria'] (kept in sync per dual-registry pattern).
  // 5 metrics computed externally by computeCriteriaMetricsForRun (Phase 1G).
  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [
      { name: 'avg_score', label: 'Avg Score', category: 'rating', formatter: 'integer', listView: true,
        timing: 'at_finalization', description: 'Mean LLM score for this criterion across runs that included it', compute: () => null },
      { name: 'frequency_as_weakest', label: 'Frequency as Weakest', category: 'rating', formatter: 'percent', listView: true,
        timing: 'at_finalization', description: 'Fraction of variants where this criterion was in weakest_criteria_ids', compute: () => null },
      { name: 'total_variants_focused', label: 'Variants Focused', category: 'count', formatter: 'integer', listView: true,
        timing: 'at_finalization', description: 'Total variants that focused on this criterion', compute: () => null },
      { name: 'avg_elo_delta_when_focused', label: 'Δ Elo Focused', category: 'rating', formatter: 'elo', listView: true,
        timing: 'at_finalization', description: 'Mean child.elo - parent.elo across variants where this criterion was the focus', compute: () => null },
      { name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer', listView: true,
        timing: 'at_finalization', description: 'Distinct completed runs that referenced this criterion', compute: () => null },
    ],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'description', label: 'Description', formatter: 'text' },
    { key: 'min_rating', label: 'Min', formatter: 'text' },
    { key: 'max_rating', label: 'Max', formatter: 'text' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active'] },
  ];

  readonly actions: EntityAction<EvolutionCriteriaFullDb>[] = [
    { key: 'rename', label: 'Rename' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Soft-delete this criteria? Existing variants that reference it will continue to render but the criteria will be hidden from new strategy configurations.' },
  ];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'variants', label: 'Variants' },
    { id: 'runs', label: 'Runs' },
    { id: 'by-prompt', label: 'By Prompt' },
  ];

  readonly insertSchema = evolutionCriteriaInsertSchema;

  detailLinks(_row: EvolutionCriteriaFullDb): EntityLink[] {
    return [];
  }
}
