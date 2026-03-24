// Unit tests for execution-phase metric compute functions.

import { computeRunCost, computeAgentCost } from './execution';
import type { ExecutionContext } from '../types';

function makeCtx(totalSpent: number, phaseCosts: Record<string, number>, phaseName: string): ExecutionContext {
  return {
    costTracker: {
      getTotalSpent: () => totalSpent,
      getPhaseCosts: () => phaseCosts,
    },
    phaseName,
  };
}

describe('computeRunCost', () => {
  it('returns costTracker.getTotalSpent()', () => {
    expect(computeRunCost(makeCtx(1.23, {}, 'generation'))).toBe(1.23);
  });

  it('returns 0 when no spend', () => {
    expect(computeRunCost(makeCtx(0, {}, 'ranking'))).toBe(0);
  });
});

describe('computeAgentCost', () => {
  it('returns phase cost for named phase', () => {
    expect(computeAgentCost(makeCtx(2, { generation: 0.8, ranking: 1.2 }, 'ranking'))).toBe(1.2);
  });

  it('returns 0 for unknown phase', () => {
    expect(computeAgentCost(makeCtx(2, { generation: 0.8 }, 'ranking'))).toBe(0);
  });
});
