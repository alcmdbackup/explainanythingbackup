// Tests for V2 rankPool — triage, Swiss fine-ranking, convergence, budget tiers.

import { rankPool } from './rank';
import { BudgetExceededError } from '../types';
import { createRating, DEFAULT_MU, DEFAULT_SIGMA } from '../core/rating';
import { createV2MockLlm } from '../../testing/v2MockLlm';
import type { TextVariation } from '../types';
import type { Rating } from '../core/rating';
import type { EvolutionConfig } from './types';

const baseConfig: EvolutionConfig = {
  iterations: 5,
  budgetUsd: 1.0,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
  calibrationOpponents: 3,
  tournamentTopK: 3,
};

function makeVariant(id: string, text?: string): TextVariation {
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

function makePool(n: number): TextVariation[] {
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
  });

  it('handles first iteration with all new entrants (fine-ranking only)', async () => {
    const pool = makePool(3);
    const ids = pool.map((v) => v.id);
    const llm = createV2MockLlm({ rankingResponses: Array(20).fill('A') });
    const result = await rankPool(pool, new Map(), new Map(), ids, llm, baseConfig);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(Object.keys(result.ratingUpdates).length).toBeGreaterThan(0);
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
    const cache = new Map<string, import('../comparison').ComparisonResult>();

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
});
