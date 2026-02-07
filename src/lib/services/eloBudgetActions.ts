/**
 * Server actions for Elo budget optimization dashboard.
 * Provides agent-level and strategy-level analysis endpoints.
 */

'use server';

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { hashStrategyConfig, labelStrategyConfig, type StrategyConfig } from '../evolution/core/strategyConfig';
import type { AgentROI } from '../evolution/core/adaptiveAllocation';

// ─── Types ──────────────────────────────────────────────────────

export interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StrategyLeaderboardEntry {
  id: string;
  configHash: string;
  name: string;
  description: string | null;
  label: string;
  config: StrategyConfig;
  runCount: number;
  totalCostUsd: number;
  avgFinalElo: number | null;
  avgEloPerDollar: number | null;
  bestFinalElo: number | null;
  worstFinalElo: number | null;
  stddevFinalElo: number | null;
  lastUsedAt: Date;
}

export interface ParetoPoint {
  strategyId: string;
  name: string;
  label: string;
  avgCostUsd: number;
  avgFinalElo: number;
  isPareto: boolean;
  runCount: number;
}

// ─── Agent-Level Analysis ───────────────────────────────────────

/**
 * Agent ROI leaderboard: which agents produce most Elo per dollar?
 */
export async function getAgentROILeaderboardAction(
  filters?: { lookbackDays?: number; minSampleSize?: number }
): Promise<ActionResult<AgentROI[]>> {
  try {
    const supabase = await createSupabaseServiceClient();
    const lookbackDays = filters?.lookbackDays ?? 30;
    // Default to 1 sample to show all data; callers can raise for statistical significance
    const minSampleSize = filters?.minSampleSize ?? 1;
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('evolution_run_agent_metrics')
      .select('agent_name, cost_usd, elo_gain, elo_per_dollar')
      .gte('created_at', cutoff);

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      return { success: true, data: [] };
    }

    // Aggregate by agent
    const byAgent = new Map<string, { costs: number[]; gains: number[]; epds: number[] }>();
    for (const row of data) {
      const existing = byAgent.get(row.agent_name) ?? { costs: [], gains: [], epds: [] };
      if (row.cost_usd != null) existing.costs.push(row.cost_usd);
      if (row.elo_gain != null) existing.gains.push(row.elo_gain);
      if (row.elo_per_dollar != null) existing.epds.push(row.elo_per_dollar);
      byAgent.set(row.agent_name, existing);
    }

    const leaderboard: AgentROI[] = [];
    for (const [agentName, stats] of byAgent) {
      if (stats.costs.length < minSampleSize) continue;

      leaderboard.push({
        agentName,
        avgCostUsd: stats.costs.reduce((a, b) => a + b, 0) / stats.costs.length,
        avgEloGain: stats.gains.length > 0 ? stats.gains.reduce((a, b) => a + b, 0) / stats.gains.length : 0,
        avgEloPerDollar: stats.epds.length > 0 ? stats.epds.reduce((a, b) => a + b, 0) / stats.epds.length : 0,
        sampleSize: stats.costs.length,
      });
    }

    return {
      success: true,
      data: leaderboard.sort((a, b) => b.avgEloPerDollar - a.avgEloPerDollar),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Agent cost breakdown by model.
 */
export async function getAgentCostByModelAction(
  agentName: string
): Promise<ActionResult<Array<{ model: string; avgCost: number; sampleSize: number }>>> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('agent_cost_baselines')
      .select('model, avg_cost_usd, sample_size')
      .eq('agent_name', agentName)
      .order('avg_cost_usd', { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: (data ?? []).map(row => ({
        model: row.model,
        avgCost: row.avg_cost_usd,
        sampleSize: row.sample_size,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Strategy-Level Analysis ────────────────────────────────────

/**
 * Strategy leaderboard: which configs produce best results?
 */
export async function getStrategyLeaderboardAction(
  filters?: {
    minRuns?: number;
    sortBy?: 'avg_elo' | 'avg_elo_per_dollar' | 'best_elo' | 'consistency';
  }
): Promise<ActionResult<StrategyLeaderboardEntry[]>> {
  try {
    const supabase = await createSupabaseServiceClient();
    const minRuns = filters?.minRuns ?? 1;
    const sortBy = filters?.sortBy ?? 'avg_elo_per_dollar';

    const { data, error } = await supabase
      .from('strategy_configs')
      .select('*')
      .gte('run_count', minRuns)
      .order(sortBy === 'consistency' ? 'stddev_final_elo' : sortBy.replace('_', '_'), { ascending: sortBy === 'consistency' });

    if (error) {
      return { success: false, error: error.message };
    }

    const entries: StrategyLeaderboardEntry[] = (data ?? []).map(row => ({
      id: row.id,
      configHash: row.config_hash,
      name: row.name,
      description: row.description,
      label: row.label,
      config: row.config as StrategyConfig,
      runCount: row.run_count,
      totalCostUsd: row.total_cost_usd,
      avgFinalElo: row.avg_final_elo,
      avgEloPerDollar: row.avg_elo_per_dollar,
      bestFinalElo: row.best_final_elo,
      worstFinalElo: row.worst_final_elo,
      stddevFinalElo: row.stddev_final_elo,
      lastUsedAt: new Date(row.last_used_at),
    }));

    return { success: true, data: entries };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get or create a strategy config entry.
 */
export async function resolveStrategyConfigAction(
  config: StrategyConfig,
  customName?: string
): Promise<ActionResult<{ id: string; isNew: boolean }>> {
  try {
    const supabase = await createSupabaseServiceClient();
    const hash = hashStrategyConfig(config);
    const label = labelStrategyConfig(config);
    const name = customName ?? `Strategy ${hash.slice(0, 6)}`;

    // Check if exists
    const { data: existing } = await supabase
      .from('strategy_configs')
      .select('id')
      .eq('config_hash', hash)
      .single();

    if (existing) {
      return { success: true, data: { id: existing.id, isNew: false } };
    }

    // Create new
    const { data: created, error } = await supabase
      .from('strategy_configs')
      .insert({ config_hash: hash, name, label, config })
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { id: created.id, isNew: true } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Update strategy name or description.
 */
export async function updateStrategyAction(
  strategyId: string,
  updates: { name?: string; description?: string }
): Promise<ActionResult<StrategyLeaderboardEntry>> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from('strategy_configs')
      .update(updates)
      .eq('id', strategyId)
      .select('*')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        id: data.id,
        configHash: data.config_hash,
        name: data.name,
        description: data.description,
        label: data.label,
        config: data.config as StrategyConfig,
        runCount: data.run_count,
        totalCostUsd: data.total_cost_usd,
        avgFinalElo: data.avg_final_elo,
        avgEloPerDollar: data.avg_elo_per_dollar,
        bestFinalElo: data.best_final_elo,
        worstFinalElo: data.worst_final_elo,
        stddevFinalElo: data.stddev_final_elo,
        lastUsedAt: new Date(data.last_used_at),
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Strategy Pareto frontier: Elo vs Cost with strategies as points.
 */
export async function getStrategyParetoAction(
  filters?: { minRuns?: number }
): Promise<ActionResult<ParetoPoint[]>> {
  try {
    const supabase = await createSupabaseServiceClient();
    const minRuns = filters?.minRuns ?? 1;

    const { data, error } = await supabase
      .from('strategy_configs')
      .select('id, name, label, run_count, total_cost_usd, avg_final_elo')
      .gte('run_count', minRuns)
      .not('avg_final_elo', 'is', null);

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      return { success: true, data: [] };
    }

    // Compute average cost per run
    const points: ParetoPoint[] = data.map(row => ({
      strategyId: row.id,
      name: row.name,
      label: row.label,
      avgCostUsd: row.total_cost_usd / row.run_count,
      avgFinalElo: row.avg_final_elo,
      isPareto: false,
      runCount: row.run_count,
    }));

    // Find Pareto-optimal points (higher Elo and lower cost is better)
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      let dominated = false;

      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const q = points[j];

        // q dominates p if q has higher or equal Elo AND lower or equal cost, with at least one strict
        if (q.avgFinalElo >= p.avgFinalElo && q.avgCostUsd <= p.avgCostUsd) {
          if (q.avgFinalElo > p.avgFinalElo || q.avgCostUsd < p.avgCostUsd) {
            dominated = true;
            break;
          }
        }
      }

      if (!dominated) {
        points[i].isPareto = true;
      }
    }

    return { success: true, data: points };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get recommended strategy for a given budget.
 */
export async function getRecommendedStrategyAction(
  params: {
    budgetUsd: number;
    optimizeFor: 'elo' | 'elo_per_dollar' | 'consistency';
  }
): Promise<ActionResult<{
  recommended: StrategyLeaderboardEntry | null;
  alternatives: StrategyLeaderboardEntry[];
  reasoning: string;
}>> {
  try {
    const supabase = await createSupabaseServiceClient();

    // Get strategies with at least 3 runs for reliability
    const { data, error } = await supabase
      .from('strategy_configs')
      .select('*')
      .gte('run_count', 3)
      .not('avg_final_elo', 'is', null);

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        data: {
          recommended: null,
          alternatives: [],
          reasoning: 'No strategies with sufficient run history. Run more experiments first.',
        },
      };
    }

    // Filter to strategies that fit within budget (based on avg cost per run)
    const affordable = data.filter(row => (row.total_cost_usd / row.run_count) <= params.budgetUsd);

    if (affordable.length === 0) {
      return {
        success: true,
        data: {
          recommended: null,
          alternatives: [],
          reasoning: `No strategies found within $${params.budgetUsd} budget. Consider increasing budget.`,
        },
      };
    }

    // Sort by optimization target
    const sorted = [...affordable];
    if (params.optimizeFor === 'elo') {
      sorted.sort((a, b) => (b.avg_final_elo ?? 0) - (a.avg_final_elo ?? 0));
    } else if (params.optimizeFor === 'elo_per_dollar') {
      sorted.sort((a, b) => (b.avg_elo_per_dollar ?? 0) - (a.avg_elo_per_dollar ?? 0));
    } else {
      // consistency = lower stddev is better
      sorted.sort((a, b) => (a.stddev_final_elo ?? Infinity) - (b.stddev_final_elo ?? Infinity));
    }

    const mapToEntry = (row: typeof data[0]): StrategyLeaderboardEntry => ({
      id: row.id,
      configHash: row.config_hash,
      name: row.name,
      description: row.description,
      label: row.label,
      config: row.config as StrategyConfig,
      runCount: row.run_count,
      totalCostUsd: row.total_cost_usd,
      avgFinalElo: row.avg_final_elo,
      avgEloPerDollar: row.avg_elo_per_dollar,
      bestFinalElo: row.best_final_elo,
      worstFinalElo: row.worst_final_elo,
      stddevFinalElo: row.stddev_final_elo,
      lastUsedAt: new Date(row.last_used_at),
    });

    const recommended = mapToEntry(sorted[0]);
    const alternatives = sorted.slice(1, 4).map(mapToEntry);

    const metricLabel = params.optimizeFor === 'elo' ? 'Elo'
      : params.optimizeFor === 'elo_per_dollar' ? 'Elo/dollar'
      : 'consistency';

    return {
      success: true,
      data: {
        recommended,
        alternatives,
        reasoning: `Recommended "${recommended.name}" for best ${metricLabel} within $${params.budgetUsd}. ` +
          `Avg Elo: ${recommended.avgFinalElo?.toFixed(0)}, Runs: ${recommended.runCount}.`,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Cross-Analysis ─────────────────────────────────────────────

/**
 * Get summary stats for the optimization dashboard.
 */
export async function getOptimizationSummaryAction(): Promise<ActionResult<{
  totalRuns: number;
  totalStrategies: number;
  totalSpentUsd: number;
  avgEloPerDollar: number | null;
  bestStrategy: { name: string; avgElo: number } | null;
  topAgent: { name: string; eloPerDollar: number } | null;
}>> {
  try {
    const supabase = await createSupabaseServiceClient();

    // Get strategy stats
    const { data: strategies, error: stratError } = await supabase
      .from('strategy_configs')
      .select('id, name, run_count, total_cost_usd, avg_final_elo, avg_elo_per_dollar');

    if (stratError) {
      return { success: false, error: stratError.message };
    }

    // Get agent stats
    const { data: agents, error: agentError } = await supabase
      .from('evolution_run_agent_metrics')
      .select('agent_name, elo_per_dollar');

    if (agentError) {
      return { success: false, error: agentError.message };
    }

    const totalRuns = strategies?.reduce((s, r) => s + r.run_count, 0) ?? 0;
    const totalStrategies = strategies?.length ?? 0;
    const totalSpentUsd = strategies?.reduce((s, r) => s + r.total_cost_usd, 0) ?? 0;

    // Find best strategy by Elo
    let bestStrategy: { name: string; avgElo: number } | null = null;
    if (strategies && strategies.length > 0) {
      const sorted = [...strategies].sort((a, b) => (b.avg_final_elo ?? 0) - (a.avg_final_elo ?? 0));
      if (sorted[0].avg_final_elo) {
        bestStrategy = { name: sorted[0].name, avgElo: sorted[0].avg_final_elo };
      }
    }

    // Find top agent by Elo/dollar
    let topAgent: { name: string; eloPerDollar: number } | null = null;
    if (agents && agents.length > 0) {
      const byAgent = new Map<string, number[]>();
      for (const row of agents) {
        if (row.elo_per_dollar == null) continue;
        const existing = byAgent.get(row.agent_name) ?? [];
        existing.push(row.elo_per_dollar);
        byAgent.set(row.agent_name, existing);
      }

      let bestEpd = 0;
      for (const [name, values] of byAgent) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        if (avg > bestEpd) {
          bestEpd = avg;
          topAgent = { name, eloPerDollar: avg };
        }
      }
    }

    // Calculate overall avg Elo/dollar
    let avgEloPerDollar: number | null = null;
    const epds = strategies?.map(s => s.avg_elo_per_dollar).filter(e => e != null) ?? [];
    if (epds.length > 0) {
      avgEloPerDollar = epds.reduce((a, b) => a + b, 0) / epds.length;
    }

    return {
      success: true,
      data: {
        totalRuns,
        totalStrategies,
        totalSpentUsd,
        avgEloPerDollar,
        bestStrategy,
        topAgent,
      },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Strategy Run History ───────────────────────────────────────

export interface StrategyRunEntry {
  runId: string;
  explanationId: number;
  explanationTitle: string;
  status: string;
  finalElo: number | null;
  totalCostUsd: number;
  iterations: number;
  duration: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Get run history for a specific strategy.
 */
export async function getStrategyRunsAction(
  strategyId: string,
  limit: number = 20
): Promise<ActionResult<StrategyRunEntry[]>> {
  try {
    const supabase = await createSupabaseServiceClient();

    // Get the strategy config hash
    const { data: strategy, error: stratError } = await supabase
      .from('strategy_configs')
      .select('config_hash, config')
      .eq('id', strategyId)
      .single();

    if (stratError || !strategy) {
      return { success: false, error: stratError?.message ?? 'Strategy not found' };
    }

    // Find runs with matching config
    // Note: This requires the runs to have strategy_config_id set, or we match by config JSON
    const { data: runs, error: runError } = await supabase
      .from('content_evolution_runs')
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
      return { success: false, error: runError.message };
    }

    if (!runs || runs.length === 0) {
      return { success: true, data: [] };
    }

    // Get explanation titles
    const explanationIds = [...new Set(runs.map(r => r.explanation_id))];
    const { data: explanations } = await supabase
      .from('explanations')
      .select('id, title')
      .in('id', explanationIds);

    const titleMap = new Map(explanations?.map(e => [e.id, e.title]) ?? []);

    const entries: StrategyRunEntry[] = runs.map(run => {
      const summary = run.run_summary as { finalTopElo?: number } | null;
      const startedAt = run.started_at ? new Date(run.started_at) : null;
      const completedAt = run.completed_at ? new Date(run.completed_at) : null;
      const duration = startedAt && completedAt
        ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
        : null;

      return {
        runId: run.id,
        explanationId: run.explanation_id,
        explanationTitle: titleMap.get(run.explanation_id) ?? `Explanation #${run.explanation_id}`,
        status: run.status,
        finalElo: summary?.finalTopElo ?? null,
        totalCostUsd: run.total_cost_usd ?? 0,
        iterations: run.current_iteration ?? 0,
        duration,
        startedAt,
        completedAt,
      };
    });

    return { success: true, data: entries };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
