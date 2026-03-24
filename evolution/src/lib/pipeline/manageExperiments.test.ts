// Tests for V2 experiment core functions.

import { createExperiment, addRunToExperiment, computeExperimentMetrics } from './manageExperiments';

function makeMockDb(options?: {
  experiment?: Record<string, unknown> | null;
  experimentError?: string;
  insertId?: string;
  runRows?: Array<Record<string, unknown>>;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: string; data: Record<string, unknown> }> = [];

  return {
    db: {
      from: jest.fn((table: string) => ({
        insert: jest.fn((data: Record<string, unknown>) => {
          inserts.push(data);
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: { id: options?.insertId ?? '00000000-0000-4000-8000-000000000099' },
                error: null,
              })),
            })),
          };
        }),
        select: jest.fn(() => ({
          eq: jest.fn(function eqChain() {
            return {
              single: jest.fn(async () => {
                if (options?.experimentError) return { data: null, error: { message: options.experimentError } };
                if (table === 'evolution_experiments') {
                  return { data: options?.experiment ?? { id: '00000000-0000-4000-8000-000000000011', status: 'draft', prompt_id: '00000000-0000-4000-8000-000000000010' }, error: null };
                }
                return { data: null, error: null };
              }),
              eq: jest.fn(() => ({
                eq: jest.fn(async () => ({
                  data: options?.runRows ?? [],
                  error: null,
                })),
              })),
            };
          }),
        })),
        update: jest.fn((data: Record<string, unknown>) => {
          updates.push({ table, data });
          return {
            eq: jest.fn(() => ({
              eq: jest.fn(async () => ({ error: null })),
            })),
          };
        }),
      })),
    } as never,
    inserts,
    updates,
  };
}

describe('createExperiment', () => {
  it('inserts row with correct fields', async () => {
    const { db, inserts } = makeMockDb();
    const result = await createExperiment('Test Exp', '00000000-0000-4000-8000-000000000010', db);
    expect(result.id).toBe('00000000-0000-4000-8000-000000000099');
    expect(inserts[0]).toMatchObject({ name: 'Test Exp', prompt_id: '00000000-0000-4000-8000-000000000010' });
    expect(inserts[0]).toMatchObject({ status: 'draft' });
  });

  it('rejects empty name', async () => {
    const { db } = makeMockDb();
    await expect(createExperiment('', '00000000-0000-4000-8000-000000000010', db)).rejects.toThrow('1-200 characters');
  });

  it('rejects overlength name', async () => {
    const { db } = makeMockDb();
    await expect(createExperiment('x'.repeat(201), '00000000-0000-4000-8000-000000000010', db)).rejects.toThrow('1-200 characters');
  });
});

describe('addRunToExperiment', () => {
  it('creates run with FK and transitions draft→running', async () => {
    const { db, inserts, updates } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'draft', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    const result = await addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000012', budget_cap_usd: 0.5 }, db);
    expect(result.runId).toBe('00000000-0000-4000-8000-000000000099');
    expect(inserts[0]).toMatchObject({ experiment_id: '00000000-0000-4000-8000-000000000011', prompt_id: '00000000-0000-4000-8000-000000000010' });
    // Should transition to running
    expect(updates.some((u) => u.data.status === 'running')).toBe(true);
  });

  it('rejects if experiment completed', async () => {
    const { db } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'completed', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    await expect(addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000013', budget_cap_usd: 1 }, db)).rejects.toThrow('completed');
  });

  it('rejects if experiment cancelled', async () => {
    const { db } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'cancelled', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    await expect(addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000013', budget_cap_usd: 1 }, db)).rejects.toThrow('cancelled');
  });

  it('completed experiment error message includes status', async () => {
    const { db } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'completed', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    await expect(
      addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000013', budget_cap_usd: 1 }, db),
    ).rejects.toThrow('Cannot add runs to completed experiment');
  });

  it('cancelled experiment error message includes status', async () => {
    const { db } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'cancelled', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    await expect(
      addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000013', budget_cap_usd: 1 }, db),
    ).rejects.toThrow('Cannot add runs to cancelled experiment');
  });

  it('transitions draft to running and sets updated_at on first run', async () => {
    const { db, updates } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'draft', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    await addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000012', budget_cap_usd: 0.5 }, db);

    const statusUpdate = updates.find((u) => u.data.status === 'running');
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate!.table).toBe('evolution_experiments');
    expect(statusUpdate!.data.updated_at).toBeDefined();
    expect(typeof statusUpdate!.data.updated_at).toBe('string');
  });

  it('does not transition already-running experiment', async () => {
    const { db, updates } = makeMockDb({ experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'running', prompt_id: '00000000-0000-4000-8000-000000000010' } });
    await addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000012', budget_cap_usd: 0.5 }, db);

    // No status update should occur for an already-running experiment
    const statusUpdate = updates.find((u) => u.data.status === 'running');
    expect(statusUpdate).toBeUndefined();
  });
});

