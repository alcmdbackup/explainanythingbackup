// Unit tests for the pipeline state reducer.
// Verifies each action type produces correct state and that state is immutable across actions.

import { applyAction, applyActions } from './reducer';
import { PipelineStateImpl, serializeState, deserializeState } from './state';
import type { PipelineAction } from './actions';
import type { TextVariation, Match, Critique, MetaFeedback } from '../types';

function makeVariation(id: string, iterationBorn = 0): TextVariation {
  return { id, text: `text-${id}`, version: 1, parentIds: [], strategy: 'test', createdAt: Date.now() / 1000, iterationBorn };
}

function makeMatch(a: string, b: string): Match {
  return { variationA: a, variationB: b, winner: a, confidence: 0.8, turns: 1, dimensionScores: {} };
}

function makeCritique(varId: string): Critique {
  return { variationId: varId, dimensionScores: { clarity: 7 }, goodExamples: {}, badExamples: {}, notes: {}, reviewer: 'llm' };
}

function makeState(): PipelineStateImpl {
  const s = new PipelineStateImpl('original text');
  s.addToPool(makeVariation('v1'));
  s.addToPool(makeVariation('v2'));
  return s;
}

describe('applyAction', () => {
  describe('ADD_TO_POOL', () => {
    it('adds variants with default ratings', () => {
      const state = new PipelineStateImpl('text');
      const next = applyAction(state, { type: 'ADD_TO_POOL', variants: [makeVariation('v1')] });
      expect(next.pool).toHaveLength(1);
      expect(next.poolIds.has('v1')).toBe(true);
      expect(next.ratings.get('v1')!.mu).toBeCloseTo(25, 0);
      expect(next.matchCounts.get('v1')).toBe(0);
      expect(next.newEntrantsThisIteration).toContain('v1');
    });

    it('adds variants with preset ratings', () => {
      const state = new PipelineStateImpl('text');
      const next = applyAction(state, {
        type: 'ADD_TO_POOL',
        variants: [makeVariation('v1')],
        presetRatings: { v1: { mu: 30, sigma: 5 } },
      });
      expect(next.ratings.get('v1')).toEqual({ mu: 30, sigma: 5 });
    });

    it('skips duplicate variants', () => {
      const state = makeState();
      const next = applyAction(state, { type: 'ADD_TO_POOL', variants: [makeVariation('v1'), makeVariation('v3')] });
      expect(next.pool).toHaveLength(3);
    });

    it('does not mutate original state', () => {
      const state = new PipelineStateImpl('text');
      const next = applyAction(state, { type: 'ADD_TO_POOL', variants: [makeVariation('v1')] });
      expect(state.pool).toHaveLength(0);
      expect(next.pool).toHaveLength(1);
    });
  });

  describe('START_NEW_ITERATION', () => {
    it('increments iteration and clears newEntrants', () => {
      const state = makeState();
      expect(state.newEntrantsThisIteration.length).toBeGreaterThan(0);
      const next = applyAction(state, { type: 'START_NEW_ITERATION' });
      expect(next.iteration).toBe(1);
      expect(next.newEntrantsThisIteration).toEqual([]);
      expect(state.iteration).toBe(0); // original unchanged
    });
  });

  describe('RECORD_MATCHES', () => {
    it('appends matches and applies rating updates', () => {
      const state = makeState();
      const next = applyAction(state, {
        type: 'RECORD_MATCHES',
        matches: [makeMatch('v1', 'v2')],
        ratingUpdates: { v1: { mu: 27, sigma: 7 }, v2: { mu: 23, sigma: 7 } },
        matchCountIncrements: { v1: 1, v2: 1 },
      });
      expect(next.matchHistory).toHaveLength(1);
      expect(next.ratings.get('v1')!.mu).toBe(27);
      expect(next.ratings.get('v2')!.mu).toBe(23);
      expect(next.matchCounts.get('v1')).toBe(1);
      expect(next.matchCounts.get('v2')).toBe(1);
      // Original state unchanged
      expect(state.matchHistory).toHaveLength(0);
    });

    it('accumulates match counts', () => {
      const state = makeState();
      state.matchCounts.set('v1', 5);
      const next = applyAction(state, {
        type: 'RECORD_MATCHES',
        matches: [],
        ratingUpdates: {},
        matchCountIncrements: { v1: 3 },
      });
      expect(next.matchCounts.get('v1')).toBe(8);
    });
  });

  describe('APPEND_CRITIQUES', () => {
    it('appends critiques and updates dimension scores', () => {
      const state = makeState();
      const next = applyAction(state, {
        type: 'APPEND_CRITIQUES',
        critiques: [makeCritique('v1')],
        dimensionScoreUpdates: { v1: { clarity: 7, flow: 6 } },
      });
      expect(next.allCritiques).toHaveLength(1);
      expect(next.dimensionScores!.v1.clarity).toBe(7);
      expect(state.allCritiques).toBeNull(); // original unchanged
    });

    it('merges into existing dimension scores', () => {
      const state = makeState();
      state.dimensionScores = { v1: { accuracy: 8 } };
      const next = applyAction(state, {
        type: 'APPEND_CRITIQUES',
        critiques: [makeCritique('v1')],
        dimensionScoreUpdates: { v1: { clarity: 7 } },
      });
      expect(next.dimensionScores!.v1).toEqual({ accuracy: 8, clarity: 7 });
    });
  });

  describe('MERGE_FLOW_SCORES', () => {
    it('merges flow scores into dimensionScores', () => {
      const state = makeState();
      const next = applyAction(state, {
        type: 'MERGE_FLOW_SCORES',
        variantScores: { v1: { 'flow:readability': 4, 'flow:coherence': 3 } },
      });
      expect(next.dimensionScores!.v1['flow:readability']).toBe(4);
    });
  });

  describe('SET_DIVERSITY_SCORE', () => {
    it('sets diversity score', () => {
      const state = makeState();
      const next = applyAction(state, { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.75 });
      expect(next.diversityScore).toBe(0.75);
      expect(state.diversityScore).toBeNull();
    });
  });

  describe('SET_META_FEEDBACK', () => {
    it('sets meta feedback', () => {
      const state = makeState();
      const feedback: MetaFeedback = {
        recurringWeaknesses: ['weak'],
        priorityImprovements: ['improve'],
        successfulStrategies: ['good'],
        patternsToAvoid: ['bad'],
      };
      const next = applyAction(state, { type: 'SET_META_FEEDBACK', feedback });
      expect(next.metaFeedback).toEqual(feedback);
      expect(state.metaFeedback).toBeNull();
    });
  });

  describe('UPDATE_ARENA_SYNC_INDEX', () => {
    it('updates lastSyncedMatchIndex', () => {
      const state = makeState();
      const next = applyAction(state, { type: 'UPDATE_ARENA_SYNC_INDEX', lastSyncedMatchIndex: 42 });
      expect(next.lastSyncedMatchIndex).toBe(42);
      expect(state.lastSyncedMatchIndex).toBe(0);
    });
  });
});

