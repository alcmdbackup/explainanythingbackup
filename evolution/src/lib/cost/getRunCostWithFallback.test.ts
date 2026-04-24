// Unit tests for the cost-source-with-fallback helper.
// B1 + B2 (use_playwright_find_bugs_ux_issues_20260422): the helper centralizes
// a four-layer fallback chain and chunks .in() clauses to dodge PostgREST
// URL-length limits.

import { getRunCostsWithFallback } from './getRunCostWithFallback';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/server_utilities', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

/** Build a chainable mock that returns the configured response for a given
 *  combination of (table, metric_name). */
function makeDb(responses: Record<string, Record<string, unknown[]>>): SupabaseClient {
  const fromCalls: Array<{ table: string; metricName?: string; runIds: string[] }> = [];
  function makeChain(table: string): unknown {
    let metricName: string | undefined;
    const runIds: string[] = [];
    const chain: Record<string, unknown> = {};
    chain.select = (): unknown => chain;
    chain.eq = (col: string, val: string): unknown => {
      if (col === 'metric_name') metricName = val;
      return chain;
    };
    chain.in = async (col: string, ids: string[]): Promise<{ data: unknown[]; error: null }> => {
      runIds.push(...ids);
      fromCalls.push({ table, metricName, runIds: [...ids] });
      const tableResponses = responses[table] ?? {};
      const key = metricName ?? '__no_metric__';
      const rows = (tableResponses[key] ?? []).filter((r: unknown) => {
        const id = (r as { entity_id?: string; run_id?: string }).entity_id
          ?? (r as { entity_id?: string; run_id?: string }).run_id;
        return id != null && ids.includes(id);
      });
      return { data: rows, error: null };
    };
    return chain;
  }
  return { from: (table: string) => makeChain(table) } as unknown as SupabaseClient;
}

describe('getRunCostsWithFallback', () => {
  it('returns empty map when given no runIds', async () => {
    const db = makeDb({});
    const out = await getRunCostsWithFallback([], db);
    expect(out.size).toBe(0);
  });

  it('uses layer 1 (cost metric) when present', async () => {
    const db = makeDb({
      evolution_metrics: {
        cost: [{ entity_id: 'r1', value: 0.05 }, { entity_id: 'r2', value: 0.10 }],
      },
    });
    const out = await getRunCostsWithFallback(['r1', 'r2'], db);
    expect(out.get('r1')).toBe(0.05);
    expect(out.get('r2')).toBe(0.10);
  });

  it('falls through to layer 2 (gen+rank+seed) when cost is missing', async () => {
    const db = makeDb({
      evolution_metrics: {
        cost: [], // r1 missing the rollup
        generation_cost: [{ entity_id: 'r1', value: 0.04 }],
        ranking_cost: [{ entity_id: 'r1', value: 0.05 }],
        seed_cost: [{ entity_id: 'r1', value: 0.0 }],
      },
    });
    const out = await getRunCostsWithFallback(['r1'], db);
    expect(out.get('r1')).toBeCloseTo(0.09);
  });

  it('falls through to layer 3 (evolution_run_costs view) when layers 1+2 empty', async () => {
    const db = makeDb({
      evolution_metrics: { cost: [], generation_cost: [], ranking_cost: [], seed_cost: [] },
      evolution_run_costs: {
        __no_metric__: [{ run_id: 'r1', total_cost_usd: 0.12 }],
      },
    });
    const out = await getRunCostsWithFallback(['r1'], db);
    expect(out.get('r1')).toBeCloseTo(0.12);
  });

  it('returns 0 (with warn) for runs missing at every layer', async () => {
    const db = makeDb({
      evolution_metrics: { cost: [], generation_cost: [], ranking_cost: [], seed_cost: [] },
      evolution_run_costs: { __no_metric__: [] },
    });
    const out = await getRunCostsWithFallback(['ghost'], db);
    expect(out.get('ghost')).toBe(0);
  });

  it('chunks large runIds lists into 100-id batches (no single .in() call > 100 IDs)', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `r${i}`);
    let maxBatchSize = 0;
    const db = {
      from: () => {
        let metricName: string | undefined;
        const chain: Record<string, unknown> = {};
        chain.select = (): unknown => chain;
        chain.eq = (col: string, val: string): unknown => {
          if (col === 'metric_name') metricName = val;
          return chain;
        };
        chain.in = async (_col: string, batch: string[]): Promise<{ data: unknown[]; error: null }> => {
          if (metricName === 'cost') maxBatchSize = Math.max(maxBatchSize, batch.length);
          return { data: [], error: null };
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    await getRunCostsWithFallback(ids, db);
    expect(maxBatchSize).toBeLessThanOrEqual(100);
  });
});
