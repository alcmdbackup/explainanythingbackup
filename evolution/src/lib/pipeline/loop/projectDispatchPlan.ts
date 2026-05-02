// Single source of truth for evolution dispatch-count prediction.
// Consumed by:
//   1. Runtime loop (runIterationLoop.ts) — sizes each iteration's batch.
//   2. Wizard preview (strategies/new/page.tsx via strategyPreviewActions) — shows users
//      "N guaranteed, M-P expected after top-up" before any run exists.
//   3. Cost-sensitivity analysis (costEstimationActions.ts) — counterfactual "what if
//      per-agent cost matched actuals from the start?" module on run/strategy detail pages.
//
// Returns triple-value estimates: `upperBound` (conservative, used for the dispatch
// reservation gate) and `expected` (realistic, used for display). When the calibration
// table is disabled (default today), `expected` applies two heuristic factors:
//   EXPECTED_GEN_RATIO          — median actual/upperBound generation cost
//   EXPECTED_RANK_COMPARISONS_RATIO — median actual/max comparisons per agent
// Both should be refreshed periodically from staging invocation data (see Phase 6a).
//
// Per-iteration per-agent cost is a weighted average over the effective tactic pool.
// The pool is resolved per iteration: iteration-level generationGuidance → strategy-level
// generationGuidance → config.strategies → DEFAULT_TACTICS. Matches runtime dispatch
// semantics (runIterationLoop round-robins / weight-samples tactics within each iter),
// so identically-budgeted iterations show identical estimates when no guidance is set.
//
// Top-up projection (investigate_issues_latest_evolution_reflection_agent_20260501):
// `expectedTotalDispatch` and `expectedTopUpDispatch` model the within-iteration top-up
// loop (Phase 7b) using `expected.total` as the proxy for `actualAvgCostPerAgent`.
// Closed-form: K_total <= floor((iterBudget - sequentialFloor) / expected.total),
// algebraically equivalent to the runtime's iterative `while (remaining - x >= floor)`.
// Gated by `opts.topUpEnabled` / `opts.reflectionEnabled` which mirror the
// EVOLUTION_TOPUP_ENABLED / EVOLUTION_REFLECTION_ENABLED runtime kill-switches. Callers
// resolve env at their own boundary so this function stays pure and reproducible.

import type { EvolutionConfig } from '../infra/types';
import {
  estimateGenerationCost,
  estimateRankingCost,
  estimateReflectionCost,
  getVariantChars,
} from '../infra/estimateCosts';
import { resolveParallelFloor, resolveSequentialFloor } from './budgetFloorResolvers';
import { DEFAULT_TACTICS } from '../../core/tactics';
import type { GuidanceEntry } from '../../core/tactics/selectTacticWeighted';

/** Defense-in-depth dispatch cap. Primary dispatch governor is budget via
 *  V2CostTracker.reserve() → BudgetExceededError; this catches budget-estimation bugs
 *  (e.g. a pricing-lookup regression returning $0 per agent) before they spawn
 *  thousands of parallel LLM calls. Set high enough that realistic strategies never
 *  hit it. Fires `effectiveCap: 'safety_cap'` when bound. */
export const DISPATCH_SAFETY_CAP = 100;

/** Median observed `actual_gen_cost / upperBound_gen_cost` across recent completed runs.
 *  Captures that (a) actual variant output is usually shorter than EMPIRICAL_OUTPUT_CHARS
 *  assumes, and (b) when strategies round-robin through 3 tactics of varying output sizes,
 *  the single-tactic upper-bound overshoots the average. Placeholder default 0.7 until
 *  sampled from staging (Phase 6a). */
export const EXPECTED_GEN_RATIO = 0.7;

/** Median observed `actual_comparisons / maxComparisonsPerVariant` across recent runs.
 *  Captures binary-search early exit (convergence at uncertainty<72 or elimination when
 *  elo + 2σ < top20Cutoff). Fed run showed ~0.5 (7.5 / 15). Placeholder default 0.5
 *  until sampled from staging (Phase 6a). */
export const EXPECTED_RANK_COMPARISONS_RATIO = 0.5;

