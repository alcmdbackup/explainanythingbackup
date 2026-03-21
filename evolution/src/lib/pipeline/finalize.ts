// Persist V2 results in V1-compatible format for admin UI display.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toEloScale, DEFAULT_MU } from '../shared/rating';
/** V2 baseline strategy name (V1 uses 'original_baseline'). */
const V2_BASELINE_STRATEGY = 'baseline';
import type { EvolutionResult } from './types';
import type { RunLogger } from './run-logger';

// ─── Types ───────────────────────────────────────────────────────

interface RunContext {
  experiment_id: string | null;
  explanation_id: number | null;
  strategy_config_id: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildRunSummary(
  result: EvolutionResult,
  durationSeconds: number,
): Record<string, unknown> {
  const { matchHistory, pool, ratings } = result;

  // Match stats
  const totalMatches = matchHistory.length;
  const avgConfidence = totalMatches > 0
    ? matchHistory.reduce((sum, m) => sum + m.confidence, 0) / totalMatches
    : 0;
  const decisiveRate = totalMatches > 0
    ? matchHistory.filter((m) => m.confidence > 0.6).length / totalMatches
    : 0;

  // Top variants (top 5 by mu)
  const sorted = [...pool]
    .map((v) => ({ v, mu: ratings.get(v.id)?.mu ?? DEFAULT_MU }))
    .sort((a, b) => b.mu - a.mu)
    .slice(0, 5);

  const topVariants = sorted.map((s) => ({
    id: s.v.id,
    strategy: s.v.strategy,
    mu: s.mu,
    isBaseline: s.v.strategy === V2_BASELINE_STRATEGY,
  }));

  // Baseline rank/mu
  const baselineVariant = pool.find((v) => v.strategy === V2_BASELINE_STRATEGY);
  let baselineRank: number | null = null;
  let baselineMu: number | null = null;
  if (baselineVariant) {
    const bMu = ratings.get(baselineVariant.id)?.mu ?? DEFAULT_MU;
    baselineMu = bMu;
    const allMus = [...pool]
      .map((v) => ratings.get(v.id)?.mu ?? DEFAULT_MU)
      .sort((a, b) => b - a);
    baselineRank = allMus.indexOf(bMu) + 1;
  }

  // Strategy effectiveness (single-pass aggregation)
  const strategyEffectiveness = pool.reduce<Record<string, { count: number; avgMu: number }>>((acc, v) => {
    const mu = ratings.get(v.id)?.mu ?? DEFAULT_MU;
    const prev = acc[v.strategy];
    if (prev) {
      const newCount = prev.count + 1;
      acc[v.strategy] = { count: newCount, avgMu: prev.avgMu + (mu - prev.avgMu) / newCount };
    } else {
      acc[v.strategy] = { count: 1, avgMu: mu };
    }
    return acc;
  }, {});

  return {
    version: 3,
    stopReason: result.stopReason,
    finalPhase: 'COMPETITION',
    totalIterations: result.iterationsRun,
    durationSeconds,
    muHistory: result.muHistory,
    diversityHistory: result.diversityHistory,
    matchStats: { totalMatches, avgConfidence, decisiveRate },
    topVariants,
    baselineRank,
    baselineMu,
    strategyEffectiveness,
    metaFeedback: null,
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Persist V2 results in V1-compatible format: run_summary, variants, strategy aggregates.
 */
export async function finalizeRun(
  runId: string,
  result: EvolutionResult,
  run: RunContext,
  db: SupabaseClient,
  durationSeconds: number,
  logger?: RunLogger,
): Promise<void> {
  // Filter out arena-loaded entries
  const localPool = result.pool.filter((v) => !v.fromArena);

  if (localPool.length === 0) {
    logger?.error('Finalization failed: empty pool', { phaseName: 'finalize' });
    await db
      .from('evolution_runs')
      .update({ status: 'failed', error_message: 'Finalization failed: empty pool' })
      .eq('id', runId);
    return;
  }

  // Step 1: Build run summary
  const runSummary = buildRunSummary(result, durationSeconds);

  // Step 2: Update run to completed with run_summary
  const { error: runUpdateError } = await db
    .from('evolution_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      run_summary: runSummary,
    })
    .eq('id', runId)
    .in('status', ['claimed', 'running']);

  if (runUpdateError) {
    throw new Error(`Failed to update run status: ${runUpdateError.message}`);
  }

  // Step 3: Determine winner (highest mu, tie-break by pool order)
  let winnerId = localPool[0].id;
  let bestMu = -Infinity;
  for (const v of localPool) {
    const mu = result.ratings.get(v.id)?.mu ?? -Infinity;
    if (mu > bestMu) {
      bestMu = mu;
      winnerId = v.id;
    }
  }
  const winnerMu = result.ratings.get(winnerId)?.mu ?? DEFAULT_MU;

  // Step 4: Upsert variants
  try {
    const variantRows = localPool.map((v) => {
      const mu = result.ratings.get(v.id)?.mu;
      if (mu === undefined) {
        logger?.warn(`Missing rating for variant ${v.id}, using default`, { phaseName: 'finalize' });
      }
      return {
        id: v.id,
        run_id: runId,
        explanation_id: run.explanation_id ?? null,
        variant_content: v.text,
        elo_score: toEloScale(mu ?? DEFAULT_MU),
        generation: v.version,
        parent_variant_id: v.parentIds[0] ?? null,
        agent_name: v.strategy,
        match_count: result.matchCounts[v.id] ?? 0,
        is_winner: v.id === winnerId,
      };
    });

    const { error: variantError } = await db
      .from('evolution_variants')
      .upsert(variantRows, { onConflict: 'id' });

    if (variantError) {
      logger?.warn(`Variant upsert error: ${variantError.message}`, { phaseName: 'finalize' });
    }
  } catch (err) {
    logger?.warn(`Variant upsert exception: ${err}`, { phaseName: 'finalize' });
  }

  // Step 5: Strategy aggregate update
  if (run.strategy_config_id) {
    try {
      await db.rpc('update_strategy_aggregates', {
        p_strategy_id: run.strategy_config_id,
        p_cost_usd: result.totalCost,
        p_final_elo: toEloScale(winnerMu),
      });
    } catch (err) {
      logger?.warn(`Strategy aggregate update failed: ${err}`, { phaseName: 'finalize' });
    }
  }

  // Step 6: Experiment auto-completion
  if (run.experiment_id) {
    try {
      await db
        .from('evolution_experiments')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', run.experiment_id)
        .eq('status', 'running');
      // Note: the actual NOT EXISTS check for sibling runs would be done via RPC in production
    } catch (err) {
      logger?.warn(`Experiment auto-completion failed: ${err}`, { phaseName: 'finalize' });
    }
  }
}
