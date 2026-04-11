// Tests for rankNewVariant: pool mutation, rating init, cost delta, surface/discard logic.

import { rankNewVariant } from './rankNewVariant';
import { createRating } from '../../shared/computeRatings';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import type { V2CostTracker } from '../infra/trackBudget';
import type { EvolutionConfig } from '../infra/types';

// ─── Mocks ────────────────────────────────────────────────────────

let mockRankStatus: string = 'converged';
let mockRankMatches: unknown[] = [];
let mockRatingMuAfterRank: number = 25;
let mockCutoff: number = 20;

jest.mock('./rankSingleVariant', () => {
  const actual = jest.requireActual('./rankSingleVariant') as typeof import('./rankSingleVariant');
  return {
    ...actual,
    rankSingleVariant: jest.fn(async ({ variant, ratings }) => {
      // Simulate rating update by setting mu on the passed-in ratings map
      const existing = ratings.get(variant.id);
      if (existing) {
        existing.mu = mockRatingMuAfterRank;
      }
      return {
        status: mockRankStatus,
        matches: mockRankMatches,
        comparisonsRun: mockRankMatches.length,
        detail: { localPoolSize: 2, stopReason: mockRankStatus, totalComparisons: mockRankMatches.length, finalLocalMu: mockRatingMuAfterRank, finalLocalSigma: 8 },
      };
    }),
    computeTop15Cutoff: jest.fn(() => mockCutoff),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────

const mkVariant = (id: string): Variant => ({
  id, text: `text-${id}`, version: 0, parentIds: [],
  strategy: 'structural_transform', createdAt: 0, iterationBorn: 0,
});

function makeCostTracker(initialSpent = 0): V2CostTracker & { _spent: number } {
  let spent = initialSpent;
  const tracker = {
    _spent: spent,
    reserve: jest.fn(),
    recordSpend: jest.fn((_phase, cost) => { spent += cost; tracker._spent = spent; }),
    release: jest.fn(),
    getTotalSpent: jest.fn(() => spent),
    getPhaseCosts: jest.fn(() => ({})),
    getAvailableBudget: jest.fn(() => 10),
  } as unknown as V2CostTracker & { _spent: number };
  return tracker;
}

const baseConfig: EvolutionConfig = {
  iterations: 3,
  budgetUsd: 5,
  judgeModel: 'gpt-4o',
  generationModel: 'gpt-4o',
};

function makeInput(overrides?: {
  variant?: Variant;
  pool?: Variant[];
  ratings?: Map<string, Rating>;
  costTracker?: V2CostTracker;
}) {
  const existing = mkVariant('existing');
  return {
    variant: overrides?.variant ?? mkVariant('new'),
    localPool: overrides?.pool ?? [existing],
    localRatings: overrides?.ratings ?? new Map([['existing', createRating()]]),
    localMatchCounts: new Map<string, number>(),
    completedPairs: new Set<string>(),
    cache: new Map(),
    llm: { complete: jest.fn(), completeStructured: jest.fn() },
    config: baseConfig,
    invocationId: 'inv-1',
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: overrides?.costTracker ?? makeCostTracker(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRankStatus = 'converged';
  mockRankMatches = [];
  mockRatingMuAfterRank = 25;
  mockCutoff = 20;
});

describe('rankNewVariant', () => {
  it('pushes variant into localPool (mutates in place)', async () => {
    const input = makeInput();
    const poolBefore = input.localPool.length;
    await rankNewVariant(input);
    expect(input.localPool.length).toBe(poolBefore + 1);
    expect(input.localPool[input.localPool.length - 1]!.id).toBe(input.variant.id);
  });

  it('initializes a default rating for the variant in localRatings', async () => {
    const input = makeInput();
    expect(input.localRatings.has(input.variant.id)).toBe(false);
    await rankNewVariant(input);
    expect(input.localRatings.has(input.variant.id)).toBe(true);
  });

  it('computes rankingCost as cost delta from costTracker around the rank call', async () => {
    const tracker = makeCostTracker(0.01);
    const { rankSingleVariant: mockRank } = jest.requireMock('./rankSingleVariant') as { rankSingleVariant: jest.Mock };
    mockRank.mockImplementationOnce(async ({ variant, ratings }) => {
      // Simulate spend during ranking
      tracker.recordSpend('ranking' as never, 0.005, 0.005);
      const existing = ratings.get(variant.id);
      if (existing) existing.mu = mockRatingMuAfterRank;
      return { status: 'converged', matches: [], comparisonsRun: 1, detail: {} };
    });

    const input = makeInput({ costTracker: tracker });
    const result = await rankNewVariant(input);
    expect(result.rankingCost).toBeCloseTo(0.005);
  });

  it('surfaced=true on converged status', async () => {
    mockRankStatus = 'converged';
    const result = await rankNewVariant(makeInput());
    expect(result.surfaced).toBe(true);
    expect(result.discardReason).toBeUndefined();
  });

  it('surfaced=true on no_more_opponents status', async () => {
    mockRankStatus = 'no_more_opponents';
    const result = await rankNewVariant(makeInput());
    expect(result.surfaced).toBe(true);
    expect(result.discardReason).toBeUndefined();
  });

  it('surfaced=true on budget status when mu >= top15Cutoff', async () => {
    mockRankStatus = 'budget';
    mockRatingMuAfterRank = 25;
    mockCutoff = 20; // mu (25) >= cutoff (20)
    const result = await rankNewVariant(makeInput());
    expect(result.surfaced).toBe(true);
    expect(result.discardReason).toBeUndefined();
  });

  it('surfaced=false on budget status when mu < top15Cutoff, sets discardReason', async () => {
    mockRankStatus = 'budget';
    mockRatingMuAfterRank = 15;
    mockCutoff = 30; // mu (15) < cutoff (30)
    const result = await rankNewVariant(makeInput());
    expect(result.surfaced).toBe(false);
    expect(result.discardReason).toEqual({ localMu: 15, localTop15Cutoff: 30 });
  });

  it('surfaced=true on eliminated status (discard only on budget+lowMu)', async () => {
    mockRankStatus = 'eliminated';
    mockRatingMuAfterRank = 5;
    mockCutoff = 30;
    const result = await rankNewVariant(makeInput());
    // eliminated does NOT trigger discard — only budget+lowMu does
    expect(result.surfaced).toBe(true);
    expect(result.discardReason).toBeUndefined();
  });

  it('returns the rankResult from rankSingleVariant', async () => {
    const fakeMatch = { winnerId: 'new', loserId: 'existing', confidence: 1, turns: 2, matchType: 'ranking' as const };
    mockRankMatches = [fakeMatch];
    const result = await rankNewVariant(makeInput());
    expect(result.rankResult.matches).toEqual([fakeMatch]);
    expect(result.rankResult.status).toBe('converged');
  });
});
