// Unit tests for invocation-level finalization metric compute functions.

import {
  computeBestVariantElo, computeAvgVariantElo, computeInvocationVariantCount,
  computeInvocationEloDeltaVsParent,
} from './finalizationInvocation';
import type { FinalizationContext } from '../types';
import type { Rating } from '@evolution/lib/shared/computeRatings';
import type { GenerationExecutionDetail } from '@evolution/lib/types';

function makeCtx(
  invocationDetails: Map<string, GenerationExecutionDetail>,
  ratings: Map<string, Rating>,
  invocationId?: string,
): FinalizationContext {
  return {
    result: { winner: { id: 'w', text: '', version: 0, parentIds: [], tactic: '', createdAt: 0, iterationBorn: 0 }, pool: [], ratings, matchHistory: [], totalCost: 0, iterationsRun: 1, stopReason: 'completed', eloHistory: [], diversityHistory: [], matchCounts: {} },
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

describe('computeInvocationEloDeltaVsParent', () => {
  // Helper to build a ctx for the new generate_from_previous_article path.
  function makePrevCtx(args: {
    invocationId?: string;
    variantId?: string | null;
    surfaced?: boolean;
    parentId?: string;
    childElo?: number;
    parentElo?: number;
  }): FinalizationContext {
    const invocationId = args.invocationId ?? 'inv1';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail: any = {
      detailType: 'generate_from_previous_article',
      variantId: args.variantId ?? null,
      surfaced: args.surfaced ?? true,
      strategy: 'lexical_simplify',
    };
    const invocationDetails = new Map([[invocationId, detail]]);
    const ratings = new Map<string, Rating>();
    const pool: Array<{ id: string; parentIds: string[] }> = [];
    if (args.variantId) {
      pool.push({ id: args.variantId, parentIds: args.parentId ? [args.parentId] : [] });
      if (args.childElo != null) ratings.set(args.variantId, { elo: args.childElo, uncertainty: 30 });
    }
    if (args.parentId && args.parentElo != null) {
      ratings.set(args.parentId, { elo: args.parentElo, uncertainty: 40 });
    }
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: {} as any,
      ratings,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pool: pool as any,
      matchHistory: [],
      invocationDetails,
      currentInvocationId: invocationId,
    };
  }

  it('returns null for null invocationId', () => {
    expect(computeInvocationEloDeltaVsParent(makePrevCtx({}), null)).toBeNull();
  });

  it('returns null when invocation produced no variant', () => {
    const ctx = makePrevCtx({ variantId: null, surfaced: false });
    expect(computeInvocationEloDeltaVsParent(ctx, 'inv1')).toBeNull();
  });

  it('returns null when variant has no parent (seed)', () => {
    const ctx = makePrevCtx({ variantId: 'v1', childElo: 1250 });
    expect(computeInvocationEloDeltaVsParent(ctx, 'inv1')).toBeNull();
  });

  it('returns positive delta when child elo exceeds parent', () => {
    const ctx = makePrevCtx({
      variantId: 'v1', parentId: 'p1', childElo: 1250, parentElo: 1200,
    });
    expect(computeInvocationEloDeltaVsParent(ctx, 'inv1')).toBe(50);
  });

  it('returns negative delta when child underperforms parent', () => {
    const ctx = makePrevCtx({
      variantId: 'v1', parentId: 'p1', childElo: 1150, parentElo: 1200,
    });
    expect(computeInvocationEloDeltaVsParent(ctx, 'inv1')).toBe(-50);
  });

  it('returns null when parent rating is missing from ctx', () => {
    const ctx = makePrevCtx({ variantId: 'v1', parentId: 'p-ghost', childElo: 1250 });
    expect(computeInvocationEloDeltaVsParent(ctx, 'inv1')).toBeNull();
  });
});
