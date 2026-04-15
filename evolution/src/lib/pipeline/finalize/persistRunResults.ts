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

/** Seed variant strategy name (formerly 'baseline'; renamed 2026-04-14 to disambiguate from V1 'original_baseline'
 *  and to clarify its role as the persisted seed article for a prompt). */
export const SEED_VARIANT_STRATEGY = 'seed_variant';
/** @deprecated Legacy alias; admin UI dual-accept reads both 'baseline' (legacy rows) and 'seed_variant' (current). */
const LEGACY_BASELINE_STRATEGY = 'baseline';

/** True if `strategy` denotes the seed variant — accepts both new and legacy names for back-compat. */
function isSeedVariantStrategy(strategy: string | undefined): boolean {
  return strategy === SEED_VARIANT_STRATEGY || strategy === LEGACY_BASELINE_STRATEGY;
}


interface RunContext {
  experiment_id: string | null;
  explanation_id: number | null;
  strategy_id: string | null;
  prompt_id: string | null;
}

/** Compute median of a non-empty number array. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
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

  // Top variants (top 5 by elo).
  const sorted = [...pool]
    .map((v) => ({ v, elo: ratings.get(v.id)?.elo ?? DEFAULT_ELO }))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 5);

  const topVariants = sorted.map((s) => ({
    id: s.v.id,
    strategy: s.v.strategy,
    elo: s.elo,
    isSeedVariant: isSeedVariantStrategy(s.v.strategy),
  }));

  // Seed variant rank/elo (renamed from baselineRank/baselineElo).
  const seedVariantPoolEntry = pool.find((v) => isSeedVariantStrategy(v.strategy));
  const seedVariantElo = seedVariantPoolEntry ? (ratings.get(seedVariantPoolEntry.id)?.elo ?? DEFAULT_ELO) : null;
  const seedVariantRank = seedVariantElo != null
    ? pool.filter((v) => (ratings.get(v.id)?.elo ?? DEFAULT_ELO) > seedVariantElo).length + 1
    : null;

  // Strategy effectiveness (single-pass aggregation) — avgElo mean.
  const strategyEffectiveness = pool.reduce<Record<string, { count: number; avgElo: number }>>((acc, v) => {
    const elo = ratings.get(v.id)?.elo ?? DEFAULT_ELO;
    const prev = acc[v.strategy];
    if (prev) {
      const newCount = prev.count + 1;
      acc[v.strategy] = { count: newCount, avgElo: prev.avgElo + (elo - prev.avgElo) / newCount };
    } else {
      acc[v.strategy] = { count: 1, avgElo: elo };
    }
    return acc;
  }, {});

  return {
    version: 3,
    stopReason: result.stopReason,
    finalPhase: 'COMPETITION',
    totalIterations: result.iterationsRun,
    durationSeconds,
    eloHistory: result.eloHistory,
    diversityHistory: result.diversityHistory,
    matchStats: { totalMatches, avgConfidence, decisiveRate },
    topVariants,
    seedVariantRank,
    seedVariantElo,
    strategyEffectiveness,
    metaFeedback: null,
    ...(result.budgetFloorConfig ? { budgetFloorConfig: result.budgetFloorConfig } : {}),
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
  // summaryPool: the pool used for run_summary, winner selection, and metric loops.
  // Includes the reused seed (it's a real participant in the run) but excludes other
  // arena entries (those are reference points, already persisted elsewhere).
  const summaryPool = result.pool.filter((v) => !v.fromArena || v.reusedFromSeed);
  // localPool: variants that need a NEW evolution_variants INSERT this run.
  // Excludes both arena entries AND the reused seed (which already has a DB row;
  // its rating updates flow through arenaUpdates / optimistic-concurrency UPDATE).
  const localPool = result.pool.filter((v) => !v.fromArena && !v.reusedFromSeed);

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

  // Step 1: Build run summary using summaryPool (includes the reused seed so it appears
  // in topVariants / seedVariantRank / seedVariantElo / strategyEffectiveness) and validate.
  const filteredResult = { ...result, pool: summaryPool };
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

  // Step 3: Determine winner (highest elo, tie-break by lowest uncertainty).
  // Use summaryPool so the reused seed can be the winner if it has the highest elo.
  // Note: when the seed is the winner, its `is_winner` flag is NOT written to a new
  // evolution_variants row (the seed is excluded from localPool/INSERT). Its winner
  // status is reflected in run_summary.topVariants[0].isSeedVariant=true instead.
  const winResult = selectWinner(summaryPool, result.ratings);
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
    // Pre-fetch invocation data so the run-level finalization loop has access to
    // execution_detail (for cost_estimation_error_pct, estimated_cost, etc.) and can
    // derive sequential GFSA durations (for the Budget Floor Sensitivity module).
    const { data: invocations } = await db
      .from('evolution_agent_invocations')
      .select('id, agent_name, cost_usd, execution_detail, iteration, duration_ms')
      .eq('run_id', runId);

    const detailsMap = invocations && invocations.length > 0
      ? new Map(
          (invocations as Array<{ id: string; execution_detail: unknown }>).map(
            (inv) => [inv.id, inv.execution_detail],
          ),
        )
      : undefined;

    // Sequential GFSA durations: iteration >= 2 AND agent_name='generate_from_seed_article'
    // (iteration 1 is the parallel batch; later iterations are the sequential fallback path).
    const sequentialGfsaDurations: number[] = ((invocations ?? []) as Array<{
      agent_name?: string; iteration?: number; duration_ms?: number | null;
    }>)
      .filter((inv) =>
        inv.agent_name === 'generate_from_seed_article' &&
        typeof inv.iteration === 'number' && inv.iteration >= 2 &&
        typeof inv.duration_ms === 'number' && Number.isFinite(inv.duration_ms),
      )
      .map((inv) => inv.duration_ms as number)
      .sort((a, b) => a - b);
    const medianSequentialGfsaDurationMs = sequentialGfsaDurations.length > 0
      ? median(sequentialGfsaDurations) : null;
    const avgSequentialGfsaDurationMs = sequentialGfsaDurations.length > 0
      ? sequentialGfsaDurations.reduce((a, b) => a + b, 0) / sequentialGfsaDurations.length
      : null;

    const finCtx: FinalizationContext = {
      result: filteredResult,
      ratings: result.ratings,
      // summaryPool — metric loops should include the reused seed (it's a real participant
      // and its variant-level metrics belong on the existing seed row).
      pool: summaryPool,
      matchHistory: result.matchHistory,
      invocationDetails: detailsMap as FinalizationContext['invocationDetails'],
      budgetFloorObservables: result.budgetFloorObservables ? {
        initialAgentCostEstimate: result.budgetFloorObservables.initialAgentCostEstimate,
        actualAvgCostPerAgent: result.budgetFloorObservables.actualAvgCostPerAgent,
        parallelDispatched: result.budgetFloorObservables.parallelDispatched,
        sequentialDispatched: result.budgetFloorObservables.sequentialDispatched,
        medianSequentialGfsaDurationMs,
        avgSequentialGfsaDurationMs,
      } : undefined,
    };

    // Ensure cost metric exists (may have been skipped if iteration loop broke early).
    // Use writeMetricMax (GREATEST upsert) to avoid downgrading a higher value that was
    // written live by createLLMClient during execution (e.g. when parallel agents accumulate
    // more spend than costTracker.getTotalSpent() reflects at finalization time).
    if (result.totalCost != null && !isNaN(result.totalCost)) {
      await writeMetricMax(db, 'run', runId, 'cost' as MetricName, result.totalCost, 'during_execution');
    }

    // Run-level finalization metrics (now with invocationDetails + budgetFloorObservables
    // available, so cost_estimation_* and budget-floor metrics resolve correctly).
    for (const def of getEntity('run').metrics.atFinalization) {
      const metricResult = def.compute(finCtx);
      if (metricResult == null) continue;
      if (isMetricValue(metricResult)) {
        await writeMetric(db, 'run', runId, def.name as MetricName, metricResult.value, 'at_finalization', {
          uncertainty: metricResult.uncertainty ?? undefined,
          ci_lower: metricResult.ci?.[0],
          ci_upper: metricResult.ci?.[1],
          n: metricResult.n,
        });
      } else {
        await writeMetric(db, 'run', runId, def.name as MetricName, metricResult, 'at_finalization');
      }
    }

    if (invocations && invocations.length > 0) {
      const invFinCtx: FinalizationContext = finCtx;
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

    // Variant-level finalization metrics — iterate summaryPool so the reused seed
    // gets its variant metrics updated on its existing arena row.
    for (const v of summaryPool) {
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
      uncertainty: aggregated.uncertainty ?? undefined,
      ci_lower: aggregated.ci?.[0],
      ci_upper: aggregated.ci?.[1],
      n: aggregated.n,
      aggregation_method: def.aggregationMethod as AggregationMethod,
    });
  }
}

/** Snapshot of the reused seed at run-start, used for optimistic-concurrency UPDATE at finalize. */
export interface ReusedSeedSnapshot {
  id: string;
  /** Lossless mu string (Postgres NUMERIC) loaded at resolveContent time. */
  muRaw: string;
  /** Lossless sigma string. */
  sigmaRaw: string;
  /** arena_match_count loaded at run-start; UPDATE WHERE clause includes this to catch concurrent races. */
  arena_match_count: number;
}

