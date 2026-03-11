// Unit tests for CostTrackerImpl.
// Verifies budget reservation with 30% margin and total budget enforcement.

import { CostTrackerImpl, createCostTrackerFromCheckpoint } from './costTracker';
import { BudgetExceededError } from '../types';

describe('CostTrackerImpl', () => {
  it('allows reservation within budget', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await expect(tracker.reserveBudget('generation', 0.10)).resolves.toBeUndefined();
  });

  it('BudgetExceededError message includes both spent and reserved', async () => {
    const tracker = new CostTrackerImpl(1.0);
    await tracker.reserveBudget('test', 0.30); // 0.39 reserved
    tracker.recordSpend('test', 0.50);        // 0.50 spent, 0 reserved
    await tracker.reserveBudget('test', 0.20); // 0.26 reserved
    // Total: 0.50 spent + 0.26 reserved = 0.76. Next reserve 0.20 * 1.3 = 0.26 → 1.02 > 1.0
    await expect(tracker.reserveBudget('test', 0.20)).rejects.toThrow(/reserved/);
    await expect(tracker.reserveBudget('test', 0.20)).rejects.toThrow(/committed/);
  });

  it('throws BudgetExceededError when total budget exceeded', async () => {
    const tracker = new CostTrackerImpl(1.0);
    tracker.recordSpend('generation', 0.30);
    tracker.recordSpend('calibration', 0.30);
    tracker.recordSpend('tournament', 0.30);
    // Total = 0.90. Request 0.10 * 1.3 = 0.13. 0.90 + 0.13 = 1.03 > 1.0
    await expect(tracker.reserveBudget('tournament', 0.10)).rejects.toThrow(BudgetExceededError);
  });

  it('records spend per agent and total', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.recordSpend('generation', 0.50);
    tracker.recordSpend('calibration', 0.30);
    tracker.recordSpend('generation', 0.20);
    expect(tracker.getAgentCost('generation')).toBe(0.70);
    expect(tracker.getAgentCost('calibration')).toBe(0.30);
    expect(tracker.getTotalSpent()).toBe(1.00);
    expect(tracker.getAvailableBudget()).toBe(4.00);
  });

  it('returns 0 for untracked agent', () => {
    const tracker = new CostTrackerImpl(5.0);
    expect(tracker.getAgentCost('nonexistent')).toBe(0);
  });

  it('applies 30% safety margin on total budget', async () => {
    const tracker = new CostTrackerImpl(1.0);
    tracker.recordSpend('generation', 0.90);
    // Reserve 0.08 → 0.08*1.3 = 0.104 → 0.90 + 0.104 = 1.004 > 1.0
    await expect(tracker.reserveBudget('generation', 0.08)).rejects.toThrow(BudgetExceededError);
    // But 0.06 → 0.06*1.3 = 0.078 → 0.978 < 1.0 → should pass
    await expect(tracker.reserveBudget('generation', 0.06)).resolves.toBeUndefined();
  });

  it('concurrent reservations do not exceed total budget', async () => {
    const tracker = new CostTrackerImpl(1.0);
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
    expect(fulfilled).toBeLessThanOrEqual(3);
    expect(rejected).toBeGreaterThanOrEqual(1);
  });

  it('recordSpend releases reservation', async () => {
    const tracker = new CostTrackerImpl(1.0);
    await tracker.reserveBudget('test', 0.50);
    tracker.recordSpend('test', 0.30);
    expect(tracker.getAvailableBudget()).toBe(0.70);
  });

  it('getAllAgentCosts returns all agent spend as record', () => {
    const tracker = new CostTrackerImpl(5.0);
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
    const tracker = new CostTrackerImpl(5.0);
    expect(tracker.getAllAgentCosts()).toEqual({});
  });

  // ─── FIFO reservation queue tests ───────────────────────────────

  it('FIFO: totalReserved reaches 0 after all recordSpend calls', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.10); // reserves 0.13
    await tracker.reserveBudget('test', 0.20); // reserves 0.26
    await tracker.reserveBudget('test', 0.05); // reserves 0.065

    tracker.recordSpend('test', 0.08); // releases 0.13 (FIFO)
    tracker.recordSpend('test', 0.15); // releases 0.26 (FIFO)
    tracker.recordSpend('test', 0.03); // releases 0.065 (FIFO)

    expect(tracker.getAvailableBudget()).toBeCloseTo(5.0 - 0.26, 10);
    expect(tracker.getTotalSpent()).toBeCloseTo(0.26, 10);
  });

  it('FIFO: no phantom reservation leak when actualCost < estimatedCost', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.10); // reserves 0.13

    tracker.recordSpend('test', 0.05); // should release full 0.13

    expect(tracker.getAvailableBudget()).toBeCloseTo(5.0 - 0.05, 10);
  });

  it('getAvailableBudget subtracts in-flight reservations', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.50); // reserves 0.65
    expect(tracker.getAvailableBudget()).toBeCloseTo(5.0 - 0.65, 10);
  });

  it('recordSpend without prior reservation does not crash', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.recordSpend('generation', 0.50);
    expect(tracker.getTotalSpent()).toBe(0.50);
    expect(tracker.getAvailableBudget()).toBe(4.50);
  });

  // ─── COST-5: getTotalReserved() assertion support ──────────────

  it('getTotalReserved returns 0 on fresh tracker', () => {
    const tracker = new CostTrackerImpl(5.0);
    expect(tracker.getTotalReserved()).toBe(0);
  });

  it('getTotalReserved reflects outstanding reservations', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.10); // reserves 0.13
    expect(tracker.getTotalReserved()).toBeCloseTo(0.13, 10);
    tracker.recordSpend('test', 0.05); // releases 0.13
    expect(tracker.getTotalReserved()).toBe(0);
  });

  it('multiple reserve+recordSpend cycles accumulate no phantom reservations', async () => {
    const tracker = new CostTrackerImpl(5.0);
    for (let i = 0; i < 10; i++) {
      await tracker.reserveBudget('test', 0.10);
      tracker.recordSpend('test', 0.05);
    }
    expect(tracker.getTotalSpent()).toBeCloseTo(0.50, 10);
    expect(tracker.getAvailableBudget()).toBeCloseTo(4.50, 10);
  });

  // ─── releaseReservation tests ──────────────────────────────────

  it('releaseReservation pops from FIFO and decrements totalReserved', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.10); // reserves 0.13
    expect(tracker.getTotalReserved()).toBeCloseTo(0.13, 10);

    tracker.releaseReservation('test');
    expect(tracker.getTotalReserved()).toBe(0);
    expect(tracker.getAvailableBudget()).toBe(5.0);
  });

  it('releaseReservation on empty queue is a no-op', () => {
    const tracker = new CostTrackerImpl(5.0);
    // Should not throw
    tracker.releaseReservation('nonexistent');
    expect(tracker.getTotalReserved()).toBe(0);
  });

  it('multiple reserve + partial release sequence', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.10); // 0.13
    await tracker.reserveBudget('test', 0.20); // 0.26
    await tracker.reserveBudget('test', 0.05); // 0.065

    // Release first (FIFO): removes 0.13
    tracker.releaseReservation('test');
    expect(tracker.getTotalReserved()).toBeCloseTo(0.325, 10); // 0.26 + 0.065

    // RecordSpend second: removes 0.26
    tracker.recordSpend('test', 0.15);
    expect(tracker.getTotalReserved()).toBeCloseTo(0.065, 10);

    // Release third: removes 0.065
    tracker.releaseReservation('test');
    expect(tracker.getTotalReserved()).toBe(0);
  });

  // ─── setEventLogger tests ────────────────────────────────────

  it('setEventLogger callback fires with correct event types', async () => {
    const tracker = new CostTrackerImpl(5.0);
    const events: Array<{ eventType: string; agentName: string; amountUsd: number }> = [];
    tracker.setEventLogger((event) => events.push(event));

    await tracker.reserveBudget('test', 0.10);
    tracker.recordSpend('test', 0.05);
    tracker.releaseReservation('nonexistent'); // release_failed
    await tracker.reserveBudget('test', 0.10);
    tracker.releaseReservation('test'); // release_ok

    expect(events.map(e => e.eventType)).toEqual([
      'reserve', 'spend', 'release_failed', 'reserve', 'release_ok',
    ]);
    expect(events[0].amountUsd).toBeCloseTo(0.13, 10); // 0.10 * 1.3
    expect(events[1].amountUsd).toBe(0.05);
    expect(events[2].amountUsd).toBe(0);
  });

  it('without setEventLogger, no errors', async () => {
    const tracker = new CostTrackerImpl(5.0);
    await tracker.reserveBudget('test', 0.10);
    tracker.recordSpend('test', 0.05);
    tracker.releaseReservation('test');
    // No crash — logger is optional
  });

  // COST-2: Negative cost guard
  it('recordSpend rejects negative costs', () => {
    const tracker = new CostTrackerImpl(5.0);
    expect(() => tracker.recordSpend('generation', -0.5)).toThrow('negative cost');
  });

  // ─── Budget overflow flag tests ───────────────────────────────

  it('isOverflowed is false on fresh tracker', () => {
    const tracker = new CostTrackerImpl(5.0);
    expect(tracker.isOverflowed).toBe(false);
  });

  it('isOverflowed latches true when totalSpent exceeds budgetCapUsd', () => {
    const tracker = new CostTrackerImpl(1.0);
    tracker.recordSpend('generation', 0.60);
    expect(tracker.isOverflowed).toBe(false);
    tracker.recordSpend('generation', 0.50); // total 1.10 > 1.0
    expect(tracker.isOverflowed).toBe(true);
  });

  it('reserveBudget throws immediately when overflow flag is set', async () => {
    const tracker = new CostTrackerImpl(1.0);
    tracker.recordSpend('generation', 1.10); // exceed cap → flag set
    expect(tracker.isOverflowed).toBe(true);
    // Even a tiny reservation should fail instantly
    await expect(tracker.reserveBudget('generation', 0.001)).rejects.toThrow(BudgetExceededError);
  });

  it('overflow flag is latched — does not reset if spend goes exactly to cap', () => {
    const tracker = new CostTrackerImpl(1.0);
    tracker.recordSpend('generation', 1.01); // exceed
    expect(tracker.isOverflowed).toBe(true);
    // Flag stays true even though we're not adding more spend
    expect(tracker.isOverflowed).toBe(true);
  });

  // ─── restoreSpent() tests ──────────────────────────────────────

  it('restoreSpent sets totalSpent baseline', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.restoreSpent(2.0);
    expect(tracker.getTotalSpent()).toBe(2.0);
    expect(tracker.getAvailableBudget()).toBe(3.0);
  });

  it('restoreSpent throws if called after spending has begun', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.recordSpend('generation', 0.10);
    expect(() => tracker.restoreSpent(1.0)).toThrow('cannot restore after spending has begun');
  });

  it('restoreSpent throws on negative amount', () => {
    const tracker = new CostTrackerImpl(5.0);
    expect(() => tracker.restoreSpent(-1.0)).toThrow('negative amount');
  });

  it('restoreSpent then recordSpend accumulates correctly', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.restoreSpent(2.0);
    tracker.recordSpend('generation', 0.50);
    expect(tracker.getTotalSpent()).toBe(2.50);
    expect(tracker.getAvailableBudget()).toBe(2.50);
  });

  it('restoreSpent affects budget reservation check', async () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.restoreSpent(4.90);
    // Total budget = 5.0, spent = 4.90. Reserve 0.10 * 1.3 = 0.13 → 5.03 > 5.0
    await expect(tracker.reserveBudget('generation', 0.10)).rejects.toThrow(BudgetExceededError);
  });
});

