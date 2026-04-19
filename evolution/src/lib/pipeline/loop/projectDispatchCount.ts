// Pure helper that reproduces the parallel/sequential dispatch-count math from
// runIterationLoop.ts. Used by both the runtime loop and the post-hoc Budget Floor
// Sensitivity analysis in costEstimationActions.ts so the "projected" scenario math
// can't drift from what actually runs.
//
// Keeps floor-resolution delegated to budgetFloorResolvers.ts (single source of truth
// for floor math). This helper only computes how many agents would be dispatched given
// a resolved estAgentCost, totalBudget, floor config, and numVariants ceiling.

import { resolveParallelFloor, resolveSequentialFloor, type BudgetFloorConfig } from './budgetFloorResolvers';

export interface ProjectDispatchCountsInput {
  totalBudget: number;
  numVariants: number;
  /** Agent-cost value used throughout — pre-dispatch estimate for "actual" scenario,
   *  observed actual for "projected" scenario. */
  agentCost: number;
  /** Available budget at the start of the sequential phase (i.e., totalBudget minus
   *  whatever parallel actually spent). For the projected scenario, callers typically
   *  use `totalBudget - (projectedParallelDispatched * agentCost)` since the projection
   *  assumes parallel spends at the same per-agent cost. */
  sequentialStartingBudget: number;
  floorConfig: BudgetFloorConfig;
}

export interface ProjectDispatchCounts {
  parallelFloor: number;
  parallelBudget: number;
  parallelDispatched: number;
  sequentialFloor: number;
  sequentialDispatched: number;
}

const EMPTY_COUNTS: ProjectDispatchCounts = {
  parallelFloor: 0, parallelBudget: 0, parallelDispatched: 0,
  sequentialFloor: 0, sequentialDispatched: 0,
};

/** Compute projected parallel + sequential dispatch counts given fixed floor config
 *  and a single agent-cost value used everywhere. Returns all-zero counts when inputs
 *  are unworkable (non-positive agent cost or budget) so callers can short-circuit
 *  without NaN/Infinity leaking into metrics. */
export function projectDispatchCounts(input: ProjectDispatchCountsInput): ProjectDispatchCounts {
  const { totalBudget, numVariants, agentCost, floorConfig } = input;

  if (!Number.isFinite(agentCost) || agentCost <= 0) return EMPTY_COUNTS;
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) return EMPTY_COUNTS;
  if (!Number.isFinite(numVariants) || numVariants <= 0) return EMPTY_COUNTS;

  const parallelFloor = resolveParallelFloor(floorConfig, totalBudget, agentCost);
  const parallelBudget = Math.max(0, totalBudget - parallelFloor);
  // Mirror runIterationLoop.ts: maxAffordable = max(1, floor(effectiveBudget / estPerAgent))
  const maxAffordable = Math.max(1, Math.floor(parallelBudget / agentCost));
  const parallelDispatched = Math.min(numVariants, maxAffordable);

  // Sequential floor resolution uses runtime feedback (actualAvgCostPerAgent) in the
  // pipeline. For projection math we pass the same agentCost as both the fallback and
  // the runtime value — the projection's whole point is to hold one cost fixed throughout.
  const sequentialFloor = resolveSequentialFloor(floorConfig, totalBudget, agentCost, agentCost);

  // Sequential loop dispatches while (availBudget - agentCost) >= sequentialFloor.
  // Starting from `sequentialStartingBudget`, after the k-th dispatch:
  //   availBudget_k = sequentialStartingBudget - k * agentCost
  // (k+1)-th dispatch allowed iff availBudget_k - agentCost >= sequentialFloor, i.e.
  //   k+1 <= (sequentialStartingBudget - sequentialFloor) / agentCost
  // So total dispatch count is floor((sequentialStartingBudget - sequentialFloor) / agentCost)
  // when positive, else 0.
  const startingBudget = Number.isFinite(input.sequentialStartingBudget) && input.sequentialStartingBudget > 0
    ? input.sequentialStartingBudget : 0;
  const sequentialCapacity = (startingBudget - sequentialFloor) / agentCost;
  const sequentialByBudget = sequentialCapacity > 0 ? Math.floor(sequentialCapacity) : 0;
  // Respect the numVariants ceiling: total dispatches (parallel + sequential) cap at numVariants.
  const sequentialCeiling = Math.max(0, numVariants - parallelDispatched);
  const sequentialDispatched = Math.min(sequentialByBudget, sequentialCeiling);

  return {
    parallelFloor,
    parallelBudget,
    parallelDispatched,
    sequentialFloor,
    sequentialDispatched,
  };
}
