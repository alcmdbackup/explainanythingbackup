// Tests for V2 experiment core functions.

import { createExperiment, addRunToExperiment, computeExperimentMetrics } from './experiments';

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
                data: { id: options?.insertId ?? 'new-id' },
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
                  return { data: options?.experiment ?? { id: 'exp-1', status: 'draft', prompt_id: 'p-1' }, error: null };
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
    const result = await createExperiment('Test Exp', 'p-1', db);
    expect(result.id).toBe('new-id');
    expect(inserts[0]).toMatchObject({ name: 'Test Exp', prompt_id: 'p-1' });
    expect(inserts[0]).not.toHaveProperty('status');
  });

  it('rejects empty name', async () => {
    const { db } = makeMockDb();
    await expect(createExperiment('', 'p-1', db)).rejects.toThrow('1-200 characters');
  });

  it('rejects overlength name', async () => {
    const { db } = makeMockDb();
    await expect(createExperiment('x'.repeat(201), 'p-1', db)).rejects.toThrow('1-200 characters');
  });
});

describe('addRunToExperiment', () => {
  it('creates run with FK and transitions draft→running', async () => {
    const { db, inserts, updates } = makeMockDb({ experiment: { id: 'exp-1', status: 'draft', prompt_id: 'p-1' } });
    const result = await addRunToExperiment('exp-1', { strategy_config_id: 'strat-1', budget_cap_usd: 0.5 }, db);
    expect(result.runId).toBe('new-id');
    expect(inserts[0]).toMatchObject({ experiment_id: 'exp-1', prompt_id: 'p-1' });
    // Should transition to running
    expect(updates.some((u) => u.data.status === 'running')).toBe(true);
  });

  it('rejects if experiment completed', async () => {
    const { db } = makeMockDb({ experiment: { id: 'exp-1', status: 'completed', prompt_id: 'p-1' } });
    await expect(addRunToExperiment('exp-1', { strategy_config_id: 's', budget_cap_usd: 1 }, db)).rejects.toThrow('completed');
  });

  it('rejects if experiment cancelled', async () => {
    const { db } = makeMockDb({ experiment: { id: 'exp-1', status: 'cancelled', prompt_id: 'p-1' } });
    await expect(addRunToExperiment('exp-1', { strategy_config_id: 's', budget_cap_usd: 1 }, db)).rejects.toThrow('cancelled');
  });
});

describe('computeExperimentMetrics', () => {
  it('returns correct metrics from completed runs', async () => {
    const runs = [
      { id: 'r1', run_summary: { totalCost: 0.1 }, evolution_variants: [{ elo_score: 1400 }] },
      { id: 'r2', run_summary: { totalCost: 0.2 }, evolution_variants: [{ elo_score: 1600 }] },
    ];
    const { db } = makeMockDb({ runRows: runs });
    const metrics = await computeExperimentMetrics('exp-1', db);
    expect(metrics.maxElo).toBe(1600);
    expect(metrics.totalCost).toBeCloseTo(0.3);
    expect(metrics.runs).toHaveLength(2);
  });

  it('handles zero runs', async () => {
    const { db } = makeMockDb({ runRows: [] });
    const metrics = await computeExperimentMetrics('exp-1', db);
    expect(metrics.maxElo).toBeNull();
    expect(metrics.totalCost).toBe(0);
    expect(metrics.runs).toHaveLength(0);
  });

  it('handles null run_summary', async () => {
    const runs = [
      { id: 'r1', run_summary: null, evolution_variants: [{ elo_score: 1300 }] },
    ];
    const { db } = makeMockDb({ runRows: runs });
    const metrics = await computeExperimentMetrics('exp-1', db);
    expect(metrics.runs[0].cost).toBe(0);
    expect(metrics.runs[0].eloPerDollar).toBeNull();
  });
});
