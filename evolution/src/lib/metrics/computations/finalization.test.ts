// Unit tests for finalization-phase metric compute functions.

import {
  computeRunCost, computeAgentCost,
  computeWinnerElo, computeMedianElo, computeP90Elo, computeMaxElo,
  computeTotalMatches, computeDecisiveRate, computeVariantCount,
  computeCostEstimationErrorPct,
  computeEstimatedCost, computeEstimationAbsErrorUsd,
  computeGenerationEstimationErrorPct, computeRankingEstimationErrorPct,
  computeAgentCostProjected, computeAgentCostActual,
  computeParallelDispatched, computeSequentialDispatched,
  computeMedianSequentialGfsaDurationMs, computeAvgSequentialGfsaDurationMs,
} from './finalization';
import type { ExecutionContext } from '../types';
import type { FinalizationContext } from '../types';
import type { Rating } from '@evolution/lib/shared/computeRatings';
import type { Variant } from '@evolution/lib/types';
import type { V2Match } from '@evolution/lib/pipeline/infra/types';
import type { AgentName } from '@evolution/lib/core/agentNames';

function makeVariant(id: string): Variant {
  return { id, text: '', version: 0, parentIds: [], strategy: 'test', createdAt: 0, iterationBorn: 0 };
}

function makeCtx(overrides: Partial<FinalizationContext> = {}): FinalizationContext {
  const pool = overrides.pool ?? [makeVariant('a'), makeVariant('b'), makeVariant('c')];
  // elos: a=1280 (mu=30), b=1200 (mu=25), c=1120 (mu=20); uncertainty=80 (sigma=5)
  const ratings: Map<string, Rating> = overrides.ratings ?? new Map<string, Rating>([
    ['a', { elo: 1280, uncertainty: 80 }],
    ['b', { elo: 1200, uncertainty: 80 }],
    ['c', { elo: 1120, uncertainty: 80 }],
  ]);
  const matchHistory = overrides.matchHistory ?? [];
  return {
    result: { winner: pool[0]!, pool, ratings, matchHistory, totalCost: 0, iterationsRun: 1, stopReason: 'completed', eloHistory: [], diversityHistory: [], matchCounts: {} },
    ratings,
    pool,
    matchHistory,
    ...overrides,
  };
}

