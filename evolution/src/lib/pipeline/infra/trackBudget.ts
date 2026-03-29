// V2 budget-aware cost tracker with reserve-before-spend pattern for parallel safety.

import { BudgetExceededError } from '../../types';
import type { EntityLogger } from './createEntityLogger';

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

/** Whether strict assertions are enabled (dev/test only). */
const STRICT_ASSERTIONS = process.env.EVOLUTION_ASSERTIONS === 'true';

/** Assert a postcondition — logs unconditionally, throws only in strict mode. */
function assertPostcondition(
  condition: boolean,
  message: string,
  logger?: EntityLogger,
): void {
  if (!condition) {
    logger?.error(`Budget assertion failed: ${message}`, { phaseName: 'budget_assertion' });
    if (STRICT_ASSERTIONS) {
      throw new Error(`Budget assertion failed: ${message}`);
    }
  }
}

// ─── Implementation ──────────────────────────────────────────────

export function createCostTracker(budgetUsd: number, logger?: EntityLogger): V2CostTracker {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    throw new Error(`createCostTracker: budgetUsd must be a positive finite number, got ${budgetUsd}`);
  }
  let totalSpent = 0;
  let totalReserved = 0;
  const phaseCosts: Record<string, number> = {};
  let warned50 = false;
  let warned80 = false;

  return {
    // INVARIANT: reserve() must remain synchronous to maintain parallel safety
    // under Node.js single-threaded event loop. Do not add awaits to this function.
    reserve(phase: string, estimatedCost: number): number {
      const margined = estimatedCost * RESERVE_MARGIN;
      if (totalSpent + totalReserved + margined > budgetUsd) {
        logger?.warn('Budget exceeded on reserve', { phaseName: phase, totalSpent, reserved: totalReserved + margined, budgetUsd });
        throw new BudgetExceededError(phase, totalSpent, totalReserved + margined, budgetUsd);
      }
      totalReserved += margined;
      if (estimatedCost >= 0) {
        assertPostcondition(totalReserved >= 0, `totalReserved negative after reserve: ${totalReserved}`, logger);
      }
      return margined;
    },

    recordSpend(phase: string, actualCost: number, reservedAmount: number): void {
      totalReserved = Math.max(0, totalReserved - reservedAmount);
      totalSpent += actualCost;
      phaseCosts[phase] = (phaseCosts[phase] ?? 0) + actualCost;

      if (totalSpent > budgetUsd) {
        const msg = `Budget overrun: spent $${totalSpent.toFixed(4)} > cap $${budgetUsd.toFixed(4)} (overage: $${(totalSpent - budgetUsd).toFixed(4)})`;
        if (logger) {
          logger.error(msg, { phaseName: phase, totalSpent, budgetUsd, overage: totalSpent - budgetUsd });
        } else {
          console.error(`[V2CostTracker] ${msg}`);
        }
      }

      // Postcondition assertions
      assertPostcondition(totalReserved >= 0, `totalReserved negative after recordSpend: ${totalReserved}`, logger);
      assertPostcondition(Number.isFinite(totalSpent), `totalSpent not finite after recordSpend: ${totalSpent}`, logger);

      // Core budget invariant (unconditional — runs in all environments)
      if (totalSpent + totalReserved > budgetUsd * 1.01) {
        logger?.error('Budget invariant violated: totalSpent + totalReserved > budgetUsd * 1.01', {
          phaseName: phase, totalSpent, totalReserved, budgetUsd,
        });
      }

      // Threshold warnings
      const pct = totalSpent / budgetUsd;
      if (!warned50 && pct >= 0.5) {
        warned50 = true;
        logger?.info('Budget 50% consumed', { phaseName: phase, totalSpent, budgetUsd });
      }
      if (!warned80 && pct >= 0.8) {
        warned80 = true;
        logger?.warn('Budget 80% consumed', { phaseName: phase, totalSpent, budgetUsd });
      }
    },

    release(_phase: string, reservedAmount: number): void {
      totalReserved = Math.max(0, totalReserved - reservedAmount);
      assertPostcondition(totalReserved >= 0, `totalReserved negative after release: ${totalReserved}`, logger);
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