describe('invocation cost tracking', () => {
  it('recordSpend with invocationId attributes cost to invocationCosts AND spentByAgent (dual tracking)', () => {
    const tracker = new CostTrackerImpl(5.0);
    const tournamentUuid = 'inv-tournament-001';
    tracker.recordSpend('pairwise', 0.01, tournamentUuid);

    expect(tracker.getInvocationCost(tournamentUuid)).toBe(0.01);
    expect(tracker.getAgentCost('pairwise')).toBe(0.01);
    expect(tracker.getTotalSpent()).toBe(0.01);
  });

  it('recordSpend without invocationId updates spentByAgent and totalSpent only, no crash', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.recordSpend('generation', 0.02);

    expect(tracker.getAgentCost('generation')).toBe(0.02);
    expect(tracker.getTotalSpent()).toBe(0.02);
    expect(tracker.getInvocationCost('any-random-id')).toBe(0);
  });

  it('getInvocationCost returns accumulated cost for that invocation ID', () => {
    const tracker = new CostTrackerImpl(5.0);
    const invId = 'inv-accumulate-001';
    tracker.recordSpend('generation', 0.05, invId);
    tracker.recordSpend('pairwise', 0.03, invId);
    tracker.recordSpend('calibration', 0.02, invId);

    expect(tracker.getInvocationCost(invId)).toBeCloseTo(0.10, 10);
  });

  it('getInvocationCost returns 0 for unknown invocation ID', () => {
    const tracker = new CostTrackerImpl(5.0);
    tracker.recordSpend('generation', 0.50, 'known-id');

    expect(tracker.getInvocationCost('unknown-id')).toBe(0);
  });

  it('multiple invocation IDs tracked independently in the same CostTracker instance', () => {
    const tracker = new CostTrackerImpl(5.0);
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
    expect(tracker.getTotalSpent()).toBeCloseTo(0.53, 10);
  });

  it('invocationCosts map survives across many recordSpend calls (no implicit reset)', () => {
    const tracker = new CostTrackerImpl(5.0);
    const invId = 'inv-long-lived';

    for (let i = 0; i < 50; i++) {
      tracker.recordSpend('generation', 0.001, invId);
    }

    expect(tracker.getInvocationCost(invId)).toBeCloseTo(0.05, 10);
    expect(tracker.getTotalSpent()).toBeCloseTo(0.05, 10);

    for (let i = 0; i < 50; i++) {
      tracker.recordSpend('pairwise', 0.001, invId);
    }

    expect(tracker.getInvocationCost(invId)).toBeCloseTo(0.10, 10);
    expect(tracker.getTotalSpent()).toBeCloseTo(0.10, 10);
  });
});

