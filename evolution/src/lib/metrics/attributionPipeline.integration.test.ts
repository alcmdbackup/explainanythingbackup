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
