// Unit tests for projectDispatchPlan — the unified dispatch prediction function.
// Consumed identically by wizard preview, runtime loop, and cost-sensitivity analysis.
// Covers: config matrix (1-iter, 2-iter, swiss-mixed), pool-size growth across iterations,
// Fed-run regression, safety-cap binding, floor-cap binding.

import {
  projectDispatchPlan,
  DISPATCH_SAFETY_CAP,
  EXPECTED_GEN_RATIO,
  EXPECTED_RANK_COMPARISONS_RATIO,
  DEFAULT_SEED_CHARS,
  type DispatchPlanContext,
} from './projectDispatchPlan';
import type { EvolutionConfig } from '../infra/types';

function baseConfig(overrides: Partial<EvolutionConfig> = {}): EvolutionConfig {
  return {
    generationModel: 'google/gemini-2.5-flash-lite',
    judgeModel: 'qwen-2.5-7b-instruct',
    budgetUsd: 0.05,
    iterationConfigs: [
      { agentType: 'generate', budgetPercent: 50 },
      { agentType: 'generate', budgetPercent: 50 },
    ],
    maxComparisonsPerVariant: 15,
    strategies: ['structural_transform', 'lexical_simplify', 'grounding_enhance'],
    calibrationOpponents: 5,
    tournamentTopK: 5,
    ...overrides,
  } as unknown as EvolutionConfig;
}

function baseCtx(overrides: Partial<DispatchPlanContext> = {}): DispatchPlanContext {
  return {
    seedChars: 8000,
    initialPoolSize: 0,
    tactics: ['structural_transform', 'lexical_simplify', 'grounding_enhance'],
    ...overrides,
  };
}

