// Integration test: verifies rankPool returns partial results with non-default ratings when budget is exceeded mid-ranking.

import { rankPool } from '../loop/rankVariants';
import type { RankResult } from '../loop/rankVariants';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../../types';
import { createRating, DEFAULT_MU, DEFAULT_SIGMA } from '../../shared/computeRatings';
import { createV2MockLlm } from '../../../testing/v2MockLlm';
import type { Variant } from '../../types';
import type { EvolutionConfig } from '../infra/types';

function makeVariant(id: string): Variant {
  return {
    id,
    text: `# Variant ${id}\n\n## Section\n\nContent for ${id}. Multiple sentences here.`,
    version: 1,
    parentIds: [],
    strategy: 'test',
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  };
}

const config: EvolutionConfig = {
  iterations: 5,
  budgetUsd: 1.0,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
  calibrationOpponents: 3,
  tournamentTopK: 5,
};

describe('rankPartialResults integration', () => {
  it('partial RankResult has non-default mu values after mid-ranking budget exceeded', async () => {
    // Build pool: 20 arena entries (calibrated) + 3 new entrants
    const arenaEntries = Array.from({ length: 20 }, (_, i) => makeVariant(`arena-${i}`));
    const newEntrants = Array.from({ length: 3 }, (_, i) => makeVariant(`new-${i}`));
    const pool = [...arenaEntries, ...newEntrants];

    // Arena entries have existing ratings with varying mu
    const ratings = new Map<string, { mu: number; sigma: number }>();
    for (let i = 0; i < 20; i++) {
      ratings.set(`arena-${i}`, { mu: 30 - i, sigma: 4 });
    }

    const matchCounts = new Map<string, number>();
    for (let i = 0; i < 20; i++) {
      matchCounts.set(`arena-${i}`, 5);
    }

    // Mock LLM: allow ~10 comparisons (20 LLM calls with bias mitigation), then budget error
    let callCount = 0;
    const llm = createV2MockLlm();
    llm.complete.mockImplementation(async () => {
      callCount++;
      if (callCount > 20) throw new BudgetExceededError('ranking', 0.9, 0.1, 1.0);
      return 'A is better';
    });

    try {
      await rankPool(
        pool, ratings, matchCounts,
        newEntrants.map((v) => v.id),
        llm, config,
      );
      fail('Should have thrown BudgetExceededWithPartialResults');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededWithPartialResults);
      const partial = (err as BudgetExceededWithPartialResults).partialData as RankResult;

      // Should have some completed matches
      expect(partial.matches.length).toBeGreaterThan(0);

      // Some variants should have non-default mu from completed comparisons
      const allRatings = Object.values(partial.ratingUpdates);
      const nonDefaultMu = allRatings.filter((r) => Math.abs(r.mu - DEFAULT_MU) > 0.1);
      expect(nonDefaultMu.length).toBeGreaterThan(0);

      // Match count increments should reflect completed comparisons
      expect(Object.keys(partial.matchCountIncrements).length).toBeGreaterThan(0);

      // converged should be false (budget exceeded)
      expect(partial.converged).toBe(false);
    }
  });
});
