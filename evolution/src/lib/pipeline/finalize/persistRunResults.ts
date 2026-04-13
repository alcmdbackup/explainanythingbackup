// Persist V2 results in V1-compatible format for admin UI display, and sync to arena.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { ratingToDb, DEFAULT_ELO, DEFAULT_UNCERTAINTY, createRating } from '../../shared/computeRatings';
import type { EvolutionResult, V2Match } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';
import { createEntityLogger } from '../infra/createEntityLogger';
import { isArenaEntry, type ArenaTextVariation } from '../setup/buildRunContext';
import { logger as serverLogger } from '@/lib/server_utilities';
import { getEntity } from '../../core/entityRegistry';
import { writeMetric, writeMetricMax } from '../../metrics/writeMetrics';
import { getMetricsForEntities } from '../../metrics/readMetrics';
import { type FinalizationContext, type MetricRow, type MetricName, type AggregationMethod, isMetricValue } from '../../metrics/types';
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

  // Top variants (top 5 by elo). Note: V3 schema still names fields mu/avgMu/baselineMu — those
  // fields are now populated with Elo-scale values (DB JSONB field-name change deferred to V4).
  const sorted = [...pool]
    .map((v) => ({ v, elo: ratings.get(v.id)?.elo ?? DEFAULT_ELO }))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 5);

  const topVariants = sorted.map((s) => ({
    id: s.v.id,
    strategy: s.v.strategy,
    mu: s.elo,
    isBaseline: s.v.strategy === V2_BASELINE_STRATEGY,
  }));

  // Baseline rank/elo (written to `baselineMu` field until V4 schema change)
  const baselineVariant = pool.find((v) => v.strategy === V2_BASELINE_STRATEGY);
  const baselineElo = baselineVariant ? (ratings.get(baselineVariant.id)?.elo ?? DEFAULT_ELO) : null;
  const baselineRank = baselineElo != null
    ? pool.filter((v) => (ratings.get(v.id)?.elo ?? DEFAULT_ELO) > baselineElo).length + 1
    : null;

  // Strategy effectiveness (single-pass aggregation) — avgMu field now stores Elo mean.
  const strategyEffectiveness = pool.reduce<Record<string, { count: number; avgMu: number }>>((acc, v) => {
    const elo = ratings.get(v.id)?.elo ?? DEFAULT_ELO;
    const prev = acc[v.strategy];
    if (prev) {
      const newCount = prev.count + 1;
      acc[v.strategy] = { count: newCount, avgMu: prev.avgMu + (elo - prev.avgMu) / newCount };
    } else {
      acc[v.strategy] = { count: 1, avgMu: elo };
    }
    return acc;
  }, {});

  return {
    version: 3,
    stopReason: result.stopReason,
    finalPhase: 'COMPETITION',
    totalIterations: result.iterationsRun,
    durationSeconds,
    muHistory: result.eloHistory,
    diversityHistory: result.diversityHistory,
    matchStats: { totalMatches, avgConfidence, decisiveRate },
    topVariants,
    baselineRank,
    baselineMu: baselineElo,
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
  // Also writes iteration_snapshots and random_seed if present on the result.
  const runUpdate: Record<string, unknown> = {
    status: 'completed',
    completed_at: new Date().toISOString(),
    run_summary: runSummary,
  };
  if (result.iterationSnapshots !== undefined) {
    runUpdate.iteration_snapshots = result.iterationSnapshots;
  }
  if (result.randomSeed !== undefined) {
    runUpdate.random_seed = result.randomSeed.toString();
  }
  let statusQuery = db
    .from('evolution_runs')
    .update(runUpdate)
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

  // Step 3: Determine winner (highest elo, tie-break by lowest uncertainty)
  const winResult = selectWinner(localPool, result.ratings);
  const winnerId = winResult.winnerId;
  const winnerElo = result.ratings.get(winnerId)?.elo ?? DEFAULT_ELO;
  const winnerUncertainty = result.ratings.get(winnerId)?.uncertainty ?? DEFAULT_UNCERTAINTY;
  logger?.info('Winner determined', { winnerId, winnerElo, winnerUncertainty, phaseName: 'finalize' });

  // Step 4: Upsert variants — both surfaced (persisted=true) and discarded (persisted=false).
  // Discarded variants exist in the DB so their generation cost stays queryable.
  const surfacedRows = localPool.map((v) => {
    const rating = result.ratings.get(v.id);
    if (!rating) {
      logger?.warn('Missing rating for variant, using default', { variantId: v.id, phaseName: 'finalize' });
    }
    const db = ratingToDb(rating ?? createRating());
    return evolutionVariantInsertSchema.parse({
      id: v.id,
      run_id: runId,
      explanation_id: run.explanation_id ?? null,
      variant_content: v.text,
      elo_score: db.elo_score,
      mu: db.mu,
      sigma: db.sigma,
      generation: v.version,
      parent_variant_id: v.parentIds[0] ?? null,
      agent_name: v.strategy,
      match_count: result.matchCounts[v.id] ?? 0,
      is_winner: v.id === winnerId,
      prompt_id: run.prompt_id ?? null,
      persisted: true,
    });
  });

  const discardedRows = (result.discardedVariants ?? [])
    .filter((v) => !v.fromArena)
    .map((v) => {
      // Discarded variants don't have global ratings (they were never merged), but their
      // generation cost lives on the invocation row. We persist with default mu/sigma so the
      // row exists; metric queries should filter by persisted=true to exclude them.
      const db = ratingToDb(createRating());
      return evolutionVariantInsertSchema.parse({
        id: v.id,
        run_id: runId,
        explanation_id: run.explanation_id ?? null,
        variant_content: v.text,
        elo_score: db.elo_score,
        mu: db.mu,
        sigma: db.sigma,
        generation: v.version,
        parent_variant_id: v.parentIds[0] ?? null,
        agent_name: v.strategy,
        match_count: 0,
        is_winner: false,
        prompt_id: run.prompt_id ?? null,
        persisted: false,
      });
    });

  const variantRows = [...surfacedRows, ...discardedRows];

  logger?.info('Persisting variants', {
    count: variantRows.length,
    surfaced: surfacedRows.length,
    discarded: discardedRows.length,
    winnerId,
    phaseName: 'finalize',
  });
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

    // Ensure cost metric exists (may have been skipped if iteration loop broke early).
    // Use writeMetricMax (GREATEST upsert) to avoid downgrading a higher value that was
    // written live by createLLMClient during execution (e.g. when parallel agents accumulate
    // more spend than costTracker.getTotalSpent() reflects at finalization time).
    if (result.totalCost != null && !isNaN(result.totalCost)) {
      await writeMetricMax(db, 'run', runId, 'cost' as MetricName, result.totalCost, 'during_execution');
    }

    // Run-level finalization metrics
    for (const def of getEntity('run').metrics.atFinalization) {
      const metricResult = def.compute(finCtx);
      if (metricResult == null) continue;
      if (isMetricValue(metricResult)) {
        await writeMetric(db, 'run', runId, def.name as MetricName, metricResult.value, 'at_finalization', {
          sigma: metricResult.sigma ?? undefined,
          ci_lower: metricResult.ci?.[0],
          ci_upper: metricResult.ci?.[1],
          n: metricResult.n,
        });
      } else {
        await writeMetric(db, 'run', runId, def.name as MetricName, metricResult, 'at_finalization');
      }
    }

    // Invocation-level finalization metrics (requires execution_detail for variant mapping)
    const { data: invocations } = await db
      .from('evolution_agent_invocations')
      .select('id, agent_name, cost_usd, execution_detail')
      .eq('run_id', runId);

    if (invocations && invocations.length > 0) {
      const detailsMap = new Map(
        invocations.map((inv: { id: string; execution_detail: unknown }) => [inv.id, inv.execution_detail]),
      );
      const invFinCtx: FinalizationContext = { ...finCtx, invocationDetails: detailsMap as FinalizationContext['invocationDetails'] };
      for (const inv of invocations) {
        const invCtx = { ...invFinCtx, currentInvocationId: inv.id };
        for (const def of getEntity('invocation').metrics.atFinalization) {
          const result = def.compute(invCtx);
          if (result == null) continue;
          const val = isMetricValue(result) ? result.value : result;
          await writeMetric(db, 'invocation', inv.id, def.name as MetricName, val, 'at_finalization');
        }
      }

      // Note: per-purpose cost split (generation_cost / ranking_cost) is no longer
      // computed here. createLLMClient writes those metrics live during execution via
      // writeMetricMax (race-fixed Postgres GREATEST upsert) keyed by the typed AgentName
      // label passed to llm.complete(). Propagation to strategy/experiment picks them up
      // automatically via the new SHARED_PROPAGATION_DEFS entries.
    }

    // Variant-level finalization metrics
    for (const v of localPool) {
      const varCtx: FinalizationContext = { ...finCtx, currentVariantCost: v.costUsd ?? null };
      for (const def of getEntity('variant').metrics.atFinalization) {
        const result = def.compute(varCtx);
        if (result == null) continue;
        const val = isMetricValue(result) ? result.value : result;
        await writeMetric(db, 'variant', v.id, def.name as MetricName, val, 'at_finalization');
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
    const err = metricsErr instanceof Error ? metricsErr : null;
    logger?.warn('Finalization metrics write failed', {
      phaseName: 'finalize',
      error: (err ? err.message : String(metricsErr)).slice(0, 500),
      errorType: err ? err.constructor.name : typeof metricsErr,
      errorStack: err?.stack?.slice(0, 1000),
      runId,
    });
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
      logger?.warn('Experiment auto-completion failed', { phaseName: 'finalize', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }
}

/** Aggregate child run metrics into a parent entity (strategy or experiment). */
export async function propagateMetrics(
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
      sigma: aggregated.sigma ?? undefined,
      ci_lower: aggregated.ci?.[0],
      ci_upper: aggregated.ci?.[1],
      n: aggregated.n,
      aggregation_method: def.aggregationMethod as AggregationMethod,
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
  isSeeded: boolean,
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
      const db = ratingToDb(ratings.get(v.id) ?? createRating());
      return {
        id: v.id,
        variant_content: v.text,
        elo_score: db.elo_score,
        mu: db.mu,
        sigma: db.sigma,
        // arena_match_count: matches played in THIS run only (not cumulative).
        // The DB RPC accumulates this into the arena entry's lifetime total.
        arena_match_count: variantMatchCounts.get(v.id) ?? 0,
        generation_method: isSeeded && v.strategy === V2_BASELINE_STRATEGY ? 'seed' : 'pipeline',
      };
    });

  // Build arena updates: existing arena entries that participated in matches this run
  const arenaUpdates = pool
    .filter((v): v is ArenaTextVariation => isArenaEntry(v))
    .filter((v) => (variantMatchCounts.get(v.id) ?? 0) > 0)
    .map((v) => {
      const db = ratingToDb(ratings.get(v.id) ?? createRating());
      return {
        id: v.id,
        mu: db.mu,
        sigma: db.sigma,
        elo_score: db.elo_score,
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
