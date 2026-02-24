// Unit tests for CostTrackerImpl.
// Verifies budget reservation with 30% margin, per-agent caps, and total budget enforcement.

import { CostTrackerImpl, createCostTrackerFromCheckpoint } from './costTracker';
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

  it('concurrent reservations do not exceed total budget', async () => {
    // Budget=1.0, make N concurrent reservations that individually fit but
    // collectively would exceed the budget without optimistic locking
    const tracker = new CostTrackerImpl(1.0, { test: 1.0 });
    const estimate = 0.20; // 0.20*1.3=0.26 per reservation

    // 4 concurrent reservations: 4×0.26=1.04 > 1.0 → 4th should fail
    const results = await Promise.allSettled([
      tracker.reserveBudget('test', estimate),
      tracker.reserveBudget('test', estimate),
      tracker.reserveBudget('test', estimate),
      tracker.reserveBudget('test', estimate),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    // At most 3 should succeed (3×0.26=0.78 < 1.0), 4th should be rejected
    expect(fulfilled).toBeLessThanOrEqual(3);
    expect(rejected).toBeGreaterThanOrEqual(1);
  });

  it('recordSpend releases reservation', async () => {
    const tracker = new CostTrackerImpl(1.0, { test: 1.0 });
    // Reserve 0.50 → with margin = 0.65
    await tracker.reserveBudget('test', 0.50);
    // Record actual spend of 0.30 (less than reserved)
    tracker.recordSpend('test', 0.30);
    // Available budget should reflect actual spend, not reservation
    expect(tracker.getAvailableBudget()).toBe(0.70);
  });

  it('getAllAgentCosts returns all agent spend as record', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.recordSpend('generation', 0.50);
    tracker.recordSpend('calibration', 0.30);
    tracker.recordSpend('generation', 0.20);
    tracker.recordSpend('tournament', 0.10);

    const allCosts = tracker.getAllAgentCosts();
    expect(allCosts).toEqual({
      generation: 0.70,
      calibration: 0.30,
      tournament: 0.10,
    });
  });

  it('getAllAgentCosts returns empty object when no spend', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    expect(tracker.getAllAgentCosts()).toEqual({});
  });

  // ─── FIFO reservation queue tests ───────────────────────────────

  it('FIFO: totalReserved reaches 0 after all recordSpend calls', async () => {
    const tracker = new CostTrackerImpl(5.0, { test: 1.0 });
    // Make 3 reservations, then record 3 spends
    await tracker.reserveBudget('test', 0.10); // reserves 0.13
    await tracker.reserveBudget('test', 0.20); // reserves 0.26
    await tracker.reserveBudget('test', 0.05); // reserves 0.065
    // totalReserved = 0.455

    tracker.recordSpend('test', 0.08); // releases 0.13 (FIFO)
    tracker.recordSpend('test', 0.15); // releases 0.26 (FIFO)
    tracker.recordSpend('test', 0.03); // releases 0.065 (FIFO)
    // totalReserved should be 0

    // getAvailableBudget = 5.0 - 0.26 - 0 = 4.74
    expect(tracker.getAvailableBudget()).toBeCloseTo(5.0 - 0.26, 10);
    expect(tracker.getTotalSpent()).toBeCloseTo(0.26, 10);
  });

  it('FIFO: no phantom reservation leak when actualCost < estimatedCost', async () => {
    const tracker = new CostTrackerImpl(5.0, { test: 1.0 });
    // Example from plan: estimate $0.10 → reserve $0.13 → actual $0.05
    await tracker.reserveBudget('test', 0.10); // reserves 0.13

    tracker.recordSpend('test', 0.05); // should release full 0.13

    // Available should be budget - spent (no reservation left)
    expect(tracker.getAvailableBudget()).toBeCloseTo(5.0 - 0.05, 10);
  });

  it('getAvailableBudget subtracts in-flight reservations', async () => {
    const tracker = new CostTrackerImpl(5.0, { test: 1.0 });
    await tracker.reserveBudget('test', 0.50); // reserves 0.65
    // Before recordSpend, available should subtract reservation
    expect(tracker.getAvailableBudget()).toBeCloseTo(5.0 - 0.65, 10);
  });

  it('recordSpend without prior reservation does not crash', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    // No reservation — recordSpend should still work (queue empty)
    tracker.recordSpend('generation', 0.50);
    expect(tracker.getTotalSpent()).toBe(0.50);
    expect(tracker.getAvailableBudget()).toBe(4.50);
  });

  // ─── COST-5: getTotalReserved() assertion support ──────────────

  it('getTotalReserved returns 0 on fresh tracker', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    expect(tracker.getTotalReserved()).toBe(0);
  });

  it('getTotalReserved reflects outstanding reservations', async () => {
    const tracker = new CostTrackerImpl(5.0, { test: 1.0 });
    await tracker.reserveBudget('test', 0.10); // reserves 0.13
    expect(tracker.getTotalReserved()).toBeCloseTo(0.13, 10);
    tracker.recordSpend('test', 0.05); // releases 0.13
    expect(tracker.getTotalReserved()).toBe(0);
  });

  it('multiple reserve+recordSpend cycles accumulate no phantom reservations', async () => {
    const tracker = new CostTrackerImpl(5.0, { test: 1.0 });
    for (let i = 0; i < 10; i++) {
      await tracker.reserveBudget('test', 0.10);
      tracker.recordSpend('test', 0.05);
    }
    // Total spent = 10 × 0.05 = 0.50, no reservations in flight
    expect(tracker.getTotalSpent()).toBeCloseTo(0.50, 10);
    expect(tracker.getAvailableBudget()).toBeCloseTo(4.50, 10);
  });

  // COST-2: Negative cost guard
  it('recordSpend rejects negative costs', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    expect(() => tracker.recordSpend('generation', -0.5)).toThrow('negative cost');
  });

  // ─── restoreSpent() tests ──────────────────────────────────────

  it('restoreSpent sets totalSpent baseline', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.restoreSpent(2.0);
    expect(tracker.getTotalSpent()).toBe(2.0);
    expect(tracker.getAvailableBudget()).toBe(3.0);
  });

  it('restoreSpent throws if called after spending has begun', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.recordSpend('generation', 0.10);
    expect(() => tracker.restoreSpent(1.0)).toThrow('cannot restore after spending has begun');
  });

  it('restoreSpent throws on negative amount', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    expect(() => tracker.restoreSpent(-1.0)).toThrow('negative amount');
  });

  it('restoreSpent then recordSpend accumulates correctly', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.restoreSpent(2.0);
    tracker.recordSpend('generation', 0.50);
    expect(tracker.getTotalSpent()).toBe(2.50);
    expect(tracker.getAvailableBudget()).toBe(2.50);
  });

  it('restoreSpent affects budget reservation check', async () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.restoreSpent(4.90);
    // Total budget = 5.0, spent = 4.90. Reserve 0.10 * 1.3 = 0.13 → 5.03 > 5.0
    await expect(tracker.reserveBudget('generation', 0.10)).rejects.toThrow(BudgetExceededError);
  });
});

