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

import type { EvolutionConfig } from '../infra/types';
import {
  estimateGenerationCost,
  estimateRankingCost,
  getVariantChars,
} from '../infra/estimateCosts';
import { resolveParallelFloor } from './budgetFloorResolvers';

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
  /** Ordered list of tactics the runtime will round-robin through. First element drives
   *  the per-iteration estimate (matches runtime's use of `tactics[0]`). */
  tactics: string[];
}

export interface EstPerAgentValue {
  gen: number;
  rank: number;
  total: number;
}

export interface EstPerAgent {
  /** Realistic expected cost (calibrated / heuristic). Used for display. */
  expected: EstPerAgentValue;
  /** Worst-case upper bound (max comparisons, full tactic output). Used for dispatch
   *  reservation so V2CostTracker can't overspend. */
  upperBound: EstPerAgentValue;
}

export type EffectiveCap = 'budget' | 'safety_cap' | 'floor' | 'swiss';

export interface IterationPlanEntry {
  iterIdx: number;
  agentType: 'generate' | 'swiss';
  iterBudgetUsd: number;
  /** Tactic assumed for the per-agent cost estimate (runtime uses tactics[0]). */
  tactic: string;
  estPerAgent: EstPerAgent;
  maxAffordable: {
    atExpected: number;
    atUpperBound: number;
  };
  /** Number of agents the runtime will dispatch at iteration start. Uses upperBound
   *  (reservation-safe). */
  dispatchCount: number;
  /** Why `dispatchCount` landed where it did — lets the UI show a "3 agents [budget]"
   *  badge so users understand which constraint bound. */
  effectiveCap: EffectiveCap;
  /** Pool size the runtime will see at the start of this iteration (incoming arena +
   *  variants accumulated from previous iterations' dispatchCount). */
  poolSizeAtStart: number;
  /** Absolute USD reserved by the parallel floor (computed against iterBudgetUsd, not
   *  totalBudget). 0 when no floor is configured. */
  parallelFloorUsd: number;
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
): IterationPlanEntry[] {
  const plan: IterationPlanEntry[] = [];
  let poolSize = ctx.initialPoolSize;
  const maxComp = config.maxComparisonsPerVariant ?? 15;
  const expectedComp = Math.max(1, Math.ceil(EXPECTED_RANK_COMPARISONS_RATIO * maxComp));

  for (let iterIdx = 0; iterIdx < config.iterationConfigs.length; iterIdx++) {
    const iterCfg = config.iterationConfigs[iterIdx]!;
    const iterBudgetUsd = (iterCfg.budgetPercent / 100) * config.budgetUsd;
    const tactic = ctx.tactics[iterIdx % Math.max(1, ctx.tactics.length)] ?? 'structural_transform';

    if (iterCfg.agentType === 'swiss') {
      plan.push({
        iterIdx,
        agentType: 'swiss',
        iterBudgetUsd,
        tactic,
        estPerAgent: {
          expected: { gen: 0, rank: 0, total: 0 },
          upperBound: { gen: 0, rank: 0, total: 0 },
        },
        maxAffordable: { atExpected: 0, atUpperBound: 0 },
        dispatchCount: 0,
        effectiveCap: 'swiss',
        poolSizeAtStart: poolSize,
        parallelFloorUsd: 0,
      });
      continue;
    }

    // ─── Generate iteration ───────────────────────────────────────
    // Upper bound: full tactic output + max comparisons (reservation-safe).
    const variantChars = getVariantChars(tactic, config.generationModel, config.judgeModel);
    const genUpper = estimateGenerationCost(ctx.seedChars, tactic, config.generationModel, config.judgeModel);
    const rankUpperBaseline = estimateRankingCost(variantChars, config.judgeModel, poolSize, maxComp);
    const totalUpper = genUpper + rankUpperBaseline;

    // Expected: apply heuristic ratios (or calibration, when enabled upstream).
    const genExpected = genUpper * EXPECTED_GEN_RATIO;
    const rankExpected = estimateRankingCost(variantChars, config.judgeModel, poolSize, expectedComp);
    const totalExpected = genExpected + rankExpected;

    // Iter-budget-scoped floor resolution (Phase 7a): budgetFloorResolvers.ts now
    // takes iterBudget as its 2nd arg instead of totalBudget. Unified across wizard
    // preview, runtime loop, and cost-sensitivity analysis.
    const parallelFloorUsd = resolveParallelFloor(config, iterBudgetUsd, totalUpper);
    const availBudget = Math.max(0, iterBudgetUsd - parallelFloorUsd);

    const maxAffordableUpper = totalUpper > 0
      ? Math.max(1, Math.floor(availBudget / totalUpper))
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

    plan.push({
      iterIdx,
      agentType: 'generate',
      iterBudgetUsd,
      tactic,
      estPerAgent: {
        expected: { gen: genExpected, rank: rankExpected, total: totalExpected },
        upperBound: { gen: genUpper, rank: rankUpperBaseline, total: totalUpper },
      },
      maxAffordable: { atExpected: maxAffordableExpected, atUpperBound: maxAffordableUpper },
      dispatchCount,
      effectiveCap,
      poolSizeAtStart: poolSize,
      parallelFloorUsd,
    });

    // Pool grows by dispatchCount for the next iteration's rank cost estimate.
    poolSize += dispatchCount;
  }

  return plan;
}

