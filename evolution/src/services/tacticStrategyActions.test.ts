// Tests for getStrategyTacticBreakdownAction — Phase 4 of
// track_tactic_effectiveness_evolution_20260422.
//
// Exercises the dual-query merge: pre-aggregated eloAttrDelta:* rows from
// evolution_metrics at entity_type='strategy', plus live variant aggregates grouped
// by agent_name. Tactics in variants but missing from attribution must surface with
// null delta (render "—" in the UI).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

import { getStrategyTacticBreakdownAction } from './tacticStrategyActions';

const STRAT_ID = '00000000-0000-4000-8000-000000000100';

// Build a supabase mock that dispatches based on table name and call sequence.
function makeSupabase(args: {
  metricRows?: Array<{ metric_name: string; value: number; ci_lower: number | null; ci_upper: number | null; n: number }>;
  runRows?: Array<{ id: string }>;
  variantRows?: Array<{ agent_name: string | null; cost_usd: number | null; is_winner: boolean }>;
  tacticRows?: Array<{ id: string; name: string }>;
}) {
  const metricRowsData = args.metricRows ?? [];
  const runRowsData = args.runRows ?? [];
  const variantRowsData = args.variantRows ?? [];
  const tacticRowsData = args.tacticRows ?? [];

  return {
    from: jest.fn((table: string) => {
      if (table === 'evolution_metrics') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                like: jest.fn().mockResolvedValue({ data: metricRowsData, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'evolution_runs') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: runRowsData, error: null }),
            }),
          }),
        };
      }
      if (table === 'evolution_variants') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({ data: variantRowsData, error: null }),
            }),
          }),
        };
      }
      if (table === 'evolution_tactics') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ data: tacticRowsData, error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStrategyTacticBreakdownAction', () => {
  it('rejects invalid strategyId', async () => {
    const result = await getStrategyTacticBreakdownAction({ strategyId: 'not-uuid' });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid strategyId');
  });

  it('returns [] when the strategy has no runs and no metrics', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(
      makeSupabase({ metricRows: [], runRows: [], variantRows: [] }),
    );
    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('merges attribution metrics + variant aggregates keyed by tactic name', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase({
      metricRows: [
        { metric_name: 'eloAttrDelta:generate_from_previous_article:structural_transform', value: 87, ci_lower: 40, ci_upper: 134, n: 12 },
        { metric_name: 'eloAttrDelta:generate_from_previous_article:lexical_simplify', value: -16, ci_lower: -50, ci_upper: 18, n: 8 },
      ],
      runRows: [{ id: 'run-1' }],
      variantRows: [
        { agent_name: 'structural_transform', cost_usd: 0.01, is_winner: true },
        { agent_name: 'structural_transform', cost_usd: 0.02, is_winner: false },
        { agent_name: 'lexical_simplify', cost_usd: 0.015, is_winner: false },
      ],
    }));

    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    expect(result.success).toBe(true);
    const rows = result.data!;
    expect(rows).toHaveLength(2);

    // Sort: highest avgEloDelta first.
    expect(rows[0]!.tacticName).toBe('structural_transform');
    expect(rows[0]!.avgEloDelta).toBe(87);
    expect(rows[0]!.ciLower).toBe(40);
    expect(rows[0]!.ciUpper).toBe(134);
    expect(rows[0]!.variantCount).toBe(2);
    expect(rows[0]!.totalCost).toBeCloseTo(0.03);
    expect(rows[0]!.winnerCount).toBe(1);
    expect(rows[0]!.winRate).toBe(0.5);

    expect(rows[1]!.tacticName).toBe('lexical_simplify');
    expect(rows[1]!.avgEloDelta).toBe(-16);
    expect(rows[1]!.variantCount).toBe(1);
  });

  it('tactics with variants but no attribution row get avgEloDelta: null (pre-Blocker-2 historical)', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase({
      metricRows: [], // no attribution rows yet
      runRows: [{ id: 'run-1' }],
      variantRows: [
        { agent_name: 'zoom_lens', cost_usd: 0.02, is_winner: false },
      ],
    }));

    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const row = result.data![0]!;
    expect(row.tacticName).toBe('zoom_lens');
    expect(row.avgEloDelta).toBeNull();
    expect(row.ciLower).toBeNull();
    expect(row.ciUpper).toBeNull();
    expect(row.variantCount).toBe(1);
  });

  it('sorts null-delta rows last, populated rows desc by delta', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase({
      metricRows: [
        { metric_name: 'eloAttrDelta:generate_from_previous_article:tacticA', value: 30, ci_lower: 10, ci_upper: 50, n: 5 },
        { metric_name: 'eloAttrDelta:generate_from_previous_article:tacticB', value: 80, ci_lower: 50, ci_upper: 110, n: 5 },
      ],
      runRows: [{ id: 'run-1' }],
      variantRows: [
        { agent_name: 'tacticA', cost_usd: 0, is_winner: false },
        { agent_name: 'tacticB', cost_usd: 0, is_winner: true },
        { agent_name: 'tacticC_no_attr', cost_usd: 0, is_winner: false },
      ],
    }));

    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    const order = result.data!.map((r) => r.tacticName);
    expect(order).toEqual(['tacticB', 'tacticA', 'tacticC_no_attr']);
  });

  it('ignores eloAttrDeltaHist:* rows (histogram buckets, not delta values)', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase({
      metricRows: [
        // Real delta row
        { metric_name: 'eloAttrDelta:generate_from_previous_article:tacticA', value: 30, ci_lower: 10, ci_upper: 50, n: 5 },
        // Histogram row (starts with eloAttrDeltaHist:, should be filtered)
        { metric_name: 'eloAttrDeltaHist:generate_from_previous_article:tacticA:0:10', value: 0.5, ci_lower: null, ci_upper: null, n: 5 },
      ],
      runRows: [{ id: 'run-1' }],
      variantRows: [{ agent_name: 'tacticA', cost_usd: 0, is_winner: false }],
    }));

    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    expect(result.data).toHaveLength(1);
    expect(result.data![0]!.avgEloDelta).toBe(30);
  });

  it('resolves tacticId from tacticName via evolution_tactics lookup', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase({
      metricRows: [
        { metric_name: 'eloAttrDelta:generate_from_previous_article:structural_transform', value: 50, ci_lower: null, ci_upper: null, n: 3 },
      ],
      runRows: [{ id: 'run-1' }],
      variantRows: [
        { agent_name: 'structural_transform', cost_usd: 0, is_winner: false },
        { agent_name: 'unregistered_tactic', cost_usd: 0, is_winner: false },
      ],
      tacticRows: [
        { id: '11111111-2222-3333-4444-555555555555', name: 'structural_transform' },
        // unregistered_tactic intentionally missing — tacticId should be null for it.
      ],
    }));

    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    expect(result.success).toBe(true);
    const byName = new Map(result.data!.map((r) => [r.tacticName, r]));
    expect(byName.get('structural_transform')!.tacticId).toBe('11111111-2222-3333-4444-555555555555');
    expect(byName.get('unregistered_tactic')!.tacticId).toBeNull();
  });

  it('skips variant query entirely when strategy has no runs', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase({
      metricRows: [
        { metric_name: 'eloAttrDelta:generate_from_previous_article:tacticA', value: 30, ci_lower: null, ci_upper: null, n: 1 },
      ],
      runRows: [],
      variantRows: [],
    }));

    const result = await getStrategyTacticBreakdownAction({ strategyId: STRAT_ID });
    // Attribution row exists but no runs → rows exist with variantCount=0 (metric survives).
    expect(result.data).toHaveLength(1);
    expect(result.data![0]!.variantCount).toBe(0);
    expect(result.data![0]!.totalCost).toBe(0);
    expect(result.data![0]!.winRate).toBe(0);
  });
});
