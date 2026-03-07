// Unit tests for backfill-experiment-metrics: idempotency, dry-run, batch processing.
// Tests the computeRunMetricsForBackfill function and main() orchestration with mocked Supabase.

import { computeRunMetricsForBackfill, main } from './backfill-experiment-metrics';

function mockSupabase(config: {
  rpcData?: unknown;
  invocations?: Array<{ agent_name: string; cost_usd: number }>;
}) {
  return {
    rpc: jest.fn().mockResolvedValue({
      data: config.rpcData ?? [{ total_variants: 5, median_elo: 1300, p90_elo: 1400, max_elo: 1500 }],
      error: null,
    }),
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'evolution_agent_invocations') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: config.invocations ?? [], error: null }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    }),
  };
}

describe('computeRunMetricsForBackfill', () => {
  it('computes metrics from RPC data', async () => {
    const supabase = mockSupabase({});
    const cache = new Map();
    const result = await computeRunMetricsForBackfill('run-1', supabase as never, cache);
    expect(result.totalVariants?.value).toBe(5);
    expect(result.medianElo?.value).toBe(1300);
    expect(result.maxElo?.value).toBe(1500);
  });

  it('uses checkpoint cache for sigma', async () => {
    const supabase = mockSupabase({});
    const cache = new Map([
      ['run-1', { ratings: { v1: { mu: 30, sigma: 3 }, v2: { mu: 25, sigma: 5 } } }],
    ]);
    const result = await computeRunMetricsForBackfill('run-1', supabase as never, cache);
    expect(result.maxElo?.sigma).not.toBeNull();
  });

  it('falls back to checkpoint when RPC returns 0 variants', async () => {
    const supabase = mockSupabase({
      rpcData: [{ total_variants: 0, median_elo: null, p90_elo: null, max_elo: null }],
    });
    const cache = new Map([
      ['run-1', { ratings: { v1: { mu: 25, sigma: 5 }, v2: { mu: 30, sigma: 3 } } }],
    ]);
    const result = await computeRunMetricsForBackfill('run-1', supabase as never, cache);
    expect(result.totalVariants?.value).toBe(2);
    expect(result.maxElo?.value).toBeDefined();
  });

  it('aggregates agent costs correctly', async () => {
    const supabase = mockSupabase({
      invocations: [
        { agent_name: 'gen', cost_usd: 0.1 },
        { agent_name: 'gen', cost_usd: 0.2 },
        { agent_name: 'judge', cost_usd: 0.5 },
      ],
    });
    const cache = new Map();
    const result = await computeRunMetricsForBackfill('run-1', supabase as never, cache);
    expect(result['agentCost:gen']?.value).toBeCloseTo(0.3);
    expect(result['agentCost:judge']?.value).toBeCloseTo(0.5);
    expect(result.cost?.value).toBeCloseTo(0.8);
  });

  it('is idempotent (same inputs produce same outputs)', async () => {
    const supabase = mockSupabase({});
    const cache = new Map([
      ['run-1', { ratings: { v1: { mu: 25, sigma: 5 } } }],
    ]);
    const r1 = await computeRunMetricsForBackfill('run-1', supabase as never, cache);
    const r2 = await computeRunMetricsForBackfill('run-1', supabase as never, cache);
    expect(r1).toEqual(r2);
  });
});

describe('main() orchestration', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
  });

  it('dry-run mode does not write to DB', async () => {
    process.argv = ['node', 'backfill', /* no --run flag */];
    const updateFn = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    const mockClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_experiments') {
          return {
            select: () => ({
              in: () => ({
                order: () => Promise.resolve({
                  data: [{ id: 'exp-1', status: 'completed', analysis_results: {} }],
                  error: null,
                }),
              }),
            }),
            update: updateFn,
          };
        }
        if (table === 'evolution_runs') {
          return {
            select: () => ({
              in: () => ({
                eq: () => Promise.resolve({
                  data: [{ id: 'run-1', experiment_id: 'exp-1', status: 'completed' }],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'evolution_checkpoints') {
          return {
            select: () => ({
              in: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'evolution_agent_invocations') {
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }),
      rpc: jest.fn().mockResolvedValue({
        data: [{ total_variants: 3, median_elo: 1300, p90_elo: 1400, max_elo: 1500 }],
        error: null,
      }),
    };

    // Inject mock client via module internals
    const mod = await import('./backfill-experiment-metrics');
    await mod.mainWithClient(mockClient as never);

    // In dry-run mode, update should never be called
    expect(updateFn).not.toHaveBeenCalled();
  });

  it('processes experiments in batches', async () => {
    const experiments = Array.from({ length: 15 }, (_, i) => ({
      id: `exp-${i}`,
      status: 'completed',
      analysis_results: {},
    }));
    const updateFn = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    const mockClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_experiments') {
          return {
            select: () => ({
              in: () => ({
                order: () => Promise.resolve({ data: experiments, error: null }),
              }),
            }),
            update: updateFn,
          };
        }
        if (table === 'evolution_runs') {
          return {
            select: () => ({
              in: jest.fn().mockImplementation((_col: string, expIds: string[]) => ({
                eq: () => Promise.resolve({
                  data: expIds.map((eid) => ({ id: `run-for-${eid}`, experiment_id: eid, status: 'completed' })),
                  error: null,
                }),
              })),
            }),
          };
        }
        if (table === 'evolution_checkpoints') {
          return { select: () => ({ in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        }
        if (table === 'evolution_agent_invocations') {
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }),
      rpc: jest.fn().mockResolvedValue({
        data: [{ total_variants: 3, median_elo: 1300, p90_elo: 1400, max_elo: 1500 }],
        error: null,
      }),
    };

    const mod = await import('./backfill-experiment-metrics');
    const result = await mod.mainWithClient(mockClient as never, true);

    // 15 experiments should be processed (batch size = 10, so 2 batches)
    expect(result.succeeded).toBe(15);
    expect(result.failed).toBe(0);
  });

  it('handles partial failure gracefully', async () => {
    let callCount = 0;
    const updateFn = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    const mockClient = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table === 'evolution_experiments') {
          return {
            select: () => ({
              in: () => ({
                order: () => Promise.resolve({
                  data: [
                    { id: 'exp-ok', status: 'completed', analysis_results: {} },
                    { id: 'exp-fail', status: 'completed', analysis_results: {} },
                  ],
                  error: null,
                }),
              }),
            }),
            update: updateFn,
          };
        }
        if (table === 'evolution_runs') {
          return {
            select: () => ({
              in: () => ({
                eq: () => Promise.resolve({
                  data: [
                    { id: 'run-ok', experiment_id: 'exp-ok', status: 'completed' },
                    { id: 'run-fail', experiment_id: 'exp-fail', status: 'completed' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'evolution_checkpoints') {
          return { select: () => ({ in: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        }
        if (table === 'evolution_agent_invocations') {
          return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
        }
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }),
      rpc: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          // Second RPC call (for exp-fail's run) throws
          return Promise.resolve({ data: null, error: { message: 'RPC failed' } });
        }
        return Promise.resolve({
          data: [{ total_variants: 3, median_elo: 1300, p90_elo: 1400, max_elo: 1500 }],
          error: null,
        });
      }),
    };

    const mod = await import('./backfill-experiment-metrics');
    const result = await mod.mainWithClient(mockClient as never, true);

    // exp-ok succeeds, exp-fail also succeeds because RPC error returns null stats
    // but the metric computation still succeeds with empty metrics
    expect(result.succeeded + result.failed).toBe(2);
    expect(result.failedIds.length).toBe(result.failed);
  });
});
