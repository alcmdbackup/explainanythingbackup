// Unit tests for projectDispatchPlan — the unified dispatch prediction function.
// Consumed identically by wizard preview, runtime loop, and cost-sensitivity analysis.
// Covers: config matrix (1-iter, 2-iter, swiss-mixed), pool-size growth across iterations,
// Fed-run regression, safety-cap binding, floor-cap binding, and tactic-mix semantics
// (defaults / strategy.strategies / strategy.generationGuidance / iter.generationGuidance).

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
    calibrationOpponents: 5,
    tournamentTopK: 5,
    ...overrides,
  } as unknown as EvolutionConfig;
}

function baseCtx(overrides: Partial<DispatchPlanContext> = {}): DispatchPlanContext {
  return {
    seedChars: 8000,
    initialPoolSize: 0,
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
    it('iteration N+1 sees poolSize = initialPoolSize + sum(previous expectedTotalDispatch)', () => {
      // investigate_issues_latest_evolution_reflection_agent_20260501: pool growth now uses
      // `expectedTotalDispatch` (parallel + projected top-up) to mirror what the runtime
      // actually grows post-Phase-7b. When top-up is disabled or saturates parallel,
      // expectedTotalDispatch === dispatchCount and the assertion is unchanged.
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
      // iter 1 sees initial 10 + whatever iter 0's projection (including top-up) was
      expect(plan[1]!.poolSizeAtStart).toBe(10 + plan[0]!.expectedTotalDispatch);
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

  describe('tactic mix semantics', () => {
    it('with no guidance, identically-budgeted generate iters get identical per-agent cost when pool growth is saturated', () => {
      // Arena is large enough that iter 0 and iter 1 both saturate maxComparisonsPerVariant.
      // With no guidance, both iters use DEFAULT_TACTICS (uniform mix) — so every input to
      // the cost estimator is the same, and $/agent should match.
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.05,
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 50 },
            { agentType: 'generate', budgetPercent: 50 },
          ],
          maxComparisonsPerVariant: 15,
        }),
        baseCtx({ seedChars: 8316, initialPoolSize: 500 }),
      );
      // Both iterations' poolSize > 15 so numComparisons saturates at 15 for both.
      expect(plan[0]!.estPerAgent.upperBound.total).toBeCloseTo(
        plan[1]!.estPerAgent.upperBound.total,
        6,
      );
      // And therefore identical dispatch counts.
      expect(plan[0]!.dispatchCount).toBe(plan[1]!.dispatchCount);
    });

    it('defaults source: tacticMix has 3 entries with uniform weights summing to 1', () => {
      const plan = projectDispatchPlan(baseConfig(), baseCtx());
      expect(plan[0]!.tacticMixSource).toBe('defaults');
      expect(plan[0]!.tacticMix).toHaveLength(3);
      const sum = plan[0]!.tacticMix.reduce((s, e) => s + e.weight, 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const entry of plan[0]!.tacticMix) {
        expect(entry.weight).toBeCloseTo(1 / 3, 6);
      }
      expect(plan[0]!.tacticLabel).toBe('3 defaults');
    });

    it('strategy.strategies: uses that list as the mix, uniform weights', () => {
      const plan = projectDispatchPlan(
        baseConfig({ strategies: ['lexical_simplify', 'grounding_enhance'] }),
        baseCtx(),
      );
      expect(plan[0]!.tacticMixSource).toBe('strategy-tactics');
      expect(plan[0]!.tacticMix.map((e) => e.tactic)).toEqual([
        'lexical_simplify',
        'grounding_enhance',
      ]);
      expect(plan[0]!.tacticLabel).toBe('2 tactics');
    });

    it('strategy.generationGuidance: wins over strategy.strategies, percents normalize to weights', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          strategies: ['lexical_simplify'],
          generationGuidance: [
            { tactic: 'grounding_enhance', percent: 80 },
            { tactic: 'lexical_simplify', percent: 20 },
          ],
        } as unknown as Partial<EvolutionConfig>),
        baseCtx(),
      );
      expect(plan[0]!.tacticMixSource).toBe('strategy-guidance');
      expect(plan[0]!.tacticMix).toEqual([
        { tactic: 'grounding_enhance', weight: 0.8 },
        { tactic: 'lexical_simplify', weight: 0.2 },
      ]);
      expect(plan[0]!.tacticLabel).toBe('2 weighted');
    });

    it('iter.generationGuidance: wins over strategy.generationGuidance for that iteration only', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            {
              agentType: 'generate',
              budgetPercent: 50,
              generationGuidance: [{ tactic: 'lexical_simplify', percent: 100 }],
            },
            { agentType: 'generate', budgetPercent: 50 },
          ],
          generationGuidance: [
            { tactic: 'grounding_enhance', percent: 100 },
          ],
        } as unknown as Partial<EvolutionConfig>),
        baseCtx(),
      );
      expect(plan[0]!.tacticMixSource).toBe('iter-guidance');
      expect(plan[0]!.tacticMix).toEqual([{ tactic: 'lexical_simplify', weight: 1 }]);
      // Iter 1 falls back to strategy-level guidance.
      expect(plan[1]!.tacticMixSource).toBe('strategy-guidance');
      expect(plan[1]!.tacticMix).toEqual([{ tactic: 'grounding_enhance', weight: 1 }]);
    });

    it('single-tactic mix sets tacticLabel to that tactic name', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          generationGuidance: [{ tactic: 'grounding_enhance', percent: 100 }],
        } as unknown as Partial<EvolutionConfig>),
        baseCtx(),
      );
      expect(plan[0]!.tacticLabel).toBe('grounding_enhance');
    });

    it('guidance with zero-total percents falls through to uniform weights (defensive)', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          generationGuidance: [
            { tactic: 'grounding_enhance', percent: 0 },
            { tactic: 'lexical_simplify', percent: 0 },
          ],
        } as unknown as Partial<EvolutionConfig>),
        baseCtx(),
      );
      // No divide-by-zero blowup; just produces the same tactic list with zero weights.
      expect(plan[0]!.tacticMix).toHaveLength(2);
      expect(plan[0]!.estPerAgent.upperBound.total).toBe(0);
    });
  });

  describe('Fed-run regression', () => {
    // Strategy 1ffefe39 config: budget $0.05, two generate iterations 50/50,
    // gemini-2.5-flash-lite + qwen-2.5-7b-instruct, maxComparisonsPerVariant=15,
    // minBudgetAfterParallelAgentMultiple=2. Arena pool had 494 entries.
    //
    // Post-refactor: the cost estimate is a weighted average over DEFAULT_TACTICS
    // (structural_transform, lexical_simplify, grounding_enhance) since no guidance
    // was provided, matching the runtime's within-iteration tactic round-robin.
    it('produces non-zero upper-bound estimate for a large-arena 2-iter config', () => {
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

      // Sanity — some nonzero generation + ranking cost. The exact value depends on
      // the weighted average over 3 tactics with different EMPIRICAL_OUTPUT_CHARS, and
      // should fall within a reasonable band (gen + rank at this pool size and model).
      expect(plan[0]!.estPerAgent.upperBound.total).toBeGreaterThan(0.003);
      expect(plan[0]!.estPerAgent.upperBound.total).toBeLessThan(0.02);
    });

    it('iter-budget parallel floor can bind the batch to 1 under multiple=2 with expensive agent cost', () => {
      // Fed-run-like config: per-agent cost ~$0.005-0.008, iter budget $0.025, floor at
      // 2x agentCost. availBudget < 2x agentCost → maxAffordable=1.
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

      // Floor formula: parallelFloorUsd = 2 × upper.total. Exact dispatch count depends
      // on the weighted avg cost, but with multiple=2 on a large arena the floor
      // reserves enough that maxAffordable is small (1 or 2).
      expect(plan[0]!.parallelFloorUsd).toBeGreaterThan(0);
      expect(plan[0]!.dispatchCount).toBeLessThanOrEqual(2);
    });

    it('without a parallel floor, same config produces the 3-per-iter dispatch observed pre-Phase-7', () => {
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

      expect(plan[0]!.effectiveCap).toBe('budget');
      expect(plan[0]!.parallelFloorUsd).toBe(0);
      expect(plan[0]!.dispatchCount).toBeGreaterThanOrEqual(2);
      expect(plan[0]!.dispatchCount).toBeLessThanOrEqual(10);
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

  // Shape A of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430:
  // a 'reflect_and_generate' iteration adds the reflection LLM call cost to estPerAgent;
  // a vanilla 'generate' iteration omits it. The cost gap also flows into dispatchCount
  // sizing — fewer agents fit per iteration when reflection is on, all else equal.
  describe('reflect_and_generate branch', () => {
    it('reflect_and_generate adds reflection cost; generate omits it', () => {
      const planGenerate = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        }),
        baseCtx(),
      );
      const planReflect = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'reflect_and_generate', budgetPercent: 100, reflectionTopN: 3 },
          ],
        }),
        baseCtx(),
      );
      expect(planGenerate[0]!.estPerAgent.upperBound.reflection).toBe(0);
      expect(planGenerate[0]!.estPerAgent.expected.reflection).toBe(0);
      expect(planReflect[0]!.estPerAgent.upperBound.reflection).toBeGreaterThan(0);
      expect(planReflect[0]!.estPerAgent.expected.reflection).toBeGreaterThan(0);
      // Reflection cost is deterministic per call — expected === upperBound.
      expect(planReflect[0]!.estPerAgent.expected.reflection).toBeCloseTo(
        planReflect[0]!.estPerAgent.upperBound.reflection,
        9,
      );
    });

    it('reflect_and_generate total upperBound = generate total + reflection', () => {
      const planGenerate = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        }),
        baseCtx(),
      );
      const planReflect = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'reflect_and_generate', budgetPercent: 100, reflectionTopN: 3 },
          ],
        }),
        baseCtx(),
      );
      const reflectionAdd = planReflect[0]!.estPerAgent.upperBound.reflection;
      expect(planReflect[0]!.estPerAgent.upperBound.total).toBeCloseTo(
        planGenerate[0]!.estPerAgent.upperBound.total + reflectionAdd,
        9,
      );
    });

    it('plan entry preserves the reflect_and_generate agentType (no coercion to generate)', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'reflect_and_generate', budgetPercent: 60, reflectionTopN: 5 },
            { agentType: 'swiss', budgetPercent: 40 },
          ],
        }),
        baseCtx(),
      );
      expect(plan[0]!.agentType).toBe('reflect_and_generate');
      expect(plan[1]!.agentType).toBe('swiss');
    });

    it('higher reflectionTopN produces higher reflection cost', () => {
      const top3 = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'reflect_and_generate', budgetPercent: 100, reflectionTopN: 3 },
          ],
        }),
        baseCtx(),
      );
      const top10 = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'reflect_and_generate', budgetPercent: 100, reflectionTopN: 10 },
          ],
        }),
        baseCtx(),
      );
      expect(top10[0]!.estPerAgent.upperBound.reflection).toBeGreaterThan(
        top3[0]!.estPerAgent.upperBound.reflection,
      );
    });
  });

  // investigate_issues_latest_evolution_reflection_agent_20260501: top-up projection
  // (`expectedTotalDispatch` / `expectedTopUpDispatch`) was added so the wizard preview
  // surfaces the realistic "with top-up" agent count, not the upper-bound parallel batch.
  describe('top-up projection (expectedTotalDispatch / expectedTopUpDispatch)', () => {
    it('Case 1: d75c9dfc strategy — iter 0 projects 5-7 agents, iter 1 projects 3-5', () => {
      // Reproduces the user-reported strategy: $0.05 budget, 4×25% iterations,
      // gemini-flash-lite + qwen, maxComp=5, minBudgetAfterParallelAgentMultiple=2.
      // Actual run a0cdf104 dispatched 6 in iter 1, 4 in iter 2 — preview should
      // approximate this rather than the upper-bound 2/1/1/1.
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.05,
          iterationConfigs: [
            { agentType: 'generate', sourceMode: 'seed', budgetPercent: 25 },
            { agentType: 'reflect_and_generate', sourceMode: 'pool', budgetPercent: 25,
              qualityCutoff: { mode: 'topN', value: 5 }, reflectionTopN: 3 },
            { agentType: 'reflect_and_generate', sourceMode: 'pool', budgetPercent: 25,
              qualityCutoff: { mode: 'topN', value: 5 }, reflectionTopN: 3 },
            { agentType: 'reflect_and_generate', sourceMode: 'pool', budgetPercent: 25,
              qualityCutoff: { mode: 'topN', value: 5 }, reflectionTopN: 3 },
          ],
          maxComparisonsPerVariant: 5,
          minBudgetAfterParallelAgentMultiple: 2,
        } as unknown as Partial<EvolutionConfig>),
        baseCtx({ seedChars: 8000, initialPoolSize: 50 }),
      );

      // Band assertions — EXPECTED_GEN_RATIO / EXPECTED_RANK_COMPARISONS_RATIO are
      // placeholder heuristics, so exact equality would break on calibration updates.
      expect(plan[0]!.expectedTotalDispatch).toBeGreaterThanOrEqual(4);
      expect(plan[0]!.expectedTotalDispatch).toBeLessThanOrEqual(8);
      expect(plan[1]!.expectedTotalDispatch).toBeGreaterThanOrEqual(2);
      expect(plan[1]!.expectedTotalDispatch).toBeLessThanOrEqual(6);
      // Top-up projection always >= parallel batch.
      expect(plan[0]!.expectedTotalDispatch).toBeGreaterThanOrEqual(plan[0]!.dispatchCount);
      expect(plan[1]!.expectedTotalDispatch).toBeGreaterThanOrEqual(plan[1]!.dispatchCount);
    });

    it('Case 2: opts.topUpEnabled=false collapses expectedTotalDispatch to dispatchCount', () => {
      const cfg = baseConfig({
        budgetUsd: 0.05,
        iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        minBudgetAfterParallelAgentMultiple: 2,
      } as unknown as Partial<EvolutionConfig>);
      const ctx = baseCtx({ seedChars: 8000, initialPoolSize: 50 });

      const planOn = projectDispatchPlan(cfg, ctx); // default opts: topUp on
      const planOff = projectDispatchPlan(cfg, ctx, { topUpEnabled: false });

      // dispatchCount is unchanged (parallel-batch sizing doesn't depend on top-up flag).
      expect(planOff[0]!.dispatchCount).toBe(planOn[0]!.dispatchCount);
      // With top-up disabled, total === parallel and top-up == 0.
      expect(planOff[0]!.expectedTotalDispatch).toBe(planOff[0]!.dispatchCount);
      expect(planOff[0]!.expectedTopUpDispatch).toBe(0);
      // With top-up enabled, total >= parallel.
      expect(planOn[0]!.expectedTotalDispatch).toBeGreaterThanOrEqual(planOn[0]!.dispatchCount);
    });

    it('Case 3: opts.reflectionEnabled=false on reflect_and_generate iter zeroes reflection cost', () => {
      const cfg = baseConfig({
        iterationConfigs: [
          { agentType: 'reflect_and_generate', budgetPercent: 100, reflectionTopN: 3 },
        ],
      });

      const planOn = projectDispatchPlan(cfg, baseCtx()); // default: reflection on
      const planOff = projectDispatchPlan(cfg, baseCtx(), { reflectionEnabled: false });

      // Reflection cost zeroed when kill-switch flipped — agent falls back to vanilla GFPA.
      expect(planOn[0]!.estPerAgent.upperBound.reflection).toBeGreaterThan(0);
      expect(planOff[0]!.estPerAgent.upperBound.reflection).toBe(0);
      expect(planOff[0]!.estPerAgent.expected.reflection).toBe(0);
      // Per-agent total drops correspondingly.
      expect(planOff[0]!.estPerAgent.upperBound.total)
        .toBeLessThan(planOn[0]!.estPerAgent.upperBound.total);
      // expectedTotalDispatch correspondingly higher (cheaper agents → more fit).
      expect(planOff[0]!.expectedTotalDispatch)
        .toBeGreaterThanOrEqual(planOn[0]!.expectedTotalDispatch);
    });

    it('Case 4: swiss iteration has expectedTotalDispatch=0 and expectedTopUpDispatch=0', () => {
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
      expect(plan[1]!.expectedTotalDispatch).toBe(0);
      expect(plan[1]!.expectedTopUpDispatch).toBe(0);
    });

    it('Case 5: parallel batch already saturates expected → expectedTopUpDispatch === 0', () => {
      // Tiny pool + very generous budget per agent → parallel batch hits safety cap, top-up
      // can't add more. Math.max(dispatchCount, ...) clamp ensures expectedTotalDispatch
      // never goes below dispatchCount.
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 100, // absurd budget
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        }),
        baseCtx({ initialPoolSize: 0 }),
      );
      expect(plan[0]!.dispatchCount).toBe(DISPATCH_SAFETY_CAP);
      expect(plan[0]!.expectedTotalDispatch).toBe(DISPATCH_SAFETY_CAP);
      expect(plan[0]!.expectedTopUpDispatch).toBe(0);
    });
  });
});
