// Unit tests for finalization-phase metric compute functions.

import {
  computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount,
} from './finalization';
import { toEloScale, DEFAULT_MU } from '@evolution/lib/shared/computeRatings';
import type { FinalizationContext } from '../types';
import type { Variant } from '@evolution/lib/types';
import type { V2Match } from '@evolution/lib/pipeline/infra/types';

function makeVariant(id: string): Variant {
  return { id, text: '', version: 0, parentIds: [], strategy: 'test', createdAt: 0, iterationBorn: 0 };
}

function makeCtx(overrides: Partial<FinalizationContext> = {}): FinalizationContext {
  const pool = overrides.pool ?? [makeVariant('a'), makeVariant('b'), makeVariant('c')];
  const ratings = overrides.ratings ?? new Map([['a', { mu: 30, sigma: 5 }], ['b', { mu: 25, sigma: 5 }], ['c', { mu: 20, sigma: 5 }]]);
  const matchHistory = overrides.matchHistory ?? [];
  return {
    result: { winner: pool[0]!, pool, ratings, matchHistory, totalCost: 0, iterationsRun: 1, stopReason: 'iterations_complete', muHistory: [], diversityHistory: [], matchCounts: {} },
    ratings,
    pool,
    matchHistory,
    ...overrides,
  };
}

describe('computeWinnerElo', () => {
  it('returns toEloScale of highest-mu variant', () => {
    const ctx = makeCtx();
    expect(computeWinnerElo(ctx)).toBe(toEloScale(30));
  });

  it('returns null for empty pool', () => {
    expect(computeWinnerElo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeMedianElo', () => {
  it('correct for odd pool size', () => {
    const ctx = makeCtx();
    const elos = [toEloScale(20), toEloScale(25), toEloScale(30)].sort((a, b) => a - b);
    expect(computeMedianElo(ctx)).toBe(elos[Math.floor(elos.length * 0.5)]);
  });

  it('correct for even pool size', () => {
    const pool = [makeVariant('a'), makeVariant('b')];
    const ratings = new Map([['a', { mu: 30, sigma: 5 }], ['b', { mu: 20, sigma: 5 }]]);
    expect(computeMedianElo(makeCtx({ pool, ratings }))).toBeDefined();
  });

  it('returns null for empty pool', () => {
    expect(computeMedianElo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeP90Elo', () => {
  it('correct percentile calculation', () => {
    const ctx = makeCtx();
    const elos = [toEloScale(20), toEloScale(25), toEloScale(30)].sort((a, b) => a - b);
    expect(computeP90Elo(ctx)).toBe(elos[Math.floor(elos.length * 0.9)]);
  });

  it('returns null for empty pool', () => {
    expect(computeP90Elo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeMaxElo', () => {
  it('returns highest elo', () => {
    expect(computeMaxElo(makeCtx())).toBe(toEloScale(30));
  });

  it('returns null for empty pool', () => {
    expect(computeMaxElo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeTotalMatches', () => {
  it('returns matchHistory.length', () => {
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'win', confidence: 0.8, judgeModel: 'test', reversed: false },
      { winnerId: 'b', loserId: 'c', result: 'win', confidence: 0.7, judgeModel: 'test', reversed: false },
    ];
    expect(computeTotalMatches(makeCtx({ matchHistory: matches }))).toBe(2);
  });
});

describe('computeDecisiveRate', () => {
  it('correct ratio', () => {
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'win', confidence: 0.8, judgeModel: 'test', reversed: false },
      { winnerId: 'b', loserId: 'c', result: 'win', confidence: 0.5, judgeModel: 'test', reversed: false },
    ];
    expect(computeDecisiveRate(makeCtx({ matchHistory: matches }))).toBe(0.5);
  });

  it('returns null for zero matches', () => {
    expect(computeDecisiveRate(makeCtx({ matchHistory: [] }))).toBeNull();
  });
});

describe('computeVariantCount', () => {
  it('returns pool.length', () => {
    expect(computeVariantCount(makeCtx())).toBe(3);
  });
});
