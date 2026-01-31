// Unit tests for CostTrackerImpl.
// Verifies budget reservation with 30% margin, per-agent caps, and total budget enforcement.

import { CostTrackerImpl } from './costTracker';
import { BudgetExceededError } from '../types';

const testBudgetCaps: Record<string, number> = {
  generation: 0.25,
  calibration: 0.20,
  tournament: 0.30,
};

describe('CostTrackerImpl', () => {
  it('allows reservation within budget', async () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    await expect(tracker.reserveBudget('generation', 0.10)).resolves.toBeUndefined();
  });

  it('throws BudgetExceededError when agent cap exceeded', async () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    // Agent cap for generation = 0.25 * 5.0 = 1.25
    tracker.recordSpend('generation', 1.20);
    // Request 0.10 * 1.3 margin = 0.13. 1.20 + 0.13 = 1.33 > 1.25
    await expect(tracker.reserveBudget('generation', 0.10)).rejects.toThrow(BudgetExceededError);
  });

  it('throws BudgetExceededError when total budget exceeded', async () => {
    const tracker = new CostTrackerImpl(1.0, testBudgetCaps);
    tracker.recordSpend('generation', 0.30);
    tracker.recordSpend('calibration', 0.30);
    tracker.recordSpend('tournament', 0.30);
    // Total = 0.90. Request 0.10 * 1.3 = 0.13. 0.90 + 0.13 = 1.03 > 1.0
    await expect(tracker.reserveBudget('tournament', 0.10)).rejects.toThrow(BudgetExceededError);
  });

  it('uses default 20% cap for unknown agent', async () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    // Unknown agent cap = 0.20 * 5.0 = 1.0
    tracker.recordSpend('unknown_agent', 0.95);
    // 0.05 * 1.3 = 0.065. 0.95 + 0.065 = 1.015 > 1.0
    await expect(tracker.reserveBudget('unknown_agent', 0.05)).rejects.toThrow(BudgetExceededError);
  });

  it('records spend per agent and total', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.recordSpend('generation', 0.50);
    tracker.recordSpend('calibration', 0.30);
    tracker.recordSpend('generation', 0.20);
    expect(tracker.getAgentCost('generation')).toBe(0.70);
    expect(tracker.getAgentCost('calibration')).toBe(0.30);
    expect(tracker.getTotalSpent()).toBe(1.00);
    expect(tracker.getAvailableBudget()).toBe(4.00);
  });

  it('returns 0 for untracked agent', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    expect(tracker.getAgentCost('nonexistent')).toBe(0);
  });

  it('applies 30% safety margin', async () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    // Generation cap = 1.25. Spend 1.15. Reserve 0.08 → 0.08*1.3 = 0.104 → 1.254 > 1.25
    tracker.recordSpend('generation', 1.15);
    await expect(tracker.reserveBudget('generation', 0.08)).rejects.toThrow(BudgetExceededError);
    // But 0.06 → 0.06*1.3 = 0.078 → 1.228 < 1.25 → should pass
    await expect(tracker.reserveBudget('generation', 0.06)).resolves.toBeUndefined();
  });
});
