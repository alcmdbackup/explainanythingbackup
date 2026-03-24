// Unit tests for stale metric recomputation with SKIP LOCKED concurrency protection.

import { recomputeStaleMetrics } from './recomputeMetrics';
import type { MetricRow, EntityType } from './types';

// ─── Mocks ─────────────────────────────────────────────────────

jest.mock('./registry', () => ({
  METRIC_REGISTRY: {
    run: {
      atFinalization: [
        { name: 'winner_elo', compute: jest.fn(() => 1400) },
        { name: 'median_elo', compute: jest.fn(() => 1300) },
        { name: 'p90_elo', compute: jest.fn(() => 1350) },
        { name: 'max_elo', compute: jest.fn(() => 1450) },
        // Non-elo finalization metric — should be skipped
        { name: 'total_matches', compute: jest.fn(() => 10) },
      ],
      atPropagation: [],
    },
    strategy: { atPropagation: [] },
    experiment: { atPropagation: [] },
  },
}));

const mockWriteMetric = jest.fn();
jest.mock('./writeMetrics', () => ({
  writeMetric: (...args: unknown[]) => mockWriteMetric(...args),
}));

jest.mock('./readMetrics', () => ({
  getMetricsForEntities: jest.fn(async () => new Map()),
}));

// ─── Helpers ───────────────────────────────────────────────────

function makeStaleRow(name: string, entityType: EntityType = 'run', entityId = 'run-1'): MetricRow {
  return {
    id: `row-${name}`,
    entity_type: entityType,
    entity_id: entityId,
    metric_name: name,
    value: 0,
    sigma: null,
    ci_lower: null,
    ci_upper: null,
    n: 0,
    origin_entity_type: null,
    origin_entity_id: null,
    aggregation_method: null,
    source: null,
    stale: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** Supabase mock builder following trackInvocations.test.ts pattern. */
function makeMockDb(options?: {
  lockResult?: unknown[] | null;
  variants?: { id: string; mu: number | null; sigma: number | null }[];
  runs?: { id: string }[];
}) {
  const updateCalls: { filter: Record<string, unknown>; payload: Record<string, unknown> }[] = [];
  const rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];

  const db = {
    rpc: jest.fn((fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      const data = options && 'lockResult' in options ? options.lockResult : [{ id: '1' }];
      return Promise.resolve({ data });
    }),
    from: jest.fn((table: string) => {
      if (table === 'evolution_variants') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() =>
              Promise.resolve({ data: options?.variants ?? [], error: null }),
            ),
          })),
        };
      }
      if (table === 'evolution_runs') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() =>
                Promise.resolve({ data: options?.runs ?? [], error: null }),
              ),
            })),
          })),
        };
      }
      // evolution_metrics — used for clearing stale flag
      return {
        update: jest.fn((payload: Record<string, unknown>) => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              in: jest.fn(() => {
                updateCalls.push({ filter: {}, payload });
                return Promise.resolve({ error: null });
              }),
            })),
          })),
        })),
      };
    }),
  } as never;

  return { db, updateCalls, rpcCalls };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('recomputeStaleMetrics', () => {
  beforeEach(() => {
    mockWriteMetric.mockReset();
  });

  it('detects stale rows and triggers run elo recomputation', async () => {
    const staleRows = [makeStaleRow('winner_elo'), makeStaleRow('median_elo')];
    const { db, rpcCalls } = makeMockDb({
      variants: [
        { id: 'v1', mu: 30, sigma: 5 },
        { id: 'v2', mu: 20, sigma: 6 },
      ],
    });

    await recomputeStaleMetrics(db, 'run', 'run-1', staleRows);

    // Should have called lock_stale_metrics RPC
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('lock_stale_metrics');
    expect(rpcCalls[0].params).toEqual({
      p_entity_type: 'run',
      p_entity_id: 'run-1',
      p_metric_names: ['winner_elo', 'median_elo'],
    });

    // writeMetric should be called for the 4 elo metrics only
    expect(mockWriteMetric).toHaveBeenCalledTimes(4);
    const writtenNames = mockWriteMetric.mock.calls.map((c: unknown[]) => c[3]);
    expect(writtenNames).toEqual(['winner_elo', 'median_elo', 'p90_elo', 'max_elo']);
  });

  it('recomputeRunEloMetrics reads variant mu/sigma and writes computed values', async () => {
    const staleRows = [makeStaleRow('max_elo')];
    const { db } = makeMockDb({
      variants: [
        { id: 'v1', mu: 25, sigma: 8.33 },
        { id: 'v2', mu: 35, sigma: 5 },
      ],
    });

    await recomputeStaleMetrics(db, 'run', 'run-1', staleRows);

    // All 4 elo metrics are always recomputed together
    expect(mockWriteMetric).toHaveBeenCalledTimes(4);

    // Verify each call passes ('run', 'run-1', metric_name, value, 'at_finalization')
    for (const call of mockWriteMetric.mock.calls) {
      expect(call[0]).toBe(db);
      expect(call[1]).toBe('run');
      expect(call[2]).toBe('run-1');
      expect(typeof call[3]).toBe('string');
      expect(typeof call[4]).toBe('number');
      expect(call[5]).toBe('at_finalization');
    }
  });

  it('clears stale flag after successful recompute', async () => {
    const staleRows = [makeStaleRow('winner_elo')];
    const { db, updateCalls } = makeMockDb({
      variants: [{ id: 'v1', mu: 25, sigma: 8 }],
    });

    await recomputeStaleMetrics(db, 'run', 'run-1', staleRows);

    // The update call should set stale: false
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload).toMatchObject({ stale: false });
  });

  it('handles empty variant array gracefully — no errors', async () => {
    const staleRows = [makeStaleRow('winner_elo')];
    const { db } = makeMockDb({ variants: [] });

    // Should not throw
    await recomputeStaleMetrics(db, 'run', 'run-1', staleRows);

    // No metrics written when variants are empty
    expect(mockWriteMetric).not.toHaveBeenCalled();
  });

  it('returns early when staleRows array is empty', async () => {
    const { db, rpcCalls } = makeMockDb();

    await recomputeStaleMetrics(db, 'run', 'run-1', []);

    // Should not call RPC or any DB operations
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns early when SKIP LOCKED returns empty (no rows locked)', async () => {
    const staleRows = [makeStaleRow('winner_elo')];
    const { db, updateCalls } = makeMockDb({ lockResult: [] });

    await recomputeStaleMetrics(db, 'run', 'run-1', staleRows);

    // Should not recompute or clear stale flags
    expect(mockWriteMetric).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('returns early when SKIP LOCKED returns null', async () => {
    const staleRows = [makeStaleRow('winner_elo')];
    const { db, updateCalls } = makeMockDb({ lockResult: null });

    await recomputeStaleMetrics(db, 'run', 'run-1', staleRows);

    expect(mockWriteMetric).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('strategy entity type queries runs and propagates', async () => {
    const staleRows = [makeStaleRow('total_cost', 'strategy', 'strat-1')];
    const { db } = makeMockDb({ runs: [{ id: 'run-a' }, { id: 'run-b' }] });

    // Should not throw
    await recomputeStaleMetrics(db, 'strategy', 'strat-1', staleRows);
  });

  it('experiment entity type with no completed runs — no errors', async () => {
    const staleRows = [makeStaleRow('total_cost', 'experiment', 'exp-1')];
    const { db } = makeMockDb({ runs: [] });

    await recomputeStaleMetrics(db, 'experiment', 'exp-1', staleRows);

    // No metrics written for empty run list
    expect(mockWriteMetric).not.toHaveBeenCalled();
  });
});
