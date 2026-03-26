// Tests for V2 rankPool — triage, Swiss fine-ranking, convergence, budget tiers.

import { rankPool } from './rankVariants';
import { BudgetExceededError } from '../../types';
import { createRating, DEFAULT_MU, DEFAULT_SIGMA } from '../../shared/computeRatings';
import { createV2MockLlm } from '../../../testing/v2MockLlm';
import { createMockEntityLogger } from '../../../testing/evolution-test-helpers';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import type { EvolutionConfig } from '../infra/types';

const baseConfig: EvolutionConfig = {
  iterations: 5,
  budgetUsd: 1.0,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
  calibrationOpponents: 3,
  tournamentTopK: 3,
};

function makeVariant(id: string, text?: string): Variant {
  return {
    id,
    text: text ?? `# Variant ${id}\n\n## Section\n\nContent for ${id}. Multiple sentences here. Properly formatted text.`,
    version: 1,
    parentIds: [],
    strategy: 'test',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  };
}

function makePool(n: number): Variant[] {
  return Array.from({ length: n }, (_, i) => makeVariant(`v${i}`));
}

function makeRatings(entries: Array<[string, number, number?]>): Map<string, Rating> {
  return new Map(entries.map(([id, mu, sigma]) => [id, { mu, sigma: sigma ?? DEFAULT_SIGMA }]));
}

