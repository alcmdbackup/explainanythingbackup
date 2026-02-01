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
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
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
    // v-0 can't play v-1 (completed). Info-theoretic scoring prefers v-1 vs v-2
    // (higher outcome uncertainty) over v-0 vs v-2 (large Elo gap = low uncertainty)
    expect(pairs).toHaveLength(1);
    const pairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(pairIds).toEqual(['v-1', 'v-2']);
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

  it('prefers under-tested variants via sigma proxy', () => {
    const state = makeState(4);
    const elo = new Map<string, number>();
    // All at same rating → equal outcome uncertainty for all pairs
    elo.set('v-0', 1200);
    elo.set('v-1', 1200);
    elo.set('v-2', 1200);
    elo.set('v-3', 1200);
    // v-0 and v-1 have many matches (low sigma), v-2 and v-3 are new (high sigma)
    const matchCounts = new Map<string, number>();
    matchCounts.set('v-0', 15);
    matchCounts.set('v-1', 15);
    matchCounts.set('v-2', 0);
    matchCounts.set('v-3', 0);
    const pairs = swissPairing(state.pool, elo, new Set(), 1200, matchCounts);
    expect(pairs).toHaveLength(2);
    // v-2 vs v-3 (both high sigma) should be the top-scored pair
    const topPairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(topPairIds).toEqual(['v-2', 'v-3']);
  });

  it('pairs established variants with similar Elo (high outcome uncertainty)', () => {
    const state = makeState(4);
    const elo = new Map<string, number>();
    elo.set('v-0', 1400);
    elo.set('v-1', 1395);
    elo.set('v-2', 1000);
    elo.set('v-3', 1005);
    // All have equal match counts so sigma is uniform
    const matchCounts = new Map<string, number>();
    matchCounts.set('v-0', 5);
    matchCounts.set('v-1', 5);
    matchCounts.set('v-2', 5);
    matchCounts.set('v-3', 5);
    const pairs = swissPairing(state.pool, elo, new Set(), 1200, matchCounts);
    expect(pairs).toHaveLength(2);
    // Close-rated pairs should be preferred: v-0 vs v-1, v-2 vs v-3
    const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort());
    expect(pairIds).toContainEqual(['v-0', 'v-1']);
    expect(pairIds).toContainEqual(['v-2', 'v-3']);
  });

  it('applies top-K boost to top-quartile matchups', () => {
    const state = makeState(6);
    const elo = new Map<string, number>();
    // Top 2 are close, rest are spread out
    elo.set('v-0', 1500);
    elo.set('v-1', 1495);
    elo.set('v-2', 1300);
    elo.set('v-3', 1295);
    elo.set('v-4', 1100);
    elo.set('v-5', 1095);
    const matchCounts = new Map<string, number>();
    for (let i = 0; i < 6; i++) matchCounts.set(`v-${i}`, 5);
    const pairs = swissPairing(state.pool, elo, new Set(), 1200, matchCounts);
    // With 6 variants, K = floor(6/3) = 2. Top-K threshold = rating of 2nd highest = 1495
    // v-0 vs v-1 gets 1.5x top-K boost AND highest outcome uncertainty → must be first pair
    const topPairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(topPairIds).toEqual(['v-0', 'v-1']);
  });

  it('handles empty matchCounts (all sigma = 1.0)', () => {
    const state = makeState(4);
    const elo = new Map<string, number>();
    elo.set('v-0', 1250);
    elo.set('v-1', 1240);
    elo.set('v-2', 1100);
    elo.set('v-3', 1110);
    // No matchCounts → default empty map, sigma(0) = 1/sqrt(1) = 1.0 for all
    const pairs = swissPairing(state.pool, elo, new Set(), 1200);
    expect(pairs).toHaveLength(2);
    // Close-rated pairs preferred: v-0 vs v-1 and v-2 vs v-3
    const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort());
    expect(pairIds).toContainEqual(['v-0', 'v-1']);
    expect(pairIds).toContainEqual(['v-2', 'v-3']);
  });

  it('returns empty for single variant', () => {
    const state = makeState(1);
    const pairs = swissPairing(state.pool, new Map(), new Set(), 1200);
    expect(pairs).toHaveLength(0);
  });

  it('clamps K to 1 when pool < 3', () => {
    // With 2 variants, K = max(1, floor(2/3)) = max(1, 0) = 1
    // Should still pair the two variants
    const state = makeState(2);
    const elo = new Map<string, number>();
    elo.set('v-0', 1300);
    elo.set('v-1', 1200);
    const pairs = swissPairing(state.pool, elo, new Set(), 1200);
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