describe('applyActions', () => {
  it('applies multiple actions in sequence', () => {
    const state = new PipelineStateImpl('text');
    const actions: PipelineAction[] = [
      { type: 'ADD_TO_POOL', variants: [makeVariation('v1'), makeVariation('v2')] },
      { type: 'RECORD_MATCHES', matches: [makeMatch('v1', 'v2')], ratingUpdates: { v1: { mu: 27, sigma: 7 } }, matchCountIncrements: { v1: 1 } },
      { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.8 },
    ];
    const next = applyActions(state, actions);
    expect(next.pool).toHaveLength(2);
    expect(next.matchHistory).toHaveLength(1);
    expect(next.diversityScore).toBe(0.8);
  });

  it('returns original state for empty actions', () => {
    const state = makeState();
    const next = applyActions(state, []);
    expect(next).toBe(state);
  });
});

describe('serialize/deserialize roundtrip', () => {
  it('roundtrips state after actions', () => {
    const state = new PipelineStateImpl('original');
    const afterActions = applyActions(state, [
      { type: 'ADD_TO_POOL', variants: [makeVariation('v1'), makeVariation('v2')] },
      { type: 'START_NEW_ITERATION' },
      { type: 'RECORD_MATCHES', matches: [makeMatch('v1', 'v2')], ratingUpdates: { v1: { mu: 27, sigma: 7 }, v2: { mu: 23, sigma: 7 } }, matchCountIncrements: { v1: 1, v2: 1 } },
      { type: 'APPEND_CRITIQUES', critiques: [makeCritique('v1')], dimensionScoreUpdates: { v1: { clarity: 7 } } },
      { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.6 },
      { type: 'SET_META_FEEDBACK', feedback: { recurringWeaknesses: ['w'], priorityImprovements: ['p'], successfulStrategies: ['s'], patternsToAvoid: ['a'] } },
    ]);

    const serialized = serializeState(afterActions);
    const restored = deserializeState(serialized);

    expect(restored.iteration).toBe(afterActions.iteration);
    expect(restored.pool).toHaveLength(afterActions.pool.length);
    expect(restored.ratings.get('v1')!.mu).toBe(27);
    expect(restored.matchHistory).toHaveLength(1);
    expect(restored.allCritiques).toHaveLength(1);
    expect(restored.diversityScore).toBe(0.6);
    expect(restored.metaFeedback!.recurringWeaknesses).toEqual(['w']);
  });
});

describe('immutability', () => {
  it('original state is untouched after multiple actions', () => {
    const state = makeState();
    const poolLenBefore = state.pool.length;
    const iterBefore = state.iteration;

    applyActions(state, [
      { type: 'ADD_TO_POOL', variants: [makeVariation('v3')] },
      { type: 'START_NEW_ITERATION' },
      { type: 'SET_DIVERSITY_SCORE', diversityScore: 0.9 },
    ]);

    expect(state.pool).toHaveLength(poolLenBefore);
    expect(state.iteration).toBe(iterBefore);
    expect(state.diversityScore).toBeNull();
  });
});