/** Default seed-article char count used by the wizard preview when no prompt is selected
 *  and the user hasn't overridden. Matches the Fed-run observation (~8316) and is the
 *  rough median of prompt-seeded articles. Users can always override. */
export const DEFAULT_SEED_CHARS = 8000;

// ─── Public types ─────────────────────────────────────────────────

export interface DispatchPlanContext {
  /** Characters in the seed/parent article used as input to generation. Affects genCost
   *  linearly via input token count. */
  seedChars: number;
  /** Number of pre-existing variants in the pool at iteration 0 start (arena entries
   *  loaded via loadArenaEntries). Affects rankCost via numComparisons. */
  initialPoolSize: number;
}

/** Optional flags mirroring the runtime kill-switches. Threaded explicitly (not read from
 *  process.env) so this function remains pure and reproducible across the wizard, runtime,
 *  and counterfactual call sites. Each call site resolves env at its own boundary. */
export interface DispatchPlanOptions {
  /** When false, top-up simulation is skipped: `expectedTotalDispatch === dispatchCount`,
   *  `expectedTopUpDispatch === 0`. Mirrors EVOLUTION_TOPUP_ENABLED runtime flag. Default true. */
  topUpEnabled?: boolean;
  /** When false, reflection cost is zeroed for `reflect_and_generate` iterations because
   *  the runtime falls those iterations back to vanilla GFPA dispatch (see
   *  reflectionDispatch.ts). Mirrors EVOLUTION_REFLECTION_ENABLED. Default true. */
  reflectionEnabled?: boolean;
}

export interface EstPerAgentValue {
  gen: number;
  rank: number;
  /** Reflection cost per agent (only > 0 when iterCfg.agentType === 'reflect_and_generate'). 0 for vanilla GFPA. */
  reflection: number;
  /** Iterative editing cost per agent (only > 0 when iterCfg.agentType === 'iterative_editing').
   *  0 for generate / reflect / swiss. Mirrors the reflection field added by PR #1017. */
  editing: number;
  total: number;
}

export interface EstPerAgent {
  /** Realistic expected cost (calibrated / heuristic). Used for display. */
  expected: EstPerAgentValue;
  /** Worst-case upper bound (max comparisons, full tactic output). Used for dispatch
   *  reservation so V2CostTracker can't overspend. */
  upperBound: EstPerAgentValue;
}

export type EffectiveCap = 'budget' | 'safety_cap' | 'floor' | 'swiss' | 'eligibility';

export type TacticMixSource = 'iter-guidance' | 'strategy-guidance' | 'strategy-tactics' | 'defaults';

export interface TacticMixEntry {
  tactic: string;
  /** Normalized weight in [0, 1]. Sums to ~1 across mix. */
  weight: number;
}

