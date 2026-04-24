// Tests for V2 cost tracker with reserve-before-spend pattern and per-iteration budget tracking.

import { createCostTracker, createAgentCostScope, createIterationBudgetTracker, IterationBudgetExceededError } from './trackBudget';
import { BudgetExceededError } from '../../types';
import { createMockEntityLogger } from '../../../testing/evolution-test-helpers';

describe('V2CostTracker', () => {
  it('reserve succeeds under budget', () => {
    const ct = createCostTracker(1.0);
    const margined = ct.reserve('generation', 0.1);
    expect(margined).toBeCloseTo(0.13); // 0.1 * 1.3
    expect(ct.getAvailableBudget()).toBeCloseTo(0.87);
  });

  it('reserve throws BudgetExceededError when over (with 1.3x margin)', () => {
    const ct = createCostTracker(0.1);
    expect(() => ct.reserve('generation', 0.1)).toThrow(BudgetExceededError);
  });

  it('recordSpend deducts from reserved and adds to spent', () => {
    const ct = createCostTracker(1.0);
    const margined = ct.reserve('generation', 0.1);
    ct.recordSpend('generation', 0.08, margined);
    expect(ct.getTotalSpent()).toBeCloseTo(0.08);
    expect(ct.getAvailableBudget()).toBeCloseTo(0.92);
  });

  it('recordSpend with actualCost > reservedAmount clamps totalReserved to 0', () => {
    const ct = createCostTracker(1.0);
    const margined = ct.reserve('generation', 0.1);
    const spy = jest.spyOn(console, 'error').mockImplementation();
    ct.recordSpend('generation', 0.5, margined); // actual > reserved
    expect(ct.getTotalSpent()).toBeCloseTo(0.5);
    expect(ct.getAvailableBudget()).toBeCloseTo(0.5);
    spy.mockRestore();
  });

  it('release deducts from reserved without spending', () => {
    const ct = createCostTracker(1.0);
    const margined = ct.reserve('generation', 0.1);
    ct.release('generation', margined);
    expect(ct.getTotalSpent()).toBe(0);
    expect(ct.getAvailableBudget()).toBeCloseTo(1.0);
  });

  it('getTotalSpent returns correct sum', () => {
    const ct = createCostTracker(1.0);
    const m1 = ct.reserve('generation', 0.1);
    ct.recordSpend('generation', 0.05, m1);
    const m2 = ct.reserve('ranking', 0.1);
    ct.recordSpend('ranking', 0.03, m2);
    expect(ct.getTotalSpent()).toBeCloseTo(0.08);
  });

  it('getPhaseCosts tracks per-phase', () => {
    const ct = createCostTracker(1.0);
    const m1 = ct.reserve('generation', 0.1);
    ct.recordSpend('generation', 0.05, m1);
    const m2 = ct.reserve('ranking', 0.1);
    ct.recordSpend('ranking', 0.03, m2);
    const costs = ct.getPhaseCosts();
    expect(costs['generation']).toBeCloseTo(0.05);
    expect(costs['ranking']).toBeCloseTo(0.03);
  });

  it('getAvailableBudget computed correctly', () => {
    const ct = createCostTracker(1.0);
    const m1 = ct.reserve('generation', 0.1);
    expect(ct.getAvailableBudget()).toBeCloseTo(0.87); // 1.0 - 0.13 reserved
    ct.recordSpend('generation', 0.05, m1);
    expect(ct.getAvailableBudget()).toBeCloseTo(0.95); // 1.0 - 0.05 spent
  });

  it('parallel 3 reserves all succeed when budget allows', async () => {
    const ct = createCostTracker(1.0);
    // All 3 reserves happen synchronously before any LLM call
    const m1 = ct.reserve('generation', 0.1); // 0.13 reserved
    const m2 = ct.reserve('generation', 0.1); // 0.26 reserved
    const m3 = ct.reserve('generation', 0.1); // 0.39 reserved
    expect(ct.getAvailableBudget()).toBeCloseTo(0.61);

    // Simulate parallel spend
    ct.recordSpend('generation', 0.05, m1);
    ct.recordSpend('generation', 0.05, m2);
    ct.recordSpend('generation', 0.05, m3);
    expect(ct.getTotalSpent()).toBeCloseTo(0.15);
  });

  it('parallel 3 reserves where 3rd exceeds budget', () => {
    const ct = createCostTracker(0.3);
    ct.reserve('generation', 0.1); // 0.13
    ct.reserve('generation', 0.1); // 0.26
    expect(() => ct.reserve('generation', 0.1)).toThrow(BudgetExceededError); // 0.39 > 0.3
  });

  it('zero-budget config throws at construction', () => {
    expect(() => createCostTracker(0)).toThrow('budgetUsd must be a positive finite number');
  });

  it('reserve after full spend throws', () => {
    const ct = createCostTracker(0.1);
    const m = ct.reserve('generation', 0.05);
    ct.recordSpend('generation', 0.09, m);
    expect(() => ct.reserve('generation', 0.05)).toThrow(BudgetExceededError);
  });

  it('release with wrong (larger) amount clamps totalReserved to 0', () => {
    const ct = createCostTracker(1.0);
    const margined = ct.reserve('generation', 0.1); // reserves 0.13
    // Release more than was reserved — should clamp to 0, not go negative
    ct.release('generation', margined * 5);
    expect(ct.getAvailableBudget()).toBeCloseTo(1.0);
    expect(ct.getTotalSpent()).toBe(0);
    // Should still be able to reserve after over-release
    const m2 = ct.reserve('generation', 0.1);
    expect(m2).toBeCloseTo(0.13);
    expect(ct.getAvailableBudget()).toBeCloseTo(0.87);
  });

  it('B017: reserve with negative estimatedCost throws', () => {
    const ct = createCostTracker(1.0);
    // Guard added in B017: a non-finite or negative estimate is a caller bug;
    // previously a negative margined value inflated available budget.
    expect(() => ct.reserve('generation', -0.1)).toThrow();
  });

  it('B017: reserve with NaN/Infinity throws', () => {
    const ct = createCostTracker(1.0);
    expect(() => ct.reserve('generation', NaN)).toThrow();
    expect(() => ct.reserve('generation', Infinity)).toThrow();
  });

  it('double release of same reservation does not go negative on available budget', () => {
    const ct = createCostTracker(1.0);
    const margined = ct.reserve('generation', 0.1); // reserves 0.13
    ct.release('generation', margined); // first release — back to 1.0 available
    ct.release('generation', margined); // second release — totalReserved clamped to 0
    // Available budget should not exceed original budget
    expect(ct.getAvailableBudget()).toBeCloseTo(1.0);
    expect(ct.getTotalSpent()).toBe(0);
  });

  it('concurrent llm-client wrapper pattern: reserve-spend interleaved correctly', async () => {
    const ct = createCostTracker(1.0);
    // Simulate 3 concurrent LLM calls: all reserve upfront, then spend in arbitrary order
    const m1 = ct.reserve('generation', 0.1); // 0.13
    const m2 = ct.reserve('ranking', 0.1); // 0.13
    const m3 = ct.reserve('generation', 0.1); // 0.13
    expect(ct.getAvailableBudget()).toBeCloseTo(0.61); // 1.0 - 0.39

    // Spend arrives out of order
    ct.recordSpend('ranking', 0.08, m2);
    expect(ct.getTotalSpent()).toBeCloseTo(0.08);
    // Available should reflect: budget - spent - remaining reserved
    // remaining reserved = 0.13 + 0.13 = 0.26
    expect(ct.getAvailableBudget()).toBeCloseTo(1.0 - 0.08 - 0.26);

    ct.recordSpend('generation', 0.05, m1);
    expect(ct.getTotalSpent()).toBeCloseTo(0.13);

    // m3 fails — release instead of spend
    ct.release('generation', m3);
    expect(ct.getTotalSpent()).toBeCloseTo(0.13);
    expect(ct.getAvailableBudget()).toBeCloseTo(0.87);

    // Phase costs should track separately
    const costs = ct.getPhaseCosts();
    expect(costs['generation']).toBeCloseTo(0.05);
    expect(costs['ranking']).toBeCloseTo(0.08);
  });

  // ─── EntityLogger integration ─────────────────────────────────

  it('budget overrun calls logger.error when logger provided', () => {
    const { logger } = createMockEntityLogger();
    const ct = createCostTracker(0.10, logger);
    const m = ct.reserve('generation', 0.05); // 0.065 reserved
    // Spend more than budget cap to trigger overrun
    ct.recordSpend('generation', 0.15, m);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Budget overrun'),
      expect.objectContaining({ totalSpent: 0.15, budgetUsd: 0.10 }),
    );
  });

  it('budget overrun calls console.error when logger NOT provided', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const ct = createCostTracker(0.10);
    const m = ct.reserve('generation', 0.05);
    ct.recordSpend('generation', 0.15, m);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Budget overrun'));
    spy.mockRestore();
  });

  it('fires 50% threshold warning via logger.info', () => {
    const { logger } = createMockEntityLogger();
    const ct = createCostTracker(1.0, logger);
    const m = ct.reserve('generation', 0.4);
    ct.recordSpend('generation', 0.5, m);
    expect(logger.info).toHaveBeenCalledWith(
      'Budget 50% consumed',
      expect.objectContaining({ totalSpent: 0.5, budgetUsd: 1.0 }),
    );
  });

  it('fires 80% threshold warning via logger.warn', () => {
    const { logger } = createMockEntityLogger();
    const ct = createCostTracker(1.0, logger);
    const m = ct.reserve('generation', 0.5);
    ct.recordSpend('generation', 0.85, m);
    expect(logger.warn).toHaveBeenCalledWith(
      'Budget 80% consumed',
      expect.objectContaining({ totalSpent: 0.85, budgetUsd: 1.0 }),
    );
  });
});

