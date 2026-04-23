// Shared helper for "cost per run" lookups with a layered fallback chain.
//
// B1 trace finding (use_playwright_find_bugs_ux_issues_20260422, 2026-04-23):
// When the dashboard's "Hide test content" filter is off, the run-id list
// grows past ~300 entries, which blows past PostgREST's ~8 KB URL length
// limit on a single `.in('entity_id', runIds)` clause. The query silently
// returns an empty row set, the dashboard's existing fallback to
// `evolution_run_costs` uses the same `.in()` clause against the same list
// and hits the same limit, and the final SUM comes out as $0.00 — even
// though 60 production runs contribute ~$2.22. Chunking the id list into
// batches of CHUNK_SIZE resolves the URL-length issue; the per-run chain
// below then resolves the cost-metric-completeness issue (B2).
//
// Layers (in order, per run):
//   1. `evolution_metrics` row with metric_name='cost' — primary.
//   2. `evolution_metrics` sum of `generation_cost + ranking_cost + seed_cost`
//      — catches runs that have per-phase cost writes but no rollup `cost` row
//      (the common case for older runs before `cost` was added to the
//      live-write path).
//   3. `evolution_run_costs` view — SUM of `evolution_agent_invocations.cost_usd`
//      per run. The authoritative last-resort source.
//   4. 0 with a logger.warn so operators can see completeness gaps.
//
// Used by:
//   - evolution/src/components/evolution/tables/RunsTable.tsx (runs list "Spent" column)
//   - evolution/src/services/evolutionVisualizationActions.ts (dashboard Total Cost)
//
// Tests (integration): src/__tests__/integration/evolution-cost-aggregation.integration.test.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/server_utilities';

/** PostgREST URL length limit forces us to chunk `.in()` clauses on large run-id lists.
 *  Matches the pattern in evolution/src/lib/metrics/readMetrics.ts. */
const CHUNK_SIZE = 100;

async function readCostMetrics(
  db: SupabaseClient,
  metricName: 'cost' | 'generation_cost' | 'ranking_cost' | 'seed_cost',
  runIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < runIds.length; i += CHUNK_SIZE) {
    const chunk = runIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db
      .from('evolution_metrics')
      .select('entity_id, value')
      .eq('entity_type', 'run')
      .eq('metric_name', metricName)
      .in('entity_id', chunk);
    if (error) {
      logger.warn('getRunCostsWithFallback: metric query failed', {
        metric: metricName, chunkSize: chunk.length, error: error.message,
      });
      continue;
    }
    for (const row of data ?? []) {
      const v = Number((row as { value: unknown }).value);
      if (Number.isFinite(v)) out.set(row.entity_id as string, v);
    }
  }
  return out;
}

async function readInvocationSums(db: SupabaseClient, runIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < runIds.length; i += CHUNK_SIZE) {
    const chunk = runIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db
      .from('evolution_run_costs')
      .select('run_id, total_cost_usd')
      .in('run_id', chunk);
    if (error) {
      logger.warn('getRunCostsWithFallback: invocation view query failed', {
        chunkSize: chunk.length, error: error.message,
      });
      continue;
    }
    for (const row of data ?? []) {
      const v = Number((row as { total_cost_usd: unknown }).total_cost_usd);
      if (Number.isFinite(v)) out.set(row.run_id as string, v);
    }
  }
  return out;
}

/**
 * Return a Map<runId, costUsd> covering every requested runId. Each missing
 * layer falls through to the next; runs not found at any layer get 0 with
 * a warn log.
 */
export async function getRunCostsWithFallback(
  runIds: string[],
  db: SupabaseClient,
): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();

  // Layer 1: cost metric rows.
  const layer1 = await readCostMetrics(db, 'cost', runIds);
  const stillMissing1 = runIds.filter(id => !layer1.has(id));

  // Layer 2 (NEW): sum of gen+rank+seed cost metrics for runs that have
  // per-phase metric rows but no rollup `cost` row.
  const layer2 = new Map<string, number>();
  if (stillMissing1.length > 0) {
    const [gen, rank, seed] = await Promise.all([
      readCostMetrics(db, 'generation_cost', stillMissing1),
      readCostMetrics(db, 'ranking_cost', stillMissing1),
      readCostMetrics(db, 'seed_cost', stillMissing1),
    ]);
    for (const id of stillMissing1) {
      const sum = (gen.get(id) ?? 0) + (rank.get(id) ?? 0) + (seed.get(id) ?? 0);
      if (gen.has(id) || rank.has(id) || seed.has(id)) layer2.set(id, sum);
    }
  }
  const stillMissing2 = stillMissing1.filter(id => !layer2.has(id));

  // Layer 3: evolution_run_costs view (SUM from evolution_agent_invocations).
  const layer3 = stillMissing2.length > 0 ? await readInvocationSums(db, stillMissing2) : new Map<string, number>();
  const stillMissing3 = stillMissing2.filter(id => !layer3.has(id));

  if (stillMissing3.length > 0) {
    logger.warn('getRunCostsWithFallback: runs with no cost data at any layer', {
      count: stillMissing3.length,
      sample: stillMissing3.slice(0, 5),
    });
  }

  const out = new Map<string, number>();
  for (const id of runIds) {
    out.set(id, layer1.get(id) ?? layer2.get(id) ?? layer3.get(id) ?? 0);
  }
  return out;
}

/** Convenience: sum of all per-run costs from getRunCostsWithFallback. */
export async function getTotalCostWithFallback(
  runIds: string[],
  db: SupabaseClient,
): Promise<number> {
  const map = await getRunCostsWithFallback(runIds, db);
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}
