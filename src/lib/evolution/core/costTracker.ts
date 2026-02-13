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
  /** FIFO queue of exact reservation amounts per agent for precise release. */
  private reservationQueues: Map<string, number[]> = new Map();

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
      console.warn('[CostTracker] Agent budget exceeded', {
        agentName, estimatedCost, withMargin, agentCapPct, agentCap,
        agentSpent, totalBudget: this.budgetCapUsd,
        allAgentCosts: this.getAllAgentCosts(),
      });
      throw new BudgetExceededError(agentName, agentSpent, agentCap);
    }
    if (this.totalSpent + this.totalReserved + withMargin > this.budgetCapUsd) {
      console.warn('[CostTracker] Total budget exceeded', {
        agentName, estimatedCost, withMargin,
        totalSpent: this.totalSpent, totalReserved: this.totalReserved,
        budgetCapUsd: this.budgetCapUsd,
        allAgentCosts: this.getAllAgentCosts(),
      });
      throw new BudgetExceededError('total', this.totalSpent + this.totalReserved, this.budgetCapUsd);
    }

    // Track individual reservation for FIFO release
    const queue = this.reservationQueues.get(agentName) ?? [];
    queue.push(withMargin);
    this.reservationQueues.set(agentName, queue);

    this.reservedByAgent.set(agentName, (this.reservedByAgent.get(agentName) ?? 0) + withMargin);
    this.totalReserved += withMargin;
  }

  recordSpend(agentName: string, actualCost: number): void {
    this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
    this.totalSpent += actualCost;

    // Release exactly one reservation (FIFO).
    // Safe if queue is empty (recordSpend called without prior reservation — e.g., test mocks).
    const queue = this.reservationQueues.get(agentName);
    if (queue && queue.length > 0) {
      const releaseAmount = queue.shift()!;
      this.reservedByAgent.set(agentName, Math.max(0, (this.reservedByAgent.get(agentName) ?? 0) - releaseAmount));
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
    return this.budgetCapUsd - this.totalSpent - this.totalReserved;
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