describe('computeWinnerElo', () => {
  it('returns MetricValue with correct elo and uncertainty', () => {
    const ctx = makeCtx();
    const result = computeWinnerElo(ctx);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(1280);
    expect(result!.uncertainty).toBe(80);
    expect(result!.ci).toEqual([
      1280 - 1.96 * 80,
      1280 + 1.96 * 80,
    ]);
    expect(result!.n).toBe(1);
  });

  it('returns null for empty pool', () => {
    expect(computeWinnerElo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeMedianElo', () => {
  it('returns MetricValue with uncertainty from median variant (odd pool)', () => {
    const ctx = makeCtx();
    const result = computeMedianElo(ctx);
    expect(result).not.toBeNull();
    // Sorted elos: [1120, 1200, 1280] — median is 1200
    expect(result!.value).toBe(1200);
    expect(result!.uncertainty).toBe(80); // uncertainty from variant 'b'
    expect(result!.ci).not.toBeNull();
  });

  it('returns MetricValue for even pool size', () => {
    const pool = [makeVariant('a'), makeVariant('b')];
    // a: mu=30 → elo=1280, sigma=5 → uncertainty=80
    // b: mu=20 → elo=1120, sigma=3 → uncertainty=48
    const ratings = new Map<string, Rating>([
      ['a', { elo: 1280, uncertainty: 80 }],
      ['b', { elo: 1120, uncertainty: 48 }],
    ]);
    const result = computeMedianElo(makeCtx({ pool, ratings }));
    expect(result).not.toBeNull();
    expect(result!.value).toBe((1120 + 1280) / 2);
    expect(result!.uncertainty).toBe((48 + 80) / 2); // average uncertainty
  });

  it('returns null for empty pool', () => {
    expect(computeMedianElo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeP90Elo', () => {
  it('returns MetricValue with uncertainty from P90 variant', () => {
    const ctx = makeCtx();
    const result = computeP90Elo(ctx);
    expect(result).not.toBeNull();
    // Sorted: [1120, 1200, 1280] — P90 index = ceil(3*0.9)-1 = 2
    expect(result!.value).toBe(1280);
    expect(result!.uncertainty).toBe(80);
  });

  it('returns null for empty pool', () => {
    expect(computeP90Elo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeMaxElo', () => {
  it('returns MetricValue with uncertainty from max variant', () => {
    const result = computeMaxElo(makeCtx());
    expect(result).not.toBeNull();
    expect(result!.value).toBe(1280);
    expect(result!.uncertainty).toBe(80);
    expect(result!.ci).toEqual([
      1280 - 1.96 * 80,
      1280 + 1.96 * 80,
    ]);
  });

  it('returns null for empty pool', () => {
    expect(computeMaxElo(makeCtx({ pool: [], ratings: new Map() }))).toBeNull();
  });
});

describe('computeTotalMatches', () => {
  it('returns matchHistory.length', () => {
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'win', confidence: 0.8, judgeModel: 'test', reversed: false },
      { winnerId: 'b', loserId: 'c', result: 'win', confidence: 0.7, judgeModel: 'test', reversed: false },
    ];
    expect(computeTotalMatches(makeCtx({ matchHistory: matches }))).toBe(2);
  });
});

describe('computeDecisiveRate', () => {
  it('correct ratio', () => {
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'win', confidence: 0.8, judgeModel: 'test', reversed: false },
      { winnerId: 'b', loserId: 'c', result: 'win', confidence: 0.5, judgeModel: 'test', reversed: false },
    ];
    expect(computeDecisiveRate(makeCtx({ matchHistory: matches }))).toBe(0.5);
  });

  it('returns null for zero matches', () => {
    expect(computeDecisiveRate(makeCtx({ matchHistory: [] }))).toBeNull();
  });
});

describe('computeVariantCount', () => {
  it('returns pool.length', () => {
    expect(computeVariantCount(makeCtx())).toBe(3);
  });
});

// ─── Execution-phase metrics ─────────────────────────────────────

function makeExecCtx(
  totalSpent: number,
  phaseCosts: Partial<Record<AgentName, number>>,
  phaseName: AgentName,
): ExecutionContext {
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
    expect(computeRunCost(makeExecCtx(1.23, {}, 'generation'))).toBe(1.23);
  });

  it('returns 0 when no spend', () => {
    expect(computeRunCost(makeExecCtx(0, {}, 'ranking'))).toBe(0);
  });
});

describe('computeAgentCost', () => {
  it('returns phase cost for named phase', () => {
    expect(computeAgentCost(makeExecCtx(2, { generation: 0.8, ranking: 1.2 }, 'ranking'))).toBe(1.2);
  });

  it('returns 0 for unknown phase', () => {
    expect(computeAgentCost(makeExecCtx(2, { generation: 0.8 }, 'ranking'))).toBe(0);
  });
});

// ─── Cost Estimate Accuracy compute fns (cost_estimate_accuracy_analysis_20260414) ───

function makeInvocationDetails(details: Array<Record<string, unknown>>): FinalizationContext['invocationDetails'] {
  const map = new Map<string, AgentExecutionDetail>();
  details.forEach((d, i) => map.set(`inv-${i}`, d as unknown as AgentExecutionDetail));
  return map;
}

type AgentExecutionDetail = import('@evolution/lib/types').AgentExecutionDetail;

describe('computeCostEstimationErrorPct', () => {
  it('returns null when invocationDetails is undefined', () => {
    expect(computeCostEstimationErrorPct(makeCtx())).toBeNull();
  });
  it('returns null when no invocations have estimationErrorPct', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([{}, { foo: 'bar' }]) });
    expect(computeCostEstimationErrorPct(ctx)).toBeNull();
  });
  it('skips non-finite values', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { estimationErrorPct: 10 }, { estimationErrorPct: Infinity }, { estimationErrorPct: NaN }, { estimationErrorPct: 20 },
    ]) });
    expect(computeCostEstimationErrorPct(ctx)).toBeCloseTo(15, 5);
  });
  it('mean across finite values', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { estimationErrorPct: -5 }, { estimationErrorPct: 5 }, { estimationErrorPct: 30 },
    ]) });
    expect(computeCostEstimationErrorPct(ctx)).toBeCloseTo(10, 5);
  });
});

describe('computeEstimatedCost', () => {
  it('returns null when no invocations carry estimatedTotalCost', () => {
    expect(computeEstimatedCost(makeCtx({ invocationDetails: makeInvocationDetails([{}]) }))).toBeNull();
  });
  it('sums across GFSA invocations', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { estimatedTotalCost: 0.05 }, { estimatedTotalCost: 0.07 }, { other: 1 },
    ]) });
    expect(computeEstimatedCost(ctx)).toBeCloseTo(0.12, 5);
  });
  it('skips negative or non-finite estimates', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { estimatedTotalCost: 0.05 }, { estimatedTotalCost: -1 }, { estimatedTotalCost: NaN },
    ]) });
    expect(computeEstimatedCost(ctx)).toBeCloseTo(0.05, 5);
  });
});

