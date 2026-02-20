// Unit tests for Tournament: Swiss pairing, budget pressure, convergence, and multi-turn tiebreaker.

import { Tournament, swissPairing, budgetPressureConfig } from './tournament';
import { PipelineStateImpl } from '../core/state';
import { createRating, getOrdinal, type Rating } from '../core/rating';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, TournamentExecutionDetail } from '../types';
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
    getTotalReserved: jest.fn().mockReturnValue(0),
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
    const pairs = swissPairing(state.pool, ratings, new Set(), 4);
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
    const pairs = swissPairing(state.pool, ratings, new Set(), 4);
    expect(pairs).toHaveLength(2);
    // v-2 vs v-3 (both high sigma) should be the top-scored pair
    const topPairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(topPairIds).toEqual(['v-2', 'v-3']);
  });

  it('pairs close-rated variants (high outcome uncertainty)', () => {
    const state = makeState(4);
    const ratings = makeRatings([['v-0', 35], ['v-1', 34.5], ['v-2', 20], ['v-3', 20.5]]);
    const pairs = swissPairing(state.pool, ratings, new Set(), 4);
    expect(pairs).toHaveLength(2);
    const pairIds = pairs.map(([a, b]) => [a.id, b.id].sort());
    expect(pairIds).toContainEqual(['v-0', 'v-1']);
    expect(pairIds).toContainEqual(['v-2', 'v-3']);
  });

  it('closest-rated variants pair first among eligible set', () => {
    const state = makeState(6);
    const ratings = makeRatings([['v-0', 35], ['v-1', 34.5], ['v-2', 28], ['v-3', 27.5], ['v-4', 20], ['v-5', 19.5]]);
    // All above baseline → all eligible. Closest ordinals pair first.
    const pairs = swissPairing(state.pool, ratings, new Set());
    const topPairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(topPairIds).toEqual(['v-0', 'v-1']);
  });

  it('handles empty ratings (all default)', () => {
    const state = makeState(4);
    const pairs = swissPairing(state.pool, new Map(), new Set(), 4);
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

// ─── swissPairing eligibility filtering tests ───────────────────

describe('swissPairing eligibility filtering', () => {
  it('excludes variants that are BOTH below baseline AND outside top K', () => {
    const state = makeState(8);
    const ratings = new Map<string, Rating>();
    // 3 above baseline, 5 below baseline
    ratings.set('v-0', { mu: 35, sigma: 3 }); // ordinal = 26, top 5 ✓ above baseline ✓
    ratings.set('v-1', { mu: 32, sigma: 3 }); // ordinal = 23, top 5 ✓ above baseline ✓
    ratings.set('v-2', { mu: 29, sigma: 3 }); // ordinal = 20, top 5 ✓ above baseline ✓
    ratings.set('v-3', { mu: 10, sigma: 5 }); // ordinal = -5, top 5 ✓ below baseline → ELIGIBLE (in top 5)
    ratings.set('v-4', { mu: 8, sigma: 5 });  // ordinal = -7, top 5 ✓ below baseline → ELIGIBLE (in top 5)
    ratings.set('v-5', { mu: 6, sigma: 5 });  // ordinal = -9, outside top 5 × below baseline → EXCLUDED
    ratings.set('v-6', { mu: 4, sigma: 5 });  // ordinal = -11, outside top 5 × below baseline → EXCLUDED
    ratings.set('v-7', { mu: 3, sigma: 5 });  // ordinal = -12, outside top 5 × below baseline → EXCLUDED
    const pairs = swissPairing(state.pool, ratings, new Set(), 5);
    // 5 eligible: v-0, v-1, v-2, v-3, v-4 → 2 pairs
    expect(pairs).toHaveLength(2);
    const allIds = pairs.flatMap(([a, b]) => [a.id, b.id]);
    expect(allIds.every((id) => ['v-0', 'v-1', 'v-2', 'v-3', 'v-4'].includes(id))).toBe(true);
    expect(allIds.some((id) => ['v-5', 'v-6', 'v-7'].includes(id))).toBe(false);
  });

  it('keeps above-baseline variants even if outside top K', () => {
    const state = makeState(6);
    const ratings = new Map<string, Rating>();
    // All above baseline (ordinal > 0), but only top 3 in top-K
    ratings.set('v-0', { mu: 40, sigma: 3 }); // ordinal = 31
    ratings.set('v-1', { mu: 38, sigma: 3 }); // ordinal = 29
    ratings.set('v-2', { mu: 36, sigma: 3 }); // ordinal = 27
    ratings.set('v-3', { mu: 34, sigma: 3 }); // ordinal = 25 — outside top 3, but above baseline → ELIGIBLE
    ratings.set('v-4', { mu: 32, sigma: 3 }); // ordinal = 23 — outside top 3, but above baseline → ELIGIBLE
    ratings.set('v-5', { mu: 30, sigma: 3 }); // ordinal = 21 — outside top 3, but above baseline → ELIGIBLE
    const pairs = swissPairing(state.pool, ratings, new Set(), 3);
    // All 6 eligible (all above baseline) → 3 pairs
    expect(pairs).toHaveLength(3);
  });

  it('keeps below-baseline variants if in top K', () => {
    const state = makeState(4);
    // All below baseline, but all within top K
    const ratings = new Map<string, Rating>();
    ratings.set('v-0', { mu: 10, sigma: 5 }); // ordinal = -5
    ratings.set('v-1', { mu: 8, sigma: 5 });  // ordinal = -7
    ratings.set('v-2', { mu: 6, sigma: 5 });  // ordinal = -9
    ratings.set('v-3', { mu: 4, sigma: 5 });  // ordinal = -11
    const pairs = swissPairing(state.pool, ratings, new Set(), 5);
    // All 4 in top K (K=5 > pool size) → 2 pairs
    expect(pairs).toHaveLength(2);
  });

  it('falls back to top 2 when all below baseline and outside top K', () => {
    const state = makeState(4);
    const ratings = new Map<string, Rating>();
    ratings.set('v-0', { mu: 10, sigma: 5 }); // ordinal = -5
    ratings.set('v-1', { mu: 8, sigma: 5 });  // ordinal = -7
    ratings.set('v-2', { mu: 6, sigma: 5 });  // ordinal = -9
    ratings.set('v-3', { mu: 4, sigma: 5 });  // ordinal = -11
    // topK=1 means only v-0 qualifies via top-K; rest are below baseline + outside top 1
    // → only 1 eligible → fallback to top 2
    const pairs = swissPairing(state.pool, ratings, new Set(), 1);
    expect(pairs).toHaveLength(1);
    const pairIds = [pairs[0][0].id, pairs[0][1].id].sort();
    expect(pairIds).toEqual(['v-0', 'v-1']);
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

  it('canExecute returns false for insufficient pool (pipeline guards execute)', () => {
    const state = new PipelineStateImpl('text');
    // Pipeline calls canExecute() before execute(), so execute() no longer has its own guard.
    expect(tournament.canExecute(state)).toBe(false);
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

  describe('time-based yield', () => {
    it('exits with time_limit when remaining time < 120s', async () => {
      const { ctx } = makeCtx(['A', 'B'], 4);
      // Simulate 181s elapsed out of 300s max → 119s remaining < 120s threshold
      ctx.timeContext = { startMs: Date.now() - 181_000, maxDurationMs: 300_000 };
      const result = await tournament.execute(ctx);
      expect(result.success).toBe(true);
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).toBe('time_limit');
      expect(detail.totalComparisons).toBe(0);
    });

    it('does not exit when remaining time >= 120s', async () => {
      const { ctx } = makeCtx(['A', 'B'], 4);
      // Simulate 0s elapsed out of 300s max → 300s remaining >> 120s threshold
      ctx.timeContext = { startMs: Date.now(), maxDurationMs: 300_000 };
      const result = await tournament.execute(ctx);
      expect(result.success).toBe(true);
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).not.toBe('time_limit');
      expect(detail.totalComparisons).toBeGreaterThan(0);
    });

    it('runs normally when timeContext is undefined', async () => {
      const { ctx } = makeCtx(['A', 'B'], 4);
      // No timeContext set → should run normally
      expect(ctx.timeContext).toBeUndefined();
      const result = await tournament.execute(ctx);
      expect(result.success).toBe(true);
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).not.toBe('time_limit');
    });

    it('boundary: exits at exactly 120_001ms elapsed (119_999ms remaining)', async () => {
      const { ctx } = makeCtx(['A', 'B'], 4);
      // 120_001ms elapsed out of 240_000ms → 119_999ms remaining < 120_000ms
      ctx.timeContext = { startMs: Date.now() - 120_001, maxDurationMs: 240_000 };
      const result = await tournament.execute(ctx);
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).toBe('time_limit');
    });

    it('boundary: does not exit at 119_999ms elapsed (120_001ms remaining)', async () => {
      const { ctx } = makeCtx(['A', 'B'], 4);
      // 119_999ms elapsed out of 240_000ms → 120_001ms remaining > 120_000ms
      ctx.timeContext = { startMs: Date.now() - 119_999, maxDurationMs: 240_000 };
      const result = await tournament.execute(ctx);
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).not.toBe('time_limit');
    });
  });

  describe('completedPairs within a single tournament invocation', () => {
    it('does not replay the same pair within a single execute() call', async () => {
      // With 2 variants there's only 1 possible pair. After the first round
      // compares it, subsequent rounds should not replay it (goes stale instead).
      const { ctx } = makeCtx(['A', 'B'], 2);
      const result = await tournament.execute(ctx);
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).toBe('stale');
      // Only 1 match should have been played (the single unique pair)
      expect(result.matchesPlayed).toBe(1);
    });

    it('starts fresh completedPairs each invocation (allows re-comparison across iterations)', async () => {
      const { ctx, state } = makeCtx(['A', 'B'], 3);
      // Pre-populate matchHistory (simulating prior iteration)
      state.matchHistory.push({
        variationA: 'v-0',
        variationB: 'v-1',
        winner: 'v-0',
        confidence: 0.8,
        turns: 2,
        dimensionScores: {},
      });
      const historyBefore = state.matchHistory.length;
      await tournament.execute(ctx);
      // The v-0|v-1 pair SHOULD be re-compared (fresh completedPairs each invocation)
      const newMatches = state.matchHistory.slice(historyBefore);
      expect(newMatches.length).toBeGreaterThan(0);
    });
  });

  describe('executionDetail', () => {
    it('captures rounds, budget tier, and exit reason', async () => {
      const { ctx } = makeCtx(['A', 'B'], 4);
      const result = await tournament.execute(ctx);

      expect(result.executionDetail).toBeDefined();
      expect(result.executionDetail!.detailType).toBe('tournament');
      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.rounds.length).toBeGreaterThan(0);
      expect(detail.budgetTier).toBe('low'); // default available=5, cap=1 → pressure<0
      expect(['budget', 'convergence', 'stale', 'maxRounds', 'time_limit']).toContain(detail.exitReason);
      expect(detail.totalComparisons).toBe(result.matchesPlayed);
      expect(detail.flowEnabled).toBe(false);
      // Each round should have pairs and matches
      for (const r of detail.rounds) {
        expect(r.pairs.length).toBeGreaterThan(0);
        expect(r.matches.length).toBeGreaterThan(0);
        expect(r.roundNumber).toBeGreaterThanOrEqual(0);
      }
    });

    it('records stale exit reason when all pairs played', async () => {
      // 2 variants → only 1 possible pair, so tournament goes stale after 1 round
      const { ctx } = makeCtx(['A', 'B'], 2);
      const result = await tournament.execute(ctx);

      const detail = result.executionDetail as TournamentExecutionDetail;
      expect(detail.exitReason).toBe('stale');
      expect(detail.staleRounds).toBeGreaterThanOrEqual(1);
    });
  });
});