describe('createAgentCostScope', () => {
  it('getOwnSpent() = 0 before any spend', () => {
    const shared = createCostTracker(1.0);
    const scope = createAgentCostScope(shared);
    expect(scope.getOwnSpent()).toBe(0);
  });

  it('getOwnSpent() increments only for this scope\'s recordSpend() calls', () => {
    const shared = createCostTracker(1.0);
    const scope = createAgentCostScope(shared);
    const m = scope.reserve('generation', 0.1);
    scope.recordSpend('generation', 0.08, m);
    expect(scope.getOwnSpent()).toBeCloseTo(0.08);
    // shared total also updated
    expect(shared.getTotalSpent()).toBeCloseTo(0.08);
  });

  it('two scopes on same tracker: getOwnSpent() independent; getTotalSpent() = combined', () => {
    const shared = createCostTracker(1.0);
    const scopeA = createAgentCostScope(shared);
    const scopeB = createAgentCostScope(shared);

    const mA = scopeA.reserve('generation', 0.1);
    const mB = scopeB.reserve('ranking', 0.1);
    scopeA.recordSpend('generation', 0.15, mA);
    scopeB.recordSpend('ranking', 0.20, mB);

    expect(scopeA.getOwnSpent()).toBeCloseTo(0.15);
    expect(scopeB.getOwnSpent()).toBeCloseTo(0.20);
    expect(shared.getTotalSpent()).toBeCloseTo(0.35);
  });

  it('getAvailableBudget() reflects shared budget after both scopes spend', () => {
    const shared = createCostTracker(1.0);
    const scopeA = createAgentCostScope(shared);
    const scopeB = createAgentCostScope(shared);

    const mA = scopeA.reserve('generation', 0.1);
    const mB = scopeB.reserve('ranking', 0.1);
    scopeA.recordSpend('generation', 0.15, mA);
    scopeB.recordSpend('ranking', 0.20, mB);

    // Both scopes see the same shared available budget
    expect(scopeA.getAvailableBudget()).toBeCloseTo(0.65);
    expect(scopeB.getAvailableBudget()).toBeCloseTo(0.65);
  });

  it('reserve() throws BudgetExceededError when shared budget exhausted', () => {
    const shared = createCostTracker(0.2);
    const scopeA = createAgentCostScope(shared);
    const scopeB = createAgentCostScope(shared);

    // scopeA uses nearly all budget
    const mA = scopeA.reserve('generation', 0.1); // reserves 0.13
    scopeA.recordSpend('generation', 0.18, mA); // spent 0.18

    // scopeB should be blocked even though it spent nothing
    expect(() => scopeB.reserve('ranking', 0.05)).toThrow(BudgetExceededError);
  });

  it('release() decrements shared totalReserved', () => {
    const shared = createCostTracker(0.2);
    const scope = createAgentCostScope(shared);

    const m = scope.reserve('generation', 0.1); // 0.13 reserved
    scope.release('generation', m);
    // After release, full budget available again
    expect(scope.getAvailableBudget()).toBeCloseTo(0.2);
    expect(scope.getOwnSpent()).toBe(0);
  });

  it('getPhaseCosts() returns shared phase costs across all scopes', () => {
    const shared = createCostTracker(1.0);
    const scopeA = createAgentCostScope(shared);
    const scopeB = createAgentCostScope(shared);

    const mA = scopeA.reserve('generation', 0.1);
    scopeA.recordSpend('generation', 0.05, mA);
    const mB = scopeB.reserve('ranking', 0.1);
    scopeB.recordSpend('ranking', 0.03, mB);

    // Both scopes return the same shared phase costs
    expect(scopeA.getPhaseCosts()['generation']).toBeCloseTo(0.05);
    expect(scopeA.getPhaseCosts()['ranking']).toBeCloseTo(0.03);
    expect(scopeB.getPhaseCosts()['generation']).toBeCloseTo(0.05);
  });
});

