// Server actions for tactic × strategy performance analysis (Phase 4 of
// track_tactic_effectiveness_evolution_20260422).
//
// Two-query design (plan option β):
//   1. Pre-aggregated eloAttrDelta:<agent>:<tactic> rows from evolution_metrics at
//      entity_type='strategy'. Yields mean ELO delta + 95% CI + n per tactic.
//      These rows are written by computeEloAttributionMetrics at run finalization
//      (Blocker 2 fix in Phase 0). Eventual-consistency caveat: arena-driven drift
//      flags rows stale but there is no runtime recompute — fresh values land only
//      on the next run in this strategy.
//   2. Deterministic aggregates from evolution_variants grouped by agent_name —
//      variant_count, total_cost, winner_count, win_rate. JS-side reduce because
//      PostgREST doesn't expose `COUNT(*) FILTER`.
//
// Merge keyed by tactic name. Tactics that produced variants but lack an attribution
// row (pre-Blocker-2 historical runs) appear with null delta + CI so the UI can
// render "—" for Elo Delta while still showing the cost/variant/winner counts.

'use server';

import { adminAction, type AdminContext } from './adminAction';
import { validateUuid } from './shared';

export interface TacticStrategyPerformanceRow {
  tacticName: string;
  /** UUID of the evolution_tactics row matching tacticName; null when agent_name
   *  does not correspond to a registered tactic (legacy data / freeform agents). */
  tacticId: string | null;
  variantCount: number;
  /** Mean ELO delta (child − parent) across the strategy's runs. Null when no
   *  attribution row exists (pre-Blocker-2 historical runs or no GFSA invocations). */
  avgEloDelta: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  /** Sample size from the attribution metric row. Null → the count is variantCount
   *  implicitly (no bootstrap CI computed). */
  n: number | null;
  totalCost: number;
  winnerCount: number;
  winRate: number;
}

/**
 * Per-tactic performance breakdown for a given strategy.
 * Reads pre-aggregated attribution metrics + live variant aggregates and merges.
 */
