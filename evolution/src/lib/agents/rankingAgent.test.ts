// Unit tests for RankingAgent: triage + fine-ranking flow, elimination, convergence, budget.

import { RankingAgent } from './rankingAgent';
import { PipelineStateImpl } from '../core/state';
import { createRating, type Rating } from '../core/rating';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, RankingExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';
import { createMockExecutionContext } from '@evolution/testing/evolution-test-helpers';

function makeMockLLMClient(responses: string[]): EvolutionLLMClient {
  let callIndex = 0;
  return {
    complete: jest.fn().mockImplementation(() => {
      const resp = responses[callIndex % responses.length];
      callIndex++;
      return Promise.resolve(resp);
    }),
    completeStructured: jest.fn(),
  };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(availableBudget = 5): CostTracker {
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(availableBudget),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
    isOverflowed: false,
  };
}

function makeState(poolSize: number): PipelineStateImpl {
  const state = new PipelineStateImpl('Original text for testing purposes.');
  for (let i = 0; i < poolSize; i++) {
    state.addToPool({
      id: `v-${i}`,
      text: `Variant ${i} with some unique text content here.`,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now(),
      iterationBorn: 0,
    });
  }
  return state;
}

function makeCtxWithNewEntrants(
  responses: string[],
  existingCount = 5,
  newCount = 1,
  configOverrides: Partial<EvolutionRunConfig> = {},
) {
  const config = resolveConfig(configOverrides);
  const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

  for (let i = 0; i < existingCount; i++) {
    state.addToPool({
      id: `existing-${i}`,
      text: `# Variant ${i}\n\n## Section\n\nVariant ${i} text content.`,
      version: 1, parentIds: [], strategy: 'structural_transform',
      createdAt: Date.now(), iterationBorn: 0,
    });
    state.ratings.set(`existing-${i}`, { mu: 25 + i * 2, sigma: 4 });
    state.matchCounts.set(`existing-${i}`, 5);
  }

  state.startNewIteration();

  for (let i = 0; i < newCount; i++) {
    state.addToPool({
      id: `new-${i}`,
      text: `# New Variant ${i}\n\n## Section\n\nNew entrant text ${i}.`,
      version: 2, parentIds: [], strategy: 'lexical_simplify',
      createdAt: Date.now(), iterationBorn: 1,
    });
  }

  return createMockExecutionContext({
    state,
    llmClient: makeMockLLMClient(responses),
    payload: {
      originalText: state.originalText,
      title: 'Test', explanationId: 1, runId: 'test-run',
      config,
    },
  });
}

function makeCtxNoNewEntrants(
  responses: string[],
  poolSize = 4,
  availableBudget = 5,
): { ctx: ExecutionContext; state: PipelineStateImpl } {
  const state = makeState(poolSize);
  // Clear newEntrantsThisIteration so triage is skipped
  state.startNewIteration();
  const ctx: ExecutionContext = {
    payload: {
      originalText: state.originalText,
      title: 'Test', explanationId: 1, runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: makeMockLLMClient(responses),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(availableBudget),
    runId: 'test-run',
  };
  return { ctx, state };
}

// ─── Basic tests ────────────────────────────────────────────────

describe('RankingAgent', () => {
  const agent = new RankingAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('ranking');
  });

  it('canExecute requires 2+ pool entries', () => {
    const emptyState = new PipelineStateImpl('text');
    expect(agent.canExecute(emptyState)).toBe(false);
    const state = makeState(2);
    expect(agent.canExecute(state)).toBe(true);
  });

  it('estimateCost returns zero (cost estimated centrally)', () => {
    const cost = agent.estimateCost({
      originalText: 'x'.repeat(4000),
      title: 'Test', explanationId: 1, runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBe(0);
  });
});

// ─── Triage tests ───────────────────────────────────────────────

describe('RankingAgent triage', () => {
  const agent = new RankingAgent();

  it('calibrates new entrants and updates ratings', async () => {
    const ctx = makeCtxWithNewEntrants(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);
    expect(ctx.state.ratings.has('new-0')).toBe(true);
  });

  it('skips triage for low-sigma entries (Arena-calibrated)', async () => {
    const config = resolveConfig({});
    const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

    for (let i = 0; i < 3; i++) {
      state.addToPool({
        id: `existing-${i}`,
        text: `# Variant ${i}\n\n## Section\n\nVariant ${i} text content.`,
        version: 1, parentIds: [], strategy: 'structural_transform',
        createdAt: Date.now(), iterationBorn: 0,
      });
      state.ratings.set(`existing-${i}`, { mu: 25 + i * 2, sigma: 4 });
      state.matchCounts.set(`existing-${i}`, 5);
    }

    state.startNewIteration();

    state.addToPool({
      id: 'arena-low-sigma',
      text: '# Arena\n\n## Section\n\nArena variant with low sigma.',
      version: 1, parentIds: [], strategy: 'evolution',
      createdAt: Date.now(), iterationBorn: 1, fromArena: true,
    });
    state.ratings.set('arena-low-sigma', { mu: 30, sigma: 3.5 });

    const ctx = createMockExecutionContext({
      state,
      llmClient: makeMockLLMClient([]),
      payload: { originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'test-run', config },
    });

    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.triage).toHaveLength(0);
  });

  it('runs sequential matches (one at a time) for triage', async () => {
    const ctx = makeCtxWithNewEntrants(
      ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'],
      5, 1,
      { calibration: { opponents: 3, minOpponents: 2 } },
    );
    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.triage.length).toBe(1);
    expect(detail.triage[0].matches.length).toBeGreaterThan(0);
  });

  it('captures execution detail with detailType ranking', async () => {
    const ctx = makeCtxWithNewEntrants(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    const result = await agent.execute(ctx);
    expect(result.executionDetail).toBeDefined();
    expect(result.executionDetail!.detailType).toBe('ranking');
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.triage).toBeDefined();
    expect(detail.fineRanking).toBeDefined();
    expect(detail.budgetPressure).toBeDefined();
    expect(detail.budgetTier).toBeDefined();
    expect(detail.top20Cutoff).toBeDefined();
    expect(detail.totalComparisons).toBeGreaterThanOrEqual(0);
  });

  it('BudgetExceededError propagates from triage', async () => {
    const mockClient = makeMockLLMClient(['A']);
    (mockClient.complete as jest.Mock)
      .mockResolvedValueOnce('A')
      .mockRejectedValueOnce(new BudgetExceededError('ranking', 5.0, 0, 5.0));

    const ctx = makeCtxWithNewEntrants(['A'], 5, 1, { calibration: { opponents: 3, minOpponents: 2 } });
    ctx.llmClient = mockClient;

    await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
  });
});

