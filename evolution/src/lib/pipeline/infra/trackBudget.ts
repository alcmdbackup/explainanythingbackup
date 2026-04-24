// V2 budget-aware cost tracker with reserve-before-spend pattern for parallel safety.
// Also provides per-iteration budget wrappers for config-driven iteration dispatch.

import { BudgetExceededError } from '../../types';
import type { EntityLogger } from './createEntityLogger';
import type { AgentName } from '../../core/agentNames';

// ─── Iteration Budget Error ─────────────────────────────────────

/** Thrown when a per-iteration budget is exhausted (stops iteration only, not entire run). */
export class IterationBudgetExceededError extends BudgetExceededError {
  constructor(
    agentName: string,
    spent: number,
    reserved: number,
    cap: number,
    public readonly iterationIndex: number,
  ) {
    super(agentName, spent, reserved, cap);
    this.name = 'IterationBudgetExceededError';
  }
}

// ─── Interface ───────────────────────────────────────────────────

export interface V2CostTracker {
  /** Reserve budget before LLM call. Returns margined amount (1.3x). Synchronous. */
  reserve(phase: AgentName, estimatedCost: number): number;
  /** Record actual spend after LLM success. Deducts reservation, adds actual. */
  recordSpend(phase: AgentName, actualCost: number, reservedAmount: number): void;
  /** Release reservation on LLM failure without spending. */
  release(phase: AgentName, reservedAmount: number): void;
  getTotalSpent(): number;
  getPhaseCosts(): Partial<Record<AgentName, number>>;
  getAvailableBudget(): number;
}

/** Per-invocation cost scope: delegates budget gating to shared tracker, tracks own spend separately. */
export interface AgentCostScope extends V2CostTracker {
  /** Returns only this agent's LLM costs, independent of other concurrent agents. */
  getOwnSpent(): number;
}

// ─── Agent Cost Scope ─────────────────────────────────────────────

/**
 * Wraps a shared V2CostTracker so budget gating (reserve/release) remains shared
 * while cost attribution (recordSpend) is tracked independently per invocation.
 * Fixes parallel-execution delta bug where getTotalSpent() delta captured sibling costs.
 */
export function createAgentCostScope(shared: V2CostTracker): AgentCostScope {
  let ownSpent = 0;

  return {
    reserve: shared.reserve.bind(shared),
    recordSpend(phase: AgentName, actualCost: number, reservedAmount: number): void {
      ownSpent += actualCost;
      shared.recordSpend(phase, actualCost, reservedAmount);
    },
    release: shared.release.bind(shared),
    getTotalSpent: shared.getTotalSpent.bind(shared),
    getPhaseCosts: shared.getPhaseCosts.bind(shared),
    getAvailableBudget: shared.getAvailableBudget.bind(shared),
    getOwnSpent(): number { return ownSpent; },
  };
}

// ─── Constants ───────────────────────────────────────────────────

/** Safety margin multiplier for budget reservations. */
const RESERVE_MARGIN = 1.3;

/**
 * Quantization unit for margined reservations. Rounds to the nearest 0.0001 USD (1/100 of
 * a cent). This keeps float-arithmetic accumulation error from eating the safety margin on
 * tight budgets over thousands of small reserves (B020).
 */
