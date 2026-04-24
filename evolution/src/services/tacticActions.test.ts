// Tests for listTacticsAction — Phase 2 leaderboard behavior
// (metric attachment, server-side + JS-side sort, search filter escaping).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

// Partial-mock readMetrics so we can control the metric rows without a real DB.
const mockGetMetricsForEntities = jest.fn();
jest.mock('../lib/metrics/readMetrics', () => ({
  ...jest.requireActual('../lib/metrics/readMetrics'),
  getMetricsForEntities: (...args: unknown[]) => mockGetMetricsForEntities(...args),
}));

import { listTacticsAction } from './tacticActions';

// ─── Mock Supabase chain that captures order + ilike + range calls ───

interface MockState {
  tacticsRows: Array<{
    id: string; name: string; label: string; agent_type: string;
    category: string | null; is_predefined: boolean; status: string; created_at: string;
  }>;
  orderCalls: Array<{ col: string; ascending: boolean }>;
  ilikeCalls: Array<{ col: string; pattern: string }>;
  eqCalls: Array<{ col: string; val: unknown }>;
  count: number;
}

function makeMockSupabase(state: MockState) {
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.order = jest.fn((col: string, opts: { ascending: boolean }) => {
    state.orderCalls.push({ col, ascending: opts.ascending });
    return chain;
  });
  chain.ilike = jest.fn((col: string, pattern: string) => {
    state.ilikeCalls.push({ col, pattern });
    return chain;
  });
  chain.eq = jest.fn((col: string, val: unknown) => {
    state.eqCalls.push({ col, val });
    return chain;
  });
  chain.range = jest.fn(() => Promise.resolve({ data: state.tacticsRows, count: state.count, error: null }));
  return {
    from: jest.fn().mockReturnValue(chain),
  } as unknown as ReturnType<typeof createSupabaseServiceClient>;
}

function row(id: string, name: string, extras: Partial<MockState['tacticsRows'][0]> = {}) {
  return {
    id, name, label: name, agent_type: 'generate_from_previous_article',
    category: 'core', is_predefined: true, status: 'active',
    created_at: '2026-04-22T00:00:00Z',
    ...extras,
  };
}

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const UUID_C = '00000000-0000-4000-8000-000000000003';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMetricsForEntities.mockResolvedValue(new Map());
});

describe('listTacticsAction', () => {
  it('returns rows with metrics: [] when no metric rows exist (unproven tactics case)', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'structural_transform'), row(UUID_B, 'lexical_simplify')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 2,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));

    const result = await listTacticsAction({});
    expect(result.success).toBe(true);
    expect(result.data!.items).toHaveLength(2);
    expect(result.data!.items[0]!.metrics).toEqual([]);
    expect(result.data!.items[1]!.metrics).toEqual([]);
    expect(result.data!.total).toBe(2);
  });

  it('attaches metric rows from getMetricsForEntities batch fetch', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'structural_transform'), row(UUID_B, 'lexical_simplify')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 2,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));
    mockGetMetricsForEntities.mockResolvedValueOnce(new Map([
      [UUID_A, [{ metric_name: 'avg_elo', value: 1287, entity_id: UUID_A } as never]],
    ]));

    const result = await listTacticsAction({});
    expect(result.data!.items.find((r) => r.id === UUID_A)!.metrics).toHaveLength(1);
    expect(result.data!.items.find((r) => r.id === UUID_B)!.metrics).toEqual([]);
    // Batch fetch called once with tactic entity type + requested metric names.
    expect(mockGetMetricsForEntities).toHaveBeenCalledTimes(1);
    const [, entityType, entityIds, metricNames] = mockGetMetricsForEntities.mock.calls[0] as [unknown, string, string[], string[]];
    expect(entityType).toBe('tactic');
    expect(entityIds.sort()).toEqual([UUID_A, UUID_B].sort());
    expect(metricNames).toEqual(expect.arrayContaining(['avg_elo', 'avg_elo_delta', 'win_rate', 'total_variants', 'run_count']));
  });

  it('identity sortKey routes through server-side .order()', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'a'), row(UUID_B, 'b')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 2,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));

    await listTacticsAction({ sortKey: 'name', sortDir: 'asc' });
    expect(state.orderCalls).toEqual([{ col: 'name', ascending: true }]);
  });

  it('unknown sortKey falls back to created_at', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'a')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 1,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));

    await listTacticsAction({ sortKey: 'made_up_column', sortDir: 'desc' });
    // sortDir is still honored for the fallback key — 'desc' → ascending=false.
    expect(state.orderCalls).toEqual([{ col: 'created_at', ascending: false }]);
  });

  it('metric sortKey: sorts JS-side on attached metric values, desc', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'a'), row(UUID_B, 'b'), row(UUID_C, 'c')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 3,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));
    mockGetMetricsForEntities.mockResolvedValueOnce(new Map([
      [UUID_A, [{ metric_name: 'avg_elo', value: 1200, entity_id: UUID_A } as never]],
      [UUID_B, [{ metric_name: 'avg_elo', value: 1300, entity_id: UUID_B } as never]],
      // UUID_C has no rows — null value → sorts last.
    ]));

    const result = await listTacticsAction({ sortKey: 'avg_elo', sortDir: 'desc' });
    const ids = result.data!.items.map((r) => r.id);
    // 1300 > 1200 > null; null always last regardless of dir.
    expect(ids).toEqual([UUID_B, UUID_A, UUID_C]);
  });

  it('metric sortKey asc still sorts nulls last', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'a'), row(UUID_B, 'b'), row(UUID_C, 'c')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 3,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));
    mockGetMetricsForEntities.mockResolvedValueOnce(new Map([
      [UUID_A, [{ metric_name: 'win_rate', value: 0.1, entity_id: UUID_A } as never]],
      [UUID_B, [{ metric_name: 'win_rate', value: 0.5, entity_id: UUID_B } as never]],
    ]));

    const result = await listTacticsAction({ sortKey: 'win_rate', sortDir: 'asc' });
    const ids = result.data!.items.map((r) => r.id);
    expect(ids).toEqual([UUID_A, UUID_B, UUID_C]); // 0.1 < 0.5 < null
  });

  it('search filter applies ilike with escaped wildcard characters', async () => {
    const state: MockState = {
      tacticsRows: [row(UUID_A, 'foo%bar')],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 1,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));

    await listTacticsAction({ search: 'struct_100%' });
    // %_\\ are escaped via \\$&; wildcards wrapping the pattern are ilike syntax.
    expect(state.ilikeCalls).toEqual([
      { col: 'name', pattern: '%struct\\_100\\%%' },
    ]);
  });

  it('status and agentType filters route through .eq()', async () => {
    const state: MockState = {
      tacticsRows: [],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 0,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));

    await listTacticsAction({ status: 'active', agentType: 'generate_from_previous_article' });
    expect(state.eqCalls).toEqual(expect.arrayContaining([
      { col: 'status', val: 'active' },
      { col: 'agent_type', val: 'generate_from_previous_article' },
    ]));
  });

  it('skips batch metric fetch when result set is empty', async () => {
    const state: MockState = {
      tacticsRows: [],
      orderCalls: [], ilikeCalls: [], eqCalls: [], count: 0,
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeMockSupabase(state));

    await listTacticsAction({});
    expect(mockGetMetricsForEntities).not.toHaveBeenCalled();
  });
});