// ─── Fine-ranking tests ─────────────────────────────────────────

describe('RankingAgent fine-ranking', () => {
  const agent = new RankingAgent();

  it('runs Swiss tournament when no new entrants', async () => {
    const { ctx, state } = makeCtxNoNewEntrants(['A', 'B'], 4);
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);
    for (const v of state.pool) {
      expect(state.ratings.has(v.id)).toBe(true);
    }
  });

  it('records matches in state.matchHistory', async () => {
    const { ctx, state } = makeCtxNoNewEntrants(['A', 'B'], 3);
    const historyBefore = state.matchHistory.length;
    await agent.execute(ctx);
    expect(state.matchHistory.length).toBeGreaterThan(historyBefore);
  });

  it('respects maxComparisons under high budget pressure', async () => {
    // availableBudget=0.5, budgetCap=5 → pressure=0.9 → high → maxComparisons=15
    const state = makeState(6);
    state.startNewIteration();
    const costTracker = makeMockCostTracker(0.5);
    (costTracker.getAvailableBudget as jest.Mock).mockReturnValue(0.5);
    const ctx: ExecutionContext = {
      payload: {
        originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'test-run',
        config: { ...DEFAULT_EVOLUTION_CONFIG, budgetCapUsd: 5 } as EvolutionRunConfig,
      },
      state,
      llmClient: makeMockLLMClient(['A', 'B']),
      logger: makeMockLogger(),
      costTracker,
      runId: 'test-run',
    };
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.totalComparisons).toBeLessThanOrEqual(15);
  });

  it('handles all-TIE responses gracefully', async () => {
    const { ctx } = makeCtxNoNewEntrants(['TIE', 'TIE'], 3);
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
  });

  it('winners gain mu, losers lose mu', async () => {
    // A, B pattern: fwd=A, rev=B(norm→A) = agreement on A → v-0 wins
    const { ctx, state } = makeCtxNoNewEntrants(['A', 'B', 'A', 'B'], 2);
    await agent.execute(ctx);
    const ratingA = state.ratings.get('v-0')!;
    const ratingB = state.ratings.get('v-1')!;
    expect(ratingA.mu).toBeGreaterThan(ratingB.mu);
  });

  it('exits with stale when all pairs played', async () => {
    const { ctx } = makeCtxNoNewEntrants(['A', 'B', 'A', 'B'], 2);
    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.fineRanking.exitReason).toBe('stale');
    // 2 variants = 1 unique pair = 1 fine-ranking match
    expect(detail.totalComparisons).toBe(1);
  });

  it('exits with budget when available budget < 5% of cap', async () => {
    const state = makeState(4);
    const costTracker = makeMockCostTracker(0.002);
    (costTracker.getAvailableBudget as jest.Mock).mockReturnValue(0.002);
    const ctx: ExecutionContext = {
      payload: {
        originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'test-run',
        config: { ...DEFAULT_EVOLUTION_CONFIG, budgetCapUsd: 0.05 } as EvolutionRunConfig,
      },
      state,
      llmClient: makeMockLLMClient(['A', 'B']),
      logger: makeMockLogger(),
      costTracker,
      runId: 'test-run',
    };
    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.fineRanking.exitReason).toBe('budget');
  });

  it('exits with time_limit when remaining time < 120s', async () => {
    const { ctx } = makeCtxNoNewEntrants(['A', 'B'], 4);
    ctx.timeContext = { startMs: Date.now() - 181_000, maxDurationMs: 300_000 };
    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.fineRanking.exitReason).toBe('time_limit');
  });

  it('runs normally when timeContext is undefined', async () => {
    const { ctx } = makeCtxNoNewEntrants(['A', 'B'], 4);
    expect(ctx.timeContext).toBeUndefined();
    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.fineRanking.exitReason).not.toBe('time_limit');
  });
});

