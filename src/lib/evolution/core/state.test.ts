// Unit tests for PipelineStateImpl.
// Verifies pool management, Elo initialization, serialization round-trip.

import { PipelineStateImpl, serializeState, deserializeState } from './state';
import type { TextVariation } from '../types';
import { ELO_CONSTANTS } from '../config';

function makeVariation(id: string, strategy = 'test'): TextVariation {
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

describe('PipelineStateImpl', () => {
  describe('addToPool', () => {
    it('adds variant and initializes Elo', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      expect(state.pool).toHaveLength(1);
      expect(state.poolIds.has('v1')).toBe(true);
      expect(state.eloRatings.get('v1')).toBe(ELO_CONSTANTS.INITIAL_RATING);
      expect(state.matchCounts.get('v1')).toBe(0);
    });

    it('tracks new entrants', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v2'));
      expect(state.newEntrantsThisIteration).toEqual(['v1', 'v2']);
    });

    it('ignores duplicate ids', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v1'));
      expect(state.pool).toHaveLength(1);
    });

    it('does not overwrite existing Elo rating', () => {
      const state = new PipelineStateImpl('original');
      state.eloRatings.set('v1', 1500);
      state.matchCounts.set('v1', 10);
      state.addToPool(makeVariation('v1'));
      expect(state.eloRatings.get('v1')).toBe(1500);
      expect(state.matchCounts.get('v1')).toBe(10);
    });
  });

  describe('startNewIteration', () => {
    it('increments iteration and clears new entrants', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      expect(state.iteration).toBe(0);
      state.startNewIteration();
      expect(state.iteration).toBe(1);
      expect(state.newEntrantsThisIteration).toEqual([]);
    });
  });

  describe('getTopByElo', () => {
    it('returns top N by Elo descending', () => {
      const state = new PipelineStateImpl('original');
      state.addToPool(makeVariation('v1'));
      state.addToPool(makeVariation('v2'));
      state.addToPool(makeVariation('v3'));
      state.eloRatings.set('v1', 1100);
      state.eloRatings.set('v2', 1300);
      state.eloRatings.set('v3', 1200);
      const top = state.getTopByElo(2);
      expect(top.map((v) => v.id)).toEqual(['v2', 'v3']);
    });

    it('returns pool slice when no Elo ratings', () => {
      const state = new PipelineStateImpl('original');
      state.pool.push(makeVariation('v1'), makeVariation('v2'));
      state.eloRatings.clear();
      const top = state.getTopByElo(1);
      expect(top).toHaveLength(1);
      expect(top[0].id).toBe('v1');
    });

    it('handles empty pool', () => {
      const state = new PipelineStateImpl('original');
      expect(state.getTopByElo(5)).toEqual([]);
    });
  });

  describe('getPoolSize', () => {
    it('returns pool length', () => {
      const state = new PipelineStateImpl('original');
      expect(state.getPoolSize()).toBe(0);
      state.addToPool(makeVariation('v1'));
      expect(state.getPoolSize()).toBe(1);
    });
  });
});

describe('serializeState / deserializeState', () => {
  it('round-trips state correctly', () => {
    const state = new PipelineStateImpl('hello world');
    state.addToPool(makeVariation('v1', 'structural'));
    state.addToPool(makeVariation('v2', 'lexical'));
    state.eloRatings.set('v1', 1250);
    state.eloRatings.set('v2', 1150);
    state.matchCounts.set('v1', 3);
    state.matchCounts.set('v2', 3);
    state.iteration = 2;
    state.matchHistory = [
      { variationA: 'v1', variationB: 'v2', winner: 'v1', confidence: 0.8, turns: 1, dimensionScores: {} },
    ];

    const serialized = serializeState(state);
    const restored = deserializeState(serialized);

    expect(restored.originalText).toBe('hello world');
    expect(restored.iteration).toBe(2);
    expect(restored.pool).toHaveLength(2);
    expect(restored.poolIds.size).toBe(2);
    expect(restored.eloRatings.get('v1')).toBe(1250);
    expect(restored.matchCounts.get('v1')).toBe(3);
    expect(restored.matchHistory).toHaveLength(1);
    expect(restored.debateTranscripts).toEqual([]);
  });

  it('round-trips debateTranscripts', () => {
    const state = new PipelineStateImpl('test');
    state.debateTranscripts = [{
      variantAId: 'v1',
      variantBId: 'v2',
      turns: [{ role: 'advocate_a', content: 'A is better' }],
      synthesisVariantId: 'v3',
      iteration: 1,
    }];

    const serialized = serializeState(state);
    expect(serialized.debateTranscripts).toHaveLength(1);

    const restored = deserializeState(serialized);
    expect(restored.debateTranscripts).toHaveLength(1);
    expect(restored.debateTranscripts[0].variantAId).toBe('v1');
    expect(restored.debateTranscripts[0].turns[0].role).toBe('advocate_a');
  });

  it('deserializes missing debateTranscripts as empty array', () => {
    const snapshot = serializeState(new PipelineStateImpl('test'));
    // Simulate old checkpoint without debateTranscripts
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy.debateTranscripts;
    const restored = deserializeState(legacy as never);
    expect(restored.debateTranscripts).toEqual([]);
  });
});
