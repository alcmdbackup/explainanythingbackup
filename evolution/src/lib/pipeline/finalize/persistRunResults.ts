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

/** True if `tactic` denotes the seed variant — accepts both new and legacy names for back-compat. */
function isSeedVariantTactic(tactic: string | undefined): boolean {
  return tactic === SEED_VARIANT_STRATEGY || tactic === LEGACY_BASELINE_STRATEGY;
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

  // Phase 4b: populate per-variant uncertainty on topVariants (direct from rating, Elo-scale).
  const topVariants = sorted.map((s) => {
    const r = ratings.get(s.v.id);
    return {
      id: s.v.id,
      tactic: s.v.tactic,
      elo: s.elo,
      ...(r && Number.isFinite(r.uncertainty) ? { uncertainty: r.uncertainty } : {}),
      isSeedVariant: isSeedVariantTactic(s.v.tactic),
    };
  });

  // Seed variant is no longer in the pool (decoupled in Phase 2), so rank/elo are null.

  // Tactic effectiveness with Welford M2 (Phase 4b): tracks count + avgElo (online mean)
  // AND M2 (sum of squared deviations from mean), which lets us emit
  // seAvgElo = sqrt(M2 / (n*(n-1))) — the standard error of the mean Elo across variants
  // in this tactic bucket. NOT per-variant rating uncertainty; it's the spread of variant
  // Elos in this bucket (labelled as such in UI tooltips).
  type StrategyAccum = { count: number; avgElo: number; m2: number };
  const accum = pool.reduce<Record<string, StrategyAccum>>((acc, v) => {
    const elo = ratings.get(v.id)?.elo ?? DEFAULT_ELO;
    const prev = acc[v.tactic];
    if (prev) {
      const newCount = prev.count + 1;
      const delta = elo - prev.avgElo;
      const newAvg = prev.avgElo + delta / newCount;
      const delta2 = elo - newAvg;
      acc[v.tactic] = { count: newCount, avgElo: newAvg, m2: prev.m2 + delta * delta2 };
    } else {
      acc[v.tactic] = { count: 1, avgElo: elo, m2: 0 };
    }
    return acc;
  }, {});
  const tacticEffectiveness: Record<string, { count: number; avgElo: number; seAvgElo?: number }> = {};
  for (const [strat, a] of Object.entries(accum)) {
    if (a.count >= 2) {
      const variance = a.m2 / (a.count - 1); // sample variance
      const seAvgElo = Math.sqrt(variance / a.count); // SE of the mean
      tacticEffectiveness[strat] = { count: a.count, avgElo: a.avgElo, seAvgElo };
    } else {
      tacticEffectiveness[strat] = { count: a.count, avgElo: a.avgElo };
    }
  }

  return {
    version: 3,
    stopReason: result.stopReason,
    finalPhase: 'COMPETITION',
    totalIterations: result.iterationsRun,
    durationSeconds,
    eloHistory: result.eloHistory,
    ...(result.uncertaintyHistory ? { uncertaintyHistory: result.uncertaintyHistory } : {}),
    diversityHistory: result.diversityHistory,
    matchStats: { totalMatches, avgConfidence, decisiveRate },
    topVariants,
    seedVariantRank: null,
    seedVariantElo: null,
    tacticEffectiveness,
    metaFeedback: null,
    ...(result.budgetFloorConfig ? { budgetFloorConfig: result.budgetFloorConfig } : {}),
  };
}

