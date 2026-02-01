// Unit tests for PoolManager, focused on baseline filtering in getEvolutionParents.
// Verifies that the original_baseline variant is excluded from evolution parent selection.

import { PoolManager } from './pool';
import { PipelineStateImpl } from './state';
import { BASELINE_STRATEGY } from '../types';
import type { TextVariation } from '../types';

function makeVariation(id: string, strategy: string, elo?: number): TextVariation {
  return {
    id,
    text: `content-${id}`,
    version: 1,
    parentIds: [],
    strategy,
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  };
}

function makeStateWithBaseline(): PipelineStateImpl {
  const state = new PipelineStateImpl('Original text');
  // Add baseline
  state.addToPool({
    id: 'baseline-run-1',
    text: 'Original text',
    version: 0,
    parentIds: [],
    strategy: BASELINE_STRATEGY,
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  });
  return state;
}

describe('PoolManager.getEvolutionParents', () => {
  it('excludes baseline even when baseline has highest Elo', () => {
    const state = makeStateWithBaseline();
    state.addToPool(makeVariation('v1', 'structural_transform'));
    state.addToPool(makeVariation('v2', 'lexical_simplify'));

    // Baseline has highest Elo
    state.eloRatings.set('baseline-run-1', 1500);
    state.eloRatings.set('v1', 1300);
    state.eloRatings.set('v2', 1200);

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);

    expect(parents).toHaveLength(2);
    expect(parents.map((p) => p.id)).toEqual(['v1', 'v2']);
    expect(parents.every((p) => p.strategy !== BASELINE_STRATEGY)).toBe(true);
  });

  it('returns fewer than n if not enough non-baseline variants', () => {
    const state = makeStateWithBaseline();
    state.addToPool(makeVariation('v1', 'structural_transform'));

    state.eloRatings.set('baseline-run-1', 1500);
    state.eloRatings.set('v1', 1300);

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);

    // Only 1 non-baseline variant available
    expect(parents).toHaveLength(1);
    expect(parents[0].id).toBe('v1');
  });

  it('returns empty array when pool contains only baseline', () => {
    const state = makeStateWithBaseline();
    state.eloRatings.set('baseline-run-1', 1500);

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);

    expect(parents).toHaveLength(0);
  });

  it('respects Elo ordering among non-baseline variants', () => {
    const state = makeStateWithBaseline();
    state.addToPool(makeVariation('v1', 'structural_transform'));
    state.addToPool(makeVariation('v2', 'lexical_simplify'));
    state.addToPool(makeVariation('v3', 'crossover'));

    state.eloRatings.set('baseline-run-1', 1400);
    state.eloRatings.set('v1', 1100);
    state.eloRatings.set('v2', 1350);
    state.eloRatings.set('v3', 1250);

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);

    // v2 (1350) and v3 (1250) are top 2 non-baseline
    expect(parents.map((p) => p.id)).toEqual(['v2', 'v3']);
  });

  it('works correctly without baseline in pool', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool(makeVariation('v1', 'structural_transform'));
    state.addToPool(makeVariation('v2', 'lexical_simplify'));

    state.eloRatings.set('v1', 1300);
    state.eloRatings.set('v2', 1200);

    const pool = new PoolManager(state);
    const parents = pool.getEvolutionParents(2);

    expect(parents).toHaveLength(2);
    expect(parents.map((p) => p.id)).toEqual(['v1', 'v2']);
  });
});
