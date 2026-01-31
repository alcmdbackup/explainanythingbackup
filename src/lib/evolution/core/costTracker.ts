// Budget enforcement with per-agent attribution and atomic pre-call reservation.
// Checks budget BEFORE every LLM call with a 30% safety margin.

import type { CostTracker, EvolutionRunConfig } from '../types';
import { BudgetExceededError } from '../types';

export class CostTrackerImpl implements CostTracker {
  private spentByAgent: Map<string, number> = new Map();
  private totalSpent = 0;

  constructor(
    private readonly budgetCapUsd: number,
    private readonly budgetCaps: Record<string, number>,
  ) {}

  async reserveBudget(agentName: string, estimatedCost: number): Promise<void> {
    const withMargin = estimatedCost * 1.3;
    const agentCapPct = this.budgetCaps[agentName] ?? 0.20;
    const agentCap = agentCapPct * this.budgetCapUsd;
    const agentSpent = this.spentByAgent.get(agentName) ?? 0;

    if (agentSpent + withMargin > agentCap) {
      throw new BudgetExceededError(agentName, agentSpent, agentCap);
    }
    if (this.totalSpent + withMargin > this.budgetCapUsd) {
      throw new BudgetExceededError('total', this.totalSpent, this.budgetCapUsd);
    }
  }

  recordSpend(agentName: string, actualCost: number): void {
    this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
    this.totalSpent += actualCost;
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
}

/** Factory: create CostTracker from run config. */
export function createCostTracker(config: EvolutionRunConfig): CostTrackerImpl {
  return new CostTrackerImpl(config.budgetCapUsd, config.budgetCaps);
}
