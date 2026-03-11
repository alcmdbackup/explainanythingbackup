// Budget enforcement with per-agent attribution and atomic pre-call reservation.
// Checks global budget BEFORE every LLM call with a 30% safety margin.
// NOTE: Per-agent cost tracking (spentByAgent) is for attribution/reporting only —
// there are no per-agent budget limits. Only the global budgetCapUsd is enforced.

import type { CostTracker, EvolutionRunConfig, BudgetEventLogger } from '../types';
import { BudgetExceededError } from '../types';

export class CostTrackerImpl implements CostTracker {
  /** Per-agent spend tracking — attribution only, not enforced as limits. */
  private spentByAgent: Map<string, number> = new Map();
  private totalSpent = 0;
  /** Optimistic reservations not yet reconciled by recordSpend. */
  private reservedByAgent: Map<string, number> = new Map();
  private totalReserved = 0;
  /** FIFO queue of exact reservation amounts per agent for precise release. */
  private reservationQueues: Map<string, number[]> = new Map();
  /** Per-invocation cost accumulator — keyed by invocation UUID, value is incremental cost delta. */
  private invocationCosts: Map<string, number> = new Map();
  /** Optional event logger for audit trail. */
  private eventLogger?: BudgetEventLogger;
  /** Latched flag: set once totalSpent exceeds budgetCapUsd, prevents further reservations. */
  private budgetOverflowed = false;

  constructor(
    private readonly budgetCapUsd: number,
  ) {}

  setEventLogger(logger: BudgetEventLogger): void {
    this.eventLogger = logger;
  }

  private emitEvent(eventType: 'reserve' | 'spend' | 'release_ok' | 'release_failed', agentName: string, amountUsd: number, invocationId?: string): void {
    this.eventLogger?.({
      eventType,
      agentName,
      amountUsd,
      totalSpentUsd: this.totalSpent,
      totalReservedUsd: this.totalReserved,
      availableBudgetUsd: this.getAvailableBudget(),
      invocationId,
    });
  }

  get isOverflowed(): boolean {
    return this.budgetOverflowed;
  }

  async reserveBudget(agentName: string, estimatedCost: number): Promise<void> {
    if (this.budgetOverflowed) {
      throw new BudgetExceededError('total', this.totalSpent, this.totalReserved, this.budgetCapUsd);
    }

    const withMargin = estimatedCost * 1.3;

    if (this.totalSpent + this.totalReserved + withMargin > this.budgetCapUsd) {
      throw new BudgetExceededError('total', this.totalSpent, this.totalReserved, this.budgetCapUsd);
    }
    const queue = this.reservationQueues.get(agentName) ?? [];
    queue.push(withMargin);
    this.reservationQueues.set(agentName, queue);

    this.reservedByAgent.set(agentName, (this.reservedByAgent.get(agentName) ?? 0) + withMargin);
    this.totalReserved += withMargin;

    this.emitEvent('reserve', agentName, withMargin);
  }

  recordSpend(agentName: string, actualCost: number, invocationId?: string): void {
    if (actualCost < 0) {
      throw new Error(`recordSpend: negative cost (${actualCost}) for agent "${agentName}"`);
    }

    this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
    this.totalSpent += actualCost;

    if (this.totalSpent > this.budgetCapUsd) {
      this.budgetOverflowed = true;
    }

    if (invocationId) {
      this.invocationCosts.set(invocationId, (this.invocationCosts.get(invocationId) ?? 0) + actualCost);
    }

    this.dequeueReservation(agentName);
    this.emitEvent('spend', agentName, actualCost, invocationId);
  }

  releaseReservation(agentName: string): void {
    const released = this.dequeueReservation(agentName);
    if (released >= 0) {
      this.emitEvent('release_ok', agentName, released);
    } else {
      this.emitEvent('release_failed', agentName, 0);
    }
  }

  /** Dequeue and subtract the oldest reservation for an agent. Returns the released amount, or -1 if none found. */
  private dequeueReservation(agentName: string): number {
    const queue = this.reservationQueues.get(agentName);
    if (!queue?.length) return -1;

    const releaseAmount = queue.shift()!;
    this.reservedByAgent.set(agentName, Math.max(0, (this.reservedByAgent.get(agentName) ?? 0) - releaseAmount));
    this.totalReserved = Math.max(0, this.totalReserved - releaseAmount);
    return releaseAmount;
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

  getTotalReserved(): number {
    return this.totalReserved;
  }

  getAllAgentCosts(): Record<string, number> {
    return Object.fromEntries(this.spentByAgent.entries());
  }

  getInvocationCost(invocationId: string): number {
    return this.invocationCosts.get(invocationId) ?? 0;
  }

  restoreSpent(amount: number): void {
    if (this.totalSpent > 0) {
      throw new Error('restoreSpent: cannot restore after spending has begun');
    }

    if (amount < 0) {
      throw new Error(`restoreSpent: negative amount (${amount})`);
    }

    this.totalSpent = amount;
  }
}

export function createCostTracker(config: EvolutionRunConfig): CostTrackerImpl {
  return new CostTrackerImpl(config.budgetCapUsd);
}

export function createCostTrackerFromCheckpoint(config: EvolutionRunConfig, restoredTotalSpent: number): CostTrackerImpl {
  const tracker = new CostTrackerImpl(config.budgetCapUsd);
  tracker.restoreSpent(restoredTotalSpent);
  return tracker;
}
