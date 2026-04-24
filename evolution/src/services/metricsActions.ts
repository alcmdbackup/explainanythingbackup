'use server';
// Server actions for reading evolution metrics with lazy stale recomputation.

import { z } from 'zod';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { serverReadRequestId } from '@/lib/serverReadRequestId';
import { handleError, type ErrorResponse } from '@/lib/errorHandling';
import { ENTITY_TYPES, type EntityType, type MetricRow } from '@evolution/lib/metrics/types';
import { recomputeStaleMetrics } from '@evolution/lib/metrics/recomputeMetrics';

async function _getEntityMetricsImpl(
  entityType: string,
  entityId: string,
): Promise<{
  success: boolean;
  data: MetricRow[] | null;
  error: ErrorResponse | null;
}> {
  try {
    await requireAdmin();

    const parsed = z.object({
      entityType: z.enum(ENTITY_TYPES),
      entityId: z.string().uuid(),
    }).parse({ entityType, entityId });

    const supabase = await createSupabaseServiceClient();

    const { data: metrics, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', parsed.entityType)
      .eq('entity_id', parsed.entityId);

    if (error) {
      return { success: false, data: null, error: handleError(error, 'getEntityMetrics') };
    }

    // Rename `sigma` DB column to `uncertainty` field on read.
    // DB column is not renamed (CI safety check blocks DDL RENAME); mapping happens in TS.
    const renameSigma = (r: Record<string, unknown>): MetricRow => {
      if ('sigma' in r && !('uncertainty' in r)) {
        const { sigma, ...rest } = r;
        return { ...rest, uncertainty: sigma } as unknown as MetricRow;
      }
      return r as MetricRow;
    };
    const rows = (metrics ?? []).map((r) => renameSigma(r as Record<string, unknown>));
    const staleRows = rows.filter(m => m.stale);

    if (staleRows.length > 0) {
      await recomputeStaleMetrics(supabase, parsed.entityType as EntityType, parsed.entityId, staleRows);
      const { data: fresh, error: freshError } = await supabase
        .from('evolution_metrics')
        .select('*')
        .eq('entity_type', parsed.entityType)
        .eq('entity_id', parsed.entityId);

      if (freshError) {
        return { success: false, data: null, error: handleError(freshError, 'getEntityMetrics:reread') };
      }
      return { success: true, data: (fresh ?? []).map((r) => renameSigma(r as Record<string, unknown>)), error: null };
    }

    return { success: true, data: rows, error: null };
  } catch (err) {
    return { success: false, data: null, error: handleError(err, 'getEntityMetrics') };
  }
}

const _getEntityMetricsAction = withLogging(_getEntityMetricsImpl, 'getEntityMetrics');

export const getEntityMetricsAction = serverReadRequestId(_getEntityMetricsAction);

// ─── Batch fetch for list views ─────────────────────────────────

async function _getBatchMetricsImpl(
  entityType: string,
  entityIds: string[],
  metricNames: string[],
): Promise<{
  success: boolean;
  data: Record<string, MetricRow[]> | null;
  error: ErrorResponse | null;
}> {
  try {
    await requireAdmin();

    const parsedType = z.enum(ENTITY_TYPES).parse(entityType);
    if (entityIds.length === 0 || metricNames.length === 0) {
      return { success: true, data: {}, error: null };
    }

    const supabase = await createSupabaseServiceClient();
    const { getMetricsForEntities } = await import('@evolution/lib/metrics/readMetrics');
    // B043: LOG — surface chunk errors as warnings; earlier-successful chunks are preserved.
    const { data: metricsMap, errors: readErrors } = await getMetricsForEntities(
      supabase, parsedType as EntityType, entityIds, metricNames,
    );
    if (readErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[metricsActions] partial read failure', { errors: readErrors });
    }

    // Check for stale rows per entity and recompute if needed
    const staleEntities: { id: string; staleRows: MetricRow[] }[] = [];
    for (const [id, rows] of metricsMap) {
      const staleRows = rows.filter(m => m.stale);
      if (staleRows.length > 0) staleEntities.push({ id, staleRows });
    }

    if (staleEntities.length > 0) {
      await Promise.all(staleEntities.map(({ id, staleRows }) =>
        recomputeStaleMetrics(supabase, parsedType as EntityType, id, staleRows),
      ));
      // Re-read fresh metrics after recomputation
      const { data: freshMap } = await getMetricsForEntities(
        supabase, parsedType as EntityType, entityIds, metricNames,
      );
      const result: Record<string, MetricRow[]> = {};
      for (const [id, rows] of freshMap) result[id] = rows;
      return { success: true, data: result, error: null };
    }

    const result: Record<string, MetricRow[]> = {};
    for (const [id, rows] of metricsMap) {
      result[id] = rows;
    }

    return { success: true, data: result, error: null };
  } catch (err) {
    return { success: false, data: null, error: handleError(err, 'getBatchMetrics') };
  }
}

const _getBatchMetricsAction = withLogging(_getBatchMetricsImpl, 'getBatchMetrics');

export const getBatchMetricsAction = serverReadRequestId(_getBatchMetricsAction);
