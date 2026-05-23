// Unit tests for empirical cost estimation functions.

import {
  estimateGenerationCost,
  estimateRankingCost,
  estimateAgentCost,
  estimateSwissPairCost,
  estimateEvaluateAndSuggestCost,
  estimateIterativeEditingCost,
  estimateDebateCost,
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

  describe('estimateEvaluateAndSuggestCost', () => {
    it('returns positive cost', () => {
      const cost = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 3, 1);
      expect(cost).toBeGreaterThan(0);
    });

    it('scales with criteriaCount (input + output)', () => {
      const cost3 = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 3, 1);
      const cost10 = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 10, 1);
      expect(cost10).toBeGreaterThan(cost3);
    });

    it('scales with weakestK (output size)', () => {
      const cost1 = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 1);
      const cost5 = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 5);
      expect(cost5).toBeGreaterThan(cost1);
    });

    it('scales with avgRubricChars (input size)', () => {
      const costSmall = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 3, 1, 100);
      const costLarge = estimateEvaluateAndSuggestCost(5000, 'gpt-4.1-nano', 'gpt-4.1-nano', 3, 1, 2000);
      expect(costLarge).toBeGreaterThan(costSmall);
    });
  });

  describe('estimateAgentCost with useCriteria', () => {
    it('useCriteria=true increases total over vanilla', () => {
      const vanilla = estimateAgentCost(10000, 'structural_transform', 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 15);
      const criteriaDriven = estimateAgentCost(
        10000, 'criteria_driven', 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 15,
        false, 3, // useReflection, reflectionTopN
        true, 3, 1, // useCriteria, criteriaCount, weakestK
      );
      expect(criteriaDriven).toBeGreaterThan(vanilla);
    });

    it('useCriteria=false has no evaluation_cost contribution', () => {
      const a = estimateAgentCost(10000, 'structural_transform', 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 15);
      const b = estimateAgentCost(
        10000, 'structural_transform', 'gpt-4.1-nano', 'gpt-4.1-nano', 5, 15,
        false, 3, false, 5, 2,
      );
      expect(a).toBeCloseTo(b, 6);
    });
  });

  describe('estimateIterativeEditingCost', () => {
    it('returns expected/upperBound/expectedRanking/upperBoundRanking', () => {
      const cost = estimateIterativeEditingCost(
        8000, 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano',
        3, 20, 15,
      );
      expect(cost.expected).toBeGreaterThan(0);
      expect(cost.upperBound).toBeGreaterThan(cost.expected);
      expect(cost.expectedRanking).toBeGreaterThan(0);
      expect(cost.upperBoundRanking).toBeGreaterThan(cost.expectedRanking);
    });

    it('zeros ranking cost when poolSize=0 (editingRankEnabled=false path)', () => {
      const cost = estimateIterativeEditingCost(
        8000, 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano',
        3, 0, 0,
      );
      expect(cost.expectedRanking).toBe(0);
      expect(cost.upperBoundRanking).toBe(0);
      // Editing cost still > 0
      expect(cost.expected).toBeGreaterThan(0);
    });

    it('upperBoundRanking covers larger article (post-cycle growth)', () => {
      // upperBoundRanking uses post-cycle articleChars (after 1.5× growth per cycle)
      // so it should exceed expectedRanking (computed at seedChars).
      const cost = estimateIterativeEditingCost(
        8000, 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano',
        3, 20, 15,
      );
      // Upper bound includes 1.3× safety margin × (1.5×)^3 article growth, so
      // ranking-side upperBound is materially larger than expected.
      expect(cost.upperBoundRanking).toBeGreaterThan(cost.expectedRanking * 2);
    });

    it('ranking cost scales with maxComparisonsPerVariant', () => {
      const lo = estimateIterativeEditingCost(
        8000, 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano',
        3, 20, 5,
      );
      const hi = estimateIterativeEditingCost(
        8000, 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano', 'gpt-4.1-nano',
        3, 20, 15,
      );
      expect(hi.expectedRanking).toBeGreaterThan(lo.expectedRanking);
    });
  });

  // ─── estimateDebateCost (bring_back_debate_agent_20260506 Phase 2.9) ──
  describe('estimateDebateCost', () => {
    it('returns positive expected/upperBound + separated synthesis sub-costs', () => {
      const cost = estimateDebateCost(
        8000, 8000,  // parentA / parentB chars
        'qwen-2.5-7b-instruct', 'gpt-4.1-nano',  // judge / generation
        20, 15,  // poolSize / maxComparisonsPerVariant
      );
      expect(cost.expected).toBeGreaterThan(0);
      expect(cost.upperBound).toBeGreaterThanOrEqual(cost.expected);
      expect(cost.expectedSynthesis).toBeGreaterThan(0);
      expect(cost.upperBoundSynthesis).toBeGreaterThanOrEqual(cost.expectedSynthesis);
    });

    it('expected = combined-judge + synthesis (so synthesis is part of debate field, not gen)', () => {
      const cost = estimateDebateCost(
        8000, 8000, 'qwen-2.5-7b-instruct', 'gpt-4.1-nano', 20, 15,
      );
      // expected ≈ judge + synthesis. Both > 0.
      expect(cost.expected).toBeGreaterThan(cost.expectedSynthesis);
    });

    it('zeros ranking cost when poolSize=0', () => {
      const cost = estimateDebateCost(
        8000, 8000, 'qwen-2.5-7b-instruct', 'gpt-4.1-nano', 0, 0,
      );
      // Synthesis still has the generation half but no ranking.
      expect(cost.expectedSynthesis).toBeGreaterThan(0);
      // Without ranking, expected synthesis should be lower than with ranking.
      const withRanking = estimateDebateCost(
        8000, 8000, 'qwen-2.5-7b-instruct', 'gpt-4.1-nano', 20, 15,
      );
      expect(withRanking.expectedSynthesis).toBeGreaterThan(cost.expectedSynthesis);
    });

    it('scales with parent text size (judge call has both parents as input)', () => {
      const small = estimateDebateCost(
        2000, 2000, 'qwen-2.5-7b-instruct', 'gpt-4.1-nano', 10, 10,
      );
      const large = estimateDebateCost(
        20000, 20000, 'qwen-2.5-7b-instruct', 'gpt-4.1-nano', 10, 10,
      );
      expect(large.expected).toBeGreaterThan(small.expected);
    });
  });
});
