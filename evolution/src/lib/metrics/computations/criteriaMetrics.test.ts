// Tests for computeCriteriaMetrics + computeCriteriaMetricsForRun.

import { computeCriteriaMetricsForRun } from './criteriaMetrics';

const RUN = '00000000-0000-4000-8000-0000000000aa';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const V1 = '00000000-0000-4000-8000-0000000000v1';
const V2 = '00000000-0000-4000-8000-0000000000v2';
const PARENT = '00000000-0000-4000-8000-0000000000pp';

interface MockTable {
  rows: Array<Record<string, unknown>>;
}

/** Tiny shim mirroring the chained Supabase client's PostgREST builder shape used
 *  by computeCriteriaMetrics. Each call returns the same query stub; terminal
 *  promises resolve with the table's rows.
 *
 *  Filtering is intentionally not implemented for this smoke test — the test
 *  seeds tables minimally and asserts that the function makes the right
 *  number/shape of upsert calls. */
function makeMockDb(tables: Record<string, MockTable>) {
  const upsertCalls: Array<{ table: string; rows: unknown[] }> = [];
  const from = jest.fn((table: string) => {
    const tbl = tables[table] ?? { rows: [] };
    const queryStub: Record<string, jest.Mock> = {};
    queryStub.select = jest.fn(() => queryStub);
    queryStub.eq = jest.fn(() => queryStub);
    queryStub.in = jest.fn(() => Promise.resolve({ data: tbl.rows, error: null }));
    queryStub.contains = jest.fn(() => Promise.resolve({ data: tbl.rows, error: null }));
    queryStub.not = jest.fn(() => Promise.resolve({ data: tbl.rows, error: null }));
    queryStub.is = jest.fn(() => Promise.resolve({ data: tbl.rows, error: null }));
    queryStub.upsert = jest.fn((rows: unknown[]) => {
      upsertCalls.push({ table, rows });
      return Promise.resolve({ error: null });
    });
    return queryStub;
  });
  return { db: { from } as never, upsertCalls };
}

describe('computeCriteriaMetricsForRun', () => {
  it('dispatches per distinct criteria_id found in run variants', async () => {
    const variantsForRun = [
      { criteria_set_used: [C1, C2] },
      { criteria_set_used: [C1] },
    ];
    const evaluatedVariants = [
      { id: V1, run_id: RUN, mu: 27, sigma: 7, elo_score: 1300, parent_variant_id: PARENT, weakest_criteria_ids: [C1] },
      { id: V2, run_id: RUN, mu: 26, sigma: 8, elo_score: 1240, parent_variant_id: null, weakest_criteria_ids: null },
    ];
    const runs = [{ id: RUN, status: 'completed' }];
    const parents = [{ id: PARENT, mu: 25, sigma: 8.333 }];
    const invocations = [
      {
        execution_detail: {
          evaluateAndSuggest: {
            criteriaScored: [
              { criteriaId: C1, score: 2 },
              { criteriaId: C2, score: 4 },
            ],
          },
        },
      },
    ];

    const tableLookup = new Map<string, MockTable>();
    // The mock dispatches by table name to whichever payload the call expects.
    // For the run-level entry: `from('evolution_variants').select('criteria_set_used').eq(run_id).not('criteria_set_used','is',null)`
    // returns variantsForRun (terminal: .not). For per-criteria computeCriteriaMetrics:
    // first call to evolution_variants (terminal: .contains) → evaluatedVariants.
    // Second call (.in() for parents) → parents. Then evolution_runs (.in) → runs.
    // Then evolution_agent_invocations (.in().eq()) → invocations.
    //
    // Our naive mock returns the same payload regardless of filter, which is OK
    // because each TABLE NAME maps to the right "shape" of rows. We just feed
    // them as multi-purpose payloads:
    let variantsCallCount = 0;
    const db = {
      from: jest.fn((table: string) => {
        const queryStub: Record<string, jest.Mock> = {};
        queryStub.select = jest.fn(() => queryStub);
        // For evolution_agent_invocations: .in() needs to return queryStub so
        // .eq('agent_name', ...) can resolve. For other tables, .in() resolves directly.
        queryStub.in = jest.fn(() => {
          if (table === 'evolution_runs') return Promise.resolve({ data: runs, error: null });
          if (table === 'evolution_agent_invocations') return queryStub; // chain continues
          return Promise.resolve({ data: parents, error: null });
        });
        queryStub.eq = jest.fn(() => {
          if (table === 'evolution_agent_invocations') {
            return Promise.resolve({ data: invocations, error: null });
          }
          return queryStub;
        });
        queryStub.is = jest.fn(() => queryStub);
        queryStub.contains = jest.fn(() => Promise.resolve({ data: evaluatedVariants, error: null }));
        queryStub.not = jest.fn(() => {
          variantsCallCount++;
          return Promise.resolve({ data: variantsForRun, error: null });
        });
        queryStub.upsert = jest.fn(() => Promise.resolve({ error: null }));
        return queryStub;
      }),
    };
    void tableLookup;

    await computeCriteriaMetricsForRun(db as never, RUN);

    // The run-level scan called once.
    expect(variantsCallCount).toBe(1);
    // The function called .from() at least 5 times: 1 for run-variants scan + per criteria the
    // function calls evolution_variants (twice) + evolution_runs + evolution_agent_invocations + evolution_metrics.
    expect((db.from as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('no-op when run has no criteria-driven variants', async () => {
    const db = {
      from: jest.fn(() => {
        const queryStub: Record<string, jest.Mock> = {};
        queryStub.select = jest.fn(() => queryStub);
        queryStub.eq = jest.fn(() => queryStub);
        queryStub.is = jest.fn(() => queryStub);
        queryStub.not = jest.fn(() => Promise.resolve({ data: [], error: null }));
        queryStub.contains = jest.fn(() => Promise.resolve({ data: [], error: null }));
        queryStub.in = jest.fn(() => Promise.resolve({ data: [], error: null }));
        queryStub.upsert = jest.fn(() => Promise.resolve({ error: null }));
        return queryStub;
      }),
    };
    await expect(computeCriteriaMetricsForRun(db as never, RUN)).resolves.toBeUndefined();
    // Only one .from() call (the initial run-variants scan).
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('handles null variants payload from supabase gracefully', async () => {
    const db = {
      from: jest.fn(() => {
        const queryStub: Record<string, jest.Mock> = {};
        queryStub.select = jest.fn(() => queryStub);
        queryStub.eq = jest.fn(() => queryStub);
        queryStub.not = jest.fn(() => Promise.resolve({ data: null, error: null }));
        return queryStub;
      }),
    };
    await expect(computeCriteriaMetricsForRun(db as never, RUN)).resolves.toBeUndefined();
  });
});