/** Persist V2 results in V1-compatible format: run_summary, variants, tactic aggregates. */
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
  // Excludes arena entries (those are reference points, already persisted elsewhere).
  // Seed variant is no longer in the pool (decoupled in Phase 2).
  const summaryPool = result.pool.filter((v) => !v.fromArena);
  // localPool: variants that need a NEW evolution_variants INSERT this run.
  // Excludes arena entries (which already have DB rows).
  const localPool = result.pool.filter((v) => !v.fromArena);

  if (localPool.length === 0) {
    if (result.pool.length > 0) {
      logger?.info('Arena-only pool: marking as completed', { phaseName: 'finalize', arenaPoolSize: result.pool.length, localPoolSize: 0 });
      // B008-S1: pass FILTERED result (arena-only branch was passing raw `result` whose
      // pool still includes arena entries — topVariants/tacticEffectiveness were
      // contaminated with arena rows). Build the summary from a result with the same
      // arena filter as the main path.
      const arenaOnlyResult = { ...result, pool: result.pool.filter((v) => !v.fromArena) };
      const arenaOnlySummary = buildRunSummary(arenaOnlyResult, durationSeconds);
      arenaOnlySummary.stopReason = 'arena_only';
      // B004-S1: explicitly set error_code: null on success path to assert race-freedom
      // contract (markRunFailed checks `.is('error_code', null)` and would no-op if we
      // already set it).
      await db.from('evolution_runs').update({
        status: 'completed', completed_at: new Date().toISOString(),
        run_summary: arenaOnlySummary, error_code: null,
      }).eq('id', runId);
    } else {
      logger?.error('Finalization failed: empty pool', { phaseName: 'finalize' });
      // B004-S1: set explicit error_code so subsequent markRunFailed (with .is('error_code',
      // null) predicate) is a no-op rather than overwriting our specific error.
      await db.from('evolution_runs').update({
        status: 'failed', error_message: 'Finalization failed: empty pool',
        error_code: 'finalize_empty_pool', completed_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    return;
  }

  // Step 1: Build run summary using summaryPool and validate.
  const filteredResult = { ...result, pool: summaryPool };
  const runSummary = buildRunSummary(filteredResult, durationSeconds);
  EvolutionRunSummaryV3Schema.parse(runSummary);
  logger?.info('Tactic effectiveness computed', { tacticEffectiveness: (runSummary as Record<string, unknown>).tacticEffectiveness, phaseName: 'finalize' });

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
      generation: v.iterationBorn,
      // Use truthy check ('' is not a valid UUID — coerce to null for seed-less explanation runs).
      parent_variant_id: v.parentIds[0] || null,
      agent_name: v.tactic,
      match_count: result.matchCounts[v.id] ?? 0,
      is_winner: v.id === winnerId,
      prompt_id: run.prompt_id ?? null,
      persisted: true,
      agent_invocation_id: v.agentInvocationId ?? null,
      criteria_set_used: v.criteriaSetUsed ? [...v.criteriaSetUsed] : null,
      weakest_criteria_ids: v.weakestCriteriaIds ? [...v.weakestCriteriaIds] : null,
    });
  });

  const discardedLocalRatings = result.discardedLocalRatings ?? new Map();
  const discardedRows = (result.discardedVariants ?? [])
    .filter((v) => !v.fromArena)
    .map((v) => {
      // Discarded variants persist with their local-rank ELO (from binary-search ranking
      // against a cloned local pool) when available. This removes survivorship bias from
      // Phase 3/5 metrics — child.elo - parent.elo is meaningful for discards too.
      // On early-exit paths (generation_failed, format-invalid, budget) where ranking
      // never ran, fall back to defaults.
      const localRating = discardedLocalRatings.get(v.id);
      const db = ratingToDb(localRating ?? createRating());
      return evolutionVariantInsertSchema.parse({
        id: v.id,
        run_id: runId,
        explanation_id: run.explanation_id ?? null,
        variant_content: v.text,
        elo_score: db.elo_score,
        mu: db.mu,
        sigma: db.sigma,
        generation: v.iterationBorn,
        // Use truthy check ('' is not a valid UUID — coerce to null for seed-less explanation runs).
        parent_variant_id: v.parentIds[0] || null,
        agent_name: v.tactic,
        match_count: 0,
        is_winner: false,
        prompt_id: run.prompt_id ?? null,
        persisted: false,
        agent_invocation_id: v.agentInvocationId ?? null,
        criteria_set_used: v.criteriaSetUsed ? [...v.criteriaSetUsed] : null,
        weakest_criteria_ids: v.weakestCriteriaIds ? [...v.weakestCriteriaIds] : null,
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

    // Sequential GFSA durations: iteration >= 2 AND agent_name='generate_from_previous_article'
    // (iteration 1 is the parallel batch; later iterations are the sequential fallback path).
    const sequentialGfsaDurations: number[] = ((invocations ?? []) as Array<{
      agent_name?: string; iteration?: number; duration_ms?: number | null;
    }>)
      .filter((inv) =>
        inv.agent_name === 'generate_from_previous_article' &&
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
      // summaryPool — metric loops iterate all non-arena pool members.
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

    // Variant-level finalization metrics.
    // B009-S2: enrich missing v.costUsd from invocation rows. Many code paths (arena
    // entries, MergeRatingsAgent variants, discarded variants where the agent didn't
    // populate costUsd before throwing) leave the in-memory variant.costUsd undefined,
    // silently dropping per-variant cost rollups. The agent_invocation_id FK on
    // evolution_variants (migration 20260418000003) gives us a direct lookup; fall back
    // to summing matching invocation cost_usd by run+iteration when FK is null on
    // legacy rows.
    const invByVariant = new Map<string, number>();
    if (invocations && invocations.length > 0) {
      // Pull agent_invocation_id from variants persisted earlier in this finalize call
      // so we can map invocation cost back to variant. Cheap single SELECT.
      const { data: variantRows } = await db
        .from('evolution_variants')
        .select('id, agent_invocation_id, cost_usd')
        .eq('run_id', runId);
      for (const row of (variantRows ?? []) as Array<{ id: string; agent_invocation_id?: string | null; cost_usd?: number | null }>) {
        // First preference: variant.cost_usd if set (canonical).
        if (typeof row.cost_usd === 'number' && Number.isFinite(row.cost_usd)) {
          invByVariant.set(row.id, row.cost_usd);
          continue;
        }
        // Fallback: invocation cost_usd via FK.
        if (row.agent_invocation_id) {
          const inv = (invocations as Array<{ id: string; cost_usd?: number | null }>).find((i) => i.id === row.agent_invocation_id);
          if (inv && typeof inv.cost_usd === 'number' && Number.isFinite(inv.cost_usd)) {
            invByVariant.set(row.id, inv.cost_usd);
          }
        }
      }
    }
    for (const v of summaryPool) {
      const enrichedCost = v.costUsd ?? invByVariant.get(v.id) ?? null;
      const varCtx: FinalizationContext = { ...finCtx, currentVariantCost: enrichedCost };
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

    // Propagation: tactic metrics (cross-run, variant-level aggregation — separate from strategy/experiment)
    const { computeTacticMetricsForRun } = await import('../../metrics/computations/tacticMetrics');
    await computeTacticMetricsForRun(db, runId);

    // Propagation: criteria metrics (cross-run, variant-level aggregation —
    // for variants tagged via criteria_set_used / weakest_criteria_ids by the
    // EvaluateCriteriaThenGenerateFromPreviousArticleAgent wrapper).
    const { computeCriteriaMetricsForRun } = await import('../../metrics/computations/criteriaMetrics');
    await computeCriteriaMetricsForRun(db, runId);
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

  // Step 5b: Phase 5 attribution metrics (Blocker 2 fix — track_tactic_effectiveness_evolution_20260422).
  // Writes eloAttrDelta:<agent>:<dim> + eloAttrDeltaHist:<agent>:<dim>:<bucket> rows at run,
  // strategy, and experiment levels. Deliberately placed OUTSIDE the main metrics try/catch so
  // upstream metric-write failures (caught above as a single WARN) don't suppress attribution
  // emission. Gated by EVOLUTION_EMIT_ATTRIBUTION_METRICS (default 'true') so ops can disable
  // without a revert PR if a regression surfaces. Has its own try/catch so attribution failures
  // are non-fatal w.r.t. the rest of finalize (Step 6 auto-completion, run.status update).
  if (process.env.EVOLUTION_EMIT_ATTRIBUTION_METRICS !== 'false') {
    try {
      const { computeRunMetrics } = await import('../../metrics/experimentMetrics');
      // Cast: experimentMetrics uses a minimal local SupabaseClient interface for
      // test-friendliness; the production SupabaseClient satisfies the chainable shape
      // at runtime but the structural types don't line up in TS.
      type ComputeRunMetricsFn = Parameters<typeof computeRunMetrics>[1];
      await computeRunMetrics(runId, db as unknown as ComputeRunMetricsFn, {
        strategyId: run.strategy_id ?? undefined,
        experimentId: run.experiment_id ?? undefined,
      });
    } catch (attrErr) {
      logger?.warn('Attribution metric emission failed (non-fatal)', {
        phaseName: 'finalize',
        runId,
        error: (attrErr instanceof Error ? attrErr.message : String(attrErr)).slice(0, 500),
      });
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
  // B043: LOG — partial chunk failure is logged; propagation uses whatever succeeded.
  const { data: runMetrics, errors: readErrors } = await getMetricsForEntities(db, 'run', childRunIds, sourceMetricNames);
  if (readErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[persistRunResults] partial metrics-read during propagation', { entityType, entityId, errors: readErrors });
  }
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

/** Sync pipeline results to arena: upsert entries, insert matches, update Elo.
 *
 * Seed variant is persisted in pre-iteration setup (claimAndExecuteRun) and is NOT
 * in the pool, so no special seed handling is needed here. */
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

  // Build entries: variants that need a NEW arena row INSERT.
  // Excludes arena entries (already exist).
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
        generation_method: isSeeded && isSeedVariantTactic(v.tactic) ? 'seed' : 'pipeline',
      };
    });

  // Build arena updates: existing arena entries that participated in matches this run.
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
}
