// Unit tests for the entity registry validation and helper functions.
// Replaces old METRIC_REGISTRY tests — now tests entity registry equivalents.

import {
  validateEntityRegistry, getAllEntityMetricDefs, getEntityListViewMetrics,
  getEntityMetricDef, isValidEntityMetricName, getEntity,
} from '../core/entityRegistry';

describe('validateEntityRegistry', () => {
  it('passes for the current registry (lazy-init validation)', () => {
    // Force initialization by calling getEntity
    getEntity('run');
    expect(() => validateEntityRegistry()).not.toThrow();
  });
});

describe('getAllEntityMetricDefs', () => {
  it('returns flat array from all phases for run', () => {
    const defs = getAllEntityMetricDefs('run');
    expect(defs.length).toBeGreaterThan(0);
    const names = defs.map(d => d.name);
    expect(names).toContain('cost');
    expect(names).toContain('winner_elo');
    expect(names).toContain('variant_count');
  });
});

describe('getEntityListViewMetrics', () => {
  it('returns only defs with listView=true', () => {
    const defs = getEntityListViewMetrics('run');
    expect(defs.every(d => d.listView === true)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });

  it('includes generation_cost / ranking_cost in run list view; cost shown via RunsTable base column with budget warning', () => {
    const names = getEntityListViewMetrics('run').map(d => d.name);
    expect(names).not.toContain('cost'); // shown via RunsTable base column, not via createMetricColumns
    expect(names).toContain('generation_cost');
    expect(names).toContain('ranking_cost');
  });

  it('returns metrics for strategy', () => {
    const defs = getEntityListViewMetrics('strategy');
    const names = defs.map(d => d.name);
    expect(names).toContain('run_count');
    expect(names).toContain('total_cost');
  });
});

describe('getEntityMetricDef', () => {
  it('finds by name', () => {
    const def = getEntityMetricDef('run', 'cost');
    expect(def).toBeDefined();
    expect(def?.label).toBe('Cost');
  });

  it('returns undefined for unknown', () => {
    expect(getEntityMetricDef('run', 'nonexistent')).toBeUndefined();
  });
});

describe('isValidEntityMetricName', () => {
  it('returns true for static names', () => {
    expect(isValidEntityMetricName('run', 'cost')).toBe(true);
    expect(isValidEntityMetricName('run', 'winner_elo')).toBe(true);
  });

  it('returns true for dynamic prefixed names', () => {
    expect(isValidEntityMetricName('run', 'agentCost:generation')).toBe(true);
    expect(isValidEntityMetricName('run', 'agentCost:ranking')).toBe(true);
  });

  it('returns false for unknown', () => {
    expect(isValidEntityMetricName('run', 'totally_fake_metric')).toBe(false);
  });
});

describe('entity registry structure', () => {
  it('strategy and experiment have identical propagation metric names', () => {
    const stratNames = getEntity('strategy').metrics.atPropagation.map(d => d.name).sort();
    const expNames = getEntity('experiment').metrics.atPropagation.map(d => d.name).sort();
    expect(stratNames).toEqual(expNames);
  });

  it('prompt has empty metrics', () => {
    expect(getAllEntityMetricDefs('prompt').length).toBe(0);
  });
});
