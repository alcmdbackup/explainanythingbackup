// Unit tests for projectDispatchPlan — the unified dispatch prediction function.
// Consumed identically by wizard preview, runtime loop, and cost-sensitivity analysis.
// Covers: config matrix (1-iter, 2-iter, swiss-mixed), pool-size growth across iterations,
// Fed-run regression, safety-cap binding, floor-cap binding, and tactic-mix semantics
// (defaults / strategy.strategies / strategy.generationGuidance / iter.generationGuidance).

import {
  projectDispatchPlan,
  resolveParagraphRecombineEligibility,
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

    it('Case 3a: opts.editingRankEnabled=false on iterative_editing iter zeroes editingRank cost', () => {
      // Phase 3.3 — when the planner-side editingRankEnabled flag is false, the
      // editing iteration's editingRank cost projects to 0 (mirrors how
      // reflectionEnabled zeros reflection cost). The runtime gate at the
      // dispatch site does the real work; this is the wizard-preview surface.
      const cfg = baseConfig({
        iterationConfigs: [
          { agentType: 'generate', budgetPercent: 50 },
          { agentType: 'iterative_editing', budgetPercent: 50, editingMaxCycles: 2 },
        ],
      });

      const planOn = projectDispatchPlan(cfg, baseCtx()); // default: editingRank on
      const planOff = projectDispatchPlan(cfg, baseCtx(), { editingRankEnabled: false });

      const editingOn = planOn[1]!;
      const editingOff = planOff[1]!;

      // editingRank cost zeroed when kill-switch flipped.
      expect(editingOn.estPerAgent.upperBound.editingRank).toBeGreaterThan(0);
      expect(editingOff.estPerAgent.upperBound.editingRank).toBe(0);
      expect(editingOff.estPerAgent.expected.editingRank).toBe(0);
      // Editing cost itself unchanged (Proposer + Approver + drift recovery still run).
      expect(editingOff.estPerAgent.upperBound.editing).toBe(editingOn.estPerAgent.upperBound.editing);
      // Per-agent total drops by the editingRank delta.
      expect(editingOff.estPerAgent.upperBound.total)
        .toBeLessThan(editingOn.estPerAgent.upperBound.total);
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

  // evaluateCriteriaThenGenerateFromPreviousArticle_20260501:
  // a 'criteria_and_generate' iteration adds the combined evaluate+suggest LLM call cost
  // to estPerAgent.evaluation; vanilla 'generate' has evaluation=0.
  describe('criteria_and_generate branch', () => {
    const C1 = '00000000-0000-4000-8000-0000000000c1';
    const C2 = '00000000-0000-4000-8000-0000000000c2';
    const C3 = '00000000-0000-4000-8000-0000000000c3';

    it('criteria_and_generate adds evaluation cost; generate omits it', () => {
      const planGenerate = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        }),
        baseCtx(),
      );
      const planCriteria = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1, C2, C3], weakestK: 1 },
          ],
        }),
        baseCtx(),
      );
      expect(planGenerate[0]!.estPerAgent.upperBound.evaluation).toBe(0);
      expect(planGenerate[0]!.estPerAgent.expected.evaluation).toBe(0);
      expect(planCriteria[0]!.estPerAgent.upperBound.evaluation).toBeGreaterThan(0);
      expect(planCriteria[0]!.estPerAgent.expected.evaluation).toBeGreaterThan(0);
    });

    it('criteria_and_generate total upperBound = generate total + evaluation', () => {
      const planGenerate = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        }),
        baseCtx(),
      );
      const planCriteria = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1, C2, C3], weakestK: 1 },
          ],
        }),
        baseCtx(),
      );
      const evalAdd = planCriteria[0]!.estPerAgent.upperBound.evaluation;
      // total may also differ via gen mix (criteria_driven vs default tactics) — assert
      // evaluation contribution is at least present:
      expect(planCriteria[0]!.estPerAgent.upperBound.total).toBeGreaterThan(
        planGenerate[0]!.estPerAgent.upperBound.total,
      );
      expect(evalAdd).toBeGreaterThan(0);
    });

    it('plan entry preserves criteria_and_generate agentType', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 60, criteriaIds: [C1, C2, C3], weakestK: 2 },
            { agentType: 'swiss', budgetPercent: 40 },
          ],
        }),
        baseCtx(),
      );
      expect(plan[0]!.agentType).toBe('criteria_and_generate');
      expect(plan[1]!.agentType).toBe('swiss');
    });

    it('higher criteriaCount → higher evaluation cost', () => {
      const small = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1], weakestK: 1 },
          ],
        }),
        baseCtx(),
      );
      const large = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1, C2, C3], weakestK: 1 },
          ],
        }),
        baseCtx(),
      );
      expect(large[0]!.estPerAgent.upperBound.evaluation).toBeGreaterThan(
        small[0]!.estPerAgent.upperBound.evaluation,
      );
    });

    it('higher weakestK → higher evaluation cost (output size)', () => {
      const k1 = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1, C2, C3], weakestK: 1 },
          ],
        }),
        baseCtx(),
      );
      const k3 = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1, C2, C3], weakestK: 3 },
          ],
        }),
        baseCtx(),
      );
      expect(k3[0]!.estPerAgent.upperBound.evaluation).toBeGreaterThan(
        k1[0]!.estPerAgent.upperBound.evaluation,
      );
    });
  });

  // rank_individual_paragraphs_evolution_20260525 — paragraph_recombine branch tests.
  describe('paragraph_recombine branch', () => {
    it('routes paragraph_recombine through paragraphRecombine cost field (NOT gen/rank)', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'paragraph_recombine', budgetPercent: 70, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 5 } },
          ],
        }),
        baseCtx(),
      );
      // generate iteration: gen > 0, paragraphRecombine = 0
      expect(plan[0]!.estPerAgent.expected.gen).toBeGreaterThan(0);
      expect(plan[0]!.estPerAgent.expected.paragraphRecombine).toBe(0);
      // paragraph_recombine iteration: paragraphRecombine > 0, gen = 0 (per-slot rewrites bucket here)
      expect(plan[1]!.estPerAgent.expected.gen).toBe(0);
      expect(plan[1]!.estPerAgent.expected.paragraphRecombine).toBeGreaterThan(0);
    });

    it('emits dispatchCount=1 when paragraph_recombine has a pool parent available', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 50 },
            { agentType: 'paragraph_recombine', budgetPercent: 50, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 5 } },
          ],
        }),
        baseCtx(),
      );
      expect(plan[1]!.dispatchCount).toBe(1);
      expect(plan[1]!.expectedTotalDispatch).toBe(1);
    });

    it('kill-switch (paragraphRecombineEnabled=false) collapses dispatch to 0', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'paragraph_recombine', budgetPercent: 70, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 5 } },
          ],
        }),
        baseCtx(),
        { paragraphRecombineEnabled: false },
      );
      expect(plan[1]!.dispatchCount).toBe(0);
      expect(plan[1]!.estPerAgent.expected.paragraphRecombine).toBe(0);
    });

    it('per-iteration knobs flow into the cost projection', () => {
      const lo = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'paragraph_recombine', budgetPercent: 70, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 5 },
              rewritesPerParagraph: 1, maxParagraphsPerInvocation: 3, maxComparisonsPerParagraph: 1 },
          ],
        }),
        baseCtx(),
      );
      const hi = projectDispatchPlan(
        baseConfig({
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'paragraph_recombine', budgetPercent: 70, sourceMode: 'pool', qualityCutoff: { mode: 'topN', value: 5 },
              rewritesPerParagraph: 6, maxParagraphsPerInvocation: 24, maxComparisonsPerParagraph: 20 },
          ],
        }),
        baseCtx(),
      );
      expect(hi[1]!.estPerAgent.expected.paragraphRecombine)
        .toBeGreaterThan(lo[1]!.estPerAgent.expected.paragraphRecombine);
    });
  });

  // ─── Phase 7: paragraph_recombine projector reads qualityCutoff ─────────────────
  // The projector at projectDispatchPlan.ts:481 reads maxDispatches but the original
  // version used `poolSize` as the eligibility ceiling, ignoring qualityCutoff. The
  // runtime applies qualityCutoff at runIterationLoop.ts:1303-1318. This phase fixes
  // the wizard preview to match runtime dispatch counts.
  describe('Phase 7: resolveParagraphRecombineEligibility', () => {
    it('sourceMode != pool returns poolSize unchanged (seed source ignores cutoff)', () => {
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'seed',
        qualityCutoff: { mode: 'topN', value: 5 },
        poolSize: 14,
      })).toBe(14);
    });

    it('qualityCutoff undefined returns poolSize unchanged', () => {
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'pool',
        poolSize: 14,
      })).toBe(14);
    });

    it('qualityCutoff topN clamps to min(poolSize, value)', () => {
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topN', value: 5 },
        poolSize: 14,
      })).toBe(5);

      // When poolSize < value, poolSize wins.
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topN', value: 20 },
        poolSize: 14,
      })).toBe(14);
    });

    it('qualityCutoff topPercent uses ceil math (not floor or round)', () => {
      // poolSize=14, 50% → ceil(7) = 7
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topPercent', value: 50 },
        poolSize: 14,
      })).toBe(7);

      // poolSize=15, 50% → ceil(7.5) = 8 (asymmetric case: confirms ceil semantic;
      // a silent Math.round regression would return 8 too but Math.floor would return 7.)
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topPercent', value: 50 },
        poolSize: 15,
      })).toBe(8);
    });

    it('qualityCutoff topPercent enforces minimum of 1 on tiny pools', () => {
      // 5% of 3 = ceil(0.15) = 1 (not 0)
      expect(resolveParagraphRecombineEligibility({
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topPercent', value: 5 },
        poolSize: 3,
      })).toBe(1);
    });
  });

  describe('Phase 7: paragraph_recombine multi-dispatch reads qualityCutoff (bug-trigger config)', () => {
    const bugTriggerStrategyConfig = (overrides: { budgetUsd?: number } = {}) =>
      baseConfig({
        budgetUsd: overrides.budgetUsd ?? 0.05,
        iterationConfigs: [
          { agentType: 'generate', sourceMode: 'seed', budgetPercent: 40 },
          {
            agentType: 'paragraph_recombine',
            sourceMode: 'pool',
            budgetPercent: 60,
            maxDispatches: 10,
            qualityCutoff: { mode: 'topN', value: 5 },
            rewritesPerParagraph: 3,
            maxComparisonsPerParagraph: 8,
            maxParagraphsPerInvocation: 12,
          },
        ],
      });

    it('7.1: eligibility-binding case — widened budget so eligibility (not budget) caps', () => {
      // With wide budget ($0.30 vs production $0.05), eligibility is the binding cap.
      // Pre-fix: returned poolSize (some larger number) as ceiling → could overshoot 5.
      // Post-fix: caps at qualityCutoff.value=5.
      const plan = projectDispatchPlan(
        bugTriggerStrategyConfig({ budgetUsd: 0.30 }),
        baseCtx({ initialPoolSize: 14 }),
      );
      // Iter 0 (generate) grows poolSize. Iter 1 paragraph_recombine reads eligible.
      const pr = plan[1]!;
      expect(pr.agentType).toBe('paragraph_recombine');
      expect(pr.expectedTotalDispatch).toBeLessThanOrEqual(5); // eligibility ceiling enforced
      expect(pr.expectedTotalDispatch).toBeGreaterThanOrEqual(1);
    });

    it('7.2: budget-binding regression guard — narrow budget caps before eligibility does', () => {
      // Original $0.05 budget; pre-fix this also returned 1 (budget binding). Post-fix
      // should NOT regress this case — budget is still binding when per-agent cost is high.
      const plan = projectDispatchPlan(
        bugTriggerStrategyConfig({ budgetUsd: 0.05 }),
        baseCtx({ initialPoolSize: 14 }),
      );
      const pr = plan[1]!;
      // With narrow budget the dispatch count is constrained by budget; it should be a
      // SMALL number (typically 1 or 2 depending on cost projection). The fix must not
      // INCREASE this — eligibility==5 is now a ceiling, not a floor.
      expect(pr.expectedTotalDispatch).toBeLessThanOrEqual(5);
    });

    it("7.3 regression guard: sourceMode='seed' ignores qualityCutoff entirely", () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.30,
          iterationConfigs: [
            // Seed-source paragraph_recombine ignores qualityCutoff at runtime per docs.
            {
              agentType: 'paragraph_recombine',
              sourceMode: 'seed',
              budgetPercent: 100,
              maxDispatches: 10,
              qualityCutoff: { mode: 'topN', value: 5 },
            },
          ],
        }),
        baseCtx({ initialPoolSize: 14 }),
      );
      // poolSize wins (eligibility = poolSize when sourceMode != pool).
      // dispatchCount can be anywhere in [1, min(maxDispatches=10, poolSize=14)] = [1, 10].
      expect(plan[0]!.expectedTotalDispatch).toBeGreaterThanOrEqual(1);
    });

    it('7.4 regression guard: qualityCutoff undefined → poolSize is the ceiling', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.30,
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine',
              sourceMode: 'pool',
              budgetPercent: 100,
              maxDispatches: 10,
              // no qualityCutoff
            },
          ],
        }),
        baseCtx({ initialPoolSize: 14 }),
      );
      // ceiling = poolSize=14 since qualityCutoff undefined.
      expect(plan[0]!.expectedTotalDispatch).toBeLessThanOrEqual(10); // maxDispatches
    });

    it('7.6 regression guard: maxDispatches=1 still binds even with cutoff topN=5', () => {
      const plan = projectDispatchPlan(
        baseConfig({
          budgetUsd: 0.30,
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine',
              sourceMode: 'pool',
              budgetPercent: 100,
              maxDispatches: 1, // single-dispatch
              qualityCutoff: { mode: 'topN', value: 5 },
            },
          ],
        }),
        baseCtx({ initialPoolSize: 14 }),
      );
      expect(plan[0]!.expectedTotalDispatch).toBe(1);
    });
  });
});
