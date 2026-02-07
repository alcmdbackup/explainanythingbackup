/**
 * Adaptive budget allocation based on historical agent ROI data.
 * Shifts budget toward agents that produce the most Elo per dollar.
 */

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

// ─── Types ──────────────────────────────────────────────────────

export interface AgentROI {
  agentName: string;
  avgCostUsd: number;
  avgEloGain: number;
  avgEloPerDollar: number;
  sampleSize: number;
}

export interface AdaptiveAllocationResult {
  caps: Record<string, number>;
  source: 'adaptive' | 'default';
  leaderboard: AgentROI[];
  reasoning: string;
}

// ─── ROI Leaderboard ────────────────────────────────────────────

/**
 * Fetch agent ROI leaderboard from historical metrics.
 * Returns agents sorted by Elo per dollar (descending).
 */
export async function getAgentROILeaderboard(
  lookbackDays: number = 30
): Promise<AgentROI[]> {
  try {
    const supabase = await createSupabaseServiceClient();
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('evolution_run_agent_metrics')
      .select('agent_name, cost_usd, elo_gain, elo_per_dollar')
      .gte('created_at', cutoff);

    if (error) {
      console.warn('Failed to fetch agent metrics:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Aggregate by agent
    const byAgent = new Map<string, {
      costs: number[];
      gains: number[];
      epds: number[];
    }>();

    for (const row of data) {
      const existing = byAgent.get(row.agent_name) ?? { costs: [], gains: [], epds: [] };
      if (row.cost_usd != null) existing.costs.push(row.cost_usd);
      if (row.elo_gain != null) existing.gains.push(row.elo_gain);
      if (row.elo_per_dollar != null) existing.epds.push(row.elo_per_dollar);
      byAgent.set(row.agent_name, existing);
    }

    const leaderboard: AgentROI[] = [];
    for (const [agentName, stats] of byAgent) {
      const sampleSize = stats.costs.length;
      if (sampleSize === 0) continue;

      leaderboard.push({
        agentName,
        avgCostUsd: stats.costs.reduce((a, b) => a + b, 0) / stats.costs.length,
        avgEloGain: stats.gains.length > 0
          ? stats.gains.reduce((a, b) => a + b, 0) / stats.gains.length
          : 0,
        avgEloPerDollar: stats.epds.length > 0
          ? stats.epds.reduce((a, b) => a + b, 0) / stats.epds.length
          : 0,
        sampleSize,
      });
    }

    return leaderboard.sort((a, b) => b.avgEloPerDollar - a.avgEloPerDollar);
  } catch (err) {
    console.warn('Error fetching ROI leaderboard:', err);
    return [];
  }
}

// ─── Adaptive Budget Caps ───────────────────────────────────────

/**
 * Compute adaptive budget caps based on historical ROI data.
 * Returns proportional allocation with floor/ceiling bounds.
 *
 * @param lookbackDays - Number of days to look back for historical data
 * @param minFloor - Minimum allocation per agent (default 5%)
 * @param maxCeiling - Maximum allocation per agent (default 40%)
 * @param minSampleSize - Minimum samples required per agent (default 10)
 */
export async function computeAdaptiveBudgetCaps(
  lookbackDays: number = 30,
  minFloor: number = 0.05,
  maxCeiling: number = 0.40,
  minSampleSize: number = 10
): Promise<AdaptiveAllocationResult> {
  const leaderboard = await getAgentROILeaderboard(lookbackDays);

  // Filter to agents with sufficient sample size and positive ROI
  const qualified = leaderboard.filter(
    a => a.sampleSize >= minSampleSize && a.avgEloPerDollar > 0
  );

  if (qualified.length === 0) {
    return {
      caps: DEFAULT_EVOLUTION_CONFIG.budgetCaps,
      source: 'default',
      leaderboard,
      reasoning: `No qualified agents found (need ${minSampleSize}+ samples and positive Elo/dollar). Using defaults.`,
    };
  }

  // Compute proportional allocation based on Elo per dollar
  const totalEpd = qualified.reduce((s, a) => s + a.avgEloPerDollar, 0);
  const caps: Record<string, number> = {};

  for (const agent of qualified) {
    const share = agent.avgEloPerDollar / totalEpd;
    caps[agent.agentName] = share;
  }

  // Add floor for agents not in leaderboard
  const allAgents = [
    'generation', 'calibration', 'tournament',
    'evolution', 'reflection', 'debate', 'iterativeEditing',
  ];
  for (const agent of allAgents) {
    if (!(agent in caps)) {
      caps[agent] = minFloor;
    }
  }

  // Apply floor and ceiling bounds, then normalize
  // Use iterative approach to ensure bounds are respected after normalization
  let needsAdjustment = true;
  let iterations = 0;
  const maxIterations = 10;

  while (needsAdjustment && iterations < maxIterations) {
    needsAdjustment = false;
    iterations++;

    // Apply bounds
    for (const k of Object.keys(caps)) {
      if (caps[k] < minFloor) {
        caps[k] = minFloor;
        needsAdjustment = true;
      } else if (caps[k] > maxCeiling) {
        caps[k] = maxCeiling;
        needsAdjustment = true;
      }
    }

    // Normalize to sum to 1.0
    const sum = Object.values(caps).reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (const k of Object.keys(caps)) {
        caps[k] = caps[k] / sum;
      }
    }
  }

  // Build reasoning
  const topAgents = qualified.slice(0, 3).map(a =>
    `${a.agentName}: ${a.avgEloPerDollar.toFixed(0)} Elo/$ (${a.sampleSize} samples)`
  );

  return {
    caps,
    source: 'adaptive',
    leaderboard,
    reasoning: `Allocated based on ${qualified.length} qualified agents. Top performers: ${topAgents.join(', ')}`,
  };
}

// ─── Budget Pressure Config ─────────────────────────────────────

/**
 * Generate budget configuration that accounts for remaining budget pressure.
 * Used to dynamically adjust agent aggressiveness based on budget consumption.
 */
export function budgetPressureConfig(
  remainingBudget: number,
  totalBudget: number,
  remainingIterations: number
): { multiplier: number; strategy: 'aggressive' | 'normal' | 'conservative' } {
  const budgetRatio = remainingBudget / totalBudget;

  // If we have lots of budget and few iterations, be aggressive
  if (budgetRatio > 0.7 && remainingIterations <= 3) {
    return { multiplier: 1.5, strategy: 'aggressive' };
  }

  // If we're low on budget, be conservative
  if (budgetRatio < 0.2) {
    return { multiplier: 0.6, strategy: 'conservative' };
  }

  // Normal operation
  return { multiplier: 1.0, strategy: 'normal' };
}

// ─── Merge with Config ──────────────────────────────────────────

/**
 * Merge adaptive caps with explicit config overrides.
 * Explicit caps take precedence over adaptive allocation.
 */
export function mergeWithConfig(
  adaptiveCaps: Record<string, number>,
  configCaps?: Record<string, number>
): Record<string, number> {
  if (!configCaps || Object.keys(configCaps).length === 0) {
    return adaptiveCaps;
  }

  // Start with adaptive caps
  const merged = { ...adaptiveCaps };

  // Override with explicit config values
  for (const [agent, cap] of Object.entries(configCaps)) {
    merged[agent] = cap;
  }

  // Re-normalize to sum to 1.0
  const sum = Object.values(merged).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const k of Object.keys(merged)) {
      merged[k] = merged[k] / sum;
    }
  }

  return merged;
}
