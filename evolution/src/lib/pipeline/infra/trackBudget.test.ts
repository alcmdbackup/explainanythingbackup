// Tests for V2 cost tracker with reserve-before-spend pattern.

import { createCostTracker } from './trackBudget';
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

  it('reserve with negative estimatedCost does not throw (adds negative reservation)', () => {
    const ct = createCostTracker(1.0);
    // Negative cost produces negative margined value; reserve does not validate sign.
    // The margined amount is negative, so totalReserved decreases, effectively
    // increasing available budget — documenting this behavior.
    const margined = ct.reserve('generation', -0.1);
    expect(margined).toBeCloseTo(-0.13);
    // Available budget increases because totalReserved went negative
    expect(ct.getAvailableBudget()).toBeGreaterThan(1.0);
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
