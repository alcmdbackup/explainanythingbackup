// Tests for entity subclasses: pure declaration checks (no DB mocking).
// Verifies each entity has complete declarations required by the abstract Entity class.

import { RunEntity } from './RunEntity';
import { StrategyEntity } from './StrategyEntity';
import { ExperimentEntity } from './ExperimentEntity';
import { VariantEntity } from './VariantEntity';
import { InvocationEntity } from './InvocationEntity';
import { PromptEntity } from './PromptEntity';
import { TacticEntity } from './TacticEntity';
import { METRIC_CATALOG } from '../metricCatalog';
import { METRIC_REGISTRY } from '../../metrics/registry';

describe('RunEntity', () => {
  const entity = new RunEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('run');
    expect(entity.table).toBe('evolution_runs');
  });

  it('has strategy, experiment, and prompt parents', () => {
    expect(entity.parents).toHaveLength(3);
    expect(entity.parents.map(p => p.parentType)).toEqual(['strategy', 'experiment', 'prompt']);
  });

  it('has variant and invocation children', () => {
    expect(entity.children).toHaveLength(2);
    expect(entity.children.map(c => c.childType)).toEqual(['variant', 'invocation']);
    expect(entity.children.every(c => c.cascade === 'delete')).toBe(true);
  });

  it('has 4 execution + 18 finalization + 0 propagation metrics', () => {
    // cost + generation_cost + ranking_cost + seed_cost (per-purpose split written live by createLLMClient)
    expect(entity.metrics.duringExecution).toHaveLength(4);
    // 7 ratings/match/count metrics + 11 cost-estimate-accuracy metrics (cost_estimate_accuracy_analysis_20260414).
    expect(entity.metrics.atFinalization).toHaveLength(18);
    expect(entity.metrics.atPropagation).toHaveLength(0);
  });

  it('has kill and delete actions', () => {
    const keys = entity.actions.map(a => a.key);
    expect(keys).toEqual(['cancel', 'delete']);
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

  it('has run children with delete cascade', () => {
    expect(entity.children).toHaveLength(1);
    expect(entity.children[0]!.childType).toBe('run');
    expect(entity.children[0]!.cascade).toBe('delete');
  });

  it('has 31 propagation metrics (base + cost-estimate-accuracy entries)', () => {
    // 20 base + 11 cost-estimate-accuracy (cost_estimate_accuracy_analysis_20260414).
    expect(entity.metrics.atPropagation).toHaveLength(31);
    const names = entity.metrics.atPropagation.map(d => d.name);
    expect(names).toContain('run_count');
    expect(names).toContain('total_cost');
    expect(names).toContain('avg_final_elo');
    expect(names).toContain('total_generation_cost');
    expect(names).toContain('avg_generation_cost_per_run');
    expect(names).toContain('total_ranking_cost');
    expect(names).toContain('avg_ranking_cost_per_run');
    expect(names).toContain('total_seed_cost');
    expect(names).toContain('avg_seed_cost_per_run');
    // Cost estimate accuracy
    expect(names).toContain('avg_cost_estimation_error_pct');
    expect(names).toContain('total_estimated_cost');
    expect(names).toContain('avg_agent_cost_projected');
    expect(names).toContain('avg_agent_cost_actual');
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

  it('has delete action', () => {
    expect(entity.actions).toHaveLength(1);
    expect(entity.actions[0]!.key).toBe('delete');
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

  it('has 4 finalization metrics', () => {
    expect(entity.metrics.atFinalization).toHaveLength(4);
    const names = entity.metrics.atFinalization.map(d => d.name);
    expect(names).toContain('best_variant_elo');
    expect(names).toContain('avg_variant_elo');
    expect(names).toContain('variant_count');
    expect(names).toContain('elo_delta_vs_parent');
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

  it('has experiment and run children with delete cascade', () => {
    expect(entity.children).toHaveLength(2);
    expect(entity.children.every(c => c.cascade === 'delete')).toBe(true);
  });

  it('has no metrics', () => {
    expect(entity.metrics.duringExecution).toHaveLength(0);
    expect(entity.metrics.atFinalization).toHaveLength(0);
    expect(entity.metrics.atPropagation).toHaveLength(0);
  });

  it('has rename, edit, delete actions', () => {
    const keys = entity.actions.map(a => a.key);
    expect(keys).toEqual(['rename', 'edit', 'delete']);
  });

  it('has create and edit config', () => {
    expect(entity.createConfig).toBeDefined();
    expect(entity.editConfig).toBeDefined();
  });
});

describe('TacticEntity', () => {
  const entity = new TacticEntity();

  it('has correct type and table', () => {
    expect(entity.type).toBe('tactic');
    expect(entity.table).toBe('evolution_tactics');
  });

  it('has no parents or children', () => {
    expect(entity.parents).toHaveLength(0);
    expect(entity.children).toHaveLength(0);
  });

  it('has 8 atFinalization metrics registered (Blocker 2 fix)', () => {
    expect(entity.metrics.atFinalization).toHaveLength(8);
    expect(entity.metrics.duringExecution).toHaveLength(0);
    expect(entity.metrics.atPropagation).toHaveLength(0);
  });

  it('exposes the 5 expected listView metrics for the tactics leaderboard', () => {
    const listViewNames = entity.metrics.atFinalization
      .filter((d) => d.listView)
      .map((d) => d.name)
      .sort();
    expect(listViewNames).toEqual(['avg_elo', 'avg_elo_delta', 'run_count', 'total_variants', 'win_rate']);
  });

  it('keeps non-listView metrics off the leaderboard', () => {
    const nonListView = entity.metrics.atFinalization
      .filter((d) => !d.listView)
      .map((d) => d.name)
      .sort();
    expect(nonListView).toEqual(['best_elo', 'total_cost', 'winner_count']);
  });

  it('stays in sync with METRIC_REGISTRY[tactic] (dual-registry parity)', () => {
    // Phase 1 populates TacticEntity.metrics to mirror the flat METRIC_REGISTRY['tactic']
    // defs in registry.ts. Both registries must agree on names, listView flags, and
    // formatters — verified here so dual-registry drift trips the test suite.
    const entityDefs = new Map(entity.metrics.atFinalization.map((d) => [d.name as string, d]));
    const flatDefs = new Map(METRIC_REGISTRY.tactic.atFinalization.map((d) => [d.name as string, d]));
    expect([...entityDefs.keys()].sort()).toEqual([...flatDefs.keys()].sort());
    for (const [name, def] of entityDefs) {
      const flat = flatDefs.get(name)!;
      expect(flat.listView ?? false).toBe(def.listView ?? false);
      expect(flat.formatter).toBe(def.formatter);
      expect(flat.category).toBe(def.category);
      expect(flat.label).toBe(def.label);
    }
  });

  it('has delete action (non-predefined only)', () => {
    const keys = entity.actions.map((a) => a.key);
    expect(keys).toEqual(['delete']);
    const deleteAction = entity.actions[0]!;
    expect(deleteAction.visible!({ is_predefined: true } as never)).toBe(false);
    expect(deleteAction.visible!({ is_predefined: false } as never)).toBe(true);
  });

  it('has 5 detail tabs', () => {
    const ids = entity.detailTabs.map((t) => t.id);
    expect(ids).toEqual(['overview', 'metrics', 'variants', 'runs', 'by-prompt']);
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
