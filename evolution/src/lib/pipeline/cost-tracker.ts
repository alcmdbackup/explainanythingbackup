// V2 budget-aware cost tracker with reserve-before-spend pattern for parallel safety.

import { BudgetExceededError } from '../types';

// ─── Interface ───────────────────────────────────────────────────

export interface V2CostTracker {
  /** Reserve budget before LLM call. Returns margined amount (1.3x). Synchronous. */
  reserve(phase: string, estimatedCost: number): number;
  /** Record actual spend after LLM success. Deducts reservation, adds actual. */
  recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
  /** Release reservation on LLM failure without spending. */
  release(phase: string, reservedAmount: number): void;
  getTotalSpent(): number;
  getPhaseCosts(): Record<string, number>;
  getAvailableBudget(): number;
}

// ─── Constants ───────────────────────────────────────────────────

/** Safety margin multiplier for budget reservations. */
const RESERVE_MARGIN = 1.3;

// ─── Implementation ──────────────────────────────────────────────

export function createCostTracker(budgetUsd: number): V2CostTracker {
  let totalSpent = 0;
  let totalReserved = 0;
  const phaseCosts: Record<string, number> = {};

  return {
    // INVARIANT: reserve() must remain synchronous to maintain parallel safety
    // under Node.js single-threaded event loop. Do not add awaits to this function.
    reserve(phase: string, estimatedCost: number): number {
      const margined = estimatedCost * RESERVE_MARGIN;
      if (totalSpent + totalReserved + margined > budgetUsd) {
        throw new BudgetExceededError(phase, totalSpent, totalReserved + margined, budgetUsd);
      }
      totalReserved += margined;
      return margined;
    },

    recordSpend(phase: string, actualCost: number, reservedAmount: number): void {
      totalReserved = Math.max(0, totalReserved - reservedAmount);
      totalSpent += actualCost;
      phaseCosts[phase] = (phaseCosts[phase] ?? 0) + actualCost;

      if (totalSpent > budgetUsd) {
        console.error(
          `[V2CostTracker] Budget overrun: spent $${totalSpent.toFixed(4)} > cap $${budgetUsd.toFixed(4)} (overage: $${(totalSpent - budgetUsd).toFixed(4)})`,
        );
      }
    },

    release(_phase: string, reservedAmount: number): void {
      totalReserved = Math.max(0, totalReserved - reservedAmount);
    },

    getTotalSpent(): number {
      return totalSpent;
    },

    getPhaseCosts(): Record<string, number> {
      return { ...phaseCosts };
    },

    getAvailableBudget(): number {
      return Math.max(0, budgetUsd - totalSpent - totalReserved);
    },
  };
}