describe('computeExperimentMetrics', () => {
  it('returns correct metrics from completed runs', async () => {
    const runs = [
      { id: 'r1', run_summary: { totalCost: 0.1 }, evolution_variants: [{ elo_score: 1400 }] },
      { id: 'r2', run_summary: { totalCost: 0.2 }, evolution_variants: [{ elo_score: 1600 }] },
    ];
    const { db } = makeMockDb({ runRows: runs });
    const metrics = await computeExperimentMetrics('00000000-0000-4000-8000-000000000011', db);
    expect(metrics.maxElo).toBe(1600);
    expect(metrics.totalCost).toBeCloseTo(0.3);
    expect(metrics.runs).toHaveLength(2);
  });

  it('handles zero runs', async () => {
    const { db } = makeMockDb({ runRows: [] });
    const metrics = await computeExperimentMetrics('00000000-0000-4000-8000-000000000011', db);
    expect(metrics.maxElo).toBeNull();
    expect(metrics.totalCost).toBe(0);
    expect(metrics.runs).toHaveLength(0);
  });

  it('handles null run_summary', async () => {
    const runs = [
      { id: 'r1', run_summary: null, evolution_variants: [{ elo_score: 1300 }] },
    ];
    const { db } = makeMockDb({ runRows: runs });
    const metrics = await computeExperimentMetrics('00000000-0000-4000-8000-000000000011', db);
    expect(metrics.runs[0].cost).toBe(0);
    expect(metrics.runs[0].eloPerDollar).toBeNull();
  });
});

// ─── Entity logging tests ───────────────────────────────────────

describe('createExperiment logging', () => {
  it('inserts into evolution_logs after successful creation', async () => {
    const insertedTables: string[] = [];
    const { db } = makeMockDb();
    const origFrom = (db as Record<string, unknown>).from as jest.Mock;
    (db as Record<string, unknown>).from = jest.fn((table: string) => {
      insertedTables.push(table);
      return origFrom(table);
    });

    await createExperiment('Logged Exp', '00000000-0000-4000-8000-000000000010', db);

    // createEntityLogger writes to evolution_logs
    expect(insertedTables).toContain('evolution_logs');
  });
});

describe('addRunToExperiment logging', () => {
  it('logs draft→running transition via evolution_logs insert', async () => {
    const insertedTables: string[] = [];
    const { db } = makeMockDb({
      experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'draft', prompt_id: '00000000-0000-4000-8000-000000000010' },
    });
    const origFrom = (db as Record<string, unknown>).from as jest.Mock;
    (db as Record<string, unknown>).from = jest.fn((table: string) => {
      insertedTables.push(table);
      return origFrom(table);
    });

    await addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000012', budget_cap_usd: 0.5 }, db);

    // Should have logged to evolution_logs for the draft→running transition
    expect(insertedTables).toContain('evolution_logs');
  });

  it('does not log transition when experiment already running', async () => {
    const insertedTables: string[] = [];
    const { db } = makeMockDb({
      experiment: { id: '00000000-0000-4000-8000-000000000011', status: 'running', prompt_id: '00000000-0000-4000-8000-000000000010' },
    });
    const origFrom = (db as Record<string, unknown>).from as jest.Mock;
    (db as Record<string, unknown>).from = jest.fn((table: string) => {
      insertedTables.push(table);
      return origFrom(table);
    });

    await addRunToExperiment('00000000-0000-4000-8000-000000000011', { strategy_id: '00000000-0000-4000-8000-000000000012', budget_cap_usd: 0.5 }, db);

    // evolution_logs should NOT appear because no draft→running transition occurs
    expect(insertedTables).not.toContain('evolution_logs');
  });
});
