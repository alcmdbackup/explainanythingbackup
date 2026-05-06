// Read metrics from evolution_metrics table with chunked batch support.
// DB column is `sigma` (not renamed); we rename to `uncertainty` in-place on read.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, MetricRow } from './types';

const CHUNK_SIZE = 100;

/** Rename `sigma` column to `uncertainty` field on raw DB rows. Pass-through if already renamed. */
function renameSigma<T extends Record<string, unknown>>(row: T): T {
  if ('sigma' in row && !('uncertainty' in row)) {
    const { sigma, ...rest } = row;
    return { ...rest, uncertainty: sigma } as unknown as T;
  }
  return row;
}

function renameRows(data: unknown[]): MetricRow[] {
  return (data as Record<string, unknown>[]).map(renameSigma) as MetricRow[];
}

export async function getEntityMetrics(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
): Promise<MetricRow[]> {
  const { data, error } = await db
    .from('evolution_metrics')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  if (error) {
    throw new Error(`Failed to read metrics: ${error.message}`);
  }
  return renameRows(data ?? []);
}

export async function getMetric(
  db: SupabaseClient,
  entityType: EntityType,
  entityId: string,
  metricName: string,
): Promise<MetricRow | null> {
  const { data, error } = await db
    .from('evolution_metrics')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('metric_name', metricName)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read metric: ${error.message}`);
  }
  return data ? (renameSigma(data as Record<string, unknown>) as MetricRow) : null;
}

/**
 * Return shape for {@link getMetricsForEntities}. Previously returned a bare
 * `Map<string, MetricRow[]>` and threw on chunk failure — which silently discarded
 * results from earlier-successful chunks when the caller retried. B043 changes this to
 * a `{data, errors}` tuple so a partial-chunk failure is visible to the caller but
 * doesn't nuke successful data.
 */
export interface MetricsForEntitiesResult {
  data: Map<string, MetricRow[]>;
  errors: Array<{ chunkIndex: number; error: string }>;
}

export async function getMetricsForEntities(
  db: SupabaseClient,
  entityType: EntityType,
  entityIds: string[],
  metricNames: string[],
): Promise<MetricsForEntitiesResult> {
  const result = new Map<string, MetricRow[]>();
  const errors: Array<{ chunkIndex: number; error: string }> = [];
  if (entityIds.length === 0 || metricNames.length === 0) {
    return { data: result, errors };
  }

  // B043: chunk entity IDs to avoid Supabase .in() limits. On a chunk error, record the
  // failure and continue rather than throwing — earlier successful chunks are preserved.
  // Callers decide whether to surface the `errors` array or log-and-ignore.
  let chunkIndex = 0;
  for (let i = 0; i < entityIds.length; i += CHUNK_SIZE) {
    const chunk = entityIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', entityType)
      .in('entity_id', chunk)
      .in('metric_name', metricNames);

    if (error) {
      errors.push({ chunkIndex, error: error.message });
      chunkIndex += 1;
      continue;
    }

    for (const row of renameRows(data ?? [])) {
      const existing = result.get(row.entity_id);
      if (existing) {
        existing.push(row);
      } else {
        result.set(row.entity_id, [row]);
      }
    }
    chunkIndex += 1;
  }

  return { data: result, errors };
}
