// Unit tests for empirical cost estimation functions.

import {
  estimateGenerationCost,
  estimateRankingCost,
  estimateAgentCost,
  estimateSwissPairCost,
  estimateEvaluateAndSuggestCost,
  estimateIterativeEditingCost,
  estimateDebateCost,
  estimateParagraphRecombineCost,
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

  // ─── estimateParagraphRecombineCost (rank_individual_paragraphs_evolution_20260525) ─
  describe('estimateParagraphRecombineCost', () => {
    it('returns zero when paragraphCount is 0', () => {
      const r = estimateParagraphRecombineCost(5000, 0, 3, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(r.expected).toBe(0);
      expect(r.upperBound).toBe(0);
    });

    it('returns zero when rewritesPerParagraph is 0', () => {
      const r = estimateParagraphRecombineCost(5000, 12, 0, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(r.expected).toBe(0);
      expect(r.upperBound).toBe(0);
    });

    it('returns positive expected + upperBound for default knobs', () => {
      const r = estimateParagraphRecombineCost(5000, 12, 3, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(r.expected).toBeGreaterThan(0);
      expect(r.upperBound).toBeGreaterThan(r.expected);
    });

    it('upperBound is 1.3× expected (matches established 30% margin)', () => {
      const r = estimateParagraphRecombineCost(5000, 12, 3, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(r.upperBound).toBeCloseTo(r.expected * 1.3, 6);
    });

    it('scales with paragraphCount (cost ∝ N)', () => {
      const small = estimateParagraphRecombineCost(5000, 6, 3, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      const large = estimateParagraphRecombineCost(5000, 24, 3, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(large.expected).toBeGreaterThan(small.expected);
    });

    it('scales with rewritesPerParagraph (cost ∝ M)', () => {
      const m1 = estimateParagraphRecombineCost(5000, 12, 1, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      const m6 = estimateParagraphRecombineCost(5000, 12, 6, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(m6.expected).toBeGreaterThan(m1.expected);
    });

    it('scales with maxComparisonsPerParagraph (ranking depth)', () => {
      const shallow = estimateParagraphRecombineCost(5000, 12, 3, 2, 'gpt-4.1-nano', 'gpt-4.1-nano');
      const deep = estimateParagraphRecombineCost(5000, 12, 3, 20, 'gpt-4.1-nano', 'gpt-4.1-nano');
      expect(deep.expected).toBeGreaterThan(shallow.expected);
    });

    it('rewrite + judge model independence (different models produce different costs)', () => {
      const both = estimateParagraphRecombineCost(5000, 12, 3, 8, 'gpt-4.1-nano', 'gpt-4.1-nano');
      const splitJudge = estimateParagraphRecombineCost(5000, 12, 3, 8, 'gpt-4.1-nano', 'qwen-2.5-7b-instruct');
      // Different judge model yields different ranking layer cost.
      expect(splitJudge.expected).not.toBe(both.expected);
    });

    // Phase 4d: coordinatorModel projector tests.
    describe('Phase 4d — coordinatorModel override', () => {
      it("coordinatorCost reflects coordinatorModel when set (not rewriteModel)", () => {
        const baseline = estimateParagraphRecombineCost(
          5000, 12, 3, 8, 'gpt-4.1-nano', 'qwen-2.5-7b-instruct',
          { sequentialEnabled: true },
        );
        const withCoord = estimateParagraphRecombineCost(
          5000, 12, 3, 8, 'gpt-4.1-nano', 'qwen-2.5-7b-instruct',
          // gpt-5-mini is meaningfully more expensive than gpt-4.1-nano per token,
          // so the coordinator-phase cost must rise when the override is set.
          { sequentialEnabled: true, coordinatorModel: 'gpt-5-mini' },
        );
        expect(withCoord.perPhase.coordinatorCost).toBeGreaterThan(baseline.perPhase.coordinatorCost);
        expect(withCoord.expected).toBeGreaterThan(baseline.expected);
      });

      it("absent coordinatorModel is byte-identical to pre-Phase-4d (coordinator falls back to rewriteModel)", () => {
        const oldShape = estimateParagraphRecombineCost(
          5000, 12, 3, 8, 'gpt-4.1-nano', 'qwen-2.5-7b-instruct',
          { sequentialEnabled: true },
        );
        const explicitUndef = estimateParagraphRecombineCost(
          5000, 12, 3, 8, 'gpt-4.1-nano', 'qwen-2.5-7b-instruct',
          { sequentialEnabled: true, coordinatorModel: undefined },
        );
        expect(explicitUndef.perPhase.coordinatorCost).toBe(oldShape.perPhase.coordinatorCost);
        expect(explicitUndef.expected).toBe(oldShape.expected);
      });

      it("replan-aware: coordinatorCost ≈ (1 + replanRate) × singleCallCost", () => {
        // The projector multiplies the single-call cost by (1 + COORDINATOR_REPLAN_RATE_DEFAULT)
        // = 1.65 today. Sanity-check: doubling the same baseline twice yields a 65%-ish
        // delta, NOT a 100% delta (which would imply replan-rate of 1.0).
        const single = estimateParagraphRecombineCost(
          5000, 12, 3, 8, 'gpt-4.1-nano', 'qwen-2.5-7b-instruct',
          { sequentialEnabled: true },
        );
        const replanRate = 0.65; // mirrors COORDINATOR_REPLAN_RATE_DEFAULT in source
        const impliedSingleCallCost = single.perPhase.coordinatorCost / (1 + replanRate);
        // Within 1% rounding tolerance.
        expect(Math.abs(single.perPhase.coordinatorCost - impliedSingleCallCost * (1 + replanRate))).toBeLessThan(0.001);
      });
    });
  });
});