describe('projectDispatchPlan', () => {
  describe('shape + basic invariants', () => {
    it('returns one entry per iterationConfig', () => {
      const plan = projectDispatchPlan(baseConfig(), baseCtx());
      expect(plan).toHaveLength(2);
      expect(plan.map((p) => p.iterIdx)).toEqual([0, 1]);
    });

    it('swiss iterations return zero-cost entries with dispatchCount=0', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 60 },
            { agentType: 'swiss', budgetPercent: 40 },
          ],
        }),
        baseCtx(),
      );
      expect(plan[1]!.agentType).toBe('swiss');
      expect(plan[1]!.dispatchCount).toBe(0);
      expect(plan[1]!.effectiveCap).toBe('swiss');
      expect(plan[1]!.estPerAgent.upperBound.total).toBe(0);
    });

    it('iter budget is budgetPercent × totalBudget', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 1.0,
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'generate', budgetPercent: 70 },
          ],
        }),
        baseCtx(),
      );
      expect(plan[0]!.iterBudgetUsd).toBeCloseTo(0.3, 6);
      expect(plan[1]!.iterBudgetUsd).toBeCloseTo(0.7, 6);
    });
  });

  describe('pool-size growth models iteration-to-iteration', () => {
    it('iteration N+1 sees poolSize = initialPoolSize + sum(previous dispatchCounts)', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 1.0, // generous enough that both iterations dispatch multiple agents
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 50 },
            { agentType: 'generate', budgetPercent: 50 },
          ],
        }),
        baseCtx({ initialPoolSize: 10 }),
      );
      expect(plan[0]!.poolSizeAtStart).toBe(10);
      // iter 1 sees initial 10 + whatever iter 0 dispatched
      expect(plan[1]!.poolSizeAtStart).toBe(10 + plan[0]!.dispatchCount);
    });

    it('iter 1 rank cost is >= iter 0 rank cost (pool grows, so more comparisons)', () => {
      const plan = projectDispatchPlan(
        baseConfig({ budgetUsd: 1.0 }),
        baseCtx({ initialPoolSize: 0 }),
      );
      // poolSize 0 at iter 0 → rank cost 0; poolSize > 0 at iter 1 → rank cost > 0
      expect(plan[0]!.estPerAgent.upperBound.rank).toBe(0);
      expect(plan[1]!.estPerAgent.upperBound.rank).toBeGreaterThan(0);
    });
  });

  describe('Fed-run regression', () => {
    // Strategy 1ffefe39 config: budget $0.05, two generate iterations 50/50,
    // gemini-2.5-flash-lite + qwen-2.5-7b-instruct, maxComparisonsPerVariant=15,
    // minBudgetAfterParallelAgentMultiple=2. Arena pool had 494 entries.
    //
    // Observed historical runtime: 3 agents per iteration with NO floor enforcement
    // (floors were advisory only pre-Phase-7a). The new projectDispatchPlan enforces
    // floors at the iter-budget level, which is load-bearing for Phase 7b top-up: the
    // parallel batch is gated by `iterBudget - parallelFloor`, shrinking to 1 in this
    // case, then top-up backfills until remainingBudget < sequentialFloor.
    it('produces cost estimate near $0.007426 matching Fed-run investigation', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.05,
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 50 },
            { agentType: 'generate', budgetPercent: 50 },
          ],
          maxComparisonsPerVariant: 15,
          minBudgetAfterParallelAgentMultiple: 2,
        } as unknown as Partial<EvolutionConfig>),
        baseCtx({ seedChars: 8316, initialPoolSize: 494 }),
      );

      // Per-agent upper-bound estimate tracks the Fed-run investigation value of
      // $0.007426 (1 gen @ gemini-flash-lite + 30 qwen ranking calls at 494-arena pool).
      expect(plan[0]!.estPerAgent.upperBound.total).toBeCloseTo(0.007426, 3);
    });

    it('enforces iter-budget parallel floor — batch shrinks to 1 under multiple=2', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.05,
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 50 },
            { agentType: 'generate', budgetPercent: 50 },
          ],
          maxComparisonsPerVariant: 15,
          minBudgetAfterParallelAgentMultiple: 2,
        } as unknown as Partial<EvolutionConfig>),
        baseCtx({ seedChars: 8316, initialPoolSize: 494 }),
      );

      // iterBudget ($0.025) − parallelFloor (2 × $0.007426 = $0.01485) = $0.01015 avail
      // maxAffordable = max(1, floor(0.01015 / 0.007426)) = 1
      // This is expected — Phase 7b top-up fills the rest of the budget at runtime.
      expect(plan[0]!.maxAffordable.atUpperBound).toBe(1);
      expect(plan[0]!.dispatchCount).toBe(1);
      expect(plan[0]!.parallelFloorUsd).toBeCloseTo(0.01485, 3);
    });

    it('without a parallel floor, produces original 3-per-iter dispatch', () => {
      // Same strategy shape but with the floor removed — matches the OLD pre-Phase-7
      // runtime behavior (floors not enforced, dispatch capped only by budget).
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.05,
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 50 },
            { agentType: 'generate', budgetPercent: 50 },
          ],
          maxComparisonsPerVariant: 15,
          // minBudgetAfterParallelAgentMultiple intentionally unset
        } as unknown as Partial<EvolutionConfig>),
        baseCtx({ seedChars: 8316, initialPoolSize: 494 }),
      );

      expect(plan[0]!.maxAffordable.atUpperBound).toBe(3);
      expect(plan[0]!.dispatchCount).toBe(3);
      expect(plan[0]!.effectiveCap).toBe('budget');
      expect(plan[0]!.parallelFloorUsd).toBe(0);
    });
  });

  describe('DISPATCH_SAFETY_CAP', () => {
    it('exports the value 100', () => {
      expect(DISPATCH_SAFETY_CAP).toBe(100);
    });

    it('caps dispatchCount at 100 when budget math would allow more', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 100, // $100 is absurd but makes the point
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        }),
        baseCtx({ initialPoolSize: 0 }), // no rank cost
      );
      expect(plan[0]!.maxAffordable.atUpperBound).toBeGreaterThanOrEqual(100);
      expect(plan[0]!.dispatchCount).toBe(100);
      expect(plan[0]!.effectiveCap).toBe('safety_cap');
    });
  });

  describe('heuristic ratios', () => {
    it('expected gen is upperBound gen × EXPECTED_GEN_RATIO', () => {
      const plan = projectDispatchPlan(baseConfig(), baseCtx());
      expect(plan[0]!.estPerAgent.expected.gen).toBeCloseTo(
        plan[0]!.estPerAgent.upperBound.gen * EXPECTED_GEN_RATIO,
        6,
      );
    });

    it('expected rank uses fewer comparisons than upperBound', () => {
      const plan = projectDispatchPlan(
        baseConfig({ maxComparisonsPerVariant: 10 }),
        baseCtx({ initialPoolSize: 100 }),
      );
      // expected should use ceil(0.5 × 10) = 5 comparisons, vs 10 upper
      expect(plan[0]!.estPerAgent.expected.rank).toBeLessThan(
        plan[0]!.estPerAgent.upperBound.rank,
      );
    });

    it('exports sane default ratios', () => {
      expect(EXPECTED_GEN_RATIO).toBeGreaterThan(0);
      expect(EXPECTED_GEN_RATIO).toBeLessThanOrEqual(1);
      expect(EXPECTED_RANK_COMPARISONS_RATIO).toBeGreaterThan(0);
      expect(EXPECTED_RANK_COMPARISONS_RATIO).toBeLessThanOrEqual(1);
    });

    it('DEFAULT_SEED_CHARS is a reasonable article length', () => {
      expect(DEFAULT_SEED_CHARS).toBeGreaterThan(1000);
      expect(DEFAULT_SEED_CHARS).toBeLessThan(100000);
    });
  });

  describe('maxAffordable at expected vs upper', () => {
    it('atExpected >= atUpperBound when expected < upper (realistic case)', () => {
      const plan = projectDispatchPlan(
        baseConfig({ budgetUsd: 0.5 }),
        baseCtx({ initialPoolSize: 100 }),
      );
      expect(plan[0]!.maxAffordable.atExpected).toBeGreaterThanOrEqual(
        plan[0]!.maxAffordable.atUpperBound,
      );
    });
  });
});
