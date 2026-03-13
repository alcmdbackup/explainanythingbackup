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
    // Note: archived filter not applied here — cost analytics should include all historical data.
    // Archived runs are excluded from list views but remain in aggregate stats.
    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('strategy_config_id, estimated_cost_usd, total_cost_usd')
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
