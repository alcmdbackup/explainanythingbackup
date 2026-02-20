// Unit tests for validateStateIntegrity: phase-independent structural validation of PipelineState.

import { validateStateIntegrity } from './validation';
import { PipelineStateImpl } from './state';
import { createRating } from './rating';
import type { TextVariation } from '../types';

function makeVariant(id: string, parentIds: string[] = []): TextVariation {
  return {
    id,
    text: `text-${id}`,
    version: 1,
    parentIds,
    strategy: 'test',
    createdAt: Date.now(),
    iterationBorn: 0,
  };
}

function buildValidState(): PipelineStateImpl {
  const state = new PipelineStateImpl('original');
  const v1 = makeVariant('v1');
  const v2 = makeVariant('v2', ['v1']);
  state.addToPool(v1);
  state.addToPool(v2);
  return state;
}

describe('validateStateIntegrity', () => {
  it('returns empty violations for a valid state', () => {
    const state = buildValidState();
    expect(validateStateIntegrity(state)).toEqual([]);
  });

  it('detects variant in pool but missing from poolIds', () => {
    const state = buildValidState();
    // Manually corrupt: remove an id from poolIds
    state.poolIds.delete('v2');

    const violations = validateStateIntegrity(state);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.includes('v2') && v.includes('missing from poolIds'))).toBe(true);
  });

  it('detects poolIds entry with no corresponding variant in pool', () => {
    const state = buildValidState();
    // Manually corrupt: add a phantom id to poolIds
    state.poolIds.add('phantom');

    const violations = validateStateIntegrity(state);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.includes('phantom') && v.includes('no corresponding variant'))).toBe(true);
  });

  it('detects orphan parent ID not in poolIds', () => {
    const state = new PipelineStateImpl('original');
    const v1 = makeVariant('v1');
    state.addToPool(v1);
    // Add variant with parentId referencing a non-existent variant
    const orphan = makeVariant('v2', ['does-not-exist']);
    state.pool.push(orphan);
    state.poolIds.add(orphan.id);

    const violations = validateStateIntegrity(state);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.includes('does-not-exist') && v.includes('parentId'))).toBe(true);
  });

  it('detects rating for unknown variant not in poolIds', () => {
    const state = buildValidState();
    // Add a rating for a variant that doesn't exist in the pool
    state.ratings.set('ghost', createRating());

    const violations = validateStateIntegrity(state);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.includes('ghost') && v.includes('ratings'))).toBe(true);
  });

  it('reports multiple violations at once', () => {
    const state = new PipelineStateImpl('original');
    const v1 = makeVariant('v1', ['missing-parent']);
    state.pool.push(v1);
    state.poolIds.add(v1.id);
    state.poolIds.add('extra-id');
    state.ratings.set('unknown-rated', createRating());

    const violations = validateStateIntegrity(state);
    // Should have at least 3: orphan parent, extra poolId, unknown rating key
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });
});