export interface IterationPlanEntry {
  iterIdx: number;
  agentType: 'generate' | 'reflect_and_generate' | 'iterative_editing' | 'swiss';
  iterBudgetUsd: number;
  /** Effective tactic pool for this iteration (normalized weights). Cost estimates are
   *  weighted averages over this mix. Single-entry for guidance with one tactic. */
  tacticMix: TacticMixEntry[];
  /** Where the mix came from — drives display labeling. */
  tacticMixSource: TacticMixSource;
  /** Short display label summarizing the mix: the tactic name when size=1, else
   *  `"N defaults"` / `"N weighted"` / `"N tactics"` depending on source. */
  tacticLabel: string;
  estPerAgent: EstPerAgent;
  maxAffordable: {
    atExpected: number;
    atUpperBound: number;
  };
  /** Number of agents the runtime will dispatch at iteration start. Uses upperBound
   *  (reservation-safe). */
  dispatchCount: number;
  /** Top-up-aware total projection: parallel batch + estimated top-up agents using
   *  `expected.total` per-agent cost as proxy for `actualAvgCostPerAgent`. Capped at
   *  DISPATCH_SAFETY_CAP. Always >= dispatchCount. Equals dispatchCount when
   *  opts.topUpEnabled === false (mirrors EVOLUTION_TOPUP_ENABLED). */
  expectedTotalDispatch: number;
  /** Top-up agents projected beyond the parallel batch.
   *  expectedTotalDispatch - dispatchCount. Zero when top-up is disabled or when
   *  the parallel batch already saturates expected per-agent cost. */
  expectedTopUpDispatch: number;
  /** Why `dispatchCount` landed where it did — lets the UI show a "3 agents [budget]"
   *  badge so users understand which constraint bound. */
  effectiveCap: EffectiveCap;
  /** Pool size the runtime will see at the start of this iteration (incoming arena +
   *  variants accumulated from previous iterations' expectedTotalDispatch — matches
   *  the post-top-up pool the runtime actually grows). */
  poolSizeAtStart: number;
  /** Absolute USD reserved by the parallel floor (computed against iterBudgetUsd, not
   *  totalBudget). 0 when no floor is configured. */
  parallelFloorUsd: number;
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Resolve the effective tactic mix for one iteration.
 *
 * Precedence (highest → lowest):
 *   1. Iteration-level `generationGuidance` (weighted).
 *   2. Strategy-level `generationGuidance` (weighted).
 *   3. Strategy-level `strategies` list (uniform weights).
 *   4. `DEFAULT_TACTICS` (uniform weights).
 */
function buildTacticMix(
  iterGuidance: ReadonlyArray<GuidanceEntry> | undefined,
  strategyGuidance: ReadonlyArray<GuidanceEntry> | undefined,
  strategyTactics: ReadonlyArray<string> | undefined,
): { mix: TacticMixEntry[]; source: TacticMixSource } {
  const hasIterGuidance = iterGuidance != null && iterGuidance.length > 0;
  const hasStrategyGuidance = strategyGuidance != null && strategyGuidance.length > 0;
  const weighted = hasIterGuidance ? iterGuidance : hasStrategyGuidance ? strategyGuidance : null;

  if (weighted) {
    const total = weighted.reduce((s, e) => s + e.percent, 0);
    const n = total > 0 ? total : 1;
    return {
      mix: weighted.map((e) => ({ tactic: e.tactic, weight: e.percent / n })),
      source: hasIterGuidance ? 'iter-guidance' : 'strategy-guidance',
    };
  }
  if (strategyTactics && strategyTactics.length > 0) {
    const w = 1 / strategyTactics.length;
    return {
      mix: strategyTactics.map((t) => ({ tactic: t, weight: w })),
      source: 'strategy-tactics',
    };
  }
  const w = 1 / DEFAULT_TACTICS.length;
  return {
    mix: DEFAULT_TACTICS.map((t) => ({ tactic: t, weight: w })),
    source: 'defaults',
  };
}

/** Short human label for a tactic mix — single tactic name when size=1, else a summary
 *  that reflects where the mix came from. */
function buildTacticLabel(mix: TacticMixEntry[], source: TacticMixSource): string {
  if (mix.length === 1) return mix[0]!.tactic;
  switch (source) {
    case 'defaults': return `${mix.length} defaults`;
    case 'strategy-tactics': return `${mix.length} tactics`;
    case 'iter-guidance':
    case 'strategy-guidance':
      return `${mix.length} weighted`;
  }
}

/** Weighted average of per-agent generation + ranking cost across a tactic mix.
 *  When `useReflection` is true (i.e. the iteration's agentType is 'reflect_and_generate'),
 *  adds the reflection LLM call cost (uniform across the mix — reflection cost depends on
 *  parent text + topN, not the tactic). */
function weightedAgentCost(
  mix: ReadonlyArray<TacticMixEntry>,
  seedChars: number,
  generationModel: string,
  judgeModel: string,
  poolSize: number,
  numComparisons: number,
  useReflection: boolean = false,
  reflectionTopN: number = 3,
): EstPerAgentValue {
  let gen = 0;
  let rank = 0;
  for (const { tactic, weight } of mix) {
    const variantChars = getVariantChars(tactic, generationModel, judgeModel);
    gen += weight * estimateGenerationCost(seedChars, tactic, generationModel, judgeModel);
    rank += weight * estimateRankingCost(variantChars, judgeModel, poolSize, numComparisons);
  }
  // Reflection cost is per-agent, not per-tactic — same call for every dispatch.
  const reflection = useReflection
    ? estimateReflectionCost(seedChars, generationModel, judgeModel, reflectionTopN)
    : 0;
  return { gen, rank, reflection, editing: 0, total: reflection + gen + rank };
}

// ─── Main ─────────────────────────────────────────────────────────

/**
 * Compute the full iteration plan for a strategy config + context.
 *
 * The runtime dispatches `plan[iterIdx].dispatchCount` agents at iteration start; top-up
 * then fills beyond that if the observed `actualAvgCostPerAgent` from the parallel batch
 * indicates budget remains (see Phase 7b in runIterationLoop.ts). This function does NOT
 * model top-up — it returns the initial parallel-batch size, same as today's runtime.
 *
 * Swiss iterations return zero-cost entries (dispatchCount=0) — the orchestrator still
 * runs a single SwissRankingAgent invocation per swiss iteration, but it doesn't factor
 * into `agent cost` the way generate iterations do.
 */
export function projectDispatchPlan(
  config: EvolutionConfig,
  ctx: DispatchPlanContext,
  opts: DispatchPlanOptions = {},
): IterationPlanEntry[] {
  const plan: IterationPlanEntry[] = [];
  let poolSize = ctx.initialPoolSize;
  const maxComp = config.maxComparisonsPerVariant ?? 15;
  const expectedComp = Math.max(1, Math.ceil(EXPECTED_RANK_COMPARISONS_RATIO * maxComp));
  const strategyTactics = config.strategies && config.strategies.length > 0 ? config.strategies : undefined;
  const strategyGuidance = config.generationGuidance as ReadonlyArray<GuidanceEntry> | undefined;
  // Defaults match runtime kill-switch convention (`!== 'false'`): unset/true = enabled.
  const topUpEnabled = opts.topUpEnabled !== false;
  const reflectionEnabled = opts.reflectionEnabled !== false;

  for (let iterIdx = 0; iterIdx < config.iterationConfigs.length; iterIdx++) {
    const iterCfg = config.iterationConfigs[iterIdx]!;
    const iterBudgetUsd = (iterCfg.budgetPercent / 100) * config.budgetUsd;
    const iterGuidance = iterCfg.generationGuidance as ReadonlyArray<GuidanceEntry> | undefined;

    const { mix, source } = buildTacticMix(iterGuidance, strategyGuidance, strategyTactics);
    const tacticLabel = buildTacticLabel(mix, source);

    if (iterCfg.agentType === 'swiss') {
      plan.push({
        iterIdx,
        agentType: 'swiss',
        iterBudgetUsd,
        tacticMix: mix,
        tacticMixSource: source,
        tacticLabel,
        estPerAgent: {
          expected: { gen: 0, rank: 0, reflection: 0, editing: 0, total: 0 },
          upperBound: { gen: 0, rank: 0, reflection: 0, editing: 0, total: 0 },
        },
        maxAffordable: { atExpected: 0, atUpperBound: 0 },
        dispatchCount: 0,
        expectedTotalDispatch: 0,
        expectedTopUpDispatch: 0,
        effectiveCap: 'swiss',
        poolSizeAtStart: poolSize,
        parallelFloorUsd: 0,
      });
      continue;
    }

    if (iterCfg.agentType === 'iterative_editing') {
      // Per Decisions §13/§14/§17: editing iterations cost = maxCycles × (propose +
      // review) per parent, with the article growing up to 1.5× per cycle in
      // upper-bound. Eligibility cutoff comes from the shared dispatch helper —
      // same call site as the runtime, math agrees via applyCutoffToCount.
      const { estimateIterativeEditingCost } = require('../infra/estimateCosts') as typeof import('../infra/estimateCosts');
      const { resolveEditingDispatchPlanner } = require('./editingDispatch') as typeof import('./editingDispatch');

      const maxCycles = (iterCfg as { editingMaxCycles?: number }).editingMaxCycles ?? 3;
      const editingModel = (config as { editingModel?: string }).editingModel ?? config.generationModel;
      const approverModel = (config as { approverModel?: string }).approverModel ?? editingModel;
      const driftRecoveryModel = (config as { driftRecoveryModel?: string }).driftRecoveryModel ?? 'gpt-4.1-nano';

      const editCost = estimateIterativeEditingCost(
        ctx.seedChars,
        editingModel,
        approverModel,
        driftRecoveryModel,
        config.judgeModel,
        maxCycles,
      );

      // Apply eligibility cutoff against the projected pool. Editing iterations
      // require an existing pool; if poolSize === 0 (first iter is editing — blocked
      // by schema first-iter refine), there are no eligible parents.
      const cutoffResult = resolveEditingDispatchPlanner({
        projectedPoolSize: poolSize,
        cutoff: (iterCfg as { editingEligibilityCutoff?: { mode: 'topN' | 'topPercent'; value: number } }).editingEligibilityCutoff,
      });

      const parallelFloorUsd = resolveParallelFloor(config, iterBudgetUsd, editCost.upperBound);
      const availBudget = Math.max(0, iterBudgetUsd - parallelFloorUsd);
      const maxAffordableUpper = editCost.upperBound > 0
        ? Math.max(1, Math.floor(availBudget / editCost.upperBound))
        : 1;
      const maxAffordableExpected = editCost.expected > 0
        ? Math.max(1, Math.floor(availBudget / editCost.expected))
        : 1;

      const dispatchCount = Math.min(
        DISPATCH_SAFETY_CAP,
        maxAffordableUpper,
        cutoffResult.eligibleCount,
      );

      let effectiveCap: EffectiveCap;
      if (dispatchCount === cutoffResult.eligibleCount && cutoffResult.effectiveCap === 'eligibility') {
        effectiveCap = 'eligibility';
      } else if (dispatchCount >= DISPATCH_SAFETY_CAP) {
        effectiveCap = 'safety_cap';
      } else if (parallelFloorUsd > 0 && maxAffordableUpper === 1) {
        effectiveCap = 'floor';
      } else {
        effectiveCap = 'budget';
      }

      plan.push({
        iterIdx,
        agentType: 'iterative_editing',
        iterBudgetUsd,
        tacticMix: mix,
        tacticMixSource: source,
        tacticLabel,
        estPerAgent: {
          expected: { gen: 0, rank: 0, reflection: 0, editing: editCost.expected, total: editCost.expected },
          upperBound: { gen: 0, rank: 0, reflection: 0, editing: editCost.upperBound, total: editCost.upperBound },
        },
        maxAffordable: { atExpected: maxAffordableExpected, atUpperBound: maxAffordableUpper },
        dispatchCount,
        effectiveCap,
        poolSizeAtStart: poolSize,
        parallelFloorUsd,
      });

      // Editing produces ONE final variant per dispatch (Decisions §14).
      poolSize += dispatchCount;
      continue;
    }

    // ─── Generate / reflect-and-generate iteration ────────────────
    // Shape A: 'reflect_and_generate' is a third top-level agentType. When the iteration
    // is reflect_and_generate AND opts.reflectionEnabled, weightedAgentCost includes the
    // reflection LLM call cost so parallelDispatchCount sizing accounts for it. When the
    // EVOLUTION_REFLECTION_ENABLED kill-switch is off, the runtime falls
    // reflect_and_generate iters back to vanilla GFPA (reflectionDispatch.ts) — we
    // mirror that here so the preview matches what runtime will actually dispatch.
    const useReflection = iterCfg.agentType === 'reflect_and_generate' && reflectionEnabled;
    const reflectionTopN = iterCfg.reflectionTopN ?? 3;

    // Upper bound: full tactic output + max comparisons (reservation-safe).
    const upper = weightedAgentCost(
      mix, ctx.seedChars, config.generationModel, config.judgeModel, poolSize, maxComp,
      useReflection, reflectionTopN,
    );
    // Expected: rank uses fewer comparisons (heuristic early-exit factor); gen scales
    // by EXPECTED_GEN_RATIO from the upper bound. Reflection cost is deterministic per
    // call so expected = upperBound for that field.
    const rankExpectedAvg = weightedAgentCost(
      mix, ctx.seedChars, config.generationModel, config.judgeModel, poolSize, expectedComp,
      useReflection, reflectionTopN,
    ).rank;
    const reflectionExpected = upper.reflection;
    const genExpected = upper.gen * EXPECTED_GEN_RATIO;
    const totalExpected = reflectionExpected + genExpected + rankExpectedAvg;

    // Iter-budget-scoped floor resolution (Phase 7a): budgetFloorResolvers.ts now
    // takes iterBudget as its 2nd arg instead of totalBudget. Unified across wizard
    // preview, runtime loop, and cost-sensitivity analysis.
    const parallelFloorUsd = resolveParallelFloor(config, iterBudgetUsd, upper.total);
    const availBudget = Math.max(0, iterBudgetUsd - parallelFloorUsd);

    const maxAffordableUpper = upper.total > 0
      ? Math.max(1, Math.floor(availBudget / upper.total))
      : 1;
    const maxAffordableExpected = totalExpected > 0
      ? Math.max(1, Math.floor(availBudget / totalExpected))
      : 1;

    // Dispatch gate uses upperBound for reservation safety.
    const dispatchCount = Math.min(DISPATCH_SAFETY_CAP, maxAffordableUpper);

    let effectiveCap: EffectiveCap;
    if (dispatchCount >= DISPATCH_SAFETY_CAP) {
      effectiveCap = 'safety_cap';
    } else if (parallelFloorUsd > 0 && maxAffordableUpper === 1) {
      // Floor bit hard enough to force dispatch down to the 1-agent minimum.
      effectiveCap = 'floor';
    } else {
      effectiveCap = 'budget';
    }

    // ─── Top-up projection ────────────────────────────────────────
    // Mirrors Phase 7b in runIterationLoop.ts. The runtime's iterative gate
    //   while (remaining - actualAvgCost >= sequentialFloor) dispatch++
    // (with remaining = iterBudget - parallelSpend - topUpSpend, parallelSpend ≈
    // dispatchCount × actualAvgCost) reduces algebraically to
    //   K_total ≤ floor((iterBudget - sequentialFloor) / actualAvgCost).
    // We use `totalExpected` as the pre-run proxy for actualAvgCost; resolveSequentialFloor
    // falls back to that proxy when AgentMultiple mode is configured.
    let expectedTotalDispatch = dispatchCount;
    let expectedTopUpDispatch = 0;
    if (topUpEnabled && totalExpected > 0) {
      const sequentialFloorUsd = resolveSequentialFloor(config, iterBudgetUsd, upper.total, totalExpected);
      const totalAffordable = Math.max(
        dispatchCount,
        Math.floor((iterBudgetUsd - sequentialFloorUsd) / totalExpected),
      );
      expectedTotalDispatch = Math.min(DISPATCH_SAFETY_CAP, totalAffordable);
      expectedTopUpDispatch = expectedTotalDispatch - dispatchCount;
    }

    plan.push({
      iterIdx,
      agentType: iterCfg.agentType,
      iterBudgetUsd,
      tacticMix: mix,
      tacticMixSource: source,
      tacticLabel,
      estPerAgent: {
        expected: { gen: genExpected, rank: rankExpectedAvg, reflection: reflectionExpected, editing: 0, total: totalExpected },
        upperBound: { gen: upper.gen, rank: upper.rank, reflection: upper.reflection, editing: upper.editing ?? 0, total: upper.total },
      },
      maxAffordable: { atExpected: maxAffordableExpected, atUpperBound: maxAffordableUpper },
      dispatchCount,
      expectedTotalDispatch,
      expectedTopUpDispatch,
      effectiveCap,
      poolSizeAtStart: poolSize,
      parallelFloorUsd,
    });

    // Pool grows by `expectedTotalDispatch` (parallel + projected top-up) for the next
    // iteration's rank cost estimate. Matches what the runtime actually grows post-top-up.
    poolSize += expectedTotalDispatch;
  }

  return plan;
}