describe('invocation cost tracking', () => {
  it('recordSpend with invocationId attributes cost to invocationCosts AND spentByAgent (dual tracking)', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    const tournamentUuid = 'inv-tournament-001';
    tracker.recordSpend('pairwise', 0.01, tournamentUuid);

    expect(tracker.getInvocationCost(tournamentUuid)).toBe(0.01);
    expect(tracker.getAgentCost('pairwise')).toBe(0.01);
    expect(tracker.getTotalSpent()).toBe(0.01);
  });

  it('recordSpend without invocationId updates spentByAgent and totalSpent only, no crash', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.recordSpend('generation', 0.02);

    expect(tracker.getAgentCost('generation')).toBe(0.02);
    expect(tracker.getTotalSpent()).toBe(0.02);
    // No invocation should have been recorded — getInvocationCost for any id returns 0
    expect(tracker.getInvocationCost('any-random-id')).toBe(0);
  });

  it('getInvocationCost returns accumulated cost for that invocation ID', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    const invId = 'inv-accumulate-001';
    tracker.recordSpend('generation', 0.05, invId);
    tracker.recordSpend('pairwise', 0.03, invId);
    tracker.recordSpend('calibration', 0.02, invId);

    expect(tracker.getInvocationCost(invId)).toBeCloseTo(0.10, 10);
  });

  it('getInvocationCost returns 0 for unknown invocation ID', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    tracker.recordSpend('generation', 0.50, 'known-id');

    expect(tracker.getInvocationCost('unknown-id')).toBe(0);
  });

  it('multiple invocation IDs tracked independently in the same CostTracker instance', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    const invA = 'inv-aaa';
    const invB = 'inv-bbb';
    const invC = 'inv-ccc';

    tracker.recordSpend('generation', 0.10, invA);
    tracker.recordSpend('generation', 0.20, invB);
    tracker.recordSpend('pairwise', 0.05, invA);
    tracker.recordSpend('calibration', 0.15, invC);
    tracker.recordSpend('pairwise', 0.03, invB);

    expect(tracker.getInvocationCost(invA)).toBeCloseTo(0.15, 10);
    expect(tracker.getInvocationCost(invB)).toBeCloseTo(0.23, 10);
    expect(tracker.getInvocationCost(invC)).toBeCloseTo(0.15, 10);
    // Total across all agents should still be consistent
    expect(tracker.getTotalSpent()).toBeCloseTo(0.53, 10);
  });

  it('invocationCosts map survives across many recordSpend calls (no implicit reset)', () => {
    const tracker = new CostTrackerImpl(5.0, testBudgetCaps);
    const invId = 'inv-long-lived';

    for (let i = 0; i < 50; i++) {
      tracker.recordSpend('generation', 0.001, invId);
    }

    expect(tracker.getInvocationCost(invId)).toBeCloseTo(0.05, 10);
    expect(tracker.getTotalSpent()).toBeCloseTo(0.05, 10);

    // Continue recording more spend to the same invocation
    for (let i = 0; i < 50; i++) {
      tracker.recordSpend('pairwise', 0.001, invId);
    }

    expect(tracker.getInvocationCost(invId)).toBeCloseTo(0.10, 10);
    expect(tracker.getTotalSpent()).toBeCloseTo(0.10, 10);
  });
});

