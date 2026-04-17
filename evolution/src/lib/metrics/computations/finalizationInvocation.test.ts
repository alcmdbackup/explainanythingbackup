// Unit tests for invocation-level finalization metric compute functions.

import { computeBestVariantElo, computeAvgVariantElo, computeInvocationVariantCount } from './finalizationInvocation';
import type { FinalizationContext } from '../types';
import type { Rating } from '@evolution/lib/shared/computeRatings';
import type { GenerationExecutionDetail } from '@evolution/lib/types';

function makeCtx(
  invocationDetails: Map<string, GenerationExecutionDetail>,
  ratings: Map<string, Rating>,
  invocationId?: string,
): FinalizationContext {
  return {
    result: { winner: { id: 'w', text: '', version: 0, parentIds: [], strategy: '', createdAt: 0, iterationBorn: 0 }, pool: [], ratings, matchHistory: [], totalCost: 0, iterationsRun: 1, stopReason: 'completed', eloHistory: [], diversityHistory: [], matchCounts: {} },
    ratings,
    pool: [],
    matchHistory: [],
    invocationDetails,
    currentInvocationId: invocationId,
  };
}

function makeGenDetail(strategies: Array<{ name: string; status: 'success' | 'error'; variantId?: string }>): GenerationExecutionDetail {
  return {
    detailType: 'generation',
    strategies: strategies.map(s => ({
      name: s.name,
      promptLength: 100,
      status: s.status,
      variantId: s.variantId,
      feedbackUsed: false,
    })),
    feedbackUsed: false,
  } as unknown as GenerationExecutionDetail;
}

describe('computeBestVariantElo', () => {
  it('extracts variant IDs from execution_detail and returns best elo', () => {
    const detail = makeGenDetail([
      { name: 'strat1', status: 'success', variantId: 'v1' },
      { name: 'strat2', status: 'success', variantId: 'v2' },
    ]);
    const details = new Map([['inv1', detail]]);
    // mu=30→elo=1280, mu=35→elo=1360
    const ratings = new Map<string, Rating>([
      ['v1', { elo: 1280, uncertainty: 80 }],
      ['v2', { elo: 1360, uncertainty: 80 }],
    ]);
    const ctx = makeCtx(details, ratings, 'inv1');
    expect(computeBestVariantElo(ctx, 'inv1')).toBe(1360);
  });

  it('returns null for invocation with no successful variants', () => {
    const detail = makeGenDetail([{ name: 'strat1', status: 'error' }]);
    const details = new Map([['inv1', detail]]);
    const ctx = makeCtx(details, new Map(), 'inv1');
    expect(computeBestVariantElo(ctx, 'inv1')).toBeNull();
  });

  it('returns null for undefined invocationId', () => {
    const ctx = makeCtx(new Map(), new Map());
    expect(computeBestVariantElo(ctx, undefined)).toBeNull();
  });
});

describe('computeAvgVariantElo', () => {
  it('correct average', () => {
    const detail = makeGenDetail([
      { name: 'strat1', status: 'success', variantId: 'v1' },
      { name: 'strat2', status: 'success', variantId: 'v2' },
    ]);
    const details = new Map([['inv1', detail]]);
    // mu=30→elo=1280, mu=20→elo=1120
    const ratings = new Map<string, Rating>([
      ['v1', { elo: 1280, uncertainty: 80 }],
      ['v2', { elo: 1120, uncertainty: 80 }],
    ]);
    const ctx = makeCtx(details, ratings, 'inv1');
    expect(computeAvgVariantElo(ctx, 'inv1')).toBe((1280 + 1120) / 2);
  });

  it('returns null for invocation with no successful variants', () => {
    const detail = makeGenDetail([{ name: 'strat1', status: 'error' }]);
    const ctx = makeCtx(new Map([['inv1', detail]]), new Map(), 'inv1');
    expect(computeAvgVariantElo(ctx, 'inv1')).toBeNull();
  });
});

describe('computeInvocationVariantCount', () => {
  it('counts successful variants only', () => {
    const detail = makeGenDetail([
      { name: 'strat1', status: 'success', variantId: 'v1' },
      { name: 'strat2', status: 'error' },
      { name: 'strat3', status: 'success', variantId: 'v3' },
    ]);
    const ctx = makeCtx(new Map([['inv1', detail]]), new Map(), 'inv1');
    expect(computeInvocationVariantCount(ctx, 'inv1')).toBe(2);
  });
});
