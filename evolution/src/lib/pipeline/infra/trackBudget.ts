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
  /**
   * Returns per-agent-label cost accumulator. The legacy name is `phaseCosts` for
   * backward compatibility — semantically these are per-subagent costs (one entry
   * per AgentName label = one subagent name). New code should prefer
   * `getSubagentCosts()` (added by rename_agents_subagents_evolution_20260508
   * Phase 4) which is an identical alias.
   */
  getPhaseCosts(): Partial<Record<AgentName, number>>;
  /** Phase 4 alias for getPhaseCosts. Semantically identical; same return shape. */
  getSubagentCosts?(): Partial<Record<AgentName, number>>;
  /**
   * Phase 12: per-iter accessor on iter trackers; on run trackers and agent scopes
   * this is undefined / not provided. Callers needing per-iter (none today) use this.
   * `getPhaseCosts()` returns run-cumulative on iter trackers post-Phase-12.
   */
  getIterationPhaseCosts?(): Partial<Record<AgentName, number>>;
  getAvailableBudget(): number;
  /** B007-S2: compute the margined reservation without mutating state. Lets wrappers
   *  (e.g. createIterationBudgetTracker) peek both budgets atomically before committing.
   *  Optional for backward compat with test mocks; production trackers always provide it. */
  computeMargined?(estimatedCost: number): number;
  /** B007-S2: check whether a margined reservation would fit without mutating state.
   *  Optional for backward compat with test mocks. */
  canReserve?(margined: number): boolean;
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
    // Phase 4 alias — bind only when shared exposes it (test mocks may omit).
    ...(shared.getSubagentCosts && { getSubagentCosts: shared.getSubagentCosts.bind(shared) }),
    // Phase 12 (analyze_effectiveness_paragraph_recombine_20260530): forward
    // getIterationPhaseCosts so the per-iter accessor is reachable through scopes
    // wrapping iter trackers (without this, ctx.costTracker.getIterationPhaseCosts is
    // silently undefined for every agent — defeating the documented escape hatch).
    ...(shared.getIterationPhaseCosts && { getIterationPhaseCosts: shared.getIterationPhaseCosts.bind(shared) }),
    getAvailableBudget: shared.getAvailableBudget.bind(shared),
    // B007-S2: bind optional methods only when present (test mocks may omit them).
    ...(shared.computeMargined && { computeMargined: shared.computeMargined.bind(shared) }),
    ...(shared.canReserve && { canReserve: shared.canReserve.bind(shared) }),
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
      // Mirror reserve()'s input validation. Negative or non-finite costs would
      // silently corrupt totalSpent and let the budget gate underreport spend.
      if (!Number.isFinite(actualCost) || actualCost < 0) {
        throw new Error(
          `V2CostTracker.recordSpend: actualCost must be finite and non-negative (phase=${phase}, got=${actualCost})`,
        );
      }
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

    // Phase 4 alias for getPhaseCosts (rename_agents_subagents_evolution_20260508).
    getSubagentCosts(): Partial<Record<AgentName, number>> {
      return { ...phaseCosts };
    },

    getAvailableBudget(): number {
      return Math.max(0, budgetUsd - totalSpent - totalReserved);
    },

    // B007-S2: peek-only — no state mutation. Mirrors reserve()'s margin + quantize math.
    computeMargined(estimatedCost: number): number {
      if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
        throw new Error(
          `V2CostTracker.computeMargined: estimatedCost must be finite and non-negative (got=${estimatedCost})`,
        );
      }
      return quantizeUsd(estimatedCost * RESERVE_MARGIN);
    },

    // B007-S2: peek-only check matching reserve()'s budget predicate.
    canReserve(margined: number): boolean {
      return totalSpent + totalReserved + margined <= budgetUsd;
    },
  };
}

// ─── Per-Iteration Budget Tracker ───────────────────────────────

/**
 * Phase 12 kill switch: when EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED === 'false',
 * iter-tracker getPhaseCosts/getSubagentCosts revert to per-iter accounting. Tristate:
 * unset / 'true' / other → false (new run-cumulative), 'false' → true (legacy per-iter).
 *
 * DEPRECATED: legacy per-iter mode silently breaks writeMetricMax(GREATEST) for
 * agent names that appear across multiple iterations (e.g. 'ranking' in both
 * generate+swiss). Cost metrics under-report when the flag is set. We log a
 * one-time warning at first invocation so operators notice. Plan to remove the
 * kill switch entirely after one release cycle of clean telemetry.
 */
function isLegacyPerIterPhaseCosts(): boolean {
  return process.env.EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED === 'false';
}