// ─── Combined triage + fine-ranking flow tests ──────────────────

describe('RankingAgent combined flow', () => {
  const agent = new RankingAgent();

  it('runs triage then fine-ranking in single execute()', async () => {
    const ctx = makeCtxWithNewEntrants(
      Array(50).fill('A').concat(Array(50).fill('B')),
      5, 2,
    );
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.triage.length).toBe(2);
    expect(detail.fineRanking.rounds).toBeGreaterThanOrEqual(0);
  });

  it('no new entrants → skip triage, only fine-ranking', async () => {
    const { ctx } = makeCtxNoNewEntrants(['A', 'B'], 4);
    const result = await agent.execute(ctx);
    const detail = result.executionDetail as RankingExecutionDetail;
    expect(detail.triage).toHaveLength(0);
    expect(detail.fineRanking.rounds).toBeGreaterThan(0);
  });

  it('all entrants eliminated → fine-ranking still runs with existing pool', async () => {
    const config = resolveConfig({ calibration: { opponents: 2, minOpponents: 2 } });
    const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

    for (let i = 0; i < 5; i++) {
      state.addToPool({
        id: `strong-${i}`,
        text: `# Strong ${i}\n\n## Section\n\nStrong variant ${i}.`,
        version: 1, parentIds: [], strategy: 'structural_transform',
        createdAt: Date.now(), iterationBorn: 0,
      });
      state.ratings.set(`strong-${i}`, { mu: 40, sigma: 2 });
      state.matchCounts.set(`strong-${i}`, 20);
    }

    state.startNewIteration();

    state.addToPool({
      id: 'weak-new',
      text: '# Weak\n\n## Section\n\nWeak new entrant.',
      version: 2, parentIds: [], strategy: 'lexical_simplify',
      createdAt: Date.now(), iterationBorn: 1,
    });

    const ctx = createMockExecutionContext({
      state,
      llmClient: makeMockLLMClient(['B', 'A', 'B', 'A', 'B', 'A']),
      payload: { originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'test-run', config },
    });

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
  });

  it('flow comparison runs when flowCritique enabled', async () => {
    const FLOW_RESPONSE = `local_cohesion: A
global_coherence: B
transition_quality: A
rhythm_variety: TIE
redundancy: A
OVERALL_WINNER: A
CONFIDENCE: HIGH
FRICTION_A: This sentence is jarring.
FRICTION_B: Moving on abruptly.`;

    const smartLLM: EvolutionLLMClient = {
      complete: jest.fn().mockImplementation((prompt: string) => {
        if (prompt.includes('local_cohesion') || prompt.includes('flow')) {
          return Promise.resolve(FLOW_RESPONSE);
        }
        return Promise.resolve('A');
      }),
      completeStructured: jest.fn(),
    };

    const state = makeState(4);
    const ctx: ExecutionContext = {
      payload: {
        originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'test-run',
        config: {
          ...DEFAULT_EVOLUTION_CONFIG,
          enabledAgents: ['flowCritique', 'reflection', 'debate', 'iterativeEditing', 'sectionDecomposition'],
        } as EvolutionRunConfig,
      },
      state,
      llmClient: smartLLM,
      logger: makeMockLogger(),
      costTracker: makeMockCostTracker(),
      runId: 'test-run',
    };

    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);

    const matchesWithFlowScores = state.matchHistory.filter((m) =>
      Object.keys(m.dimensionScores).some((k) => k.startsWith('flow:')),
    );
    expect(matchesWithFlowScores.length).toBeGreaterThan(0);
  });

  it('does not run flow when flowCritique not enabled', async () => {
    const { ctx, state } = makeCtxNoNewEntrants(['A', 'B'], 3);
    const result = await agent.execute(ctx);
    expect(result.success).toBe(true);

    const matchesWithFlowScores = state.matchHistory.filter((m) =>
      Object.keys(m.dimensionScores).some((k) => k.startsWith('flow:')),
    );
    expect(matchesWithFlowScores.length).toBe(0);
  });
});
