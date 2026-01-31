// Unit tests for Tournament: Swiss pairing, budget pressure, convergence, and multi-turn tiebreaker.

import { Tournament, swissPairing, budgetPressureConfig } from './tournament';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

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
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(availableBudget),
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

function makeCtx(
  responses: string[],
  poolSize = 4,
  availableBudget = 5,
): { ctx: ExecutionContext; state: PipelineStateImpl } {
  const state = makeState(poolSize);
  const ctx: ExecutionContext = {
    payload: {
      originalText: state.originalText,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
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

// ─── budgetPressureConfig tests ──────────────────────────────────

describe('budgetPressureConfig', () => {
  it('low pressure → thorough config', () => {
    const cfg = budgetPressureConfig(0.3);
    expect(cfg.maxComparisons).toBe(40);
    expect(cfg.maxMultiTurnDebates).toBe(3);
    expect(cfg.multiTurnThreshold).toBe(100);
  });

  it('medium pressure → moderate config', () => {
    const cfg = budgetPressureConfig(0.6);
    expect(cfg.maxComparisons).toBe(25);
    expect(cfg.maxMultiTurnDebates).toBe(1);
  });

  it('high pressure → minimal config', () => {
    const cfg = budgetPressureConfig(0.9);
    expect(cfg.maxComparisons).toBe(15);
    expect(cfg.maxMultiTurnDebates).toBe(0);
  });
});

// ─── swissPairing tests ──────────────────────────────────────────

describe('swissPairing', () => {
  it('pairs similar-rated variants', () => {
    const state = makeState(4);
    const elo = new Map<string, number>();
    elo.set('v-0', 1300);
    elo.set('v-1', 1290);
    elo.set('v-2', 1100);
    elo.set('v-3', 1110);
    const pairs = swissPairing(state.pool, elo, new Set(), 1200);
    expect(pairs).toHaveLength(2);
    // v-0 (1300) should pair with v-1 (1290), v-3 (1110) with v-2 (1100)
    const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort());
    expect(pairIds).toContainEqual(['v-0', 'v-1']);
    expect(pairIds).toContainEqual(['v-2', 'v-3']);
  });

  it('skips already-played pairs', () => {
    const state = makeState(3);
    const elo = new Map<string, number>();
    elo.set('v-0', 1300);
    elo.set('v-1', 1200);
    elo.set('v-2', 1100);
    const completed = new Set(['v-0|v-1']);
    const pairs = swissPairing(state.pool, elo, completed, 1200);
    // v-0 can't play v-1, so pairs v-0 with v-2
    expect(pairs).toHaveLength(1);
    expect(pairs[0][0].id).toBe('v-0');
    expect(pairs[0][1].id).toBe('v-2');
  });

  it('returns empty when all pairs played', () => {
    const state = makeState(2);
    const completed = new Set(['v-0|v-1']);
    const pairs = swissPairing(state.pool, new Map(), completed, 1200);
    expect(pairs).toHaveLength(0);
  });

  it('handles odd number of variants (one sits out)', () => {
    const state = makeState(3);
    const pairs = swissPairing(state.pool, new Map(), new Set(), 1200);
    expect(pairs).toHaveLength(1);
  });
});

// ─── Tournament agent tests ─────────────────────────────────────

describe('Tournament', () => {
  const tournament = new Tournament();

  it('has correct name', () => {
    expect(tournament.name).toBe('tournament');
  });

  it('canExecute requires 2+ pool entries', () => {
    const emptyState = new PipelineStateImpl('text');
    expect(tournament.canExecute(emptyState)).toBe(false);
    const state = makeState(2);
    expect(tournament.canExecute(state)).toBe(true);
  });

  it('execute runs matches and updates Elo', async () => {
    // All LLM responses: "A" (both bias-mitigated calls agree on A)
    const { ctx, state } = makeCtx(['A', 'B'], 4);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);
    // Elo ratings should be set for all variants
    for (const v of state.pool) {
      expect(state.eloRatings.has(v.id)).toBe(true);
    }
  });

  it('records matches in state.matchHistory', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 3);
    const historyBefore = state.matchHistory.length;
    await tournament.execute(ctx);
    expect(state.matchHistory.length).toBeGreaterThan(historyBefore);
  });

  it('respects maxComparisons under high budget pressure', async () => {
    // availableBudget = 0.5 → pressure ~0.9 → maxComparisons=15
    const { ctx } = makeCtx(['A', 'B'], 6, 0.5);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
    // With 6 variants, Swiss produces ~3 pairs per round
    // At high pressure, maxComparisons=15, capped to min(15,40)=15
    expect(result.matchesPlayed!).toBeLessThanOrEqual(15);
  });

  it('detects convergence and stops early', async () => {
    // With tiny pool (2 variants), converges in ~1 round (1 comparison)
    const { ctx } = makeCtx(['A', 'B'], 2);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
    // Convergence metric should be defined
    expect(result.convergence).toBeDefined();
  });

  it('handles all-TIE responses gracefully', async () => {
    const { ctx } = makeCtx(['TIE', 'TIE'], 3);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
  });

  it('returns failure for insufficient pool', async () => {
    const state = new PipelineStateImpl('text');
    const ctx: ExecutionContext = {
      payload: {
        originalText: 'text',
        title: 'Test',
        explanationId: 1,
        runId: 'test',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      },
      state,
      llmClient: makeMockLLMClient([]),
      logger: makeMockLogger(),
      costTracker: makeMockCostTracker(),
      runId: 'test',
    };
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('2 variations');
  });

  it('estimateCost returns positive', () => {
    const cost = tournament.estimateCost({
      originalText: 'x'.repeat(4000),
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBeGreaterThan(0);
  });

  it('initializes Elo for unrated variants', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 3);
    // Clear ratings to simulate uninitialized state
    state.eloRatings.clear();
    expect(state.eloRatings.size).toBe(0);
    await tournament.execute(ctx);
    // All should have ratings now
    expect(state.eloRatings.size).toBe(3);
  });

  it('winners gain Elo, losers lose Elo', async () => {
    // All "A" + "B" (reversed) = both say A is better → A wins consistently
    const { ctx, state } = makeCtx(['A', 'B'], 2);
    await tournament.execute(ctx);
    const ratingA = state.eloRatings.get('v-0')!;
    const ratingB = state.eloRatings.get('v-1')!;
    expect(ratingA).toBeGreaterThan(ratingB);
  });
});
