// Unit tests for the cost-backfill helpers (extracted so they can be tested
// without triggering the script's top-level dotenv + env-var validation).

import { findRunsMissingCostMetric, computeCostsForRuns } from './backfillRunCostMetricHelpers';
import type { SupabaseClient } from '@supabase/supabase-js';

interface FakeRow { id?: string; status?: string; entity_id?: string; entity_type?: string; metric_name?: string; run_id?: string; total_cost_usd?: number }
type Tables = Record<string, FakeRow[]>;

/** Build a chainable Supabase mock that returns rows from the configured
 *  table. Each chain remembers eq() filters and applies them in-memory. */
function makeDb(tables: Tables): SupabaseClient {
  function makeChain(table: string): unknown {
    const filters: Record<string, string> = {};
    let inFilter: { col: string; vals: string[] } | null = null;
    let rangeFilter: { from: number; to: number } | null = null;
    let single = false;
    let limit: number | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = (): unknown => chain;
    chain.eq = (col: string, val: string): unknown => { filters[col] = val; return chain; };
    chain.in = (col: string, vals: string[]): unknown => { inFilter = { col, vals }; return chain; };
    chain.range = (from: number, to: number): unknown => { rangeFilter = { from, to }; return chain; };
    chain.limit = (n: number): unknown => { limit = n; return chain; };
    chain.single = async (): Promise<{ data: FakeRow | null; error: null }> => {
      single = true;
      const matches = (tables[table] ?? []).filter(r => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      return { data: matches[0] ?? null, error: null };
    };
    chain.then = async (resolve: (x: { data: FakeRow[]; error: null }) => void): Promise<void> => {
      let rows = tables[table] ?? [];
      rows = rows.filter(r => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      if (inFilter) {
        const f = inFilter;
        rows = rows.filter(r => f.vals.includes(((r as Record<string, unknown>)[f.col] as string)));
      }
      if (rangeFilter) {
        rows = rows.slice(rangeFilter.from, rangeFilter.to + 1);
      }
      if (limit != null) rows = rows.slice(0, limit);
      void single;
      resolve({ data: rows, error: null });
    };
    return chain;
  }
  return { from: (table: string) => makeChain(table) } as unknown as SupabaseClient;
}

describe('findRunsMissingCostMetric', () => {
  it('returns the singleRunId when it is completed AND has no cost metric', async () => {
    const db = makeDb({
      evolution_runs: [{ id: 'r1', status: 'completed' }],
      evolution_metrics: [],
    });
    expect(await findRunsMissingCostMetric(db, 'r1')).toEqual(['r1']);
  });

  it('returns [] when singleRunId is completed BUT already has a cost metric', async () => {
    const db = makeDb({
      evolution_runs: [{ id: 'r1', status: 'completed' }],
      // The helper filters by entity_type='run' AND metric_name='cost'
      evolution_metrics: [{ entity_id: 'r1', entity_type: 'run', metric_name: 'cost' } as FakeRow],
    });
    expect(await findRunsMissingCostMetric(db, 'r1')).toEqual([]);
  });

  it('returns [] when singleRunId is not completed (e.g. running)', async () => {
    const db = makeDb({
      evolution_runs: [{ id: 'r1', status: 'running' }],
      evolution_metrics: [],
    });
    expect(await findRunsMissingCostMetric(db, 'r1')).toEqual([]);
  });

  it('bulk: returns completed runs minus those with a cost metric row', async () => {
    const db = makeDb({
      evolution_runs: [
        { id: 'r1', status: 'completed' },
        { id: 'r2', status: 'completed' },
        { id: 'r3', status: 'completed' },
        { id: 'r4', status: 'running' },
      ],
      evolution_metrics: [{ entity_id: 'r2', entity_type: 'run', metric_name: 'cost' } as FakeRow],
    });
    const out = await findRunsMissingCostMetric(db);
    expect(out.sort()).toEqual(['r1', 'r3']);
  });
});

describe('computeCostsForRuns', () => {
  it('returns runId+cost pairs from the evolution_run_costs view', async () => {
    const db = makeDb({
      evolution_run_costs: [
        { run_id: 'r1', total_cost_usd: 0.05 },
        { run_id: 'r2', total_cost_usd: 0.12 },
      ],
    });
    const out = await computeCostsForRuns(db, ['r1', 'r2']);
    expect(out).toEqual([
      { runId: 'r1', cost: 0.05 },
      { runId: 'r2', cost: 0.12 },
    ]);
  });

  it('drops rows with zero or non-finite cost (cannot backfill a 0 — original may be missing)', async () => {
    const db = makeDb({
      evolution_run_costs: [
        { run_id: 'r1', total_cost_usd: 0 },
        { run_id: 'r2', total_cost_usd: 0.07 },
      ],
    });
    const out = await computeCostsForRuns(db, ['r1', 'r2']);
    expect(out).toEqual([{ runId: 'r2', cost: 0.07 }]);
  });

  it('returns [] when no runIds match', async () => {
    const db = makeDb({ evolution_run_costs: [] });
    const out = await computeCostsForRuns(db, ['ghost']);
    expect(out).toEqual([]);
  });
});
