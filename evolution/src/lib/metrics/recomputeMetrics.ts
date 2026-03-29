// Stale metric recomputation with SELECT FOR UPDATE SKIP LOCKED thundering herd protection.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, MetricRow, FinalizationContext, MetricName } from './types';
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

  // Acquire row-level lock — SKIP LOCKED means concurrent readers skip recomputation
  const staleNames = staleRows.map(r => r.metric_name);
  const { data: locked } = await db.rpc('lock_stale_metrics', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metric_names: staleNames,
  });

  // If no rows locked (another request is recomputing), skip
  if (!locked || (locked as unknown[]).length === 0) return;

  try {
    if (entityType === 'run') {
      await recomputeRunEloMetrics(db, entityId);
    } else if (entityType === 'strategy') {
      await recomputeStrategyMetrics(db, entityId);
    } else if (entityType === 'experiment') {
      await recomputeExperimentMetrics(db, entityId);
    }
  } finally {
    // Clear stale flags for the metrics we locked
    await db
      .from('evolution_metrics')
      .update({ stale: false, updated_at: new Date().toISOString() })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .in('metric_name', staleNames);
  }
}

async function recomputeRunEloMetrics(db: SupabaseClient, runId: string): Promise<void> {
  // Read current variant ratings for this run
  const { data: variants, error: variantError } = await db
    .from('evolution_variants')
    .select('id, mu, sigma')
    .eq('run_id', runId);
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

  // Recompute elo metrics using finalization compute functions
  const ctx: FinalizationContext = {
    result: { winner: pool[0]!, pool, ratings, matchHistory: [], totalCost: 0, iterationsRun: 0, stopReason: 'iterations_complete', muHistory: [], diversityHistory: [], matchCounts: {} },
    ratings,
    pool,
    matchHistory: [],
  };

  for (const def of getEntity('run').metrics.atFinalization) {
    const value = def.compute(ctx);
    if (value != null) {
      await writeMetric(db, 'run', runId, def.name as MetricName, value, 'at_finalization');
    }
  }
}

async function recomputeStrategyMetrics(db: SupabaseClient, strategyId: string): Promise<void> {
  // Get all completed run IDs for this strategy
  const { data: runs, error: runsError } = await db
    .from('evolution_runs')
    .select('id')
    .eq('strategy_id', strategyId)
    .eq('status', 'completed');
  if (runsError) throw new Error(`Failed to read runs for strategy ${strategyId}: ${runsError.message}`);

  if (!runs || runs.length === 0) return;
  const runIds = runs.map(r => r.id);

  await recomputePropagatedMetrics(db, 'strategy', strategyId, runIds);
}

async function recomputeExperimentMetrics(db: SupabaseClient, experimentId: string): Promise<void> {
  const { data: runs, error: runsError } = await db
    .from('evolution_runs')
    .select('id')
    .eq('experiment_id', experimentId)
    .eq('status', 'completed');
  if (runsError) throw new Error(`Failed to read runs for experiment ${experimentId}: ${runsError.message}`);

  if (!runs || runs.length === 0) return;
  const runIds = runs.map(r => r.id);

  await recomputePropagatedMetrics(db, 'experiment', experimentId, runIds);
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
      ci_lower: aggregated.ci?.[0],
      ci_upper: aggregated.ci?.[1],
      n: aggregated.n,
      aggregation_method: def.aggregationMethod as import('./types').AggregationMethod,
    });
  }
}
