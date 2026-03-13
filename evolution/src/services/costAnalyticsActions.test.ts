// Tests for cost analytics actions: strategy accuracy aggregation.

import { getStrategyAccuracyAction } from './costAnalyticsActions';
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