describe('createIterationBudgetTracker', () => {
  it('reserve succeeds when within both iteration and run budgets', () => {
    const run = createCostTracker(1.0);
    const iter = createIterationBudgetTracker(0.5, run, 0);
    const m = iter.reserve('generation', 0.1);
    expect(m).toBeCloseTo(0.13);
    expect(iter.getAvailableBudget()).toBeCloseTo(0.37); // 0.5 - 0.13
  });

  it('throws IterationBudgetExceededError when iteration budget exhausted', () => {
    const run = createCostTracker(1.0);
    const iter = createIterationBudgetTracker(0.1, run, 0);
    expect(() => iter.reserve('generation', 0.1)).toThrow(IterationBudgetExceededError);
    // Run-level reservation should NOT have been consumed.
    expect(run.getAvailableBudget()).toBeCloseTo(1.0);
  });

  it('throws BudgetExceededError (not Iteration) when run budget exhausted first', () => {
    const run = createCostTracker(0.1);
    const iter = createIterationBudgetTracker(0.5, run, 0);
    try {
      iter.reserve('generation', 0.1);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      expect(e).not.toBeInstanceOf(IterationBudgetExceededError);
    }
  });

  it('recordSpend updates both iteration and run trackers', () => {
    const run = createCostTracker(1.0);
    const iter = createIterationBudgetTracker(0.5, run, 0);
    const m = iter.reserve('generation', 0.1);
    iter.recordSpend('generation', 0.08, m);
    expect(iter.getTotalSpent()).toBeCloseTo(0.08); // iteration-level
    expect(run.getTotalSpent()).toBeCloseTo(0.08);  // run-level
  });

  it('release frees both iteration and run reservations', () => {
    const run = createCostTracker(1.0);
    const iter = createIterationBudgetTracker(0.5, run, 0);
    const m = iter.reserve('generation', 0.1);
    iter.release('generation', m);
    expect(iter.getAvailableBudget()).toBeCloseTo(0.5);
    expect(run.getAvailableBudget()).toBeCloseTo(1.0);
  });

  it('getAvailableBudget returns min of iteration and run available', () => {
    const run = createCostTracker(0.3);
    const iter = createIterationBudgetTracker(0.5, run, 0);
    // Run budget (0.3) is less than iteration budget (0.5), so run is the constraint.
    expect(iter.getAvailableBudget()).toBeCloseTo(0.3);
  });

  it('getPhaseCosts tracks iteration-level costs independently', () => {
    const run = createCostTracker(1.0);
    const iter = createIterationBudgetTracker(0.5, run, 0);
    const m = iter.reserve('generation', 0.1);
    iter.recordSpend('generation', 0.08, m);
    expect(iter.getPhaseCosts()['generation']).toBeCloseTo(0.08);
  });

  it('two iterations on same run tracker have independent iteration spend', () => {
    const run = createCostTracker(1.0);
    const iter1 = createIterationBudgetTracker(0.6, run, 0);
    const iter2 = createIterationBudgetTracker(0.4, run, 1);

    const m1 = iter1.reserve('generation', 0.1);
    iter1.recordSpend('generation', 0.05, m1);

    const m2 = iter2.reserve('ranking', 0.1);
    iter2.recordSpend('ranking', 0.03, m2);

    expect(iter1.getTotalSpent()).toBeCloseTo(0.05);
    expect(iter2.getTotalSpent()).toBeCloseTo(0.03);
    expect(run.getTotalSpent()).toBeCloseTo(0.08);
  });

  it('IterationBudgetExceededError extends BudgetExceededError', () => {
    const err = new IterationBudgetExceededError('generation', 0.1, 0.2, 0.3, 2);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toBeInstanceOf(IterationBudgetExceededError);
    expect(err.name).toBe('IterationBudgetExceededError');
    expect(err.iterationIndex).toBe(2);
  });
});