describe('comparison taskType budget impact', () => {
  it('14 comparison reservations with realistic pricing stay under total budget', async () => {
    const estimatePerCall = 0.006;
    const tracker = new CostTrackerImpl(5.0);

    for (let i = 0; i < 14; i++) {
      await expect(tracker.reserveBudget('pairwise', estimatePerCall)).resolves.toBeUndefined();
      tracker.recordSpend('pairwise', estimatePerCall * 0.5);
    }

    expect(tracker.getAgentCost('pairwise')).toBeLessThan(1.0);
  });

  it('end-to-end: estimateTokenCost → reserveBudget with comparison taskType', async () => {
    const { estimateTokenCost } = await import('./llmClient');
    const tracker = new CostTrackerImpl(5.0);

    const prompt = 'x'.repeat(5000);
    const estimate = estimateTokenCost(prompt, 'deepseek-chat', 'comparison');

    const defaultEstimate = estimateTokenCost(prompt, 'deepseek-chat');
    expect(estimate).toBeLessThan(defaultEstimate);

    for (let i = 0; i < 20; i++) {
      await expect(tracker.reserveBudget('tournament', estimate)).resolves.toBeUndefined();
      tracker.recordSpend('tournament', estimate * 0.3);
    }
  });
});

describe('createCostTrackerFromCheckpoint', () => {
  it('creates tracker with restored totalSpent', () => {
    const config = { budgetCapUsd: 5.0 } as import('../types').EvolutionRunConfig;
    const tracker = createCostTrackerFromCheckpoint(config, 1.50);
    expect(tracker.getTotalSpent()).toBe(1.50);
    expect(tracker.getAvailableBudget()).toBe(3.50);
  });

  it('creates tracker that can then record additional spend', () => {
    const config = { budgetCapUsd: 5.0 } as import('../types').EvolutionRunConfig;
    const tracker = createCostTrackerFromCheckpoint(config, 2.0);
    tracker.recordSpend('generation', 0.30);
    expect(tracker.getTotalSpent()).toBe(2.30);
  });
});
