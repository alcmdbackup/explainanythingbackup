// Unit tests for the dual-unit budget floor resolver functions.
// Covers: fraction mode, agent-multiple mode, precedence, NaN/zero/negative guards,
// sequential fallback to initial estimate when actualAvgCostPerAgent is unavailable.

import { resolveParallelFloor, resolveSequentialFloor } from './budgetFloorResolvers';

describe('resolveParallelFloor', () => {
  it('returns 0 when no floor is set', () => {
    expect(resolveParallelFloor({}, 1.0, 0.01)).toBe(0);
  });

  it('fraction mode: floor = totalBudget × fraction', () => {
    expect(resolveParallelFloor({ minBudgetAfterParallelFraction: 0.4 }, 1.0, 0.01)).toBeCloseTo(0.4, 10);
    expect(resolveParallelFloor({ minBudgetAfterParallelFraction: 0.25 }, 2.0, 0.01)).toBeCloseTo(0.5, 10);
  });

  it('agent-multiple mode: floor = initialAgentCost × multiplier', () => {
    expect(resolveParallelFloor({ minBudgetAfterParallelAgentMultiple: 3 }, 1.0, 0.012)).toBeCloseTo(0.036, 10);
    expect(resolveParallelFloor({ minBudgetAfterParallelAgentMultiple: 0.5 }, 1.0, 0.008)).toBeCloseTo(0.004, 10);
  });

  it('agent-multiple: guards against NaN agent cost', () => {
    expect(resolveParallelFloor({ minBudgetAfterParallelAgentMultiple: 3 }, 1.0, NaN)).toBe(0);
  });

  it('agent-multiple: guards against zero agent cost', () => {
    expect(resolveParallelFloor({ minBudgetAfterParallelAgentMultiple: 3 }, 1.0, 0)).toBe(0);
  });

  it('agent-multiple: guards against negative agent cost', () => {
    expect(resolveParallelFloor({ minBudgetAfterParallelAgentMultiple: 3 }, 1.0, -0.5)).toBe(0);
  });

  it('fraction takes precedence when somehow both are set (defensive)', () => {
    // Schema refine prevents this, but the resolver is defensive.
    expect(resolveParallelFloor(
      { minBudgetAfterParallelFraction: 0.3, minBudgetAfterParallelAgentMultiple: 5 },
      1.0, 0.01,
    )).toBeCloseTo(0.3, 10);
  });
});

describe('resolveSequentialFloor', () => {
  it('returns 0 when no floor is set', () => {
    expect(resolveSequentialFloor({}, 1.0, 0.01, null)).toBe(0);
  });

  it('fraction mode: floor = totalBudget × fraction (ignores agent costs)', () => {
    expect(resolveSequentialFloor({ minBudgetAfterSequentialFraction: 0.15 }, 1.0, 0.01, 0.02)).toBeCloseTo(0.15, 10);
    expect(resolveSequentialFloor({ minBudgetAfterSequentialFraction: 0.15 }, 1.0, 0.01, null)).toBeCloseTo(0.15, 10);
  });

  it('agent-multiple: uses actualAvgCostPerAgent when > 0 and finite', () => {
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.01 /* initial */, 0.015 /* actual */,
    )).toBeCloseTo(0.030, 10); // 2 × actual (0.015)
  });

  it('agent-multiple: falls back to initial estimate when actualAvgCostPerAgent is null', () => {
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.010, null,
    )).toBeCloseTo(0.020, 10);
  });

  it('agent-multiple: falls back to initial when actualAvgCostPerAgent is 0', () => {
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.010, 0,
    )).toBeCloseTo(0.020, 10);
  });

  it('agent-multiple: falls back to initial when actualAvgCostPerAgent is negative', () => {
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.010, -0.5,
    )).toBeCloseTo(0.020, 10);
  });

  it('agent-multiple: falls back to initial when actualAvgCostPerAgent is NaN', () => {
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.010, NaN,
    )).toBeCloseTo(0.020, 10);
  });

  it('agent-multiple: both sources invalid returns 0', () => {
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0, null,
    )).toBe(0);
    expect(resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, NaN, null,
    )).toBe(0);
  });
});

describe('budget-aware dispatch arithmetic (integration)', () => {
  // These tests exercise the concrete scenarios the resolver is used for in
  // runIterationLoop.ts: "how many parallel agents can we afford?"

  it('agent-multiple mode: floor of 3× reserves exactly 3 agents worth of budget', () => {
    const totalBudget = 1.00;
    const initialAgentCostEstimate = 0.015; // $0.015 per agent
    const floor = resolveParallelFloor(
      { minBudgetAfterParallelAgentMultiple: 3 },
      totalBudget,
      initialAgentCostEstimate,
    );
    const parallelBudget = totalBudget - floor;
    const maxAffordable = Math.floor(parallelBudget / initialAgentCostEstimate);
    // Parallel budget = $1.00 - $0.045 = $0.955; max affordable = 63 agents
    expect(floor).toBeCloseTo(0.045, 10);
    expect(maxAffordable).toBe(63);
  });

  it('fraction mode: 40% floor with $1 budget reserves $0.40', () => {
    const totalBudget = 1.00;
    const floor = resolveParallelFloor(
      { minBudgetAfterParallelFraction: 0.4 },
      totalBudget,
      0.01,
    );
    expect(floor).toBeCloseTo(0.4, 10);
    const parallelBudget = totalBudget - floor;
    expect(parallelBudget).toBeCloseTo(0.6, 10);
  });

  it('sequential floor shrinks with cheaper actualAvgCostPerAgent feedback', () => {
    // Before batch: predicted $0.015/agent
    const initialFloor = resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.015, null,
    );
    // After batch: actually only $0.008/agent
    const runtimeFloor = resolveSequentialFloor(
      { minBudgetAfterSequentialAgentMultiple: 2 },
      1.0, 0.015, 0.008,
    );
    expect(initialFloor).toBeCloseTo(0.030, 10);
    expect(runtimeFloor).toBeCloseTo(0.016, 10);
    expect(runtimeFloor).toBeLessThan(initialFloor);
  });
});
