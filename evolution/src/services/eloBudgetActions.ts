'use server';
// Server actions for evolution strategy run history and peak stats.
// Provides strategy-level run data for detail pages and list views.

import { adminAction, type AdminContext } from './adminAction';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Private helpers ──────────────────────────────────────────────

/** Fetch p90/max Elo stats for completed runs via the compute_run_variant_stats RPC. */
async function fetchRunVariantStats(
  supabase: SupabaseClient,
  completedRunIds: string[],
): Promise<Map<string, { p90Elo: number | null; maxElo: number | null }>> {
  const statsMap = new Map<string, { p90Elo: number | null; maxElo: number | null }>();
  await Promise.all(completedRunIds.map(async (runId) => {
    try {
      const { data: statsData } = await supabase.rpc('compute_run_variant_stats', { p_run_id: runId });
      const row = Array.isArray(statsData) ? statsData[0] : statsData;
      if (row) {
        statsMap.set(runId, {
          p90Elo: row.p90_elo ?? null,
          maxElo: row.max_elo ?? null,
        });
      }
    } catch {
      // Graceful degradation: if RPC fails, leave as null
    }
  }));
  return statsMap;
}

function computeDurationSecs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  return Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
}

// ─── Types ────────────────────────────────────────────────────────

export interface StrategyRunEntry {
  runId: string;
  explanationId: number;
  explanationTitle: string;
  status: string;
  finalElo: number | null;
  p90Elo: number | null;
  maxElo: number | null;
  totalCostUsd: number;
  iterations: number;
  duration: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface StrategyPeakStats {
  strategyId: string;
  bestP90Elo: number | null;
  bestMaxElo: number | null;
}

// ─── Actions ──────────────────────────────────────────────────────

/**
 * Get run history for a specific strategy.
 */
export const getStrategyRunsAction = adminAction(
  'getStrategyRuns',
  async (input: { strategyId: string; limit?: number }, ctx: AdminContext) => {
    const { strategyId, limit = 20 } = input;
    const { supabase } = ctx;

    const { data: strategy, error: stratError } = await supabase
      .from('evolution_strategy_configs')
      .select('config_hash, config')
      .eq('id', strategyId)
      .single();

    if (stratError || !strategy) {
      throw new Error(stratError?.message ?? 'Strategy not found');
    }

    const { data: runs, error: runError } = await supabase
      .from('evolution_runs')
      .select(`
        id,
        explanation_id,
        status,
        total_cost_usd,
        current_iteration,
        started_at,
        completed_at,
        config,
        run_summary
      `)
      .eq('strategy_config_id', strategyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (runError) {
      throw new Error(runError.message);
    }

    if (!runs || runs.length === 0) {
      return [] as StrategyRunEntry[];
    }

    const explanationIds = [...new Set(runs.map(r => r.explanation_id))];
    const { data: explanations } = await supabase
      .from('explanations')
      .select('id, title')
      .in('id', explanationIds);

    const titleMap = new Map(explanations?.map(e => [e.id, e.title]) ?? []);

    const completedRunIds = runs.filter(r => r.status === 'completed').map(r => r.id);
    const statsMap = await fetchRunVariantStats(supabase, completedRunIds);

    const entries: StrategyRunEntry[] = runs.map(run => {
      const summary = run.run_summary as { finalTopElo?: number } | null;
      const stats = statsMap.get(run.id);
      return {
        runId: run.id,
        explanationId: run.explanation_id,
        explanationTitle: titleMap.get(run.explanation_id) ?? `Explanation #${run.explanation_id}`,
        status: run.status,
        finalElo: summary?.finalTopElo ?? null,
        p90Elo: stats?.p90Elo ?? null,
        maxElo: stats?.maxElo ?? null,
        totalCostUsd: run.total_cost_usd ?? 0,
        iterations: run.current_iteration ?? 0,
        duration: computeDurationSecs(run.started_at, run.completed_at),
        startedAt: run.started_at ? new Date(run.started_at) : null,
        completedAt: run.completed_at ? new Date(run.completed_at) : null,
      };
    });

    return entries;
  },
);

/**
 * Batch-fetch peak p90/max Elo across completed runs for multiple strategies.
 * Returns the best p90 and best max variant Elo seen across all runs of each strategy.
 */
export const getStrategiesPeakStatsAction = adminAction(
  'getStrategiesPeakStats',
  async (strategyIds: string[], ctx: AdminContext) => {
    if (strategyIds.length === 0) return [] as StrategyPeakStats[];

    const { supabase } = ctx;

    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, strategy_config_id')
      .in('strategy_config_id', strategyIds)
      .eq('status', 'completed');

    if (error) throw new Error(error.message);
    if (!runs || runs.length === 0) {
      return strategyIds.map(id => ({ strategyId: id, bestP90Elo: null, bestMaxElo: null })) as StrategyPeakStats[];
    }

    const completedRunIds = runs.map(r => r.id);
    const statsMap = await fetchRunVariantStats(supabase, completedRunIds);

    const strategyBest = new Map<string, { bestP90: number | null; bestMax: number | null }>();
    for (const run of runs) {
      const sid = run.strategy_config_id as string;
      const stats = statsMap.get(run.id);
      if (!stats) continue;

      const cur = strategyBest.get(sid) ?? { bestP90: null, bestMax: null };
      if (stats.p90Elo != null && (cur.bestP90 == null || stats.p90Elo > cur.bestP90)) {
        cur.bestP90 = stats.p90Elo;
      }
      if (stats.maxElo != null && (cur.bestMax == null || stats.maxElo > cur.bestMax)) {
        cur.bestMax = stats.maxElo;
      }
      strategyBest.set(sid, cur);
    }

    const result: StrategyPeakStats[] = strategyIds.map(id => {
      const best = strategyBest.get(id);
      return { strategyId: id, bestP90Elo: best?.bestP90 ?? null, bestMaxElo: best?.bestMax ?? null };
    });

    return result;
  },
);
