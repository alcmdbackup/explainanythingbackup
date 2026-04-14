// Pure resolver functions for the dual-unit budget floor system.
// Extracted from runIterationLoop.ts for testability.
//
// A phase's floor can be specified in either:
//   - Fraction of total budget (0-1)
//   - Multiple of estimated agent cost (≥ 0)
//
// Parallel phase uses the initial agent cost estimate (pre-batch).
// Sequential phase uses actualAvgCostPerAgent when available, falling back to initial.

export interface BudgetFloorConfig {
  minBudgetAfterParallelFraction?: number;
  minBudgetAfterParallelAgentMultiple?: number;
  minBudgetAfterSequentialFraction?: number;
  minBudgetAfterSequentialAgentMultiple?: number;
}

/** Resolve the parallel-phase floor to an absolute USD amount.
 *  Parallel floor uses the initial agent cost estimate only (the parallel batch
 *  hasn't run yet, so there's no actualAvgCostPerAgent feedback). */
export function resolveParallelFloor(
  cfg: BudgetFloorConfig,
  totalBudget: number,
  initialAgentCostEstimate: number,
): number {
  if (cfg.minBudgetAfterParallelFraction != null) {
    return totalBudget * cfg.minBudgetAfterParallelFraction;
  }
  if (cfg.minBudgetAfterParallelAgentMultiple != null) {
    if (!Number.isFinite(initialAgentCostEstimate) || initialAgentCostEstimate <= 0) return 0;
    return initialAgentCostEstimate * cfg.minBudgetAfterParallelAgentMultiple;
  }
  return 0;
}

/** Resolve the sequential-phase floor to an absolute USD amount.
 *  Sequential floor uses `actualAvgCostPerAgent` from the completed parallel batch
 *  when available (runtime feedback); otherwise falls back to the initial estimate. */
export function resolveSequentialFloor(
  cfg: BudgetFloorConfig,
  totalBudget: number,
  initialAgentCostEstimate: number,
  actualAvgCostPerAgent: number | null,
): number {
  if (cfg.minBudgetAfterSequentialFraction != null) {
    return totalBudget * cfg.minBudgetAfterSequentialFraction;
  }
  if (cfg.minBudgetAfterSequentialAgentMultiple != null) {
    const useActual =
      actualAvgCostPerAgent != null &&
      Number.isFinite(actualAvgCostPerAgent) &&
      actualAvgCostPerAgent > 0;
    const agentCost = useActual ? (actualAvgCostPerAgent as number) : initialAgentCostEstimate;
    if (!Number.isFinite(agentCost) || agentCost <= 0) return 0;
    return agentCost * cfg.minBudgetAfterSequentialAgentMultiple;
  }
  return 0;
}
