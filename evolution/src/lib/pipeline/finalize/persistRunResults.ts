// Persist V2 results in V1-compatible format for admin UI display, and sync to arena.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { toEloScale, DEFAULT_MU, DEFAULT_SIGMA } from '../../shared/computeRatings';
import type { EvolutionResult, V2Match } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';
import { createEntityLogger } from '../infra/createEntityLogger';
import { isArenaEntry, type ArenaTextVariation } from '../setup/buildRunContext';
import { logger as serverLogger } from '@/lib/server_utilities';
import { getEntity } from '../../core/entityRegistry';
import { writeMetric } from '../../metrics/writeMetrics';
import { getMetricsForEntities } from '../../metrics/readMetrics';
import type { FinalizationContext, MetricRow, MetricName } from '../../metrics/types';

import { evolutionVariantInsertSchema, EvolutionRunSummaryV3Schema } from '../../schemas';
import { selectWinner } from '../../shared/selectWinner';

/** V2 baseline strategy name (V1 uses 'original_baseline'). */
const V2_BASELINE_STRATEGY = 'baseline';

interface RunContext {
  experiment_id: string | null;
  explanation_id: number | null;
  strategy_id: string | null;
  prompt_id: string | null;
}

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

/** Persist V2 results in V1-compatible format: run_summary, variants, strategy aggregates. */
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
      logger?.info('Arena-only pool: marking as completed', { phaseName: 'finalize', arenaPoolSize: result.pool.length, localPoolSize: 0 });
      const arenaOnlySummary = buildRunSummary(result, durationSeconds);
      arenaOnlySummary.stopReason = 'arena_only';
      await db.from('evolution_runs').update({ status: 'completed', completed_at: new Date().toISOString(), run_summary: arenaOnlySummary }).eq('id', runId);
    } else {
      logger?.error('Finalization failed: empty pool', { phaseName: 'finalize' });
      await db.from('evolution_runs').update({ status: 'failed', error_message: 'Finalization failed: empty pool' }).eq('id', runId);
    }
    return;
  }

  // Step 1: Build run summary (exclude arena entries from stats) and validate
  const filteredResult = { ...result, pool: localPool };
  const runSummary = buildRunSummary(filteredResult, durationSeconds);
  EvolutionRunSummaryV3Schema.parse(runSummary);
  logger?.info('Strategy effectiveness computed', { strategyEffectiveness: (runSummary as Record<string, unknown>).strategyEffectiveness, phaseName: 'finalize' });

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
    logger?.error('Finalization aborted: run status changed externally. Variants NOT persisted.', {
      phaseName: 'finalize',
      variantCount: localPool.length,
      runId,
    });
    return; // Skip variant persistence
  }

  // Step 3: Determine winner (highest mu, tie-break by lowest sigma)
  const winResult = selectWinner(localPool, result.ratings);
  const winnerId = winResult.winnerId;
  const winnerMu = result.ratings.get(winnerId)?.mu ?? DEFAULT_MU;
  const winnerSigma = result.ratings.get(winnerId)?.sigma ?? DEFAULT_SIGMA;
  logger?.info('Winner determined', { winnerId, winnerMu, winnerSigma, phaseName: 'finalize' });

  // Step 4: Upsert variants
  const variantRows = localPool.map((v) => {
    const rating = result.ratings.get(v.id);
    const mu = rating?.mu ?? DEFAULT_MU;
    const sigma = rating?.sigma ?? DEFAULT_SIGMA;
    if (!rating) {
      logger?.warn('Missing rating for variant, using default', { variantId: v.id, phaseName: 'finalize' });
    }
    return evolutionVariantInsertSchema.parse({
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
    });
  });

  logger?.info('Persisting variants', { count: variantRows.length, winnerId, phaseName: 'finalize' });
  const { error: variantError } = await db
    .from('evolution_variants')
    .upsert(variantRows, { onConflict: 'id' });

  if (variantError) {
    if (variantError.code === '23505') {
      logger?.warn('Variant upsert duplicate (acceptable race)', { phaseName: 'finalize', error: variantError.message.slice(0, 500) });
    } else {
      throw new Error(`Variant upsert failed: ${variantError.message}`);
    }
  }

  // Step 5: Write finalization metrics (run, invocation, variant)
  try {
    const finCtx: FinalizationContext = {
      result: filteredResult,
      ratings: result.ratings,
      pool: localPool,
      matchHistory: result.matchHistory,
    };

    // Ensure cost metric exists (may have been skipped if iteration loop broke early)
    if (result.totalCost != null && !isNaN(result.totalCost)) {
      await writeMetric(db, 'run', runId, 'cost' as MetricName, result.totalCost, 'during_execution');
    }

    // Run-level finalization metrics
    for (const def of getEntity('run').metrics.atFinalization) {
      const value = def.compute(finCtx);
      if (value != null) {
        await writeMetric(db, 'run', runId, def.name as MetricName, value, 'at_finalization');
      }
    }

    // Invocation-level finalization metrics (requires execution_detail for variant mapping)
    const { data: invocations } = await db
      .from('evolution_agent_invocations')
      .select('id, agent_name, execution_detail')
      .eq('run_id', runId);

    if (invocations && invocations.length > 0) {
      const detailsMap = new Map(
        invocations.map((inv: { id: string; execution_detail: unknown }) => [inv.id, inv.execution_detail]),
      );
      const invFinCtx: FinalizationContext = { ...finCtx, invocationDetails: detailsMap as FinalizationContext['invocationDetails'] };
      for (const inv of invocations) {
        const invCtx = { ...invFinCtx, currentInvocationId: inv.id };
        for (const def of getEntity('invocation').metrics.atFinalization) {
          const value = def.compute(invCtx);
          if (value != null) {
            await writeMetric(db, 'invocation', inv.id, def.name as MetricName, value, 'at_finalization');
          }
        }
      }
    }

    // Variant-level finalization metrics
    for (const v of localPool) {
      const varCtx: FinalizationContext = { ...finCtx, currentVariantCost: v.costUsd ?? null };
      for (const def of getEntity('variant').metrics.atFinalization) {
        const value = def.compute(varCtx);
        if (value != null) {
          await writeMetric(db, 'variant', v.id, def.name as MetricName, value, 'at_finalization');
        }
      }
    }

    // Propagation: strategy & experiment metrics
    if (run.strategy_id) {
      await propagateMetrics(db, 'strategy', run.strategy_id);
    }
    if (run.experiment_id) {
      await propagateMetrics(db, 'experiment', run.experiment_id);
    }
  } catch (metricsErr) {
    const errMsg = metricsErr instanceof Error ? metricsErr.message : String(metricsErr);
    const errStack = metricsErr instanceof Error ? metricsErr.stack?.slice(0, 1000) : undefined;
    logger?.warn('Finalization metrics write failed', {
      phaseName: 'finalize',
      error: errMsg.slice(0, 500),
      errorType: metricsErr instanceof Error ? metricsErr.constructor.name : typeof metricsErr,
      errorStack: errStack,
      runId,
    });
  }

  // Step 6a: Strategy aggregate update (legacy — will be removed in Phase 6)
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
      logger?.warn('Strategy aggregate update failed', { phaseName: 'finalize', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  // Step 6b: Experiment auto-completion (only if ALL sibling runs are done)
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
      logger?.warn('Experiment auto-completion failed', { phaseName: 'finalize', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }
}

/** Aggregate child run metrics into a parent entity (strategy or experiment). */
async function propagateMetrics(
  db: SupabaseClient,
  entityType: 'strategy' | 'experiment',
  entityId: string,
): Promise<void> {
  const columnName = entityType === 'strategy' ? 'strategy_id' : 'experiment_id';
  const { data: runs } = await db
    .from('evolution_runs')
    .select('id')
    .eq(columnName, entityId)
    .eq('status', 'completed');

  const childRunIds = (runs ?? []).map((r: { id: string }) => r.id);
  if (childRunIds.length === 0) return;

  const propDefs = getEntity(entityType).metrics.atPropagation;
  if (propDefs.length === 0) return;

  const sourceMetricNames = [...new Set(propDefs.map(d => d.sourceMetric))];
  const runMetrics = await getMetricsForEntities(db, 'run', childRunIds, sourceMetricNames);
  const allRows = [...runMetrics.values()].flat();

  for (const def of propDefs) {
    const sourceRows = allRows.filter((m: MetricRow) => m.metric_name === def.sourceMetric);
    if (sourceRows.length === 0) continue;
    const aggregated = def.aggregate(sourceRows);
    await writeMetric(db, entityType, entityId, def.name as MetricName, aggregated.value, 'at_propagation', {
      ci_lower: aggregated.ci?.[0],
      ci_upper: aggregated.ci?.[1],
      n: aggregated.n,
      aggregation_method: def.aggregationMethod as import('../../metrics/types').AggregationMethod,
    });
  }
}

/** Sync pipeline results to arena: upsert entries, insert matches, update Elo. */
export async function syncToArena(
  runId: string,
  promptId: string,
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchHistory: V2Match[],
  supabase: SupabaseClient,
  logger?: EntityLogger,
): Promise<void> {
  // Compute per-variant match counts from match history
  const variantMatchCounts = new Map<string, number>();
  for (const m of matchHistory) {
    if (m.confidence > 0) {
      variantMatchCounts.set(m.winnerId, (variantMatchCounts.get(m.winnerId) ?? 0) + 1);
      variantMatchCounts.set(m.loserId, (variantMatchCounts.get(m.loserId) ?? 0) + 1);
    }
  }

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
        arena_match_count: variantMatchCounts.get(v.id) ?? 0,
        generation_method: 'pipeline',
      };
    });

  // Build arena updates: existing arena entries that participated in matches this run
  const arenaUpdates = pool
    .filter((v): v is ArenaTextVariation => isArenaEntry(v))
    .filter((v) => (variantMatchCounts.get(v.id) ?? 0) > 0)
    .map((v) => {
      const r = ratings.get(v.id);
      return {
        id: v.id,
        mu: r?.mu ?? 25,
        sigma: r?.sigma ?? 8.333,
        elo_score: r ? toEloScale(r.mu) : 1200,
        arena_match_count: (v.arenaMatchCount ?? 0) + (variantMatchCounts.get(v.id) ?? 0),
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

  logger?.info('Arena sync preparation', { newEntriesCount: newEntries.length, arenaUpdatesCount: arenaUpdates.length, matchCount: matches.length, phaseName: 'arena' });

  // Try sync with 1 retry (idempotent RPC using ON CONFLICT DO UPDATE)
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: newEntries,
      p_matches: matches,
      p_arena_updates: arenaUpdates,
    });

    if (!error) {
      logger?.info('Arena sync complete', { entrySynced: newEntries.length, arenaUpdated: arenaUpdates.length, matchesSynced: matches.length, phaseName: 'arena' });
      return;
    }
    lastError = error;

    if (attempt === 0) {
      logger?.warn('Arena sync retry', { attempt: 1, delay: 2000, phaseName: 'arena' });
      // Wait 2s before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Arena sync is non-critical — log but don't re-throw
  if (lastError) {
    if (logger) {
      logger.error('Arena sync failed after retry', { error: lastError.message, runId, promptId, entryCount: newEntries.length, phaseName: 'arena' });
    } else {
      serverLogger.warn('sync_to_arena failed after retry', { error: lastError.message, runId, promptId, entryCount: newEntries.length });
    }
  }
}
