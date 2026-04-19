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

// cost_estimate_accuracy_analysis_20260414: assert new metric defs are registered
// and that propagated entries reference valid run-level source metrics. The
// registry's load-time validateRegistry() catches broken sourceMetric references
// generally; this block makes the new metric set explicit so future drift is caught
// at this test rather than at load time.
describe('cost-estimate-accuracy registry entries', () => {
  const NEW_RUN_METRICS = [
    'cost_estimation_error_pct',
    'estimated_cost',
    'estimation_abs_error_usd',
    'generation_estimation_error_pct',
    'ranking_estimation_error_pct',
    'agent_cost_projected',
    'agent_cost_actual',
    'parallel_dispatched',
    'sequential_dispatched',
    'median_sequential_gfsa_duration_ms',
    'avg_sequential_gfsa_duration_ms',
  ];

  const NEW_PROPAGATED_METRICS = [
    'avg_cost_estimation_error_pct',
    'avg_generation_estimation_error_pct',
    'avg_ranking_estimation_error_pct',
    'avg_estimation_abs_error_usd',
    'total_estimated_cost',
    'avg_estimated_cost',
    'avg_agent_cost_projected',
    'avg_agent_cost_actual',
    'avg_parallel_dispatched',
    'avg_sequential_dispatched',
    'avg_median_sequential_gfsa_duration_ms',
  ];

  it.each(NEW_RUN_METRICS)('run.atFinalization includes %s', (name) => {
    const def = getEntityMetricDef('run', name);
    expect(def).toBeDefined();
    expect(def?.category === 'cost' || def?.category === 'count').toBe(true);
  });

  it.each(NEW_PROPAGATED_METRICS)('strategy.atPropagation includes %s', (name) => {
    const def = getEntityMetricDef('strategy', name);
    expect(def).toBeDefined();
  });

  it.each(NEW_PROPAGATED_METRICS)('experiment.atPropagation includes %s', (name) => {
    const def = getEntityMetricDef('experiment', name);
    expect(def).toBeDefined();
  });

  it('all propagated cost-estimate metrics reference valid run sources (load-time validateRegistry guards this in production)', () => {
    const runNames = new Set(getAllEntityMetricDefs('run').map((d) => d.name));
    const stratPropagated = getEntity('strategy').metrics.atPropagation;
    for (const name of NEW_PROPAGATED_METRICS) {
      const def = stratPropagated.find((d) => d.name === name);
      expect(def).toBeDefined();
      if (def && 'sourceMetric' in def) {
        expect(runNames.has(def.sourceMetric)).toBe(true);
      }
    }
  });
});