describe('computeEstimationAbsErrorUsd', () => {
  it('returns null when no paired data', () => {
    expect(computeEstimationAbsErrorUsd(makeCtx({ invocationDetails: makeInvocationDetails([{ estimatedTotalCost: 0.05 }]) }))).toBeNull();
  });
  it('mean of |actual − estimated| across paired invocations', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { estimatedTotalCost: 0.05, totalCost: 0.07 }, // 0.02
      { estimatedTotalCost: 0.10, totalCost: 0.08 }, // 0.02
      { estimatedTotalCost: 0.04, totalCost: 0.10 }, // 0.06
    ]) });
    expect(computeEstimationAbsErrorUsd(ctx)).toBeCloseTo(0.0333, 3);
  });
});

describe('computeGenerationEstimationErrorPct', () => {
  it('returns null when no generation data exists', () => {
    expect(computeGenerationEstimationErrorPct(makeCtx({ invocationDetails: makeInvocationDetails([{}]) }))).toBeNull();
  });
  it('mean of generation-phase error % across invocations', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { generation: { estimatedCost: 0.05, cost: 0.06 } }, // +20%
      { generation: { estimatedCost: 0.10, cost: 0.08 } }, // -20%
    ]) });
    expect(computeGenerationEstimationErrorPct(ctx)).toBeCloseTo(0, 5);
  });
  it('guards against zero estimates', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { generation: { estimatedCost: 0, cost: 0.06 } },
      { generation: { estimatedCost: 0.05, cost: 0.05 } }, // 0%
    ]) });
    expect(computeGenerationEstimationErrorPct(ctx)).toBe(0);
  });
});

describe('computeRankingEstimationErrorPct', () => {
  it('returns null when no ranking data exists', () => {
    expect(computeRankingEstimationErrorPct(makeCtx({ invocationDetails: makeInvocationDetails([{}]) }))).toBeNull();
  });
  it('mean of ranking-phase error %', () => {
    const ctx = makeCtx({ invocationDetails: makeInvocationDetails([
      { ranking: { estimatedCost: 0.02, cost: 0.025 } }, // +25%
      { ranking: { estimatedCost: 0.04, cost: 0.030 } }, // -25%
    ]) });
    expect(computeRankingEstimationErrorPct(ctx)).toBeCloseTo(0, 5);
  });
});

describe('budget-floor observable computes', () => {
  it('all return null without budgetFloorObservables', () => {
    const ctx = makeCtx();
    expect(computeAgentCostProjected(ctx)).toBeNull();
    expect(computeAgentCostActual(ctx)).toBeNull();
    expect(computeParallelDispatched(ctx)).toBeNull();
    expect(computeSequentialDispatched(ctx)).toBeNull();
    expect(computeMedianSequentialGfsaDurationMs(ctx)).toBeNull();
    expect(computeAvgSequentialGfsaDurationMs(ctx)).toBeNull();
  });
  it('returns budgetFloorObservables values when present', () => {
    const ctx = makeCtx({ budgetFloorObservables: {
      initialAgentCostEstimate: 0.082,
      actualAvgCostPerAgent: 0.094,
      parallelDispatched: 7,
      sequentialDispatched: 2,
      medianSequentialGfsaDurationMs: 51000,
      avgSequentialGfsaDurationMs: 54000,
    } });
    expect(computeAgentCostProjected(ctx)).toBeCloseTo(0.082, 4);
    expect(computeAgentCostActual(ctx)).toBeCloseTo(0.094, 4);
    expect(computeParallelDispatched(ctx)).toBe(7);
    expect(computeSequentialDispatched(ctx)).toBe(2);
    expect(computeMedianSequentialGfsaDurationMs(ctx)).toBe(51000);
    expect(computeAvgSequentialGfsaDurationMs(ctx)).toBe(54000);
  });
  it('actual null (parallel had no successful agents) returns null', () => {
    const ctx = makeCtx({ budgetFloorObservables: {
      initialAgentCostEstimate: 0.082,
      actualAvgCostPerAgent: null,
      parallelDispatched: 0,
      sequentialDispatched: 0,
      medianSequentialGfsaDurationMs: null,
      avgSequentialGfsaDurationMs: null,
    } });
    expect(computeAgentCostActual(ctx)).toBeNull();
    expect(computeMedianSequentialGfsaDurationMs(ctx)).toBeNull();
  });
  it('non-finite observables return null', () => {
    const ctx = makeCtx({ budgetFloorObservables: {
      initialAgentCostEstimate: Infinity,
      actualAvgCostPerAgent: NaN,
      parallelDispatched: 0,
      sequentialDispatched: 0,
      medianSequentialGfsaDurationMs: 0,
      avgSequentialGfsaDurationMs: 0,
    } });
    expect(computeAgentCostProjected(ctx)).toBeNull();
    expect(computeAgentCostActual(ctx)).toBeNull();
  });
});