export const getStrategyTacticBreakdownAction = adminAction(
  'getStrategyTacticBreakdown',
  async (input: { strategyId: string }, ctx: AdminContext): Promise<TacticStrategyPerformanceRow[]> => {
    if (!validateUuid(input.strategyId)) throw new Error('Invalid strategyId');

    // Query 1: pre-aggregated eloAttrDelta:* rows at strategy level.
    const { data: metricRows, error: metricError } = await ctx.supabase
      .from('evolution_metrics')
      .select('metric_name, value, ci_lower, ci_upper, n')
      .eq('entity_type', 'strategy')
      .eq('entity_id', input.strategyId)
      .like('metric_name', 'eloAttrDelta:%');

    if (metricError) throw new Error(`Failed to read attribution metrics: ${metricError.message}`);

    // Parse tactic name from `eloAttrDelta:<agent>:<tactic>`. For the current attribution
    // dimension (execution_detail.strategy from generate_from_previous_article), the
    // tactic name is the suffix.
    const attrByTactic = new Map<string, { avgEloDelta: number; ciLower: number | null; ciUpper: number | null; n: number }>();
    for (const row of metricRows ?? []) {
      const name = row.metric_name as string;
      // Skip histogram rows — those are eloAttrDeltaHist:*, not just eloAttrDelta:*
      if (name.startsWith('eloAttrDeltaHist:')) continue;
      const parts = name.split(':');
      if (parts.length < 3) continue;
      // parts[0] = 'eloAttrDelta', parts[1] = agent, parts[2...] = dim (may contain colons?)
      // computeEloAttributionMetrics rejects colon-containing dims, so parts[2] IS the tactic.
      const tactic = parts[2]!;
      attrByTactic.set(tactic, {
        avgEloDelta: row.value as number,
        ciLower: (row.ci_lower as number | null) ?? null,
        ciUpper: (row.ci_upper as number | null) ?? null,
        n: (row.n as number) ?? 0,
      });
    }

    // Query 2: variant aggregates scoped to this strategy's completed runs.
    // Two-step fetch (runs → variants) because evolution_variants doesn't carry strategy_id
    // directly. The run set is typically small (≤ hundreds); the variant set is cap-bounded
    // by individual-run size (≤ DISPATCH_SAFETY_CAP=100 per run + arena entries) — a
    // bulk fetch is cheap and bypasses PostgREST's nested-filter limitations.
    const { data: runs, error: runsError } = await ctx.supabase
      .from('evolution_runs')
      .select('id')
      .eq('strategy_id', input.strategyId)
      .eq('status', 'completed');
    if (runsError) throw new Error(`Failed to query strategy runs: ${runsError.message}`);

    const runIds = (runs ?? []).map((r: { id: string }) => r.id);
    const variantAggByTactic = new Map<string, { variantCount: number; totalCost: number; winnerCount: number }>();

    if (runIds.length > 0) {
      const { data: variants, error: variantError } = await ctx.supabase
        .from('evolution_variants')
        .select('agent_name, cost_usd, is_winner')
        .in('run_id', runIds)
        .not('agent_name', 'is', null);
      if (variantError) throw new Error(`Failed to query variants: ${variantError.message}`);

      for (const row of variants ?? []) {
        const tactic = row.agent_name as string | null;
        if (!tactic) continue;
        const existing = variantAggByTactic.get(tactic) ?? { variantCount: 0, totalCost: 0, winnerCount: 0 };
        existing.variantCount += 1;
        existing.totalCost += (row.cost_usd as number | null) ?? 0;
        if (row.is_winner) existing.winnerCount += 1;
        variantAggByTactic.set(tactic, existing);
      }
    }

    // Merge: union of tactic names from both sources. Tactics with variants but no
    // attribution metric (pre-Blocker-2 historical runs) get avgEloDelta=null and
    // render "—" for the Elo Delta column in the UI.
    const allTactics = new Set<string>([...attrByTactic.keys(), ...variantAggByTactic.keys()]);

    // Batch-resolve tactic_id from tacticName — matches the in-memory lookup pattern
    // in arenaActions.ts (~line 243). Enables direct UUID links in the UI instead of
    // a filtered-list search link.
    const tacticIdByName = new Map<string, string>();
    if (allTactics.size > 0) {
      const { data: tacticRows, error: tacticError } = await ctx.supabase
        .from('evolution_tactics')
        .select('id, name')
        .in('name', [...allTactics]);
      if (tacticError) throw new Error(`Failed to resolve tactic ids: ${tacticError.message}`);
      for (const t of tacticRows ?? []) {
        tacticIdByName.set(t.name as string, t.id as string);
      }
    }

    const rows: TacticStrategyPerformanceRow[] = [];
    for (const tactic of allTactics) {
      const attr = attrByTactic.get(tactic);
      const agg = variantAggByTactic.get(tactic) ?? { variantCount: 0, totalCost: 0, winnerCount: 0 };
      const winRate = agg.variantCount > 0 ? agg.winnerCount / agg.variantCount : 0;
      rows.push({
        tacticName: tactic,
        tacticId: tacticIdByName.get(tactic) ?? null,
        variantCount: agg.variantCount,
        avgEloDelta: attr?.avgEloDelta ?? null,
        ciLower: attr?.ciLower ?? null,
        ciUpper: attr?.ciUpper ?? null,
        n: attr?.n ?? null,
        totalCost: agg.totalCost,
        winnerCount: agg.winnerCount,
        winRate,
      });
    }

    // Sort: populated delta desc first, null delta rows last (matches the "unproven"
    // convention from the tactics leaderboard in Phase 2).
    rows.sort((a, b) => {
      if (a.avgEloDelta == null && b.avgEloDelta == null) return 0;
      if (a.avgEloDelta == null) return 1;
      if (b.avgEloDelta == null) return -1;
      return b.avgEloDelta - a.avgEloDelta;
    });

    return rows;
  },
);
