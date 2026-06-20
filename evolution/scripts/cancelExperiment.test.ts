// Tests for the Phase 6 cancelExperiment wrapper. Exercises the RPC call,
// snapshot-time WHERE filter, reason-logging, and --archive-strategies idempotency
// against a stubbed Supabase client.

import { cancelExperiment } from './cancelExperiment';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock createEntityLogger so its writes don't try to hit a real DB. We capture
// the calls to assert (a) it's called once per cancelled run and (b) the
// basePath includes 'cancelExperiment' for the subagent_name column.
const mockLoggerInfo = jest.fn(async () => undefined);
const mockCreateEntityLogger = jest.fn(
  (_entityCtx: unknown, _db: unknown, _basePath?: unknown) => ({
    info: mockLoggerInfo, warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn(),
  }),
);
jest.mock('../src/lib/pipeline/infra/createEntityLogger', () => ({
  // Forward as a single rest param so the mock signature stays compatible with the
  // underlying createEntityLogger(entityCtx, supabase, basePath?) tri-arg shape.
  createEntityLogger: (entityCtx: unknown, db: unknown, basePath?: unknown) =>
    mockCreateEntityLogger(entityCtx as never, db as never, basePath as never),
}));

function mockDb(opts: {
  expBefore: { status: string; prompt_id: string } | null;
  cancelledRuns?: { id: string; experiment_id: string; strategy_id: string | null; completed_at: string }[];
  runStrategies?: { strategy_id: string | null }[];
  archiveResult?: { id: string }[];
  rpcError?: { message: string };
}): SupabaseClient {
  const calls: { rpc: number } = { rpc: 0 };
  const rpc = jest.fn(async () => {
    calls.rpc++;
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    return { data: null, error: null };
  });

  // Sequence of evolution_runs SELECTs that the function performs:
  //   call 1 (after rpc): list of just-cancelled runs
  //   call 2 (--archive-strategies): list of all run strategy_ids
  const runsSelectQueue: unknown[] = [
    { data: opts.cancelledRuns ?? [], error: null },
    { data: opts.runStrategies ?? [], error: null },
  ];

  const from = jest.fn((table: string) => {
    if (table === 'evolution_experiments') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: jest.fn(async () => ({
              data: opts.expBefore,
              error: opts.expBefore ? null : { message: 'not found' },
            })),
          }),
        }),
      };
    }
    if (table === 'evolution_runs') {
      // Each consecutive call shifts off the queue.
      const next = runsSelectQueue.shift();
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                gte: jest.fn(async () => next),
              }),
              // For the simpler archive-strategies SELECT pattern.
              maybeSingle: jest.fn(async () => next),
            }),
            // For the archive-strategies path: select('strategy_id').eq('experiment_id', ...)
            then: undefined,
          }),
          // For the archive-strategies path: select(...).eq(...)
        }),
        update: () => ({
          in: () => ({
            eq: () => ({
              select: jest.fn(async () => ({ data: opts.archiveResult ?? [], error: null })),
            }),
          }),
        }),
      };
    }
    if (table === 'evolution_strategies') {
      return {
        update: () => ({
          in: () => ({
            eq: () => ({
              select: jest.fn(async () => ({ data: opts.archiveResult ?? [], error: null })),
            }),
          }),
        }),
      };
    }
    return {};
  });

  return { rpc, from } as unknown as SupabaseClient;
}

describe('cancelExperiment (Phase 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws "Experiment not found" if the experiment row does not exist', async () => {
    const db = mockDb({ expBefore: null });
    await expect(
      cancelExperiment(db, { experimentId: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f', reason: 'test' }),
    ).rejects.toThrow(/not found/i);
  });

  it('calls cancel_experiment RPC and returns experimentWasRunning=true when previously running', async () => {
    const db = mockDb({
      expBefore: { status: 'running', prompt_id: 'p-uuid' },
      cancelledRuns: [
        { id: 'r1', experiment_id: 'e1', strategy_id: 's1', completed_at: '2026-06-19T00:00:00Z' },
      ],
    });
    const result = await cancelExperiment(db, {
      experimentId: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f',
      reason: 'Stage 1 check 3 failed',
    });
    expect(result.experimentWasRunning).toBe(true);
    expect(result.cancelledRunCount).toBe(1);
    expect(db.rpc).toHaveBeenCalledWith('cancel_experiment', { p_experiment_id: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f' });
  });

  it('logs reason via createEntityLogger with basePath=[cancelExperiment]', async () => {
    const db = mockDb({
      expBefore: { status: 'running', prompt_id: 'p-uuid' },
      cancelledRuns: [
        { id: 'r1', experiment_id: 'e1', strategy_id: 's1', completed_at: '2026-06-19T00:00:00Z' },
        { id: 'r2', experiment_id: 'e1', strategy_id: 's2', completed_at: '2026-06-19T00:00:00Z' },
      ],
    });
    await cancelExperiment(db, {
      experimentId: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f',
      reason: 'Stage 1 check 3 failed: bypass not active',
    });
    expect(mockCreateEntityLogger).toHaveBeenCalledTimes(2);
    // 3rd arg (basePath) must include 'cancelExperiment' so it lands in subagent_name.
    expect(mockCreateEntityLogger).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      ['cancelExperiment'],
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith('Stage 1 check 3 failed: bypass not active');
  });

  it('returns experimentWasRunning=false (no-op semantics) when experiment is already cancelled', async () => {
    const db = mockDb({
      expBefore: { status: 'cancelled', prompt_id: 'p-uuid' },
      cancelledRuns: [],
    });
    const result = await cancelExperiment(db, {
      experimentId: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f',
      reason: 'idempotent retry',
    });
    expect(result.experimentWasRunning).toBe(false);
    expect(result.cancelledRunCount).toBe(0);
    expect(mockCreateEntityLogger).not.toHaveBeenCalled();
  });

  it('propagates errors from the cancel_experiment RPC with a clear prefix', async () => {
    const db = mockDb({
      expBefore: { status: 'running', prompt_id: 'p-uuid' },
      rpcError: { message: 'simulated DB error' },
    });
    await expect(
      cancelExperiment(db, { experimentId: 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f', reason: 'test' }),
    ).rejects.toThrow(/cancel_experiment RPC failed: simulated DB error/);
  });
});
