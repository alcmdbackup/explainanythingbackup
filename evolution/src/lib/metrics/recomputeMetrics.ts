// Stale metric recomputation with atomic claim-and-clear thundering herd protection.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type EntityType, type MetricRow, type FinalizationContext, type MetricName, isMetricValue } from './types';
import { getEntity } from '../core/entityRegistry';
import { writeMetric } from './writeMetrics';
import { getMetricsForEntities } from './readMetrics';
import { dbToRating, _INTERNAL_DEFAULT_MU, _INTERNAL_DEFAULT_SIGMA } from '@evolution/lib/shared/computeRatings';
import type { Rating } from '@evolution/lib/shared/computeRatings';
import type { Variant } from '@evolution/lib/types';

export async function recomputeStaleMetrics(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  staleRows: MetricRow[],
): Promise<void> {
  if (staleRows.length === 0) return;

  // Atomic claim-and-clear: sets stale=false and returns claimed rows.
  // If another request already cleared stale, returns empty — skip recomputation.
  const staleNames = staleRows.map(r => r.metric_name);
  const { data: claimed } = await db.rpc('lock_stale_metrics', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metric_names: staleNames,
  });

  // No rows claimed (another request is recomputing or already finished) — skip
  if (!claimed || (claimed as unknown[]).length === 0) return;

  // B046: track which specific metric names were actually written before any thrown
  // error, so on catch we re-mark ONLY the unpersisted ones. Previously the catch
  // block re-marked every claimed name, which wrongly reverted successfully-written
  // rows back to stale=true on the very next read after recompute.
  const persistedNames = new Set<string>();

  try {
    if (entityType === 'run') {
      await recomputeRunEloMetrics(db, entityId, persistedNames);
    } else if (entityType === 'strategy' || entityType === 'experiment') {
      await recomputeParentEntityMetrics(db, entityType, entityId, persistedNames);
    } else if (entityType === 'invocation') {
      await recomputeInvocationMetrics(db, entityId, persistedNames);
    } else if (entityType === 'tactic') {
      // Tactic metrics recompute from variants directly (not from child entity rows).
      const { data: tactic } = await db.from('evolution_tactics').select('name').eq('id', entityId).single();
      if (tactic) {
        const { computeTacticMetrics } = await import('./computations/tacticMetrics');
        await computeTacticMetrics(db, entityId, tactic.name);
        // `computeTacticMetrics` writes an atomic batch — on success, every tactic
        // metric is persisted. On throw before completion, none are; the SDK doesn't
        // expose partial-batch state, so assume all-or-nothing (re-mark all on throw).
      }
    }
    // Success: stale already cleared by the RPC — no further action needed
  } catch (err) {
    // B046: re-mark ONLY the names that weren't successfully persisted. The ones we
    // did write are already at stale=false with correct values and must not revert.
    const claimedNames = (claimed as Array<{ metric_name: string }>).map(r => r.metric_name);
    const unpersisted = claimedNames.filter((n) => !persistedNames.has(n));
    if (unpersisted.length > 0) {
      try {
        await db
          .from('evolution_metrics')
          .update({ stale: true, updated_at: new Date().toISOString() })
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
          .in('metric_name', unpersisted);
      } catch (_remarErr) {
        // Double-fault: re-mark failed too. Metrics stuck as stale=false but
        // values may be incorrect. Log but don't mask the original error.
      }
    }
    throw err;
  }
}

// Metrics that depend on matchHistory, which is not persisted to DB and cannot be reconstructed.
// These are skipped during stale recomputation to preserve their existing (correct) values.
const MATCH_DEPENDENT_METRICS = new Set(['total_matches', 'decisive_rate']);

async function recomputeRunEloMetrics(db: SupabaseClient, runId: string, persistedNames?: Set<string>): Promise<void> {
  // Read current variant ratings for this run.
  // Filter persisted=true: discarded variants must not enter the recomputed pool.
  const { data: variants, error: variantError } = await db
    .from('evolution_variants')
    .select('id, mu, sigma')
    .eq('run_id', runId)
    .eq('persisted', true);
  if (variantError) throw new Error(`Failed to read variants for run ${runId}: ${variantError.message}`);

  if (!variants || variants.length === 0) return;

  const ratings = new Map<string, Rating>();
  const pool: Variant[] = [];
  for (const v of variants) {
    const rawMu = v.mu as number | null;
    const rawSigma = v.sigma as number | null;
    ratings.set(v.id, dbToRating(
      Number.isFinite(rawMu) ? rawMu! : _INTERNAL_DEFAULT_MU,
      Number.isFinite(rawSigma) ? rawSigma! : _INTERNAL_DEFAULT_SIGMA,
    ));
    pool.push({ id: v.id, text: '', version: 0, parentIds: [], tactic: '', createdAt: 0, iterationBorn: 0 });
  }

  // Read existing totalCost and iterationsRun from metrics table so we don't overwrite with zeros
  // B043: IGNORE — single-run read, chunk errors here are equivalent to missing data.
  const { data: existingMetrics } = await getMetricsForEntities(db, 'run', [runId], ['cost', 'total_matches']);
  const runMetrics = existingMetrics.get(runId) ?? [];
  const existingCost = runMetrics.find(m => m.metric_name === 'cost')?.value ?? 0;

  const ctx: FinalizationContext = {
    result: { winner: pool[0]!, pool, ratings, matchHistory: [], totalCost: existingCost, iterationsRun: 0, stopReason: 'completed', eloHistory: [], diversityHistory: [], matchCounts: {} },
    ratings,
    pool,
    matchHistory: [],
  };

  for (const def of getEntity('run').metrics.atFinalization) {
    // Skip match-dependent metrics — matchHistory is not persisted to DB,
    // so we cannot reconstruct it. Preserve existing values instead of overwriting with zeros.
    if (MATCH_DEPENDENT_METRICS.has(def.name)) continue;

    const result = def.compute(ctx);
    if (result == null) continue;
    if (isMetricValue(result)) {
      await writeMetric(db, 'run', runId, def.name as MetricName, result.value, 'at_finalization', {
        uncertainty: result.uncertainty ?? undefined,
        ci_lower: result.ci?.[0],
        ci_upper: result.ci?.[1],
        n: result.n,
      });
    } else {
      await writeMetric(db, 'run', runId, def.name as MetricName, result, 'at_finalization');
    }
    // B046: record this metric name as persisted so the caller's re-mark-on-error
    // path skips rows that already landed successfully.
    persistedNames?.add(def.name as string);
  }
}

