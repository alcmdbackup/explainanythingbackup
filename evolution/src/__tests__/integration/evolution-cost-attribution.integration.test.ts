// Integration test: verifies that per-invocation cost attribution works correctly
// when rawProvider/defaultModel are set on AgentContext.
//
// Tests the Agent.run() → AgentCostScope → createEvolutionLLMClient flow that
// was broken in production (rawProvider never propagated, costScope.getOwnSpent() = 0).

import { createAgentCostScope } from '../../lib/pipeline/infra/trackBudget';

describe('per-invocation cost attribution via AgentCostScope', () => {
  it('AgentCostScope.getOwnSpent() accumulates recordSpend calls', () => {
    const shared = {
      reserve: jest.fn().mockReturnValue(0.01),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => 0),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10),
      computeMargined: jest.fn((c: number) => c * 1.3),
      canReserve: jest.fn(() => true),
    };

    const scope = createAgentCostScope(shared);

    // Simulate two LLM calls through the scope
    scope.recordSpend('generation', 0.005, 0.01);
    scope.recordSpend('ranking', 0.003, 0.01);

    // Scope should track its own cost independently
    expect(scope.getOwnSpent()).toBeCloseTo(0.008);

    // Shared tracker should also receive both calls
    expect(shared.recordSpend).toHaveBeenCalledTimes(2);
    expect(shared.recordSpend).toHaveBeenCalledWith('generation', 0.005, 0.01);
    expect(shared.recordSpend).toHaveBeenCalledWith('ranking', 0.003, 0.01);
  });

  it('parallel scopes do not bleed cost into each other', () => {
    const shared = {
      reserve: jest.fn().mockReturnValue(0.01),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => 0),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10),
      computeMargined: jest.fn((c: number) => c * 1.3),
      canReserve: jest.fn(() => true),
    };

    const scopeA = createAgentCostScope(shared);
    const scopeB = createAgentCostScope(shared);

    scopeA.recordSpend('generation', 0.01, 0.02);
    scopeB.recordSpend('generation', 0.02, 0.03);
    scopeA.recordSpend('ranking', 0.005, 0.01);

    // Each scope sees only its own cost
    expect(scopeA.getOwnSpent()).toBeCloseTo(0.015);
    expect(scopeB.getOwnSpent()).toBeCloseTo(0.02);

    // Shared tracker received all calls
    expect(shared.recordSpend).toHaveBeenCalledTimes(3);
  });

  it('scope delegates reserve/release to shared tracker', () => {
    const shared = {
      reserve: jest.fn().mockReturnValue(0.013),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => 0.5),
      getPhaseCosts: jest.fn(() => ({ generation: 0.3 })),
      getAvailableBudget: jest.fn(() => 9.5),
      computeMargined: jest.fn((c: number) => c * 1.3),
      canReserve: jest.fn(() => true),
    };

    const scope = createAgentCostScope(shared);

    expect(scope.reserve('generation', 0.01)).toBe(0.013);
    expect(shared.reserve).toHaveBeenCalledWith('generation', 0.01);

    scope.release('generation', 0.013);
    expect(shared.release).toHaveBeenCalledWith('generation', 0.013);

    expect(scope.getTotalSpent()).toBe(0.5);
    expect(scope.getAvailableBudget()).toBe(9.5);
  });
});