let legacyPerIterWarned = false;
function maybeWarnLegacyPerIterMode(logger: EntityLogger | undefined): void {
  if (legacyPerIterWarned) return;
  if (!isLegacyPerIterPhaseCosts()) return;
  legacyPerIterWarned = true;
  const msg =
    '[V2CostTracker] EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED=false is DEPRECATED. ' +
    'Per-iter phase costs break writeMetricMax(GREATEST) when an AgentName recurs across ' +
    'iterations (e.g. ranking in both generate + swiss). Cost metrics will under-report. ' +
    'Unset the variable to opt into run-cumulative accounting.';
  if (logger) logger.warn(msg, { phaseName: 'budget' });
  else console.warn(msg);
}

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
  logger?: EntityLogger,
): V2CostTracker {
  let iterSpent = 0;
  let iterReserved = 0;
  const iterPhaseCosts: Partial<Record<AgentName, number>> = {};
  // Fire once if the deprecated kill switch is on — operators need to see this.
  maybeWarnLegacyPerIterMode(logger);

  return {
    reserve(phase: AgentName, estimatedCost: number): number {
      // B007-S2: PEEK both budgets without mutating, then commit only on full success.
      // Previous impl mutated runTracker first then checked iter, leaking the run-tracker
      // reservation when iter rejected. Now: compute margined once, check both, then
      // single mutation call on the run tracker.
      // B007-S2: when the run tracker exposes the peek API (production), peek both
      // budgets without mutating. When it doesn't (legacy / test mocks lacking the
      // optional methods), fall back to the original behavior (mutate-then-check) —
      // this preserves the leak behavior for those callers but doesn't crash on the
      // missing method.
      if (runTracker.computeMargined && runTracker.canReserve) {
        const margined = runTracker.computeMargined(estimatedCost);
        if (!runTracker.canReserve(margined)) {
          throw new BudgetExceededError(
            phase, runTracker.getTotalSpent(), margined, runTracker.getTotalSpent() + runTracker.getAvailableBudget(),
          );
        }
        if (iterSpent + iterReserved + margined > iterationBudgetUsd) {
          throw new IterationBudgetExceededError(
            phase, iterSpent, iterReserved + margined, iterationBudgetUsd, iterationIndex,
          );
        }
        const actuallyMargined = runTracker.reserve(phase, estimatedCost);
        iterReserved += actuallyMargined;
        return actuallyMargined;
      }
      // Legacy fallback (no peek API): old mutate-first behavior — leak still possible
      // on iter-reject, but better than crashing on missing methods.
      const margined = runTracker.reserve(phase, estimatedCost);
      if (iterSpent + iterReserved + margined > iterationBudgetUsd) {
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

    // Phase 12 (analyze_effectiveness_paragraph_recombine_20260530): getPhaseCosts() now
    // delegates to the RUN-CUMULATIVE accumulator on runTracker, not the per-iter local one.
    // The createEvolutionLLMClient.writeMetricMax(GREATEST) path requires monotonically
    // non-decreasing values across the run; the previous per-iter shape silently shadowed
    // smaller per-iter contributions to overlapping AgentName labels (e.g. 'ranking' spend
    // from both generate iter 1 + paragraph_recombine iter 2 collapsed to MAX, not SUM).
    //
    // Kill switch: EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED. Default 'true' (unset OK).
    // Set to 'false' to revert to the legacy per-iter accumulator behavior.
    // Tristate: unset → true (new), 'true' → true (new), 'false' → false (legacy), other → true.
    //
    // For callers that genuinely need per-iter (none today), see getIterationPhaseCosts().
    getPhaseCosts(): Partial<Record<AgentName, number>> {
      if (isLegacyPerIterPhaseCosts()) return { ...iterPhaseCosts };
      return runTracker.getPhaseCosts();
    },

    // Phase 4 alias for getPhaseCosts (rename_agents_subagents_evolution_20260508).
    // Phase 12 lockstep: alias must move with getPhaseCosts() — both gate on the same flag.
    getSubagentCosts(): Partial<Record<AgentName, number>> {
      if (isLegacyPerIterPhaseCosts()) return { ...iterPhaseCosts };
      return runTracker.getSubagentCosts?.() ?? runTracker.getPhaseCosts();
    },

    // Phase 12.3: per-iter accessor for callers that genuinely need per-iter shape.
    // None today; provided for future code that needs to distinguish iter from run scope.
    getIterationPhaseCosts(): Partial<Record<AgentName, number>> {
      return { ...iterPhaseCosts };
    },

    getAvailableBudget(): number {
      const iterRemaining = Math.max(0, iterationBudgetUsd - iterSpent - iterReserved);
      return Math.min(iterRemaining, runTracker.getAvailableBudget());
    },

    // B007-S2: delegate peek-only helpers when the underlying tracker exposes them.
    ...(runTracker.computeMargined && { computeMargined: runTracker.computeMargined.bind(runTracker) }),
    ...(runTracker.canReserve && { canReserve: runTracker.canReserve.bind(runTracker) }),
  };
}
