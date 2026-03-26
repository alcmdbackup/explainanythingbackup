// Tests for entity subclasses: pure declaration checks (no DB mocking).
// Verifies each entity has complete declarations required by the abstract Entity class.

import { RunEntity } from './RunEntity';
import { StrategyEntity } from './StrategyEntity';
import { ExperimentEntity } from './ExperimentEntity';
import { VariantEntity } from './VariantEntity';
import { InvocationEntity } from './InvocationEntity';
import { PromptEntity } from './PromptEntity';
import { METRIC_CATALOG } from '../metricCatalog';

describe('RunEntity', () => {
  const entity = new RunEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('run');
    expect(entity.table).toBe('evolution_runs');
  });

  it('has strategy and experiment parents', () => {
    expect(entity.parents).toHaveLength(2);
    expect(entity.parents.map(p => p.parentType)).toEqual(['strategy', 'experiment']);
  });

  it('has variant and invocation children', () => {
    expect(entity.children).toHaveLength(2);
    expect(entity.children.map(c => c.childType)).toEqual(['variant', 'invocation']);
    expect(entity.children.every(c => c.cascade === 'delete')).toBe(true);
  });

  it('has 1 execution + 7 finalization + 0 propagation metrics', () => {
    expect(entity.metrics.duringExecution).toHaveLength(1);
    expect(entity.metrics.atFinalization).toHaveLength(7);
    expect(entity.metrics.atPropagation).toHaveLength(0);
  });

  it('has kill, archive, unarchive, delete actions', () => {
    const keys = entity.actions.map(a => a.key);
    expect(keys).toEqual(['cancel', 'archive', 'unarchive', 'delete']);
  });

  it('has logQueryColumn', () => {
    expect(entity.logQueryColumn).toBe('run_id');
  });

  it('generates detail links from row', () => {
    const row = { strategy_id: 's1', experiment_id: 'e1' } as any;
    const links = entity.detailLinks(row);
    expect(links).toHaveLength(2);
  });
});

describe('StrategyEntity', () => {
  const entity = new StrategyEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('strategy');
    expect(entity.table).toBe('evolution_strategies');
  });

  it('has no parents', () => {
    expect(entity.parents).toHaveLength(0);
  });

  it('has run children with restrict cascade', () => {
    expect(entity.children).toHaveLength(1);
    expect(entity.children[0]!.childType).toBe('run');
    expect(entity.children[0]!.cascade).toBe('restrict');
  });

  it('has 14 propagation metrics (same as SHARED_PROPAGATION_DEFS)', () => {
    expect(entity.metrics.atPropagation).toHaveLength(14);
    const names = entity.metrics.atPropagation.map(d => d.name);
    expect(names).toContain('run_count');
    expect(names).toContain('total_cost');
    expect(names).toContain('avg_final_elo');
  });

  it('has rename field', () => {
    expect(entity.renameField).toBe('name');
  });

  it('has create and edit config', () => {
    expect(entity.createConfig).toBeDefined();
    expect(entity.editConfig).toBeDefined();
  });
});

describe('ExperimentEntity', () => {
  const entity = new ExperimentEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('experiment');
    expect(entity.table).toBe('evolution_experiments');
  });

  it('has prompt parent', () => {
    expect(entity.parents).toHaveLength(1);
    expect(entity.parents[0]!.parentType).toBe('prompt');
  });

  it('has same propagation metrics as strategy', () => {
    const stratEntity = new StrategyEntity();
    const stratNames = stratEntity.metrics.atPropagation.map(d => d.name).sort();
    const expNames = entity.metrics.atPropagation.map(d => d.name).sort();
    expect(expNames).toEqual(stratNames);
  });

  it('has cancel action', () => {
    const keys = entity.actions.map(a => a.key);
    expect(keys).toContain('cancel');
  });
});

describe('VariantEntity', () => {
  const entity = new VariantEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('variant');
    expect(entity.table).toBe('evolution_variants');
  });

  it('has run parent', () => {
    expect(entity.parents).toHaveLength(1);
    expect(entity.parents[0]!.parentType).toBe('run');
  });

  it('has no children', () => {
    expect(entity.children).toHaveLength(0);
  });

  it('has 1 finalization metric (cost)', () => {
    expect(entity.metrics.atFinalization).toHaveLength(1);
    expect(entity.metrics.atFinalization[0]!.name).toBe('cost');
  });

  it('has no actions', () => {
    expect(entity.actions).toHaveLength(0);
  });
});

