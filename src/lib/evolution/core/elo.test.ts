// Unit tests for Elo rating update functions.
// Verifies adaptive K-factor, floor enforcement, draw handling, and confidence blending.

import { getAdaptiveK, updateEloRatings, updateEloDraw, updateEloWithConfidence } from './elo';
import { PipelineStateImpl } from './state';
import { ELO_CONSTANTS } from '../config';

function makeState(): PipelineStateImpl {
  const state = new PipelineStateImpl('test');
  state.eloRatings.set('a', 1200);
  state.eloRatings.set('b', 1200);
  state.matchCounts.set('a', 0);
  state.matchCounts.set('b', 0);
  return state;
}

describe('getAdaptiveK', () => {
  it('returns high K for few matches', () => {
    expect(getAdaptiveK(0)).toBe(48);
    expect(getAdaptiveK(4)).toBe(48);
  });

  it('returns medium K for moderate matches', () => {
    expect(getAdaptiveK(5)).toBe(32);
    expect(getAdaptiveK(14)).toBe(32);
  });

  it('returns low K for many matches', () => {
    expect(getAdaptiveK(15)).toBe(16);
    expect(getAdaptiveK(100)).toBe(16);
  });
});

describe('updateEloRatings', () => {
  it('winner gains and loser loses with equal starting ratings', () => {
    const state = makeState();
    const [newW, newL] = updateEloRatings(state, 'a', 'b');
    expect(newW).toBeGreaterThan(1200);
    expect(newL).toBeLessThan(1200);
    // With K=32 and equal ratings, expected score is 0.5
    // Change = 32 * (1 - 0.5) = 16
    expect(newW).toBeCloseTo(1216, 0);
    expect(newL).toBeCloseTo(1184, 0);
  });

  it('increments match counts', () => {
    const state = makeState();
    updateEloRatings(state, 'a', 'b');
    expect(state.matchCounts.get('a')).toBe(1);
    expect(state.matchCounts.get('b')).toBe(1);
  });

  it('uses custom K-factor', () => {
    const state = makeState();
    const [newW] = updateEloRatings(state, 'a', 'b', 64);
    // K=64, change = 64 * 0.5 = 32
    expect(newW).toBeCloseTo(1232, 0);
  });

  it('enforces floor at 800', () => {
    const state = new PipelineStateImpl('test');
    state.eloRatings.set('a', 1500);
    state.eloRatings.set('b', 810);
    state.matchCounts.set('a', 0);
    state.matchCounts.set('b', 0);
    const [, newL] = updateEloRatings(state, 'a', 'b', 64);
    expect(newL).toBeGreaterThanOrEqual(ELO_CONSTANTS.FLOOR);
  });

  it('initializes missing ratings to default', () => {
    const state = new PipelineStateImpl('test');
    // No ratings set — should default to INITIAL_RATING
    const [newW, newL] = updateEloRatings(state, 'x', 'y');
    expect(newW).toBeCloseTo(1216, 0);
    expect(newL).toBeCloseTo(1184, 0);
  });
});

describe('updateEloDraw', () => {
  it('moves ratings toward each other for equal ratings', () => {
    const state = makeState();
    const [newA, newB] = updateEloDraw(state, 'a', 'b');
    // Equal ratings, draw = expected, no change
    expect(newA).toBeCloseTo(1200, 0);
    expect(newB).toBeCloseTo(1200, 0);
  });

  it('higher-rated player loses rating in a draw', () => {
    const state = new PipelineStateImpl('test');
    state.eloRatings.set('a', 1400);
    state.eloRatings.set('b', 1000);
    state.matchCounts.set('a', 0);
    state.matchCounts.set('b', 0);
    const [newA, newB] = updateEloDraw(state, 'a', 'b');
    expect(newA).toBeLessThan(1400);
    expect(newB).toBeGreaterThan(1000);
  });
});

describe('updateEloWithConfidence', () => {
  it('full confidence behaves like standard update', () => {
    const state1 = makeState();
    const state2 = makeState();
    const [w1] = updateEloRatings(state1, 'a', 'b');
    const [w2] = updateEloWithConfidence(state2, 'a', 'b', 1.0);
    expect(w2).toBeCloseTo(w1, 1);
  });

  it('zero confidence behaves like a draw', () => {
    const state = makeState();
    const [newW, newL] = updateEloWithConfidence(state, 'a', 'b', 0.0);
    // Zero confidence → both get 0.5 score → no change for equal ratings
    expect(newW).toBeCloseTo(1200, 0);
    expect(newL).toBeCloseTo(1200, 0);
  });

  it('partial confidence gives smaller delta than full confidence', () => {
    const stateHalf = makeState();
    const stateFull = makeState();
    const [wHalf] = updateEloWithConfidence(stateHalf, 'a', 'b', 0.5);
    const [wFull] = updateEloWithConfidence(stateFull, 'a', 'b', 1.0);
    expect(wHalf - 1200).toBeLessThan(wFull - 1200);
    expect(wHalf).toBeGreaterThan(1200);
  });
});
