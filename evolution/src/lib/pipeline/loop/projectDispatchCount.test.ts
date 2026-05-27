// Tests for the dispatch-count projection helper that backs the Budget Floor
// Sensitivity module. Mirrors the math in runIterationLoop's dispatch logic.

import { projectDispatchCounts } from './projectDispatchCount';

describe('projectDispatchCounts', () => {
  const baseConfig = {
    totalBudget: 1.0,
    numVariants: 9,
    agentCost: 0.082,
    sequentialStartingBudget: 0.342,
  };

  it('AgentMultiple mode: happy path computes parallel + sequential counts', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      floorConfig: {
        minBudgetAfterParallelAgentMultiple: 3,
        minBudgetAfterSequentialAgentMultiple: 1,
      },
    });
    // parallel floor = 3 × 0.082 = 0.246; budget = 0.754; maxAffordable = 9; capped at numVariants=9
    expect(result.parallelFloor).toBeCloseTo(0.246, 3);
    expect(result.parallelDispatched).toBe(9);
    // sequential floor = 1 × 0.082 = 0.082; capacity = (0.342 − 0.082) / 0.082 = 3.17 → 3, but
    // sequentialCeiling = numVariants − parallel = 9 − 9 = 0, so dispatched = 0
    expect(result.sequentialDispatched).toBe(0);
  });

  it('Fraction mode: floor is static fraction of total budget', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      floorConfig: {
        minBudgetAfterParallelFraction: 0.35,
        minBudgetAfterSequentialFraction: 0.12,
      },
    });
    expect(result.parallelFloor).toBeCloseTo(0.35, 6);
    expect(result.sequentialFloor).toBeCloseTo(0.12, 6);
    // parallel budget = 0.65; maxAffordable = floor(0.65 / 0.082) = 7
    expect(result.parallelDispatched).toBe(7);
  });

  it('numVariants ceiling binds total count', () => {
    const result = projectDispatchCounts({
      totalBudget: 10.0,  // Huge budget
      numVariants: 3,      // Tight ceiling
      agentCost: 0.05,
      sequentialStartingBudget: 9.0,
      floorConfig: {
        minBudgetAfterParallelAgentMultiple: 1,
        minBudgetAfterSequentialAgentMultiple: 1,
      },
    });
    // Parallel capped at numVariants=3; sequential ceiling = 0
    expect(result.parallelDispatched).toBe(3);
    expect(result.sequentialDispatched).toBe(0);
  });

  it('zero agent cost returns all-zero counts (no NaN leak)', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      agentCost: 0,
      floorConfig: { minBudgetAfterSequentialAgentMultiple: 1 },
    });
    expect(result.parallelDispatched).toBe(0);
    expect(result.sequentialDispatched).toBe(0);
    expect(Number.isFinite(result.parallelFloor)).toBe(true);
  });

  it('negative agent cost returns all-zero counts', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      agentCost: -0.1,
      floorConfig: { minBudgetAfterSequentialAgentMultiple: 1 },
    });
    expect(result.parallelDispatched).toBe(0);
    expect(result.sequentialDispatched).toBe(0);
  });

  it('non-finite agent cost returns all-zero counts', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      agentCost: Infinity,
      floorConfig: { minBudgetAfterSequentialAgentMultiple: 1 },
    });
    expect(result.parallelDispatched).toBe(0);
    expect(result.sequentialDispatched).toBe(0);
  });

  it('zero total budget returns all-zero counts', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      totalBudget: 0,
      floorConfig: { minBudgetAfterSequentialAgentMultiple: 1 },
    });
    expect(result.parallelDispatched).toBe(0);
    expect(result.sequentialDispatched).toBe(0);
  });

  it('unset floor config: floors are zero, dispatch limited only by budget/numVariants', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      floorConfig: {},
    });
    expect(result.parallelFloor).toBe(0);
    expect(result.sequentialFloor).toBe(0);
    // maxAffordable = floor(1.0 / 0.082) = 12; capped at numVariants = 9
    expect(result.parallelDispatched).toBe(9);
  });

  it('sequential dispatch capacity math: (startingBudget − floor) / agentCost', () => {
    const result = projectDispatchCounts({
      totalBudget: 1.0,
      numVariants: 20, // Loose ceiling so budget is the bottleneck
      agentCost: 0.1,
      sequentialStartingBudget: 0.5,
      floorConfig: {
        // no parallel floor so all of totalBudget is available
        minBudgetAfterSequentialAgentMultiple: 1,
      },
    });
    // parallelDispatched = min(20, floor(1.0/0.1)) = 10
    expect(result.parallelDispatched).toBe(10);
    // sequential floor = 1 × 0.1 = 0.1
    // capacity = (0.5 − 0.1) / 0.1 = 4
    // sequentialCeiling = 20 − 10 = 10
    expect(result.sequentialDispatched).toBe(4);
  });

  it('sequential starting budget below floor yields zero sequential dispatches', () => {
    const result = projectDispatchCounts({
      ...baseConfig,
      sequentialStartingBudget: 0.05, // below typical floor of 0.082
      floorConfig: { minBudgetAfterSequentialAgentMultiple: 1 },
    });
    expect(result.sequentialDispatched).toBe(0);
  });
});
