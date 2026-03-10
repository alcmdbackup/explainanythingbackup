'use server';
// Server actions for cost estimation accuracy analytics. Aggregates estimated vs actual
// cost data from completed evolution runs per strategy.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';

type ActionResult<T> = { success: boolean; data: T | null; error: ErrorResponse | null };

export interface StrategyAccuracyStats {
  strategyId: string;
  strategyName: string;
  runCount: number;
  avgDeltaPercent: number;
  stdDevPercent: number;
}

const _getStrategyAccuracyAction = withLogging(async (): Promise<ActionResult<StrategyAccuracyStats[]>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    // Fetch completed runs that have both estimated and actual cost
    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('strategy_config_id, estimated_cost_usd, total_cost_usd')
      .eq('archived', false)
      .eq('status', 'completed')
      .not('estimated_cost_usd', 'is', null)
      .not('strategy_config_id', 'is', null)
      .gt('estimated_cost_usd', 0);

    if (error) throw new Error(`Failed to fetch runs: ${error.message}`);
    if (!runs || runs.length === 0) return { success: true, data: [], error: null };

    // Group by strategy and compute delta percentages
    const grouped = new Map<string, number[]>();
    for (const run of runs) {
      const stratId = run.strategy_config_id as string;
      const estimated = run.estimated_cost_usd as number;
      const actual = (run.total_cost_usd as number) ?? 0;
      const deltaPct = ((actual - estimated) / estimated) * 100;
      const deltas = grouped.get(stratId) ?? [];
      deltas.push(deltaPct);
      grouped.set(stratId, deltas);
    }

    // Fetch strategy names
    const strategyIds = Array.from(grouped.keys());
    const { data: strategies } = await supabase
      .from('evolution_strategy_configs')
      .select('id, name')
      .in('id', strategyIds);

    const nameMap = new Map((strategies ?? []).map(s => [s.id, s.name as string]));

    // Compute stats per strategy
    const results: StrategyAccuracyStats[] = [];
    for (const [stratId, deltas] of grouped) {
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const variance = deltas.reduce((sum, d) => sum + (d - avg) ** 2, 0) / deltas.length;
      results.push({
        strategyId: stratId,
        strategyName: nameMap.get(stratId) ?? 'Unknown',
        runCount: deltas.length,
        avgDeltaPercent: Math.round(avg * 10) / 10,
        stdDevPercent: Math.round(Math.sqrt(variance) * 10) / 10,
      });
    }

    // Sort by run count descending
    results.sort((a, b) => b.runCount - a.runCount);

    return { success: true, data: results, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getStrategyAccuracyAction') };
  }
}, 'getStrategyAccuracyAction');

export const getStrategyAccuracyAction = serverReadRequestId(_getStrategyAccuracyAction);

// ─── Cost accuracy overview ──────────────────────────────────────

export interface CostAccuracyOverview {
  recentDeltas: Array<{ runId: string; deltaPercent: number; createdAt: string }>;
  perAgentAccuracy: Record<string, { avgEstimated: number; avgActual: number; avgDeltaPercent: number }>;
  confidenceCalibration: Record<'high' | 'medium' | 'low', { count: number; avgAbsDeltaPercent: number }>;
  outliers: Array<{ runId: string; deltaPercent: number; estimatedUsd: number; actualUsd: number }>;
}

const EMPTY_OVERVIEW: CostAccuracyOverview = {
  recentDeltas: [],
  perAgentAccuracy: {},
  confidenceCalibration: {
    high: { count: 0, avgAbsDeltaPercent: 0 },
    medium: { count: 0, avgAbsDeltaPercent: 0 },
    low: { count: 0, avgAbsDeltaPercent: 0 },
  },
  outliers: [],
};