describe('InvocationEntity', () => {
  const entity = new InvocationEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('invocation');
    expect(entity.table).toBe('evolution_agent_invocations');
  });

  it('has run parent', () => {
    expect(entity.parents).toHaveLength(1);
    expect(entity.parents[0]!.parentType).toBe('run');
  });

  it('has 3 finalization metrics', () => {
    expect(entity.metrics.atFinalization).toHaveLength(3);
    const names = entity.metrics.atFinalization.map(d => d.name);
    expect(names).toContain('best_variant_elo');
    expect(names).toContain('avg_variant_elo');
    expect(names).toContain('variant_count');
  });

  it('has no actions', () => {
    expect(entity.actions).toHaveLength(0);
  });
});

describe('PromptEntity', () => {
  const entity = new PromptEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('prompt');
    expect(entity.table).toBe('evolution_prompts');
  });

  it('has no parents', () => {
    expect(entity.parents).toHaveLength(0);
  });

  it('has experiment and run children with restrict', () => {
    expect(entity.children).toHaveLength(2);
    expect(entity.children.every(c => c.cascade === 'restrict')).toBe(true);
  });

  it('has no metrics', () => {
    expect(entity.metrics.duringExecution).toHaveLength(0);
    expect(entity.metrics.atFinalization).toHaveLength(0);
    expect(entity.metrics.atPropagation).toHaveLength(0);
  });

  it('has rename, edit, archive, unarchive, delete actions', () => {
    const keys = entity.actions.map(a => a.key);
    expect(keys).toEqual(['rename', 'edit', 'archive', 'unarchive', 'delete']);
  });

  it('has create and edit config', () => {
    expect(entity.createConfig).toBeDefined();
    expect(entity.editConfig).toBeDefined();
  });
});

describe('METRIC_CATALOG cross-reference', () => {
  const catalogNames = new Set(Object.keys(METRIC_CATALOG));

  it('all entity metric names reference valid catalog entries', () => {
    const runEntity = new RunEntity();
    for (const def of [...runEntity.metrics.duringExecution, ...runEntity.metrics.atFinalization]) {
      expect(catalogNames).toContain(def.name);
    }

    const invocationEntity = new InvocationEntity();
    for (const def of [...invocationEntity.metrics.duringExecution, ...invocationEntity.metrics.atFinalization]) {
      expect(catalogNames).toContain(def.name);
    }

    const variantEntity = new VariantEntity();
    for (const def of [...variantEntity.metrics.duringExecution, ...variantEntity.metrics.atFinalization]) {
      expect(catalogNames).toContain(def.name);
    }

    const strategyEntity = new StrategyEntity();
    for (const def of strategyEntity.metrics.atPropagation) {
      expect(catalogNames).toContain(def.name);
    }

    const experimentEntity = new ExperimentEntity();
    for (const def of experimentEntity.metrics.atPropagation) {
      expect(catalogNames).toContain(def.name);
    }
  });
});

describe('InvocationEntity with agent metrics (via registry)', () => {
  it('has agent-contributed metrics when initialized through registry', () => {
    const { getEntity, _resetRegistryForTesting } = require('../../core/entityRegistry');
    _resetRegistryForTesting();
    const entity = getEntity('invocation');
    const names = entity.metrics.atFinalization.map((d: { name: string }) => d.name);
    // Base 3 + agent-contributed: format_rejection_rate, total_comparisons
    expect(names).toContain('best_variant_elo');
    expect(names).toContain('format_rejection_rate');
    expect(names).toContain('total_comparisons');
    expect(entity.metrics.atFinalization.length).toBeGreaterThanOrEqual(5);
    _resetRegistryForTesting();
  });
});

describe('DETAIL_VIEW_CONFIGS sync with agent classes', () => {
  it('every agent detailViewConfig matches its DETAIL_VIEW_CONFIGS entry', () => {
    const { getAgentClasses } = require('../../core/agentRegistry');
    const { DETAIL_VIEW_CONFIGS } = require('../../core/detailViewConfigs');
    const agents = getAgentClasses();
    for (const agent of agents) {
      const config = DETAIL_VIEW_CONFIGS[agent.name];
      expect(config).toBeDefined();
      expect(agent.detailViewConfig).toEqual(config);
    }
  });
});

describe('entity registry integration', () => {
  it('strategy and experiment have identical propagation metric names', () => {
    const stratEntity = new StrategyEntity();
    const expEntity = new ExperimentEntity();
    const stratNames = stratEntity.metrics.atPropagation.map(d => d.name).sort();
    const expNames = expEntity.metrics.atPropagation.map(d => d.name).sort();
    expect(stratNames).toEqual(expNames);
  });

  it('all propagation metrics source from run', () => {
    const stratEntity = new StrategyEntity();
    for (const def of stratEntity.metrics.atPropagation) {
      expect(def.sourceEntity).toBe('run');
    }
  });
});
