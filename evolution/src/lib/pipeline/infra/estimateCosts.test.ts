// Unit tests for empirical cost estimation functions.

import {
  estimateGenerationCost,
  estimateRankingCost,
  estimateAgentCost,
  estimateSwissPairCost,
} from './estimateCosts';

describe('estimateCosts', () => {
  describe('estimateGenerationCost', () => {
    it('returns positive cost for known strategy', () => {
      const cost = estimateGenerationCost(10000, 'grounding_enhance', 'gpt-4.1-nano');
      expect(cost).toBeGreaterThan(0);
    });

    it('uses empirical output chars per strategy', () => {
      // grounding_enhance produces ~11799 chars, lexical_simplify ~5836
      const costGrounding = estimateGenerationCost(10000, 'grounding_enhance', 'gpt-4.1-nano');
      const costLexical = estimateGenerationCost(10000, 'lexical_simplify', 'gpt-4.1-nano');
      expect(costGrounding).toBeGreaterThan(costLexical);
    });

    it('uses default output for unknown strategy', () => {
      const cost = estimateGenerationCost(10000, 'totally_new_strategy', 'gpt-4.1-nano');
      expect(cost).toBeGreaterThan(0);
    });

    it('scales with seed article length (input tokens)', () => {
      const costSmall = estimateGenerationCost(1000, 'structural_transform', 'gpt-4.1-nano');
      const costLarge = estimateGenerationCost(20000, 'structural_transform', 'gpt-4.1-nano');
      expect(costLarge).toBeGreaterThan(costSmall);
    });

    it('scales with model pricing', () => {
      const costCheap = estimateGenerationCost(10000, 'structural_transform', 'gpt-4.1-nano');
      const costExpensive = estimateGenerationCost(10000, 'structural_transform', 'gpt-4.1');
      expect(costExpensive).toBeGreaterThan(costCheap);
    });
  });

  describe('estimateRankingCost', () => {
    it('returns 0 for pool of 1 (no opponents)', () => {
      const cost = estimateRankingCost(5000, 'gpt-4.1-nano', 1, 15);
      expect(cost).toBe(0);
    });

    it('scales with pool size up to cap', () => {
      const costSmallPool = estimateRankingCost(5000, 'gpt-4.1-nano', 3, 15);
      const costLargePool = estimateRankingCost(5000, 'gpt-4.1-nano', 10, 15);
      expect(costLargePool).toBeGreaterThan(costSmallPool);
    });

    it('caps at maxComparisonsPerVariant', () => {
      const costPool50 = estimateRankingCost(5000, 'gpt-4.1-nano', 50, 15);
      const costPool100 = estimateRankingCost(5000, 'gpt-4.1-nano', 100, 15);
      // Both should be the same (capped at 15)
      expect(costPool50).toBe(costPool100);
    });

    it('uses min(poolSize-1, cap)', () => {
      // Pool of 5: min(4, 15) = 4 comparisons
      // Pool of 20: min(19, 15) = 15 comparisons
      const cost4 = estimateRankingCost(5000, 'gpt-4.1-nano', 5, 15);
      const cost15 = estimateRankingCost(5000, 'gpt-4.1-nano', 20, 15);
      expect(cost15 / cost4).toBeCloseTo(15 / 4, 1);
    });
  });

  describe('estimateAgentCost', () => {
    it('combines generation + ranking', () => {
      const gen = estimateGenerationCost(10000, 'structural_transform', 'gpt-4.1-nano');
      const rank = estimateRankingCost(9956, 'gpt-4.1-nano', 5, 15);
      const total = estimateAgentCost(10000, 'structural_transform', 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 15);
      expect(total).toBeCloseTo(gen + rank, 6);
    });

    it('returns positive cost even for smallest pool', () => {
      const cost = estimateAgentCost(1000, 'lexical_simplify', 'gpt-4.1-nano', 'gpt-4.1-nano', 2, 15);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('estimateSwissPairCost', () => {
    it('returns positive cost', () => {
      const cost = estimateSwissPairCost(5000, 'gpt-4.1-nano');
      expect(cost).toBeGreaterThan(0);
    });

    it('scales with article length', () => {
      const costShort = estimateSwissPairCost(2000, 'gpt-4.1-nano');
      const costLong = estimateSwissPairCost(10000, 'gpt-4.1-nano');
      expect(costLong).toBeGreaterThan(costShort);
    });
  });
});