describe('comparison taskType budget impact', () => {
  it('14 comparison reservations with claude-sonnet-4 pricing stay under $1.00 pairwise cap', async () => {
    // Simulate tournament: 14 comparison calls with realistic estimates
    // 5000-char prompt → 1250 input tokens, 150 output tokens (comparison)
    // claude-sonnet-4: (1250/1M)*3 + (150/1M)*15 = $0.00375 + $0.00225 = $0.006 per call
    const estimatePerCall = 0.006;
    const caps: Record<string, number> = { pairwise: 0.20 }; // 20% of $5 = $1.00
    const tracker = new CostTrackerImpl(5.0, caps);

    for (let i = 0; i < 14; i++) {
      await expect(tracker.reserveBudget('pairwise', estimatePerCall)).resolves.toBeUndefined();
      tracker.recordSpend('pairwise', estimatePerCall * 0.5); // actual spend < estimate
    }

    expect(tracker.getAgentCost('pairwise')).toBeLessThan(1.0);
  });

  it('end-to-end: estimateTokenCost → reserveBudget with comparison taskType', async () => {
    // Import estimateTokenCost to validate the chain
    const { estimateTokenCost } = await import('./llmClient');
    const caps: Record<string, number> = { tournament: 0.20 };
    const tracker = new CostTrackerImpl(5.0, caps);

    // 5000-char prompt with comparison taskType
    const prompt = 'x'.repeat(5000);
    const estimate = estimateTokenCost(prompt, 'deepseek-chat', 'comparison');

    // Should be much cheaper than without comparison taskType
    const defaultEstimate = estimateTokenCost(prompt, 'deepseek-chat');
    expect(estimate).toBeLessThan(defaultEstimate);

    // Should be able to make many reservations
    for (let i = 0; i < 20; i++) {
      await expect(tracker.reserveBudget('tournament', estimate)).resolves.toBeUndefined();
      tracker.recordSpend('tournament', estimate * 0.3);
    }
  });
});

describe('createCostTrackerFromCheckpoint', () => {
  it('creates tracker with restored totalSpent', () => {
    const config = { budgetCapUsd: 5.0, budgetCaps: testBudgetCaps } as import('../types').EvolutionRunConfig;
    const tracker = createCostTrackerFromCheckpoint(config, 1.50);
    expect(tracker.getTotalSpent()).toBe(1.50);
    expect(tracker.getAvailableBudget()).toBe(3.50);
  });

  it('creates tracker that can then record additional spend', () => {
    const config = { budgetCapUsd: 5.0, budgetCaps: testBudgetCaps } as import('../types').EvolutionRunConfig;
    const tracker = createCostTrackerFromCheckpoint(config, 2.0);
    tracker.recordSpend('generation', 0.30);
    expect(tracker.getTotalSpent()).toBe(2.30);
  });
});
