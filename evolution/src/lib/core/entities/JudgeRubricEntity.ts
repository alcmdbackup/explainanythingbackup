// JudgeRubricEntity: thin DB entity for judge-rubric identity. A judge rubric is a
// reusable named bundle of judging dimensions (criteria refs + weights) used by
// rubric-based pairwise judging; the dimensions live in the
// evolution_judge_rubric_dimensions junction. CRUD goes through judgeRubricActions
// (self-managed admin page), so this entity carries no metrics and a minimal tab set.

import { Entity } from '../Entity';
import type {
  ParentRelation, ChildRelation, EntityAction, ColumnDef, FilterDef,
  TabDef, EntityLink, EntityMetricRegistry, EntityType,
} from '../types';
import type { EvolutionJudgeRubricRow } from '../../schemas';

export class JudgeRubricEntity extends Entity<EvolutionJudgeRubricRow> {
  readonly type: EntityType = 'judge_rubric';
  readonly table = 'evolution_judge_rubrics';
  readonly insertSchema = undefined;

  readonly parents: ParentRelation[] = [];
  readonly children: ChildRelation[] = [];

  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [],
  };

  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'description', label: 'Description', formatter: 'text' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
  ];

  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active', 'archived'] },
  ];

  // Delete/edit are handled by the self-managed admin page via judgeRubricActions
  // (so the referenced-strategy delete gate is enforced); no generic dispatcher actions.
  readonly actions: EntityAction<EvolutionJudgeRubricRow>[] = [];

  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
  ];

  detailLinks(_row: EvolutionJudgeRubricRow): EntityLink[] {
    return [];
  }
}
