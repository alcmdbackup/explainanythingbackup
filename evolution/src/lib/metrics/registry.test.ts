// Unit tests for the metric registry validation and helper functions.

import { validateRegistry, getAllMetricDefs, getListViewMetrics, getMetricDef, isValidMetricName, METRIC_REGISTRY } from './registry';

describe('validateRegistry', () => {
  it('passes for the current registry (import-time validation already ran)', () => {
    expect(() => validateRegistry()).not.toThrow();
  });
});

describe('getAllMetricDefs', () => {
  it('returns flat array from all phases for run', () => {
    const defs = getAllMetricDefs('run');
    expect(defs.length).toBeGreaterThan(0);
    const names = defs.map(d => d.name);
    expect(names).toContain('cost');
    expect(names).toContain('winner_elo');
    expect(names).toContain('variant_count');
  });
});

describe('getListViewMetrics', () => {
  it('returns only defs with listView=true', () => {
    const defs = getListViewMetrics('run');
    expect(defs.every(d => d.listView === true)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });

  it('returns metrics for strategy', () => {
    const defs = getListViewMetrics('strategy');
    const names = defs.map(d => d.name);
    expect(names).toContain('run_count');
    expect(names).toContain('total_cost');
  });
});

describe('getMetricDef', () => {
  it('finds by name', () => {
    const def = getMetricDef('run', 'cost');
    expect(def).toBeDefined();
    expect(def?.label).toBe('Total Cost');
  });

  it('returns undefined for unknown', () => {
    expect(getMetricDef('run', 'nonexistent')).toBeUndefined();
  });
});

describe('isValidMetricName', () => {
  it('returns true for static names', () => {
    expect(isValidMetricName('run', 'cost')).toBe(true);
    expect(isValidMetricName('run', 'winner_elo')).toBe(true);
  });

  it('returns true for dynamic prefixed names', () => {
    expect(isValidMetricName('run', 'agentCost:generation')).toBe(true);
    expect(isValidMetricName('run', 'agentCost:ranking')).toBe(true);
  });

  it('returns false for unknown', () => {
    expect(isValidMetricName('run', 'totally_fake_metric')).toBe(false);
  });
});

describe('registry structure', () => {
  it('strategy and experiment have identical propagation metric names', () => {
    const stratNames = METRIC_REGISTRY.strategy.atPropagation.map(d => d.name).sort();
    const expNames = METRIC_REGISTRY.experiment.atPropagation.map(d => d.name).sort();
    expect(stratNames).toEqual(expNames);
  });

  it('prompt and arena_topic have empty registries', () => {
    expect(getAllMetricDefs('prompt').length).toBe(0);
    expect(getAllMetricDefs('arena_topic').length).toBe(0);
  });
});
