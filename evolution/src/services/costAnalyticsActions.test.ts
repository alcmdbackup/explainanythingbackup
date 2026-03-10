// Tests for cost analytics actions: strategy accuracy aggregation.

import { getStrategyAccuracyAction, getCostAccuracyOverviewAction } from './costAnalyticsActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

function createChainMock() {
  const mock: Record<string, jest.Mock> = {};
  const chain = () => mock;
  for (const m of ['from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'in', 'is',
    'not', 'order', 'limit', 'range', 'single', 'maybeSingle']) {
    mock[m] = jest.fn(chain);
  }
  return mock;
}

describe('getStrategyAccuracyAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('aggregates accuracy stats grouped by strategy', async () => {
    const mock = createChainMock();

    // First query: completed runs with estimates
    mock.gt.mockResolvedValueOnce({
      data: [
        { strategy_config_id: 'strat-a', estimated_cost_usd: 1.00, total_cost_usd: 1.10 },
        { strategy_config_id: 'strat-a', estimated_cost_usd: 1.00, total_cost_usd: 0.90 },
        { strategy_config_id: 'strat-b', estimated_cost_usd: 2.00, total_cost_usd: 2.50 },
      ],
      error: null,
    });

    // Second query: strategy names
    mock.in.mockResolvedValueOnce({
      data: [
        { id: 'strat-a', name: 'Strategy A' },
        { id: 'strat-b', name: 'Strategy B' },
      ],
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getStrategyAccuracyAction();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);

    // strat-a: deltas = [+10%, -10%] → avg 0%, stddev 10%
    const stratA = result.data!.find(s => s.strategyId === 'strat-a')!;
    expect(stratA.strategyName).toBe('Strategy A');
    expect(stratA.runCount).toBe(2);
    expect(stratA.avgDeltaPercent).toBe(0);
    expect(stratA.stdDevPercent).toBe(10);

    // strat-b: deltas = [+25%] → avg 25%, stddev 0%
    const stratB = result.data!.find(s => s.strategyId === 'strat-b')!;
    expect(stratB.strategyName).toBe('Strategy B');
    expect(stratB.runCount).toBe(1);
    expect(stratB.avgDeltaPercent).toBe(25);
    expect(stratB.stdDevPercent).toBe(0);
  });

  it('returns empty array when no matching runs', async () => {
    const mock = createChainMock();

    mock.gt.mockResolvedValueOnce({ data: [], error: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getStrategyAccuracyAction();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('handles database error gracefully', async () => {
    const mock = createChainMock();

    mock.gt.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection failed' },
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getStrategyAccuracyAction();

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('connection failed');
  });
});

describe('getCostAccuracyOverviewAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('computes overview with deltas, confidence calibration, per-agent stats, and outliers', async () => {
    const mock = createChainMock();

    mock.limit.mockResolvedValueOnce({
      data: [
        {
          id: 'run-1', estimated_cost_usd: 1.0, total_cost_usd: 1.1, created_at: '2026-02-09T00:00:00Z',
          cost_estimate_detail: { confidence: 'high' },
          cost_prediction: { perAgent: { generation: { estimated: 0.6, actual: 0.7 }, calibration: { estimated: 0.4, actual: 0.4 } } },
        },
        {
          id: 'run-2', estimated_cost_usd: 1.0, total_cost_usd: 2.0, created_at: '2026-02-08T00:00:00Z',
          cost_estimate_detail: { confidence: 'low' },
          cost_prediction: { perAgent: { generation: { estimated: 0.6, actual: 1.2 } } },
        },
      ],
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getCostAccuracyOverviewAction();

    expect(result.success).toBe(true);
    const data = result.data!;

    // Recent deltas (reversed to chronological)
    expect(data.recentDeltas).toHaveLength(2);
    expect(data.recentDeltas[0].runId).toBe('run-2'); // older first
    expect(data.recentDeltas[1].runId).toBe('run-1');
    expect(data.recentDeltas[1].deltaPercent).toBe(10); // (1.1-1.0)/1.0 * 100

    // Confidence calibration
    expect(data.confidenceCalibration.high.count).toBe(1);
    expect(data.confidenceCalibration.high.avgAbsDeltaPercent).toBe(10);
    expect(data.confidenceCalibration.low.count).toBe(1);
    expect(data.confidenceCalibration.low.avgAbsDeltaPercent).toBe(100);

    // Per-agent: generation appears in both runs
    expect(data.perAgentAccuracy.generation).toBeDefined();
    expect(data.perAgentAccuracy.generation.avgEstimated).toBe(0.6); // (0.6+0.6)/2
    expect(data.perAgentAccuracy.generation.avgActual).toBe(0.95); // (0.7+1.2)/2

    // Outliers: run-2 has 100% delta
    expect(data.outliers).toHaveLength(1);
    expect(data.outliers[0].runId).toBe('run-2');
    expect(data.outliers[0].deltaPercent).toBe(100);
  });

  it('aggregates actual-only agents (estimated: 0) in per-agent stats', async () => {
    const mock = createChainMock();

    mock.limit.mockResolvedValueOnce({
      data: [
        {
          id: 'run-1', estimated_cost_usd: 1.0, total_cost_usd: 1.5, created_at: '2026-02-09T00:00:00Z',
          cost_estimate_detail: { confidence: 'medium' },
          cost_prediction: {
            perAgent: {
              generation: { estimated: 0.6, actual: 0.7 },
              calibration: { estimated: 0.4, actual: 0.4 },
              treeSearch: { estimated: 0, actual: 0.30 },  // actual-only agent
              flowCritique: { estimated: 0, actual: 0.10 }, // actual-only agent
            },
          },
        },
      ],
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getCostAccuracyOverviewAction();
    expect(result.success).toBe(true);
    const data = result.data!;

    // Actual-only agents should appear in per-agent stats
    expect(data.perAgentAccuracy.treeSearch).toBeDefined();
    expect(data.perAgentAccuracy.treeSearch.avgEstimated).toBe(0);
    expect(data.perAgentAccuracy.treeSearch.avgActual).toBe(0.30);

    expect(data.perAgentAccuracy.flowCritique).toBeDefined();
    expect(data.perAgentAccuracy.flowCritique.avgEstimated).toBe(0);
    expect(data.perAgentAccuracy.flowCritique.avgActual).toBe(0.10);

    // Standard agents still present
    expect(data.perAgentAccuracy.generation).toBeDefined();
    expect(data.perAgentAccuracy.calibration).toBeDefined();
  });

  it('returns zeroed structure with empty data', async () => {
    const mock = createChainMock();

    mock.limit.mockResolvedValueOnce({ data: [], error: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getCostAccuracyOverviewAction();

    expect(result.success).toBe(true);
    expect(result.data!.recentDeltas).toEqual([]);
    expect(result.data!.perAgentAccuracy).toEqual({});
    expect(result.data!.confidenceCalibration.high).toEqual({ count: 0, avgAbsDeltaPercent: 0 });
    expect(result.data!.outliers).toEqual([]);
  });
});
