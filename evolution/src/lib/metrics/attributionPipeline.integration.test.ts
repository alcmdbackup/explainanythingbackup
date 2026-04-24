// Integration-style test for Phase 5 attribution aggregation (computeEloAttributionMetrics
// invoked via computeRunMetrics). Uses a richer mocked supabase client that distinguishes
// the attribution-specific queries from the base variant/invocation queries.

import { computeRunMetrics } from './experimentMetrics';

interface VariantRow {
  id: string;
  mu: number | null;
  elo_score: number;
  parent_variant_id: string | null;
  agent_invocation_id: string | null;
  persisted: boolean | null;
}
interface InvocationRow {
  id: string;
  agent_name: string;
  cost_usd: number;
  execution_detail: Record<string, unknown> | null;
}

function buildMockSupabase(args: {
  baseVariants: Array<{ elo_score: number }>;
  attrVariants: VariantRow[];
  invocations: InvocationRow[];
  parents: Array<{ id: string; mu: number | null; elo_score: number }>;
  /**
   * When set, collects every upsert() call against evolution_metrics so tests can
   * assert write-path behavior (Blocker 2 fix). Array mutated in place.
   */
  upsertSpy?: Array<Array<Record<string, unknown>>>;
  /** When true, upsert returns an error — exercises the failure path. */
  upsertError?: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function chainable<T>(data: T): any {
    const result = { data, error: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {
      eq: () => obj,
      not: () => obj,
      in: () => obj,
      limit: () => obj,
      order: () => obj,
      single: () => Promise.resolve(result),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (onFulfilled?: any, onRejected?: any) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return obj;
  }

  // Counter per table so we can return different responses for successive selects.
  const variantSelectCounts = { base: 0, attr: 0, parents: 0 };
  return {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'evolution_variants') {
        return {
          select: (columns: string) => {
            // The base query selects just 'elo_score'.
            if (columns.trim() === 'elo_score') {
              variantSelectCounts.base += 1;
              return chainable(args.baseVariants);
            }
            // The attribution query includes 'agent_invocation_id' and 'parent_variant_id'.
            if (columns.includes('agent_invocation_id') && columns.includes('parent_variant_id')) {
              variantSelectCounts.attr += 1;
              return chainable(args.attrVariants);
            }
            // Parent lookup selects 'id, mu, elo_score'.
            if (columns.startsWith('id, mu, elo_score') && !columns.includes('run_id')) {
              variantSelectCounts.parents += 1;
              return chainable(args.parents);
            }
            return chainable([]);
          },
        };
      }
      if (table === 'evolution_agent_invocations') {
        return {
          select: (columns: string) => {
            if (columns.includes('execution_detail')) {
              return chainable(args.invocations);
            }
            // Base cost aggregation expects {agent_name, cost_usd}.
            return chainable(args.invocations.map(i => ({ agent_name: i.agent_name, cost_usd: i.cost_usd })));
          },
        };
      }
      if (table === 'evolution_metrics') {
        return {
          // writeMetric calls .from('evolution_metrics').upsert(rows, opts).
          upsert: (rows: Array<Record<string, unknown>>) => {
            if (args.upsertSpy) args.upsertSpy.push(rows);
            if (args.upsertError) {
              return Promise.resolve({ data: null, error: { message: 'simulated DB error' } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      return { select: () => chainable([]) };
    }),
  };
}

describe('computeRunMetrics attribution aggregation', () => {
  it('emits eloAttrDelta + eloAttrDeltaHist rows for a single (agent, dimension) group', async () => {
    // Three variants produced by the same agent+strategy with varying deltas.
    // Deltas: +50, +20, -10 → mean = 20, buckets: [+40,+Inf)=1, [+10,+20)=1, [-10,0)=1.
    const supabase = buildMockSupabase({
      baseVariants: [{ elo_score: 1250 }, { elo_score: 1220 }, { elo_score: 1190 }],
      attrVariants: [
        { id: 'v1', mu: 1250, elo_score: 1250, parent_variant_id: 'p1', agent_invocation_id: 'inv1', persisted: true },
        { id: 'v2', mu: 1220, elo_score: 1220, parent_variant_id: 'p2', agent_invocation_id: 'inv2', persisted: true },
        { id: 'v3', mu: 1190, elo_score: 1190, parent_variant_id: 'p3', agent_invocation_id: 'inv3', persisted: true },
      ],
      invocations: [
        { id: 'inv1', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'lexical_simplify' } },
        { id: 'inv2', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'lexical_simplify' } },
        { id: 'inv3', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'lexical_simplify' } },
      ],
      parents: [
        { id: 'p1', mu: 1200, elo_score: 1200 },
        { id: 'p2', mu: 1200, elo_score: 1200 },
        { id: 'p3', mu: 1200, elo_score: 1200 },
      ],
    });

    const result = await computeRunMetrics('run-1', supabase as never);
    const key = 'eloAttrDelta:generate_from_previous_article:lexical_simplify';
    expect(result.metrics[key as never]).toBeDefined();
    expect(result.metrics[key as never]!.value).toBe(20);
    expect(result.metrics[key as never]!.n).toBe(3);
    expect(result.metrics[key as never]!.ci).not.toBeNull();

    // Histogram emits 3 bucket rows — one per delta.
    const histKeys = Object.keys(result.metrics).filter(k => k.startsWith('eloAttrDeltaHist:'));
    expect(histKeys.length).toBe(3);
  });

  it('groups by dimension — different strategies produce different metric names', async () => {
    const supabase = buildMockSupabase({
      baseVariants: [{ elo_score: 1250 }, { elo_score: 1210 }],
      attrVariants: [
        { id: 'v1', mu: 1250, elo_score: 1250, parent_variant_id: 'p1', agent_invocation_id: 'inv1', persisted: true },
        { id: 'v2', mu: 1210, elo_score: 1210, parent_variant_id: 'p2', agent_invocation_id: 'inv2', persisted: true },
      ],
      invocations: [
        { id: 'inv1', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'lexical_simplify' } },
        { id: 'inv2', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'structural_transform' } },
      ],
      parents: [
        { id: 'p1', mu: 1200, elo_score: 1200 },
        { id: 'p2', mu: 1200, elo_score: 1200 },
      ],
    });

    const result = await computeRunMetrics('run-1', supabase as never);
    expect(result.metrics['eloAttrDelta:generate_from_previous_article:lexical_simplify' as never]?.value).toBe(50);
    expect(result.metrics['eloAttrDelta:generate_from_previous_article:structural_transform' as never]?.value).toBe(10);
  });

  it('skips invocations whose execution_detail lacks strategy', async () => {
    const supabase = buildMockSupabase({
      baseVariants: [{ elo_score: 1250 }],
      attrVariants: [
        { id: 'v1', mu: 1250, elo_score: 1250, parent_variant_id: 'p1', agent_invocation_id: 'inv1', persisted: true },
      ],
      invocations: [
        { id: 'inv1', agent_name: 'swiss_ranking', cost_usd: 0.01,
          execution_detail: { detailType: 'swiss_ranking' } }, // no strategy field
      ],
      parents: [{ id: 'p1', mu: 1200, elo_score: 1200 }],
    });

    const result = await computeRunMetrics('run-1', supabase as never);
    const attrKeys = Object.keys(result.metrics).filter(k => k.startsWith('eloAttrDelta:'));
    expect(attrKeys).toEqual([]);
  });

  it('emits nothing when there are no variants with agent_invocation_id', async () => {
    const supabase = buildMockSupabase({
      baseVariants: [{ elo_score: 1250 }],
      attrVariants: [],
      invocations: [{ id: 'inv1', agent_name: 'generation', cost_usd: 0.01, execution_detail: null }],
      parents: [],
    });
    const result = await computeRunMetrics('run-1', supabase as never);
    const attrKeys = Object.keys(result.metrics).filter(k => k.startsWith('eloAttrDelta:'));
    expect(attrKeys).toEqual([]);
  });
});

// ─── Blocker 2 write-through tests (track_tactic_effectiveness_evolution_20260422) ──
// When opts.strategyId / opts.experimentId are set, computeRunMetrics must persist
// eloAttrDelta:* / eloAttrDeltaHist:* rows at run/strategy/experiment levels.
describe('computeRunMetrics attribution — write-through (Blocker 2)', () => {
  function makeBasicArgs() {
    return {
      baseVariants: [{ elo_score: 1250 }, { elo_score: 1220 }],
      attrVariants: [
        { id: 'v1', mu: 1250, elo_score: 1250, parent_variant_id: 'p1', agent_invocation_id: 'inv1', persisted: true },
        { id: 'v2', mu: 1220, elo_score: 1220, parent_variant_id: 'p2', agent_invocation_id: 'inv2', persisted: true },
      ],
      invocations: [
        { id: 'inv1', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'lexical_simplify' } },
        { id: 'inv2', agent_name: 'generate_from_previous_article', cost_usd: 0.01,
          execution_detail: { strategy: 'lexical_simplify' } },
      ],
      parents: [
        { id: 'p1', mu: 1200, elo_score: 1200 },
        { id: 'p2', mu: 1200, elo_score: 1200 },
      ],
    };
  }

  it('opts omitted → no writes to evolution_metrics (preserves legacy call pattern)', async () => {
    const upsertSpy: Array<Array<Record<string, unknown>>> = [];
    const supabase = buildMockSupabase({ ...makeBasicArgs(), upsertSpy });
    await computeRunMetrics('run-1', supabase as never);
    expect(upsertSpy).toHaveLength(0);
  });

  it('opts.strategyId + opts.experimentId → writes at run, strategy, and experiment levels', async () => {
    const upsertSpy: Array<Array<Record<string, unknown>>> = [];
    const supabase = buildMockSupabase({ ...makeBasicArgs(), upsertSpy });
    await computeRunMetrics('run-1', supabase as never, {
      strategyId: 'strat-1',
      experimentId: 'exp-1',
    });

    // Each delta row and each histogram bucket row produces 3 upsert calls.
    // 1 delta (single (agent, dim) group) + 2 buckets (deltas +50 and +20 land in distinct 10-ELO buckets).
    // That's (1 + 2) × 3 entity levels = 9 upserts.
    expect(upsertSpy).toHaveLength(9);

    const allRows = upsertSpy.flat();
    const deltaRows = allRows.filter(r => (r.metric_name as string).startsWith('eloAttrDelta:') && !(r.metric_name as string).startsWith('eloAttrDeltaHist:'));
    const histRows = allRows.filter(r => (r.metric_name as string).startsWith('eloAttrDeltaHist:'));
    expect(deltaRows).toHaveLength(3); // 1 group × 3 levels
    expect(histRows).toHaveLength(6);  // 2 buckets × 3 levels

    const entityTypes = new Set(allRows.map(r => r.entity_type));
    expect(entityTypes).toEqual(new Set(['run', 'strategy', 'experiment']));

    // Run-level rows carry entity_id = runId; strategy/experiment rows carry their own IDs.
    const runRows = allRows.filter(r => r.entity_type === 'run');
    const stratRows = allRows.filter(r => r.entity_type === 'strategy');
    const expRows = allRows.filter(r => r.entity_type === 'experiment');
    expect(runRows.every(r => r.entity_id === 'run-1')).toBe(true);
    expect(stratRows.every(r => r.entity_id === 'strat-1')).toBe(true);
    expect(expRows.every(r => r.entity_id === 'exp-1')).toBe(true);
  });

  it('opts.strategyId only → writes at run + strategy, NOT experiment', async () => {
    const upsertSpy: Array<Array<Record<string, unknown>>> = [];
    const supabase = buildMockSupabase({ ...makeBasicArgs(), upsertSpy });
    await computeRunMetrics('run-1', supabase as never, { strategyId: 'strat-1' });

    const allRows = upsertSpy.flat();
    const entityTypes = new Set(allRows.map(r => r.entity_type));
    expect(entityTypes).toEqual(new Set(['run', 'strategy']));
    expect(allRows.find(r => r.entity_type === 'experiment')).toBeUndefined();
  });

  it('delta values + CI match the returned bag', async () => {
    const upsertSpy: Array<Array<Record<string, unknown>>> = [];
    const supabase = buildMockSupabase({ ...makeBasicArgs(), upsertSpy });
    const result = await computeRunMetrics('run-1', supabase as never, {
      strategyId: 'strat-1',
    });

    const bagKey = 'eloAttrDelta:generate_from_previous_article:lexical_simplify';
    const bagEntry = result.metrics[bagKey as never]!;
    const writtenRunRow = upsertSpy.flat().find(r => r.entity_type === 'run' && r.metric_name === bagKey)!;
    expect(writtenRunRow.value).toBe(bagEntry.value);
    expect(writtenRunRow.ci_lower).toBe(bagEntry.ci?.[0] ?? null);
    expect(writtenRunRow.ci_upper).toBe(bagEntry.ci?.[1] ?? null);
    expect(writtenRunRow.n).toBe(bagEntry.n);
  });

  it('upsert error propagates — caller (persistRunResults) wraps in try/catch', async () => {
    const supabase = buildMockSupabase({ ...makeBasicArgs(), upsertError: true });
    await expect(
      computeRunMetrics('run-1', supabase as never, { strategyId: 'strat-1' }),
    ).rejects.toThrow(/simulated DB error/);
  });
});
