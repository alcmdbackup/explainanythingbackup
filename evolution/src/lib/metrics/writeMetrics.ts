// UPSERT metrics to evolution_metrics table with timing validation. Throws on failure.

import type { SupabaseClient } from '@supabase/supabase-js';
import { METRIC_REGISTRY, getAllMetricDefs } from './registry';
import type { MetricName, MetricTiming, EntityType, AggregationMethod, EntityMetricRegistry } from './types';
import { DYNAMIC_METRIC_PREFIXES } from './types';

export interface WriteMetricOpts {
  uncertainty?: number;
  ci_lower?: number;
  ci_upper?: number;
  n?: number;
  origin_entity_type?: string;
  origin_entity_id?: string;
  aggregation_method?: AggregationMethod;
  source?: string;
}

interface MetricRowInput {
  entity_type: EntityType;
  entity_id: string;
  metric_name: string;
  value: number;
  uncertainty?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
  n?: number;
  origin_entity_type?: string | null;
  origin_entity_id?: string | null;
  aggregation_method?: string | null;
  source?: string | null;
}

const TIMING_TO_PHASE: Record<MetricTiming, keyof EntityMetricRegistry> = {
  during_execution: 'duringExecution',
  at_finalization: 'atFinalization',
  at_propagation: 'atPropagation',
};

function validateTiming(rows: MetricRowInput[], timing: MetricTiming): void {
  for (const row of rows) {
    const entityType = row.entity_type as EntityType;
    const registry = METRIC_REGISTRY[entityType];
    const phase = TIMING_TO_PHASE[timing];
    const allowedDefs = registry[phase];
    const isDynamic = DYNAMIC_METRIC_PREFIXES.some(p => row.metric_name.startsWith(p));

    if (!isDynamic && !allowedDefs.some(d => d.name === row.metric_name)) {
      const allDefs = getAllMetricDefs(entityType);
      const found = allDefs.find(d => d.name === row.metric_name);
      if (found) {
        throw new Error(
          `Metric '${row.metric_name}' belongs to a different phase but writeMetrics was called with '${timing}'`,
        );
      }
      throw new Error(`Unknown metric '${row.metric_name}' for entity '${entityType}'`);
    }
  }
}

export async function writeMetrics(
  db: SupabaseClient,
  rows: MetricRowInput[],
  timing: MetricTiming,
): Promise<void> {
  if (rows.length === 0) return;
  validateTiming(rows, timing);

  // DB column is named `sigma` (not renamed due to CI safety check).
  // Application layer exposes this as `uncertainty`; we map at the query boundary.
  const upsertRows = rows.map(r => ({
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    metric_name: r.metric_name,
    value: r.value,
    sigma: r.uncertainty ?? null,
    ci_lower: r.ci_lower ?? null,
    ci_upper: r.ci_upper ?? null,
    n: r.n ?? 1,
    origin_entity_type: r.origin_entity_type ?? null,
    origin_entity_id: r.origin_entity_id ?? null,
    aggregation_method: r.aggregation_method ?? null,
    source: r.source ?? timing,
    stale: false,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from('evolution_metrics')
    .upsert(upsertRows, { onConflict: 'entity_type,entity_id,metric_name' });

  if (error) {
    throw new Error(`Failed to write metrics: ${error.message}`);
  }
}

export async function writeMetric(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  metricName: MetricName,
  value: number,
  timing: MetricTiming,
  opts?: WriteMetricOpts,
): Promise<void> {
  if (!Number.isFinite(value)) {
    throw new Error(`writeMetric: value must be finite, got ${value} for metric '${metricName}' on ${entityType}/${entityId}`);
  }
  await writeMetrics(db, [{
    entity_type: entityType,
    entity_id: entityId,
    metric_name: metricName,
    value,
    uncertainty: opts?.uncertainty,
    ci_lower: opts?.ci_lower,
    ci_upper: opts?.ci_upper,
    n: opts?.n,
    origin_entity_type: opts?.origin_entity_type,
    origin_entity_id: opts?.origin_entity_id,
    aggregation_method: opts?.aggregation_method,
    source: opts?.source,
  }], timing);
}

/**
 * Race-fixed upsert for monotonically-increasing metrics. Calls the `upsert_metric_max`
 * Postgres RPC which uses ON CONFLICT DO UPDATE SET value = GREATEST(...) so concurrent
 * out-of-order writes can never overwrite a larger value with a smaller one.
 *
 * Validates timing the same way `writeMetric` does — the metric must be declared in the
 * appropriate phase of `METRIC_REGISTRY` for its entity type.
 */
export async function writeMetricMax(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  metricName: MetricName,
  value: number,
  timing: MetricTiming,
): Promise<void> {
  if (!Number.isFinite(value)) {
    throw new Error(`writeMetricMax: value must be finite, got ${value} for metric '${metricName}' on ${entityType}/${entityId}`);
  }
  validateTiming([{
    entity_type: entityType,
    entity_id: entityId,
    metric_name: metricName,
    value,
  }], timing);

  const { error } = await db.rpc('upsert_metric_max', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metric_name: metricName,
    p_value: value,
    p_source: timing,
  });

  if (error) {
    throw new Error(`Failed to write max metric '${metricName}': ${error.message}`);
  }
}