/** Sync pipeline results to arena: upsert entries, insert matches, update Elo.
 *
 * `reusedSeedSnapshot`: when set, the run reused a persisted seed variant. Its post-run
 * rating is written back via an optimistic-concurrency UPDATE (separate from the RPC's
 * `p_arena_updates` which would last-writer-wins overwrite a concurrent runner's update).
 * If the WHERE-equality guard fails (another runner wrote between load and finalize), we
 * skip the update and emit the `evolution.seed_rating.collision` log signal. */
export async function syncToArena(
  runId: string,
  promptId: string,
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchHistory: V2Match[],
  supabase: SupabaseClient,
  isSeeded: boolean,
  logger?: EntityLogger,
  reusedSeedSnapshot?: ReusedSeedSnapshot,
): Promise<void> {
  // Compute per-variant match counts from match history
  const variantMatchCounts = new Map<string, number>();
  for (const m of matchHistory) {
    if (m.confidence > 0) {
      variantMatchCounts.set(m.winnerId, (variantMatchCounts.get(m.winnerId) ?? 0) + 1);
      variantMatchCounts.set(m.loserId, (variantMatchCounts.get(m.loserId) ?? 0) + 1);
    }
  }

  // Build entries: variants that need a NEW arena row INSERT.
  // Excludes arena entries (already exist) AND the reused seed (its rating is updated
  // via optimistic-concurrency UPDATE below; an INSERT would create a duplicate row).
  const newEntries = pool
    .filter((v) => !isArenaEntry(v) && !v.reusedFromSeed)
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
        generation_method: isSeeded && isSeedVariantStrategy(v.strategy) ? 'seed' : 'pipeline',
      };
    });

  // Build arena updates: existing arena entries (NOT the reused seed) that participated
  // in matches this run. The reused seed gets its own optimistic-concurrency UPDATE below.
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
  let rpcSucceeded = false;
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
      rpcSucceeded = true;
      break;
    }
    lastError = error;

    if (attempt === 0) {
      logger?.warn('Arena sync retry', { attempt: 1, delay: 2000, phaseName: 'arena' });
      // Wait 2s before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Arena sync is non-critical — log but don't re-throw
  if (!rpcSucceeded && lastError) {
    if (logger) {
      logger.error('Arena sync failed after retry', { error: lastError.message, runId, promptId, entryCount: newEntries.length, phaseName: 'arena' });
    } else {
      serverLogger.warn('sync_to_arena failed after retry', { error: lastError.message, runId, promptId, entryCount: newEntries.length });
    }
  }

  // Optimistic-concurrency UPDATE for the reused seed (separate from the RPC so we can
  // enforce mu=loaded_mu AND sigma=loaded_sigma AND arena_match_count=loaded_match_count).
  // If a concurrent runner wrote between our load and this UPDATE, the WHERE clause
  // mismatches → 0 rows affected → we skip and log; their write wins. Avoids silent
  // last-writer-wins overwrites.
  if (reusedSeedSnapshot) {
    const seedPoolEntry = pool.find((v) => v.id === reusedSeedSnapshot.id && v.reusedFromSeed);
    const matchesThisRun = variantMatchCounts.get(reusedSeedSnapshot.id) ?? 0;
    if (seedPoolEntry && matchesThisRun > 0) {
      const newRating = ratings.get(seedPoolEntry.id) ?? createRating();
      const newDb = ratingToDb(newRating);
      const newArenaMatchCount = reusedSeedSnapshot.arena_match_count + matchesThisRun;
      // Postgres NUMERIC equality is exact; we pass loaded mu/sigma as the lossless
      // string form to avoid JS-float precision loss in the round-trip.
      const { count, error: updateError } = await supabase
        .from('evolution_variants')
        .update({
          mu: newDb.mu,
          sigma: newDb.sigma,
          elo_score: newDb.elo_score,
          arena_match_count: newArenaMatchCount,
        }, { count: 'exact' })
        .eq('id', reusedSeedSnapshot.id)
        .eq('mu', reusedSeedSnapshot.muRaw)
        .eq('sigma', reusedSeedSnapshot.sigmaRaw)
        .eq('arena_match_count', reusedSeedSnapshot.arena_match_count);

      if (updateError) {
        logger?.warn('Reused-seed rating UPDATE failed (non-fatal)', {
          phaseName: 'arena', seedId: reusedSeedSnapshot.id,
          error: updateError.message.slice(0, 500),
        });
      } else if (count === 0) {
        // Optimistic-concurrency collision: another runner updated the row between our load and write.
        // Their rating evidence wins; we surface this so collision frequency can be monitored.
        logger?.warn('evolution.seed_rating.collision: reused-seed UPDATE matched 0 rows; concurrent runner won', {
          phaseName: 'arena', seedId: reusedSeedSnapshot.id,
          loadedMu: reusedSeedSnapshot.muRaw, loadedSigma: reusedSeedSnapshot.sigmaRaw,
          loadedArenaMatchCount: reusedSeedSnapshot.arena_match_count,
          attemptedMu: newDb.mu, attemptedSigma: newDb.sigma,
          attemptedArenaMatchCount: newArenaMatchCount, matchesThisRun,
        });
      } else {
        logger?.info('Reused-seed rating updated', {
          phaseName: 'arena', seedId: reusedSeedSnapshot.id,
          newMu: newDb.mu, newSigma: newDb.sigma, matchesThisRun, newArenaMatchCount,
        });
      }
    }
  }
}
