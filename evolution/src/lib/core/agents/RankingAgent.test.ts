// Tests for RankingAgent: verifies delegation to rankPool() with Map instances preserved.

import { RankingAgent, type RankingInput, type RankResult } from './RankingAgent';
import type { AgentContext } from '../types';
import { rankPool } from '../../pipeline/loop/rankVariants';
import { rankingExecutionDetailSchema } from '../../schemas';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';

jest.mock('../../pipeline/loop/rankVariants', () => ({
  rankPool: jest.fn(),
}));

jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-rank-1'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

const mockRankPool = rankPool as jest.MockedFunction<typeof rankPool>;

function createMockContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    db: {} as any,
    runId: 'run-rank-1',
    iteration: 1,
    executionOrder: 2,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn().mockReturnValue(0),
      getPhaseCosts: jest.fn().mockReturnValue({}),
      getAvailableBudget: jest.fn().mockReturnValue(5),
    },
    config: {
      iterations: 5,
      budgetUsd: 10,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
    ...overrides,
  };
}

const MOCK_VARIANT = { id: 'v1', text: 'variant', version: 0, parentIds: [], strategy: 'gen', createdAt: 0, iterationBorn: 0 };

const MOCK_META = {
  budgetPressure: 0.3,
  budgetTier: 'low' as const,
  top20Cutoff: 25,
  eligibleContenders: 4,
  totalComparisons: 0,
  fineRankingRounds: 1,
  fineRankingExitReason: 'stale',
  convergenceStreak: 0,
};

function createMockRankPoolResult() {
  return {
    matches: [],
    ratingUpdates: { v1: { mu: 1500, sigma: 200 } as Rating },
    matchCountIncrements: { v1: 3 },
    converged: false,
    meta: MOCK_META,
  };
}

describe('RankingAgent', () => {
  let agent: RankingAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new RankingAgent();
  });

  it('has name "ranking"', () => {
    expect(agent.name).toBe('ranking');
  });

  it('uses rankingExecutionDetailSchema', () => {
    expect(agent.executionDetailSchema).toBe(rankingExecutionDetailSchema);
  });

  describe('execute()', () => {
    it('delegates to rankPool with correct arguments', async () => {
      const poolResult = createMockRankPoolResult();
      mockRankPool.mockResolvedValue(poolResult);

      const ratings = new Map<string, Rating>([['v1', { mu: 1500, sigma: 350 } as Rating]]);
      const matchCounts = new Map<string, number>([['v1', 0]]);
      const cache = new Map<string, ComparisonResult>();

      const input: RankingInput = {
        pool: [MOCK_VARIANT as any],
        ratings,
        matchCounts,
        newEntrantIds: ['v1'],
        llm: { generate: jest.fn() } as any,
        budgetFraction: 0.3,
        cache,
      };
      const ctx = createMockContext();

      const actual = await agent.execute(input, ctx);

      expect(mockRankPool).toHaveBeenCalledWith(
        input.pool, ratings, matchCounts, ['v1'],
        input.llm, ctx.config, 0.3, cache, ctx.logger,
      );
      expect(actual.result.matches).toEqual(poolResult.matches);
      expect(actual.detail.detailType).toBe('ranking');
    });

    it('preserves Map instances passed to rankPool', async () => {
      mockRankPool.mockResolvedValue(createMockRankPoolResult());

      const ratings = new Map<string, Rating>();
      const matchCounts = new Map<string, number>();
      const cache = new Map<string, ComparisonResult>();

      const input: RankingInput = {
        pool: [],
        ratings,
        matchCounts,
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.5,
        cache,
      };
      const ctx = createMockContext();

      await agent.execute(input, ctx);

      const call = mockRankPool.mock.calls[0];
      expect(call[1]).toBeInstanceOf(Map);
      expect(call[1]).toBe(ratings);
      expect(call[2]).toBeInstanceOf(Map);
      expect(call[2]).toBe(matchCounts);
      expect(call[7]).toBeInstanceOf(Map);
      expect(call[7]).toBe(cache);
    });

    it('returns AgentOutput with rank result and detail', async () => {
      const poolResult = createMockRankPoolResult();
      poolResult.converged = true;
      poolResult.ratingUpdates = { v1: { mu: 1600, sigma: 180 } as Rating };
      poolResult.matchCountIncrements = { v1: 5 };
      mockRankPool.mockResolvedValue(poolResult);

      const input: RankingInput = {
        pool: [MOCK_VARIANT as any],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.5,
        cache: new Map(),
      };

      const actual = await agent.execute(input, createMockContext());

      expect(actual.result.converged).toBe(true);
      expect(actual.result.ratingUpdates).toEqual({ v1: { mu: 1600, sigma: 180 } });
      expect(actual.result.matchCountIncrements).toEqual({ v1: 5 });
      expect(actual.detail.detailType).toBe('ranking');
      expect(actual.parentVariantIds).toEqual(['v1']);
    });

    it('propagates errors from rankPool', async () => {
      mockRankPool.mockRejectedValue(new Error('ranking failed'));

      const input: RankingInput = {
        pool: [],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.5,
        cache: new Map(),
      };

      await expect(agent.execute(input, createMockContext())).rejects.toThrow('ranking failed');
    });

    it('passes budgetFraction correctly', async () => {
      mockRankPool.mockResolvedValue(createMockRankPoolResult());

      const input: RankingInput = {
        pool: [],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.75,
        cache: new Map(),
      };

      await agent.execute(input, createMockContext());

      expect(mockRankPool).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), expect.anything(), 0.75, expect.anything(), expect.anything(),
      );
    });

    it('passes config from context', async () => {
      mockRankPool.mockResolvedValue(createMockRankPoolResult());
      const customConfig = { iterations: 10, budgetUsd: 20, judgeModel: 'claude-3', generationModel: 'claude-3' };

      const input: RankingInput = {
        pool: [],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.5,
        cache: new Map(),
      };

      await agent.execute(input, createMockContext({ config: customConfig }));

      expect(mockRankPool).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), customConfig, expect.anything(), expect.anything(), expect.anything(),
      );
    });

    it('passes newEntrantIds correctly', async () => {
      mockRankPool.mockResolvedValue(createMockRankPoolResult());

      const input: RankingInput = {
        pool: [MOCK_VARIANT as any],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: ['v1', 'v2', 'v3'],
        llm: {} as any,
        budgetFraction: 0.5,
        cache: new Map(),
      };

      await agent.execute(input, createMockContext());

      expect(mockRankPool).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), ['v1', 'v2', 'v3'],
        expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
      );
    });
  });

  describe('run() integration', () => {
    it('wraps execute with invocation tracking via base class', async () => {
      mockRankPool.mockResolvedValue(createMockRankPoolResult());

      const input: RankingInput = {
        pool: [],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.5,
        cache: new Map(),
      };

      const result = await agent.run(input, createMockContext());

      expect(result.success).toBe(true);
      expect(result.invocationId).toBe('inv-rank-1');
    });

    it('handles matches in returned result', async () => {
      const rankResult = createMockRankPoolResult();
      rankResult.matches = [{ variantAId: 'v1', variantBId: 'v2', winnerId: 'v1' } as any];
      mockRankPool.mockResolvedValue(rankResult);

      const input: RankingInput = {
        pool: [MOCK_VARIANT as any],
        ratings: new Map(),
        matchCounts: new Map(),
        newEntrantIds: [],
        llm: {} as any,
        budgetFraction: 0.5,
        cache: new Map(),
      };

      const result = await agent.run(input, createMockContext());

      expect(result.success).toBe(true);
      expect(result.result!.matches).toHaveLength(1);
    });
  });
});
