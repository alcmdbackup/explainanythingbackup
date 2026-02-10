// Unit tests for Tournament: Swiss pairing, budget pressure, convergence, and multi-turn tiebreaker.

import { Tournament, swissPairing, budgetPressureConfig } from './tournament';
import { PipelineStateImpl } from '../core/state';
import { createRating, getOrdinal, type Rating } from '../core/rating';
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
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
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

/** Helper: create a Rating map from ordinal-like values. */
function makeRatings(entries: Array<[string, number]>): Map<string, Rating> {
  const map = new Map<string, Rating>();
  for (const [id, muValue] of entries) {
    map.set(id, { mu: muValue, sigma: 4 }); // fixed sigma for test predictability
  }
  return map;
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
    const ratings = makeRatings([['v-0', 30], ['v-1', 29], ['v-2', 20], ['v-3', 21]]);
    const pairs = swissPairing(state.pool, ratings, new Set());
    expect(pairs).toHaveLength(2);
    const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort());
    expect(pairIds).toContainEqual(['v-0', 'v-1']);
    expect(pairIds).toContainEqual(['v-2', 'v-3']);
  });

  it('skips already-played pairs', () => {
    const state = makeState(3);
    const ratings = makeRatings([['v-0', 30], ['v-1', 25], ['v-2', 20]]);
    const completed = new Set(['v-0|v-1']);
    const pairs = swissPairing(state.pool, ratings, completed);
    expect(pairs).toHaveLength(1);
    const pairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(pairIds).toEqual(['v-1', 'v-2']);
  });

  it('returns empty when all pairs played', () => {
    const state = makeState(2);
    const completed = new Set(['v-0|v-1']);
    const pairs = swissPairing(state.pool, new Map(), completed);
    expect(pairs).toHaveLength(0);
  });

  it('handles odd number of variants (one sits out)', () => {
    const state = makeState(3);
    const pairs = swissPairing(state.pool, new Map(), new Set());
    expect(pairs).toHaveLength(1);
  });

  it('prefers high-sigma variants', () => {
    const state = makeState(4);
    const ratings = new Map<string, Rating>();
    // All at same mu → equal ordinal gap for all pairs
    ratings.set('v-0', { mu: 25, sigma: 2 }); // low sigma (well-tested)
    ratings.set('v-1', { mu: 25, sigma: 2 }); // low sigma
    ratings.set('v-2', { mu: 25, sigma: 8 }); // high sigma (new)
    ratings.set('v-3', { mu: 25, sigma: 8 }); // high sigma
    const pairs = swissPairing(state.pool, ratings, new Set());
    expect(pairs).toHaveLength(2);
    // v-2 vs v-3 (both high sigma) should be the top-scored pair
    const topPairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(topPairIds).toEqual(['v-2', 'v-3']);
  });

  it('pairs close-rated variants (high outcome uncertainty)', () => {
    const state = makeState(4);
    const ratings = makeRatings([['v-0', 35], ['v-1', 34.5], ['v-2', 20], ['v-3', 20.5]]);
    const pairs = swissPairing(state.pool, ratings, new Set());
    expect(pairs).toHaveLength(2);
    const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort());
    expect(pairIds).toContainEqual(['v-0', 'v-1']);
    expect(pairIds).toContainEqual(['v-2', 'v-3']);
  });

  it('applies top-K boost to top-quartile matchups', () => {
    const state = makeState(6);
    const ratings = makeRatings([['v-0', 35], ['v-1', 34.5], ['v-2', 28], ['v-3', 27.5], ['v-4', 20], ['v-5', 19.5]]);
    const pairs = swissPairing(state.pool, ratings, new Set());
    // With 6 variants, K = floor(6/3) = 2. Top-2 = v-0, v-1
    // v-0 vs v-1 gets 1.5x boost → must be first pair
    const topPairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(topPairIds).toEqual(['v-0', 'v-1']);
  });

  it('handles empty ratings (all default)', () => {
    const state = makeState(4);
    const pairs = swissPairing(state.pool, new Map(), new Set());
    expect(pairs).toHaveLength(2);
  });

  it('returns empty for single variant', () => {
    const state = makeState(1);
    const pairs = swissPairing(state.pool, new Map(), new Set());
    expect(pairs).toHaveLength(0);
  });

  it('clamps K to 1 when pool < 3', () => {
    const state = makeState(2);
    const ratings = makeRatings([['v-0', 30], ['v-1', 25]]);
    const pairs = swissPairing(state.pool, ratings, new Set());
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

  it('execute runs matches and updates ratings', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 4);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);
    // Ratings should be set for all variants
    for (const v of state.pool) {
      expect(state.ratings.has(v.id)).toBe(true);
    }
  });

  it('records matches in state.matchHistory', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 3);
    const historyBefore = state.matchHistory.length;
    await tournament.execute(ctx);
    expect(state.matchHistory.length).toBeGreaterThan(historyBefore);
  });

  it('respects maxComparisons under high budget pressure', async () => {
    const { ctx } = makeCtx(['A', 'B'], 6, 0.5);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed!).toBeLessThanOrEqual(15);
  });

  it('detects convergence and stops early', async () => {
    const { ctx } = makeCtx(['A', 'B'], 2);
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
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

  it('initializes ratings for unrated variants', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 3);
    state.ratings.clear();
    expect(state.ratings.size).toBe(0);
    await tournament.execute(ctx);
    expect(state.ratings.size).toBe(3);
  });

  it('winners gain ordinal, losers lose ordinal', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 2);
    await tournament.execute(ctx);
    const ratingA = state.ratings.get('v-0')!;
    const ratingB = state.ratings.get('v-1')!;
    expect(getOrdinal(ratingA)).toBeGreaterThan(getOrdinal(ratingB));
  });

  it('runs flow comparison when flowCritiqueEnabled is true', async () => {
    const FLOW_RESPONSE = `local_cohesion: A
global_coherence: B
transition_quality: A
rhythm_variety: TIE
redundancy: A
OVERALL_WINNER: A
CONFIDENCE: HIGH
FRICTION_A: This sentence is jarring.
FRICTION_B: Moving on abruptly.`;

    // Use a smart mock that returns flow format for flow prompts, 'A'/'B' for quality
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
        originalText: state.originalText,
        title: 'Test',
        explanationId: 1,
        runId: 'test-run',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      },
      state,
      llmClient: smartLLM,
      logger: makeMockLogger(),
      costTracker: makeMockCostTracker(),
      runId: 'test-run',
      featureFlags: {
        tournamentEnabled: true,
        evolvePoolEnabled: true,
        dryRunOnly: false,
        debateEnabled: true,
        iterativeEditingEnabled: true,
        outlineGenerationEnabled: false,
        treeSearchEnabled: false,
        sectionDecompositionEnabled: true,
        flowCritiqueEnabled: true,
        promptBasedEvolutionEnabled: true,
      },
    };

    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);

    // Flow comparison should have added flow: prefixed dimension scores to matches
    const matchesWithFlowScores = state.matchHistory.filter((m) =>
      Object.keys(m.dimensionScores).some((k) => k.startsWith('flow:')),
    );
    expect(matchesWithFlowScores.length).toBeGreaterThan(0);
  });

  it('does not run flow comparison when flowCritiqueEnabled is false', async () => {
    const { ctx, state } = makeCtx(['A', 'B'], 3);
    // No featureFlags set → flowCritiqueEnabled is undefined → no flow comparison
    const result = await tournament.execute(ctx);
    expect(result.success).toBe(true);

    // No flow: prefixed dimensions should appear
    const matchesWithFlowScores = state.matchHistory.filter((m) =>
      Object.keys(m.dimensionScores).some((k) => k.startsWith('flow:')),
    );
    expect(matchesWithFlowScores.length).toBe(0);
  });

  it('sigma-based convergence uses fewer comparisons than max rounds', async () => {
    // Regression test: sigma-based convergence should terminate
    // well before maxRounds when outcomes are consistent.
    // With 8 variants and consistent A-wins results, the tournament
    // should converge as sigmas shrink, requiring fewer total comparisons
    // than the theoretical maximum (maxRounds * pairsPerRound).
    const poolSize = 8;
    // Consistent "A wins" produces clear ranking, driving sigmas down quickly
    const { ctx, state } = makeCtx(['A', 'A'], poolSize);
    const result = await tournament.execute(ctx);

    expect(result.success).toBe(true);
    // With 8 variants, max pairs per round = 4, maxRounds = 50 → theoretical max = 200
    // Sigma-based convergence should stop significantly earlier
    const maxTheoreticalComparisons = 50 * Math.floor(poolSize / 2);
    expect(result.matchesPlayed!).toBeLessThan(maxTheoreticalComparisons);
    // Convergence metric should be positive, indicating some sigma reduction occurred
    expect(result.convergence!).toBeGreaterThan(0);
    // Verify ordinal ranking is established: top variant should have higher ordinal
    const ordinals = [...state.ratings.entries()]
      .map(([id, r]) => ({ id, ordinal: getOrdinal(r) }))
      .sort((a, b) => b.ordinal - a.ordinal);
    // The winner (v-0, always presented as A) should be in the top half
    const topHalf = ordinals.slice(0, Math.floor(poolSize / 2)).map((o) => o.id);
    expect(topHalf).toContain('v-0');
  });
});
