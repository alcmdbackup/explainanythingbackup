// Unit tests for writeMetrics, writeMetric, and writeMetricMax functions.

import { writeMetrics, writeMetric, writeMetricMax } from './writeMetrics';

function makeMockDb(options?: { upsertError?: string }) {
  const upsertedRows: unknown[] = [];
  return {
    db: {
      from: jest.fn(() => ({
        upsert: jest.fn((rows: unknown[], _opts: unknown) => {
          upsertedRows.push(...(rows as unknown[]));
          if (options?.upsertError) return { error: { message: options.upsertError } };
          return { error: null };
        }),
      })),
    } as never,
    upsertedRows,
  };
}

function makeMockRpcDb(options?: { rpcError?: string }) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    db: {
      rpc: jest.fn(async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (options?.rpcError) return { error: { message: options.rpcError } };
        return { error: null };
      }),
    } as never,
    rpcCalls,
  };
}

describe('writeMetrics', () => {
  it('inserts new rows via upsert', async () => {
    const { db, upsertedRows } = makeMockDb();
    await writeMetrics(db, [{
      entity_type: 'run',
      entity_id: '00000000-0000-0000-0000-000000000001',
      metric_name: 'cost',
      value: 1.5,
    }], 'during_execution');
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0]).toMatchObject({ entity_type: 'run', metric_name: 'cost', value: 1.5 });
  });

  it('batch write with multiple rows', async () => {
    const { db, upsertedRows } = makeMockDb();
    await writeMetrics(db, [
      { entity_type: 'run', entity_id: '00000000-0000-0000-0000-000000000001', metric_name: 'winner_elo', value: 1500 },
      { entity_type: 'run', entity_id: '00000000-0000-0000-0000-000000000001', metric_name: 'median_elo', value: 1400 },
    ], 'at_finalization');
    expect(upsertedRows).toHaveLength(2);
  });

  it('throws on DB error', async () => {
    const { db } = makeMockDb({ upsertError: 'DB down' });
    await expect(writeMetrics(db, [{
      entity_type: 'run',
      entity_id: '00000000-0000-0000-0000-000000000001',
      metric_name: 'cost',
      value: 1.5,
    }], 'during_execution')).rejects.toThrow('Failed to write metrics: DB down');
  });

  it('rejects NaN metric value', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(db, 'run', '00000000-0000-0000-0000-000000000001', 'cost' as any, NaN, 'during_execution'))
      .rejects.toThrow('writeMetric: value must be finite');
  });

  it('rejects Infinity metric value', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(db, 'run', '00000000-0000-0000-0000-000000000001', 'cost' as any, Infinity, 'during_execution'))
      .rejects.toThrow('writeMetric: value must be finite');
  });

  it('handles null uncertainty/ci fields correctly', async () => {
    const { db, upsertedRows } = makeMockDb();
    await writeMetrics(db, [{
      entity_type: 'run',
      entity_id: '00000000-0000-0000-0000-000000000001',
      metric_name: 'cost',
      value: 1.5,
      uncertainty: undefined,
      ci_lower: undefined,
    }], 'during_execution');
    const row = upsertedRows[0] as Record<string, unknown>;
    expect(row.uncertainty).toBeNull();
    expect(row.ci_lower).toBeNull();
  });

  it('no-ops for empty rows', async () => {
    const { db, upsertedRows } = makeMockDb();
    await writeMetrics(db, [], 'during_execution');
    expect(upsertedRows).toHaveLength(0);
  });
});

describe('writeMetric timing validation', () => {
  it('rejects metric written with wrong timing', async () => {
    const { db } = makeMockDb();
    // winner_elo is at_finalization, not during_execution
    await expect(writeMetric(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'winner_elo', 1500, 'during_execution',
    )).rejects.toThrow(/different phase/);
  });

  it('accepts metric written with correct timing', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'cost', 1.5, 'during_execution',
    )).resolves.not.toThrow();
  });

  it('accepts dynamic agentCost:* in during_execution', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'agentCost:generation', 0.5, 'during_execution',
    )).resolves.not.toThrow();
  });

  it('rejects unknown metric name', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'totally_fake' as never, 1, 'during_execution',
    )).rejects.toThrow(/Unknown metric/);
  });

  // Regression test for Finding 11: agent-contributed metrics must pass validation
  it('accepts format_rejection_rate for invocation at_finalization', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(
      db, 'invocation', '00000000-0000-0000-0000-000000000001', 'format_rejection_rate', 0.33, 'at_finalization',
    )).resolves.not.toThrow();
  });

  it('accepts total_comparisons for invocation at_finalization', async () => {
    const { db } = makeMockDb();
    await expect(writeMetric(
      db, 'invocation', '00000000-0000-0000-0000-000000000001', 'total_comparisons', 15, 'at_finalization',
    )).resolves.not.toThrow();
  });
});

describe('writeMetricMax', () => {
  it('routes through db.rpc("upsert_metric_max") with correct args', async () => {
    const { db, rpcCalls } = makeMockRpcDb();
    await writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'cost', 0.05, 'during_execution',
    );
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('upsert_metric_max');
    expect(rpcCalls[0]!.args).toEqual({
      p_entity_type: 'run',
      p_entity_id: '00000000-0000-0000-0000-000000000001',
      p_metric_name: 'cost',
      p_value: 0.05,
      p_source: 'during_execution',
    });
  });

  it('writes generation_cost and ranking_cost (the per-purpose metrics)', async () => {
    const { db, rpcCalls } = makeMockRpcDb();
    await writeMetricMax(db, 'run', '00000000-0000-0000-0000-000000000001', 'generation_cost', 0.04, 'during_execution');
    await writeMetricMax(db, 'run', '00000000-0000-0000-0000-000000000001', 'ranking_cost', 0.02, 'during_execution');
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0]!.args.p_metric_name).toBe('generation_cost');
    expect(rpcCalls[0]!.args.p_value).toBe(0.04);
    expect(rpcCalls[1]!.args.p_metric_name).toBe('ranking_cost');
    expect(rpcCalls[1]!.args.p_value).toBe(0.02);
  });

  it('throws on RPC error', async () => {
    const { db } = makeMockRpcDb({ rpcError: 'connection refused' });
    await expect(writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'cost', 0.05, 'during_execution',
    )).rejects.toThrow('Failed to write max metric \'cost\': connection refused');
  });

  it('rejects NaN value', async () => {
    const { db } = makeMockRpcDb();
    await expect(writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'cost', NaN, 'during_execution',
    )).rejects.toThrow(/value must be finite/);
  });

  it('rejects Infinity value', async () => {
    const { db } = makeMockRpcDb();
    await expect(writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'cost', Infinity, 'during_execution',
    )).rejects.toThrow(/value must be finite/);
  });

  it('rejects metric written with wrong timing (validates same as writeMetric)', async () => {
    const { db } = makeMockRpcDb();
    // winner_elo is at_finalization, not during_execution
    await expect(writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'winner_elo', 1500, 'during_execution',
    )).rejects.toThrow(/different phase/);
  });

  it('rejects unknown metric name', async () => {
    const { db } = makeMockRpcDb();
    await expect(writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'totally_fake' as never, 1, 'during_execution',
    )).rejects.toThrow(/Unknown metric/);
  });

  it('does NOT call rpc when validation fails (atomic: validate first)', async () => {
    const { db, rpcCalls } = makeMockRpcDb();
    await expect(writeMetricMax(
      db, 'run', '00000000-0000-0000-0000-000000000001', 'cost', NaN, 'during_execution',
    )).rejects.toThrow();
    expect(rpcCalls).toHaveLength(0);
  });
});