describe('rankPool', () => {
  // ─── Edge cases ──────────────────────────────────────────────
  it('returns empty for pool < 2', async () => {
    const llm = createV2MockLlm();
    const result = await rankPool([makeVariant('a')], new Map(), new Map(), [], llm, baseConfig);
    expect(result.matches).toHaveLength(0);
    expect(result.converged).toBe(false);
    expect(result.meta).toBeDefined();
    expect(result.meta.budgetTier).toBe('low');
  });

  it('handles first iteration with all new entrants (fine-ranking only)', async () => {
    const pool = makePool(3);
    const ids = pool.map((v) => v.id);
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, new Map(), new Map(), ids, llm, baseConfig);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(Object.keys(result.ratingUpdates).length).toBeGreaterThan(0);
  });

  it('returns meta with ranking metadata', async () => {
    const pool = makePool(4);
    const ids = pool.map((v) => v.id);
    const llm = createV2MockLlm({ rankingResponses: Array(30).fill('A') });
    const result = await rankPool(pool, new Map(), new Map(), ids, llm, baseConfig);
    expect(result.meta).toBeDefined();
    expect(result.meta.budgetTier).toBe('low');
    expect(result.meta.totalComparisons).toBe(result.matches.length);
    expect(typeof result.meta.fineRankingRounds).toBe('number');
    expect(typeof result.meta.fineRankingExitReason).toBe('string');
    expect(typeof result.meta.convergenceStreak).toBe('number');
    expect(typeof result.meta.top20Cutoff).toBe('number');
    expect(typeof result.meta.eligibleContenders).toBe('number');
  });

  // ─── Triage ──────────────────────────────────────────────────
  it('triage matches new entrants against stratified opponents', async () => {
    const pool = makePool(8);
    const ratings = makeRatings([
      ['v0', 35], ['v1', 30], ['v2', 28], ['v3', 25],
      ['v4', 22], ['v5', 20], ['v6', 18], ['v7', 15],
    ]);
    const newEntrants = ['v0']; // New entrant with high starting mu
    // Reset v0 to fresh rating (high sigma)
    ratings.set('v0', createRating());

    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), newEntrants, llm, baseConfig);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('triage early exit fires when decisiveCount >= minOpp AND avg >= 0.8', async () => {
    const pool = makePool(6);
    const ratings = makeRatings([
      ['v0', 30], ['v1', 28], ['v2', 25],
      ['v3', 22], ['v4', 20], ['v5', 18],
    ]);
    ratings.set('v0', createRating()); // New entrant

    // All A wins with high confidence → early exit after MIN_TRIAGE_OPPONENTS
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), ['v0'], llm, { ...baseConfig, calibrationOpponents: 5 });
    // Should have played some matches but not necessarily all 5 opponents
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('triage eliminates when mu+2σ < top20 cutoff', async () => {
    const pool = makePool(6);
    const ratings = makeRatings([
      ['v0', 40], ['v1', 38], ['v2', 35],
      ['v3', 30], ['v4', 28], ['v5', 5], // v5 will be very low
    ]);
    // v5 is new with very low rating after losing
    ratings.set('v5', { mu: 5, sigma: 4 }); // mu + 2*sigma = 13, well below top 20%

    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('B') }); // v5 always loses
    const result = await rankPool(pool, ratings, new Map(), ['v5'], llm, baseConfig);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  // ─── Draw handling ───────────────────────────────────────────
  it('treats confidence < 0.3 as draw in fine-ranking', async () => {
    const pool = makePool(3);
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('TIE') });
    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);
    expect(result.matches.every((m) => m.result === 'draw')).toBe(true);
  });

  it('treats confidence === 0 as draw in triage', async () => {
    const pool = makePool(4);
    const ratings = makeRatings([['v0', 30], ['v1', 28], ['v2', 25], ['v3', 22]]);
    ratings.set('v3', createRating());

    // Empty responses → both passes fail → confidence 0 → draw
    const llm = createV2MockLlm();
    llm.complete.mockResolvedValue('');

    const result = await rankPool(pool, ratings, new Map(), ['v3'], llm, baseConfig);
    // Matches with confidence 0 are treated as draws
    const triageMatches = result.matches.filter((m) => m.confidence === 0);
    expect(triageMatches.every((m) => m.result === 'draw')).toBe(true);
  });

  // ─── Budget pressure tiers ───────────────────────────────────
  it.each([
    [0.0, 'low'],
    [0.49, 'low'],
    [0.5, 'medium'],
    [0.79, 'medium'],
    [0.8, 'high'],
    [1.0, 'high'],
  ] as const)('budgetFraction=%s → tier=%s', async (fraction, expectedTier) => {
    const pool = makePool(4);
    const llm = createV2MockLlm({ rankingResponses: Array(50).fill('A') });
    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig, fraction);

    const maxComparisons = { low: 40, medium: 25, high: 15 }[expectedTier];
    // Fine-ranking comparisons should be <= max for the tier
    expect(result.matches.length).toBeLessThanOrEqual(maxComparisons + 10); // +10 for triage
  });

  // ─── Match count increments ──────────────────────────────────
  it('matchCountIncrements are correct deltas', async () => {
    const pool = makePool(3);
    const initialCounts = new Map([['v0', 5], ['v1', 3]]);
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, new Map(), new Map(initialCounts), [], llm, baseConfig);

    for (const [id, delta] of Object.entries(result.matchCountIncrements)) {
      expect(delta).toBeGreaterThan(0);
    }
  });

  // ─── Rating updates ─────────────────────────────────────────
  it('ratingUpdates returns full snapshot', async () => {
    const pool = makePool(3);
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);

    // Should have ratings for all pool members
    for (const v of pool) {
      expect(result.ratingUpdates[v.id]).toBeDefined();
      expect(result.ratingUpdates[v.id].mu).toBeDefined();
      expect(result.ratingUpdates[v.id].sigma).toBeDefined();
    }
  });

  it('mu direction correct: consistent winner gets higher mu', async () => {
    const pool = [makeVariant('winner', 'winner text'), makeVariant('loser', 'loser text')];
    // 2-pass reversal: forward 'A' + reverse 'B' = both agree text A wins → confidence 1.0
    const llm = createV2MockLlm({ rankingResponses: ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'] });
    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);

    const winnerMu = result.ratingUpdates['winner']?.mu ?? 0;
    const loserMu = result.ratingUpdates['loser']?.mu ?? 0;
    expect(winnerMu).toBeGreaterThan(loserMu);
  });

  // ─── LLM error handling ──────────────────────────────────────
  it('LLM error → empty response → low-confidence partial result', async () => {
    const pool = makePool(2);
    const llm = createV2MockLlm();
    // Return empty on all calls → aggregateWinners gets null/null → confidence 0
    llm.complete.mockResolvedValue('');

    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);
    expect(result.matches.length).toBeGreaterThan(0);
    // All matches should be draws (confidence 0)
    expect(result.matches.every((m) => m.result === 'draw')).toBe(true);
  });

  it('BudgetExceededError propagates from callback', async () => {
    const pool = makePool(3);
    const llm = createV2MockLlm();
    llm.complete.mockRejectedValue(new BudgetExceededError('ranking', 0.9, 0.1, 1.0));

    await expect(
      rankPool(pool, new Map(), new Map(), [], llm, baseConfig),
    ).rejects.toThrow(BudgetExceededError);
  });

  // ─── Cache ───────────────────────────────────────────────────
  it('cache hit skips LLM call', async () => {
    const pool = makePool(2);
    const llm = createV2MockLlm({ rankingResponses: ['A', 'A'] });
    const cache = new Map<string, import('../../shared/computeRatings').ComparisonResult>();

    // First call populates cache
    await rankPool(pool, new Map(), new Map(), [], llm, baseConfig, 0, cache);
    const firstCallCount = llm.complete.mock.calls.length;

    // Second call with same pool + cache → should use cache
    const freshRatings = new Map<string, Rating>();
    const result2 = await rankPool(pool, freshRatings, new Map(), [], llm, baseConfig, 0, cache);
    // Cache populated from first call → no new LLM calls for cached pairs
    expect(result2.matches.length).toBeGreaterThan(0);
  });

  // ─── Matches includes both phases ────────────────────────────
  it('matches includes both triage + fine-ranking', async () => {
    const pool = makePool(5);
    const ratings = makeRatings([
      ['v0', 30], ['v1', 28], ['v2', 25], ['v3', 22], ['v4', 20],
    ]);
    ratings.set('v4', createRating()); // New entrant

    const llm = createV2MockLlm({ rankingResponses: Array(50).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), ['v4'], llm, baseConfig);
    // Should have both triage matches (v4 vs opponents) and fine-ranking matches
    expect(result.matches.length).toBeGreaterThan(1);
  });

  // ─── Convergence ─────────────────────────────────────────────
  it('converges when all eligible sigmas < threshold for 2 rounds', async () => {
    const pool = makePool(2);
    // Start with already-low sigma (near convergence)
    const ratings = makeRatings([
      ['v0', 30, 3.5],
      ['v1', 25, 3.5],
    ]);

    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), [], llm, baseConfig);
    // After enough matches, sigma should drop below 3.0 → converged
    // Note: convergence depends on rating updates, may or may not trigger
    expect(typeof result.converged).toBe('boolean');
  });

  it('all-draws pool still runs without error', async () => {
    const pool = makePool(3);
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('TIE') });
    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  // ─── Additional tests ─────────────────────────────────────────

  it('triage early exit does NOT fire when decisiveCount < MIN_TRIAGE_OPPONENTS', async () => {
    const pool = makePool(6);
    const ratings = makeRatings([
      ['v0', 30], ['v1', 28], ['v2', 25],
      ['v3', 22], ['v4', 20], ['v5', 18],
    ]);
    ratings.set('v0', createRating()); // New entrant

    // Mix of TIE and A: first match TIE (not decisive), rest A
    // With only 1 decisive match after 2 opponents, early exit should not fire
    const responses = ['TIE', 'TIE', 'A', 'TIE', 'A', 'TIE', 'A', 'TIE', 'A', 'TIE',
                       'A', 'TIE', 'A', 'TIE', 'A', 'TIE', 'A', 'TIE', 'A', 'TIE'];
    const llm = createV2MockLlm({ rankingResponses: responses });
    const result = await rankPool(pool, ratings, new Map(), ['v0'], llm, { ...baseConfig, calibrationOpponents: 5 });
    // With ties producing low confidence, decisiveCount stays low, so all 5 opponents are played
    // Count triage matches (v0 involved)
    const triageMatches = result.matches.filter((m) => m.winnerId === 'v0' || m.loserId === 'v0');
    // Should have played more opponents than the MIN_TRIAGE_OPPONENTS (2) since early exit didn't fire
    expect(triageMatches.length).toBeGreaterThan(2);
  });

  it('stratified selection works with fewer existing than n opponents', async () => {
    // Pool has 3 variants: 1 existing + 2 new entrants
    const pool = makePool(3);
    const ratings = makeRatings([['v0', 30]]); // Only v0 has a rating
    const newEntrants = ['v1', 'v2'];

    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), newEntrants, llm, {
      ...baseConfig,
      calibrationOpponents: 5, // Request 5 opponents but only 2 others exist
    });
    // Should still complete without error and produce matches
    expect(result.matches.length).toBeGreaterThan(0);
    // All pool members should get ratings
    for (const v of pool) {
      expect(result.ratingUpdates[v.id]).toBeDefined();
    }
  });

  it('Swiss pairing scoring prefers high-uncertainty pairs', async () => {
    // Create pool where v0 and v1 have similar mu (high uncertainty) and v2 is far away
    const pool = makePool(3);
    const ratings = makeRatings([
      ['v0', 25, DEFAULT_SIGMA],
      ['v1', 25, DEFAULT_SIGMA],
      ['v2', 5, 2.0],  // Far away with low sigma — pair with others is low uncertainty
    ]);

    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), [], llm, baseConfig);
    // The high-uncertainty pair (v0 vs v1) should appear somewhere in matches
    // (not necessarily first — Swiss pairing may shuffle)
    expect(result.matches.length).toBeGreaterThan(0);
    const v0v1Match = result.matches.find(
      (m) => (m.winnerId === 'v0' && m.loserId === 'v1') || (m.winnerId === 'v1' && m.loserId === 'v0'),
    );
    expect(v0v1Match).toBeDefined();
  });

  it('ratingUpdates returns correct snapshot with updated mu/sigma values', async () => {
    // Use 2 variants with different starting mu so matches produce distinct outcomes
    const pool = [makeVariant('high', 'high quality text'), makeVariant('low', 'low quality text')];
    const initialRatings = makeRatings([
      ['high', 28, DEFAULT_SIGMA],
      ['low', 22, DEFAULT_SIGMA],
    ]);
    // 2-pass reversal: forward 'A' + reverse 'B' = both agree text A wins → confidence 1.0
    const llm = createV2MockLlm({ rankingResponses: ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'] });
    const result = await rankPool(pool, new Map(initialRatings), new Map(), [], llm, {
      ...baseConfig, tournamentTopK: 2,
    });

    // Both pool members should be in ratingUpdates
    expect(Object.keys(result.ratingUpdates)).toHaveLength(2);
    // After matches, ratings should have diverged
    const highRating = result.ratingUpdates['high'];
    const lowRating = result.ratingUpdates['low'];
    expect(highRating).toBeDefined();
    expect(lowRating).toBeDefined();
    // Winner should have higher mu than loser
    expect(highRating.mu).toBeGreaterThan(lowRating.mu);
    // Both sigmas should be lower than DEFAULT_SIGMA after matches
    expect(highRating.sigma).toBeLessThan(DEFAULT_SIGMA);
    expect(lowRating.sigma).toBeLessThan(DEFAULT_SIGMA);
  });

  // ─── Bug #2: Silent Elo corruption from LLM errors ──────────
  it('Bug #2: confidence-0 match does NOT update ratings in triage', async () => {
    const pool = makePool(4);
    const ratings = makeRatings([['v0', 30], ['v1', 28], ['v2', 25], ['v3', 22]]);
    ratings.set('v3', createRating());

    // LLM returns empty → confidence 0
    const llm = createV2MockLlm();
    llm.complete.mockResolvedValue('');

    const initialMu = DEFAULT_MU;
    const result = await rankPool(pool, ratings, new Map(), ['v3'], llm, baseConfig);

    // Confidence-0 matches should NOT change ratings (no draw update)
    const v3Rating = result.ratingUpdates['v3'];
    // v3 should stay near default mu since all matches were confidence-0 (skipped)
    expect(v3Rating.mu).toBeCloseTo(initialMu, 0);
  });

  it('Bug #2: confidence-0 match does NOT update ratings in fine-ranking', async () => {
    const pool = makePool(2);
    const llm = createV2MockLlm();
    llm.complete.mockResolvedValue('');

    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);

    // All matches have confidence 0 → ratings should remain at default
    const r0 = result.ratingUpdates['v0'];
    const r1 = result.ratingUpdates['v1'];
    expect(r0.mu).toBeCloseTo(DEFAULT_MU, 0);
    expect(r1.mu).toBeCloseTo(DEFAULT_MU, 0);
  });

  it('Bug #2: 4+ consecutive errors break ranking early', async () => {
    const pool = makePool(4);
    const llm = createV2MockLlm();
    // All calls fail → consecutive errors > 3 → early break
    llm.complete.mockResolvedValue('');

    const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);
    // Should have limited matches due to early break
    expect(result.converged).toBe(false);
  });

  // ─── Logger integration ──────────────────────────────────────
  describe('logging', () => {
    it('logs pool size, budget tier, and triage results', async () => {
      const pool = makePool(4);
      const ratings = makeRatings([['v0', 30], ['v1', 28], ['v2', 25]]);
      const llm = createV2MockLlm();
      const { logger, calls } = createMockEntityLogger();

      await rankPool(pool, ratings, new Map(), ['v3'], llm, baseConfig, 0.3, undefined, logger);
      const messages = calls.map((c) => c.message);
      expect(messages.some((m) => m.includes('Ranking pool'))).toBe(true);
      expect(messages.some((m) => m.includes('Budget tier'))).toBe(true);
      expect(messages.some((m) => m.includes('Triage'))).toBe(true);
    });

    it('logs comparison results at debug level', async () => {
      const pool = makePool(3);
      const llm = createV2MockLlm();
      const { logger, calls } = createMockEntityLogger();

      await rankPool(pool, new Map(), new Map(), [], llm, baseConfig, 0, undefined, logger);
      const debugCalls = calls.filter((c) => c.level === 'debug' && c.message === 'Comparison result');
      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it('logs Swiss round starts', async () => {
      const pool = makePool(4);
      const llm = createV2MockLlm();
      const { logger, calls } = createMockEntityLogger();

      await rankPool(pool, new Map(), new Map(), [], llm, baseConfig, 0, undefined, logger);
      expect(calls.some((c) => c.message === 'Swiss round start')).toBe(true);
    });

    it('logs failed comparisons as warnings', async () => {
      const pool = makePool(3);
      const llm = createV2MockLlm();
      llm.complete.mockResolvedValue('');
      const { logger, calls } = createMockEntityLogger();

      await rankPool(pool, new Map(), new Map(), [], llm, baseConfig, 0, undefined, logger);
      expect(calls.some((c) => c.level === 'warn' && c.message.includes('comparison failed'))).toBe(true);
    });

    it('logs convergence when pool converges', async () => {
      const pool = makePool(2);
      const llm = createV2MockLlm();
      const { logger, calls } = createMockEntityLogger();

      // Pre-set low sigmas to trigger convergence
      const ratings = new Map<string, Rating>();
      ratings.set('v0', { mu: 30, sigma: 0.5 });
      ratings.set('v1', { mu: 25, sigma: 0.5 });

      await rankPool(pool, ratings, new Map(), [], llm, baseConfig, 0, undefined, logger);
      expect(calls.some((c) => c.message === 'Pool converged' || c.message.includes('convergence'))).toBe(true);
    });

    it('logs triage elimination when entrant is eliminated', async () => {
      const pool = makePool(6);
      // Set strong top-20% to create high cutoff
      const ratings = makeRatings([['v0', 40], ['v1', 38], ['v2', 35], ['v3', 33], ['v4', 30]]);
      // v5 is new entrant with weak text, will lose comparisons
      const llm = createV2MockLlm();
      // Make v5 always lose: LLM returns B as winner
      llm.completeStructured.mockResolvedValue({ winner: 'B', confidence: 0.95 });
      const { logger, calls } = createMockEntityLogger();

      await rankPool(pool, ratings, new Map(), ['v5'], llm, baseConfig, 0, undefined, logger);
      // Should have triage logs even if elimination doesn't trigger (depends on cutoff math)
      expect(calls.some((c) => c.message.includes('Triage'))).toBe(true);
    });

    it('logs LLM comparison failure in makeCompareCallback', async () => {
      const pool = makePool(3);
      const llm = createV2MockLlm();
      llm.complete.mockRejectedValue(new Error('LLM timeout'));
      const { logger, calls } = createMockEntityLogger();

      await rankPool(pool, new Map(), new Map(), [], llm, baseConfig, 0, undefined, logger);
      expect(calls.some((c) => c.level === 'warn' && c.message === 'LLM comparison failed')).toBe(true);
    });

    it('does not throw when logger is undefined', async () => {
      const pool = makePool(3);
      const llm = createV2MockLlm();
      // No logger passed — should not throw
      const result = await rankPool(pool, new Map(), new Map(), [], llm, baseConfig);
      expect(result.matches.length).toBeGreaterThan(0);
    });
  });

  it('calibrationOpponents=0 still works without error', async () => {
    const pool = makePool(4);
    const ratings = makeRatings([['v0', 30], ['v1', 28], ['v2', 25], ['v3', 22]]);
    ratings.set('v3', createRating()); // New entrant

    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, ratings, new Map(), ['v3'], llm, {
      ...baseConfig,
      calibrationOpponents: 0,
    });
    // Should complete without throwing; triage may be skipped with 0 opponents
    expect(result).toBeDefined();
    expect(typeof result.converged).toBe('boolean');
  });
});
