// Budget enforcement with per-agent attribution and atomic pre-call reservation.
// Checks budget BEFORE every LLM call with a 30% safety margin.

import type { CostTracker, EvolutionRunConfig } from '../types';
import { BudgetExceededError } from '../types';

export class CostTrackerImpl implements CostTracker {
  private spentByAgent: Map<string, number> = new Map();
  private totalSpent = 0;
  /** Optimistic reservations not yet reconciled by recordSpend. */
  private reservedByAgent: Map<string, number> = new Map();
  private totalReserved = 0;

  constructor(
    private readonly budgetCapUsd: number,
    private readonly budgetCaps: Record<string, number>,
  ) {}

  async reserveBudget(agentName: string, estimatedCost: number): Promise<void> {
    const withMargin = estimatedCost * 1.3;
    const agentCapPct = this.budgetCaps[agentName] ?? 0.20;
    const agentCap = agentCapPct * this.budgetCapUsd;
    const agentSpent = (this.spentByAgent.get(agentName) ?? 0) + (this.reservedByAgent.get(agentName) ?? 0);

    if (agentSpent + withMargin > agentCap) {
      throw new BudgetExceededError(agentName, agentSpent, agentCap);
    }
    if (this.totalSpent + this.totalReserved + withMargin > this.budgetCapUsd) {
      throw new BudgetExceededError('total', this.totalSpent + this.totalReserved, this.budgetCapUsd);
    }

    // Optimistic reservation: track the margin-adjusted estimate
    this.reservedByAgent.set(agentName, (this.reservedByAgent.get(agentName) ?? 0) + withMargin);
    this.totalReserved += withMargin;
  }

  recordSpend(agentName: string, actualCost: number): void {
    this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
    this.totalSpent += actualCost;

    // Release one reservation (FIFO-ish: release the oldest margin-adjusted estimate)
    const agentReserved = this.reservedByAgent.get(agentName) ?? 0;
    if (agentReserved > 0) {
      // Release the minimum of what was reserved vs a fair share
      const releaseAmount = Math.min(agentReserved, actualCost * 1.3);
      this.reservedByAgent.set(agentName, agentReserved - releaseAmount);
      this.totalReserved = Math.max(0, this.totalReserved - releaseAmount);
    }
  }

  getAgentCost(agentName: string): number {
    return this.spentByAgent.get(agentName) ?? 0;
  }

  getTotalSpent(): number {
    return this.totalSpent;
  }

  getAvailableBudget(): number {
    return this.budgetCapUsd - this.totalSpent;
  }

  getAllAgentCosts(): Record<string, number> {
    const costs: Record<string, number> = {};
    for (const [agentName, spent] of this.spentByAgent.entries()) {
      costs[agentName] = spent;
    }
    return costs;
  }
}

/** Factory: create CostTracker from run config. */
export function createCostTracker(config: EvolutionRunConfig): CostTrackerImpl {
  return new CostTrackerImpl(config.budgetCapUsd, config.budgetCaps);
}
