// Unit tests for finalization-phase metric compute functions.

import {
  computeRunCost, computeAgentCost,
  computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount,
} from './finalization';
import type { ExecutionContext } from '../types';
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

// ─── Execution-phase metrics ─────────────────────────────────────

function makeExecCtx(totalSpent: number, phaseCosts: Record<string, number>, phaseName: string): ExecutionContext {
  return {
    costTracker: {
      getTotalSpent: () => totalSpent,
      getPhaseCosts: () => phaseCosts,
    },
    phaseName,
  };
}

describe('computeRunCost', () => {
  it('returns costTracker.getTotalSpent()', () => {
    expect(computeRunCost(makeExecCtx(1.23, {}, 'generation'))).toBe(1.23);
  });

  it('returns 0 when no spend', () => {
    expect(computeRunCost(makeExecCtx(0, {}, 'ranking'))).toBe(0);
  });
});

describe('computeAgentCost', () => {
  it('returns phase cost for named phase', () => {
    expect(computeAgentCost(makeExecCtx(2, { generation: 0.8, ranking: 1.2 }, 'ranking'))).toBe(1.2);
  });

  it('returns 0 for unknown phase', () => {
    expect(computeAgentCost(makeExecCtx(2, { generation: 0.8 }, 'ranking'))).toBe(0);
  });
});
