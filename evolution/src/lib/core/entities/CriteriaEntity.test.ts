// Tests for CriteriaEntity declarations: 5 metrics with correct listView flags,
// insertSchema present, actions = rename/edit/delete, detailTabs match Tactic.

import { CriteriaEntity } from './CriteriaEntity';
import { evolutionCriteriaInsertSchema } from '../../schemas';

describe('CriteriaEntity', () => {
  const entity = new CriteriaEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('criteria');
    expect(entity.table).toBe('evolution_criteria');
    expect(entity.renameField).toBe('name');
  });

  it('has 5 finalization metrics, no execution or propagation', () => {
    expect(entity.metrics.duringExecution).toHaveLength(0);
    expect(entity.metrics.atFinalization).toHaveLength(5);
    expect(entity.metrics.atPropagation).toHaveLength(0);
  });

  it('all 5 finalization metrics declare listView: true', () => {
    for (const m of entity.metrics.atFinalization) {
      expect(m.listView).toBe(true);
    }
  });

  it('finalization metric names match registry shape', () => {
    const names = entity.metrics.atFinalization.map((m) => m.name).sort();
    expect(names).toEqual([
      'avg_elo_delta_when_focused',
      'avg_score',
      'frequency_as_weakest',
      'run_count',
      'total_variants_focused',
    ]);
  });

  it('actions = rename, edit, delete', () => {
    expect(entity.actions.map((a) => a.key)).toEqual(['rename', 'edit', 'delete']);
    const deleteAction = entity.actions.find((a) => a.key === 'delete');
    expect(deleteAction?.danger).toBe(true);
    expect(deleteAction?.confirm).toContain('Soft-delete');
  });

  it('detailTabs match Tactic shape (Overview, Metrics, Variants, Runs, By Prompt)', () => {
    const tabIds = entity.detailTabs.map((t) => t.id);
    expect(tabIds).toEqual(['overview', 'metrics', 'variants', 'runs', 'by-prompt']);
  });

  it('insertSchema is the criteria insert schema', () => {
    expect(entity.insertSchema).toBe(evolutionCriteriaInsertSchema);
  });

  it('createConfig has 5 fields with correct keys', () => {
    expect(entity.createConfig.fields.map((f) => f.key)).toEqual([
      'name', 'description', 'min_rating', 'max_rating', 'evaluation_guidance',
    ]);
  });

  it('editConfig omits name, exposes 4 fields including rubric', () => {
    expect(entity.editConfig.fields.map((f) => f.key)).toEqual([
      'description', 'min_rating', 'max_rating', 'evaluation_guidance',
    ]);
    const rubric = entity.editConfig.fields.find((f) => f.key === 'evaluation_guidance');
    expect(rubric?.type).toBe('rubric');
  });

  it('parents and children are empty (no FK relations)', () => {
    expect(entity.parents).toHaveLength(0);
    expect(entity.children).toHaveLength(0);
  });

  it('detailLinks returns empty array', () => {
    expect(entity.detailLinks({} as never)).toEqual([]);
  });
});