async function recomputeParentEntityMetrics(
  db: SupabaseClient,
  entityType: 'strategy' | 'experiment',
  entityId: string,
  persistedNames?: Set<string>,
): Promise<void> {
  const columnName = entityType === 'strategy' ? 'strategy_id' : 'experiment_id';
  const { data: runs, error: runsError } = await db
    .from('evolution_runs')
    .select('id')
    .eq(columnName, entityId)
    .eq('status', 'completed');
  if (runsError) throw new Error(`Failed to read runs for ${entityType} ${entityId}: ${runsError.message}`);

  if (!runs || runs.length === 0) return;
  await recomputePropagatedMetrics(db, entityType, entityId, runs.map(r => r.id), persistedNames);
}

async function recomputePropagatedMetrics(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  childRunIds: string[],
  persistedNames?: Set<string>,
): Promise<void> {
  const propDefs = getEntity(entityType as import('../core/types').EntityType).metrics.atPropagation;
  if (propDefs.length === 0) return;

  const sourceMetricNames = [...new Set(propDefs.map(d => d.sourceMetric))];
  // B043: LOG — partial chunk failure logged; propagation uses whatever succeeded.
  const { data: runMetrics, errors: readErrors } = await getMetricsForEntities(db, 'run', childRunIds, sourceMetricNames);
  if (readErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[recomputeMetrics] partial read failure for ${entityType}/${entityId}`, { errors: readErrors });
  }

  const collect = (name: string) =>
    [...runMetrics.values()].flatMap(ms => ms.filter(m => m.metric_name === name));

  for (const def of propDefs) {
    const sourceRows = collect(def.sourceMetric);
    if (sourceRows.length === 0) continue;
    const aggregated = def.aggregate(sourceRows);
    await writeMetric(db, entityType, entityId, def.name as MetricName, aggregated.value, 'at_propagation', {
      uncertainty: aggregated.uncertainty ?? undefined,
      ci_lower: aggregated.ci?.[0],
      ci_upper: aggregated.ci?.[1],
      n: aggregated.n,
      aggregation_method: def.aggregationMethod as import('./types').AggregationMethod,
    });
    // B046: record persistence so the caller skips this name on the error-path re-mark.
    persistedNames?.add(def.name as string);
  }
}

async function recomputeInvocationMetrics(db: SupabaseClient, invocationId: string, persistedNames?: Set<string>): Promise<void> {
  // Fetch invocation's execution_detail and parent run's variants
  const { data: inv, error: invError } = await db
    .from('evolution_agent_invocations')
    .select('id, run_id, execution_detail')
    .eq('id', invocationId)
    .single();
  if (invError || !inv) return;

  const { data: variants, error: variantError } = await db
    .from('evolution_variants')
    .select('id, mu, sigma')
    .eq('run_id', inv.run_id)
    .eq('persisted', true);
  if (variantError || !variants || variants.length === 0) return;

  const ratings = new Map<string, Rating>();
  const pool: Variant[] = [];
  for (const v of variants) {
    ratings.set(v.id, dbToRating(v.mu ?? _INTERNAL_DEFAULT_MU, v.sigma ?? _INTERNAL_DEFAULT_SIGMA));
    pool.push({ id: v.id, text: '', version: 0, parentIds: [], tactic: '', createdAt: 0, iterationBorn: 0 });
  }

  const detailsMap = new Map([[inv.id, inv.execution_detail]]);
  const ctx: FinalizationContext = {
    result: { winner: pool[0]!, pool, ratings, matchHistory: [], totalCost: 0, iterationsRun: 0, stopReason: 'completed', eloHistory: [], diversityHistory: [], matchCounts: {} },
    ratings,
    pool,
    matchHistory: [],
    invocationDetails: detailsMap as FinalizationContext['invocationDetails'],
    currentInvocationId: inv.id,
  };

  for (const def of getEntity('invocation').metrics.atFinalization) {
    const result = def.compute(ctx);
    if (result == null) continue;
    if (isMetricValue(result)) {
      await writeMetric(db, 'invocation', invocationId, def.name as MetricName, result.value, 'at_finalization', {
        uncertainty: result.uncertainty ?? undefined,
        ci_lower: result.ci?.[0],
        ci_upper: result.ci?.[1],
        n: result.n,
      });
    } else {
      await writeMetric(db, 'invocation', invocationId, def.name as MetricName, result, 'at_finalization');
    }
    persistedNames?.add(def.name as string);
  }
}
