// Stale metric recomputation with atomic claim-and-clear thundering herd protection.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type EntityType, type MetricRow, type FinalizationContext, type MetricName, isMetricValue } from './types';
import { getEntity } from '../core/entityRegistry';
import { writeMetric } from './writeMetrics';
import { getMetricsForEntities } from './readMetrics';
import { DEFAULT_MU } from '@evolution/lib/shared/computeRatings';
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

  try {
    if (entityType === 'run') {
      await recomputeRunEloMetrics(db, entityId);
    } else if (entityType === 'strategy' || entityType === 'experiment') {
      await recomputeParentEntityMetrics(db, entityType, entityId);
    } else if (entityType === 'invocation') {
      await recomputeInvocationMetrics(db, entityId);
    }
    // Success: stale already cleared by the RPC — no further action needed
  } catch (err) {
    // Re-mark only the specific claimed metrics as stale (not all metrics for this entity).
    // Metrics that were successfully written before the error retain their correct values
    // and stale=false status — only the unfinished ones need retry.
    const claimedNames = (claimed as Array<{ metric_name: string }>).map(r => r.metric_name);
    try {
      await db
        .from('evolution_metrics')
        .update({ stale: true, updated_at: new Date().toISOString() })
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .in('metric_name', claimedNames);
    } catch (_remarErr) {
      // Double-fault: re-mark failed too. Metrics stuck as stale=false but
      // values may be incorrect. Log but don't mask the original error.
    }
    throw err;
  }
}

// Metrics that depend on matchHistory, which is not persisted to DB and cannot be reconstructed.
// These are skipped during stale recomputation to preserve their existing (correct) values.
const MATCH_DEPENDENT_METRICS = new Set(['total_matches', 'decisive_rate']);

async function recomputeRunEloMetrics(db: SupabaseClient, runId: string): Promise<void> {
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
    ratings.set(v.id, {
      mu: Number.isFinite(rawMu) ? rawMu! : DEFAULT_MU,
      sigma: Number.isFinite(rawSigma) ? rawSigma! : DEFAULT_MU / 3,
    });
    pool.push({ id: v.id, text: '', version: 0, parentIds: [], strategy: '', createdAt: 0, iterationBorn: 0 });
  }

  // Read existing totalCost and iterationsRun from metrics table so we don't overwrite with zeros
  const existingMetrics = await getMetricsForEntities(db, 'run', [runId], ['cost', 'total_matches']);
  const runMetrics = existingMetrics.get(runId) ?? [];
  const existingCost = runMetrics.find(m => m.metric_name === 'cost')?.value ?? 0;

  const ctx: FinalizationContext = {
    result: { winner: pool[0]!, pool, ratings, matchHistory: [], totalCost: existingCost, iterationsRun: 0, stopReason: 'iterations_complete', muHistory: [], diversityHistory: [], matchCounts: {} },
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
        sigma: result.sigma ?? undefined,
        ci_lower: result.ci?.[0],
        ci_upper: result.ci?.[1],
        n: result.n,
      });
    } else {
      await writeMetric(db, 'run', runId, def.name as MetricName, result, 'at_finalization');
    }
  }
}

async function recomputeParentEntityMetrics(
  db: SupabaseClient,
  entityType: 'strategy' | 'experiment',
  entityId: string,
): Promise<void> {
  const columnName = entityType === 'strategy' ? 'strategy_id' : 'experiment_id';
  const { data: runs, error: runsError } = await db
    .from('evolution_runs')
    .select('id')
    .eq(columnName, entityId)
    .eq('status', 'completed');
  if (runsError) throw new Error(`Failed to read runs for ${entityType} ${entityId}: ${runsError.message}`);

  if (!runs || runs.length === 0) return;
  await recomputePropagatedMetrics(db, entityType, entityId, runs.map(r => r.id));
}

async function recomputePropagatedMetrics(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  childRunIds: string[],
): Promise<void> {
  const propDefs = getEntity(entityType as import('../core/types').EntityType).metrics.atPropagation;
  if (propDefs.length === 0) return;

  const sourceMetricNames = [...new Set(propDefs.map(d => d.sourceMetric))];
  const runMetrics = await getMetricsForEntities(db, 'run', childRunIds, sourceMetricNames);

  const collect = (name: string) =>
    [...runMetrics.values()].flatMap(ms => ms.filter(m => m.metric_name === name));

  for (const def of propDefs) {
    const sourceRows = collect(def.sourceMetric);
    if (sourceRows.length === 0) continue;
    const aggregated = def.aggregate(sourceRows);
    await writeMetric(db, entityType, entityId, def.name as MetricName, aggregated.value, 'at_propagation', {
      sigma: aggregated.sigma ?? undefined,
      ci_lower: aggregated.ci?.[0],
      ci_upper: aggregated.ci?.[1],
      n: aggregated.n,
      aggregation_method: def.aggregationMethod as import('./types').AggregationMethod,
    });
  }
}

async function recomputeInvocationMetrics(db: SupabaseClient, invocationId: string): Promise<void> {
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
    ratings.set(v.id, { mu: v.mu ?? DEFAULT_MU, sigma: v.sigma ?? DEFAULT_MU / 3 });
    pool.push({ id: v.id, text: '', version: 0, parentIds: [], strategy: '', createdAt: 0, iterationBorn: 0 });
  }

  const detailsMap = new Map([[inv.id, inv.execution_detail]]);
  const ctx: FinalizationContext = {
    result: { winner: pool[0]!, pool, ratings, matchHistory: [], totalCost: 0, iterationsRun: 0, stopReason: 'iterations_complete', muHistory: [], diversityHistory: [], matchCounts: {} },
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
        sigma: result.sigma ?? undefined,
        ci_lower: result.ci?.[0],
        ci_upper: result.ci?.[1],
        n: result.n,
      });
    } else {
      await writeMetric(db, 'invocation', invocationId, def.name as MetricName, result, 'at_finalization');
    }
  }
}