const RESERVE_QUANTUM = 10_000;
function quantizeUsd(value: number): number {
  return Math.round(value * RESERVE_QUANTUM) / RESERVE_QUANTUM;
}

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
  const phaseCosts: Partial<Record<AgentName, number>> = {};
  let warned50 = false;
  let warned80 = false;

  return {
    // INVARIANT: reserve() must remain synchronous to maintain parallel safety
    // under Node.js single-threaded event loop. Do not add awaits to this function.
    reserve(phase: AgentName, estimatedCost: number): number {
      // B017: reject non-finite / negative inputs at the entry so garbage cost numbers can't
      // corrupt totalReserved (negative margined would inflate availableBudget).
      if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
        throw new Error(
          `V2CostTracker.reserve: estimatedCost must be finite and non-negative (phase=${phase}, got=${estimatedCost})`,
        );
      }
      // B020: quantize to 0.0001 USD so float-arithmetic accumulation error doesn't
      // erode the safety margin over thousands of small reserves on tight budgets.
      const margined = quantizeUsd(estimatedCost * RESERVE_MARGIN);
      if (totalSpent + totalReserved + margined > budgetUsd) {
        logger?.warn('Budget exceeded on reserve', { phaseName: phase, totalSpent, reserved: totalReserved + margined, budgetUsd });
        throw new BudgetExceededError(phase, totalSpent, totalReserved + margined, budgetUsd);
      }
      totalReserved += margined;
      return margined;
    },

    recordSpend(phase: AgentName, actualCost: number, reservedAmount: number): void {
      totalReserved = Math.max(0, totalReserved - reservedAmount);
      totalSpent += actualCost;
      phaseCosts[phase] = (phaseCosts[phase] ?? 0) + actualCost;

      if (totalSpent > budgetUsd) {
        const overage = totalSpent - budgetUsd;
        const msg = `Budget overrun: spent $${totalSpent.toFixed(4)} > cap $${budgetUsd.toFixed(4)} (overage: $${overage.toFixed(4)})`;
        if (logger) {
          logger.error(msg, { phaseName: phase, totalSpent, budgetUsd, overage });
        } else {
          console.error(`[V2CostTracker] ${msg}`);
        }
      }

      assertPostcondition(Number.isFinite(totalSpent), `totalSpent not finite after recordSpend: ${totalSpent}`, logger);

      if (totalSpent + totalReserved > budgetUsd * 1.01) {
        logger?.error('Budget invariant violated: totalSpent + totalReserved > budgetUsd * 1.01', {
          phaseName: phase, totalSpent, totalReserved, budgetUsd,
        });
      }

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

    release(_phase: AgentName, reservedAmount: number): void {
      totalReserved = Math.max(0, totalReserved - reservedAmount);
    },

    getTotalSpent(): number {
      return totalSpent;
    },

    getPhaseCosts(): Partial<Record<AgentName, number>> {
      return { ...phaseCosts };
    },

    getAvailableBudget(): number {
      return Math.max(0, budgetUsd - totalSpent - totalReserved);
    },
  };
}

// ─── Per-Iteration Budget Tracker ───────────────────────────────

/**
 * Creates a V2CostTracker that wraps a run-level tracker with a per-iteration budget cap.
 * reserve() checks run tracker first (throws BudgetExceededError if run exhausted),
 * then checks iteration remaining (throws IterationBudgetExceededError).
 * recordSpend/release delegate to both run tracker and iteration-level accounting.
 */
export function createIterationBudgetTracker(
  iterationBudgetUsd: number,
  runTracker: V2CostTracker,
  iterationIndex: number,
): V2CostTracker {
  let iterSpent = 0;
  let iterReserved = 0;
  const iterPhaseCosts: Partial<Record<AgentName, number>> = {};

  return {
    reserve(phase: AgentName, estimatedCost: number): number {
      // Check run-level first — throws BudgetExceededError (stops entire run).
      const margined = runTracker.reserve(phase, estimatedCost);
      // Now check iteration-level — throws IterationBudgetExceededError (stops iteration only).
      if (iterSpent + iterReserved + margined > iterationBudgetUsd) {
        // Release run-level reservation since we won't proceed.
        runTracker.release(phase, margined);
        throw new IterationBudgetExceededError(
          phase, iterSpent, iterReserved + margined, iterationBudgetUsd, iterationIndex,
        );
      }
      iterReserved += margined;
      return margined;
    },

    recordSpend(phase: AgentName, actualCost: number, reservedAmount: number): void {
      // Delegate to run tracker (handles global accounting + warnings).
      runTracker.recordSpend(phase, actualCost, reservedAmount);
      // Track iteration-level spend.
      iterReserved = Math.max(0, iterReserved - reservedAmount);
      iterSpent += actualCost;
      iterPhaseCosts[phase] = (iterPhaseCosts[phase] ?? 0) + actualCost;
    },

    release(phase: AgentName, reservedAmount: number): void {
      // Delegate to run tracker.
      runTracker.release(phase, reservedAmount);
      // Adjust iteration reserved.
      iterReserved = Math.max(0, iterReserved - reservedAmount);
    },

    getTotalSpent(): number {
      return iterSpent;
    },

    getPhaseCosts(): Partial<Record<AgentName, number>> {
      return { ...iterPhaseCosts };
    },

    getAvailableBudget(): number {
      const iterRemaining = Math.max(0, iterationBudgetUsd - iterSpent - iterReserved);
      return Math.min(iterRemaining, runTracker.getAvailableBudget());
    },
  };
}
