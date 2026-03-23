// Persist V2 results in V1-compatible format for admin UI display, and sync to arena.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { toEloScale, DEFAULT_MU, DEFAULT_SIGMA } from '../../shared/computeRatings';
import type { EvolutionResult, V2Match } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';
import { createEntityLogger } from '../infra/createEntityLogger';
import { isArenaEntry } from '../setup/buildRunContext';
import { logger as serverLogger } from '@/lib/server_utilities';

/** V2 baseline strategy name (V1 uses 'original_baseline'). */
const V2_BASELINE_STRATEGY = 'baseline';

// ─── Types ───────────────────────────────────────────────────────

interface RunContext {
  experiment_id: string | null;
  explanation_id: number | null;
  strategy_id: string | null;
  prompt_id: string | null;
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
  const baselineMu = baselineVariant ? (ratings.get(baselineVariant.id)?.mu ?? DEFAULT_MU) : null;
  const baselineRank = baselineMu != null
    ? pool.filter((v) => (ratings.get(v.id)?.mu ?? DEFAULT_MU) > baselineMu).length + 1
    : null;

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
  logger?: EntityLogger,
  runnerId?: string,
): Promise<void> {
  // Filter out arena-loaded entries
  const localPool = result.pool.filter((v) => !v.fromArena);

  if (localPool.length === 0) {
    if (result.pool.length > 0) {
      // Arena-only pool: all variants came from arena, no local variants to persist
      logger?.info('Arena-only pool: marking as completed', {
        phaseName: 'finalize',
        arenaPoolSize: result.pool.length,
        localPoolSize: 0,
      });
      await db
        .from('evolution_runs')
        .update({ status: 'completed', completed_at: new Date().toISOString(), run_summary: { version: 3, stopReason: 'arena_only' } })
        .eq('id', runId);
      return;
    }
    logger?.error('Finalization failed: empty pool', { phaseName: 'finalize' });
    await db
      .from('evolution_runs')
      .update({ status: 'failed', error_message: 'Finalization failed: empty pool' })
      .eq('id', runId);
    return;
  }

  // Step 1: Build run summary (exclude arena entries from stats)
  const filteredResult = { ...result, pool: localPool };
  const runSummary = buildRunSummary(filteredResult, durationSeconds);

  // Step 2: Update run to completed with run_summary (runner_id check prevents stale finalization)
  let statusQuery = db
    .from('evolution_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      run_summary: runSummary,
    })
    .eq('id', runId)
    .in('status', ['claimed', 'running']);

  if (runnerId) {
    statusQuery = statusQuery.eq('runner_id', runnerId);
  }

  const { data: updatedRows, error: runUpdateError } = await statusQuery.select('id');

  if (runUpdateError) {
    throw new Error(`Failed to update run status: ${runUpdateError.message}`);
  }

  if (!updatedRows || updatedRows.length === 0) {
    logger?.warn('Finalization aborted: run status changed externally (likely killed)', { phaseName: 'finalize' });
    return; // Skip variant persistence
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
  const variantRows = localPool.map((v) => {
    const rating = result.ratings.get(v.id);
    const mu = rating?.mu ?? DEFAULT_MU;
    const sigma = rating?.sigma ?? DEFAULT_SIGMA;
    if (!rating) {
      logger?.warn(`Missing rating for variant ${v.id}, using default`, { phaseName: 'finalize' });
    }
    return {
      id: v.id,
      run_id: runId,
      explanation_id: run.explanation_id ?? null,
      variant_content: v.text,
      elo_score: toEloScale(mu),
      mu,
      sigma,
      generation: v.version,
      parent_variant_id: v.parentIds[0] ?? null,
      agent_name: v.strategy,
      match_count: result.matchCounts[v.id] ?? 0,
      is_winner: v.id === winnerId,
      prompt_id: run.prompt_id ?? null,
    };
  });

  const { error: variantError } = await db
    .from('evolution_variants')
    .upsert(variantRows, { onConflict: 'id' });

  if (variantError) {
    if (variantError.code === '23505') {
      logger?.warn(`Variant upsert duplicate (acceptable race): ${variantError.message}`, { phaseName: 'finalize' });
    } else {
      throw new Error(`Variant upsert failed: ${variantError.message}`);
    }
  }

  // Step 5: Strategy aggregate update
  if (run.strategy_id) {
    try {
      await db.rpc('update_strategy_aggregates', {
        p_strategy_id: run.strategy_id,
        p_cost_usd: result.totalCost,
        p_final_elo: toEloScale(winnerMu),
      });
      const stratLogger = createEntityLogger({
        entityType: 'strategy',
        entityId: run.strategy_id,
        strategyId: run.strategy_id,
      }, db);
      stratLogger.info('Strategy aggregates updated', { totalCost: result.totalCost, finalElo: toEloScale(winnerMu) });
    } catch (err) {
      logger?.warn(`Strategy aggregate update failed: ${err}`, { phaseName: 'finalize' });
    }
  }

  // Step 6: Experiment auto-completion (only if ALL sibling runs are done)
  if (run.experiment_id) {
    try {
      await db.rpc('complete_experiment_if_done', {
        p_experiment_id: run.experiment_id,
        p_completed_run_id: runId,
      });
      const expLogger = createEntityLogger({
        entityType: 'experiment',
        entityId: run.experiment_id,
        experimentId: run.experiment_id,
        strategyId: run.strategy_id ?? undefined,
      }, db);
      expLogger.info('Experiment auto-completion checked', { completedRunId: runId });
    } catch (err) {
      logger?.warn(`Experiment auto-completion failed: ${err}`, { phaseName: 'finalize' });
    }
  }
}

// ─── Sync to arena ───────────────────────────────────────────────

/**
 * Sync pipeline results to arena via sync_to_arena RPC.
 * Upserts new variants as entries, inserts match history, updates Elo.
 */
export async function syncToArena(
  runId: string,
  promptId: string,
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchHistory: V2Match[],
  supabase: SupabaseClient,
): Promise<void> {
  // Build entries: all non-arena variants
  const newEntries = pool
    .filter((v) => !isArenaEntry(v))
    .map((v) => {
      const r = ratings.get(v.id);
      return {
        id: v.id,
        variant_content: v.text,
        elo_score: r ? toEloScale(r.mu) : 1200,
        mu: r?.mu ?? 25,
        sigma: r?.sigma ?? 8.333,
        arena_match_count: 0,
        generation_method: 'pipeline',
      };
    });

  // Build match results: filter failed comparisons, normalize draw entries to sorted order
  const matches = matchHistory
    .filter((m) => m.confidence > 0) // Skip failed comparisons (confidence 0)
    .map((m) => {
      if (m.result === 'draw') {
        // Normalize draw entries to sorted order to prevent duplicate match records
        const [first, second] = [m.winnerId, m.loserId].sort();
        return { entry_a: first, entry_b: second, winner: 'draw' as const, confidence: m.confidence };
      }
      // entry_a = winnerId, so winner is always 'a' by construction
      return { entry_a: m.winnerId, entry_b: m.loserId, winner: 'a' as const, confidence: m.confidence };
    });

  // Try sync with 1 retry (idempotent RPC using ON CONFLICT DO UPDATE)
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: newEntries,
      p_matches: matches,
    });

    if (!error) return;
    lastError = error;

    if (attempt === 0) {
      // Wait 2s before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Arena sync is non-critical — log but don't re-throw
  if (lastError) {
    serverLogger.warn('sync_to_arena failed after retry', { error: lastError.message, runId, promptId, entryCount: newEntries.length });
  }
}