const _getCostAccuracyOverviewAction = withLogging(async (
  limit = 50,
): Promise<ActionResult<CostAccuracyOverview>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();

    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, estimated_cost_usd, total_cost_usd, cost_estimate_detail, cost_prediction, created_at')
      .eq('archived', false)
      .eq('status', 'completed')
      .not('estimated_cost_usd', 'is', null)
      .gt('estimated_cost_usd', 0)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to fetch runs: ${error.message}`);
    if (!runs || runs.length === 0) return { success: true, data: EMPTY_OVERVIEW, error: null };

    // Recent deltas (chronological order for charting)
    const recentDeltas = runs.map(r => {
      const estimated = r.estimated_cost_usd as number;
      const actual = (r.total_cost_usd as number) ?? 0;
      return {
        runId: r.id as string,
        deltaPercent: Math.round(((actual - estimated) / estimated) * 1000) / 10,
        createdAt: r.created_at as string,
      };
    }).reverse();

    // Per-agent accuracy from cost_prediction JSONB
    const agentTotals = new Map<string, { estSum: number; actSum: number; count: number }>();
    for (const r of runs) {
      const pred = r.cost_prediction as { perAgent?: Record<string, { estimated: number; actual: number }> } | null;
      if (!pred?.perAgent) continue;
      const perAgent = pred.perAgent;
      for (const [agent, vals] of Object.entries(perAgent)) {
        const entry = agentTotals.get(agent) ?? { estSum: 0, actSum: 0, count: 0 };
        entry.estSum += vals.estimated;
        entry.actSum += vals.actual;
        entry.count += 1;
        agentTotals.set(agent, entry);
      }
    }
    const perAgentAccuracy: CostAccuracyOverview['perAgentAccuracy'] = {};
    for (const [agent, { estSum, actSum, count }] of agentTotals) {
      const avgEst = estSum / count;
      const avgAct = actSum / count;
      perAgentAccuracy[agent] = {
        avgEstimated: Math.round(avgEst * 1000) / 1000,
        avgActual: Math.round(avgAct * 1000) / 1000,
        avgDeltaPercent: avgEst > 0 ? Math.round(((avgAct - avgEst) / avgEst) * 1000) / 10 : 0,
      };
    }

    // Confidence calibration
    const confBuckets: Record<string, { sum: number; count: number }> = {
      high: { sum: 0, count: 0 },
      medium: { sum: 0, count: 0 },
      low: { sum: 0, count: 0 },
    };
    for (const r of runs) {
      const detail = r.cost_estimate_detail as { confidence?: string } | null;
      const conf = detail?.confidence ?? 'low';
      const bucket = confBuckets[conf] ?? confBuckets.low;
      const estimated = r.estimated_cost_usd as number;
      const actual = (r.total_cost_usd as number) ?? 0;
      bucket.sum += Math.abs(((actual - estimated) / estimated) * 100);
      bucket.count += 1;
    }
    function avgAbsDelta(bucket: { sum: number; count: number }): number {
      return bucket.count > 0 ? Math.round(bucket.sum / bucket.count * 10) / 10 : 0;
    }

    const confidenceCalibration: CostAccuracyOverview['confidenceCalibration'] = {
      high: { count: confBuckets.high.count, avgAbsDeltaPercent: avgAbsDelta(confBuckets.high) },
      medium: { count: confBuckets.medium.count, avgAbsDeltaPercent: avgAbsDelta(confBuckets.medium) },
      low: { count: confBuckets.low.count, avgAbsDeltaPercent: avgAbsDelta(confBuckets.low) },
    };

    // Outliers: abs(deltaPercent) > 50%
    const outliers = recentDeltas
      .filter(d => Math.abs(d.deltaPercent) > 50)
      .map(d => {
        const run = runs.find(r => (r.id as string) === d.runId)!;
        return {
          runId: d.runId,
          deltaPercent: d.deltaPercent,
          estimatedUsd: run.estimated_cost_usd as number,
          actualUsd: (run.total_cost_usd as number) ?? 0,
        };
      });

    return { success: true, data: { recentDeltas, perAgentAccuracy, confidenceCalibration, outliers }, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'getCostAccuracyOverviewAction') };
  }
}, 'getCostAccuracyOverviewAction');

export const getCostAccuracyOverviewAction = serverReadRequestId(_getCostAccuracyOverviewAction);
