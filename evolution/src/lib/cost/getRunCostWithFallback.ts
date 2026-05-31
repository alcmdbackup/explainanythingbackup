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
//   2. `evolution_metrics` sum of all 9 per-purpose cost metrics (gen, rank,
//      reflection, seed, evaluation, iterative_edit, proposer_approver_criteria,
//      paragraph_recombine, debate) — catches runs that have per-phase writes
//      but no rollup `cost` row (common for older runs pre-live-write-path).
//      paragraph_recombine_cost + debate_cost added by
//      investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 (Option H).
//   3. 0 with a logger.warn so operators can see completeness gaps.
//
// Layer 3 (`evolution_run_costs` view) was REMOVED by
// investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 (Option G9): the
// view was dropped in `20260323000004_drop_legacy_metrics.sql` and queries against
// it have been erroring silently since. Layers 1+2 now cover all cases.
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
  metricName: 'cost' | 'generation_cost' | 'ranking_cost' | 'reflection_cost' | 'seed_cost'
    | 'evaluation_cost' | 'iterative_edit_cost' | 'proposer_approver_criteria_cost'
    | 'paragraph_recombine_cost' | 'debate_cost',
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

  // Layer 2: sum of all per-purpose cost metrics for runs that have per-phase
  // metric rows but no rollup `cost` row.
  //
  // History:
  // - rename_agents_subagents_evolution_20260508 Phase 6: widened from 4 to 7 metrics.
  // - investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 (Option H):
  //   added paragraph_recombine_cost + debate_cost. Pre-fix, any run whose ONLY cost
  //   came from paragraph_recombine (no top-level `cost` rollup row) under-reported
  //   on the dashboard "Total Cost" tile + runs-list "Spent" column by the full
  //   paragraph_recombine spend. Same fix retroactively covers debate_cost.
  const layer2 = new Map<string, number>();
  if (stillMissing1.length > 0) {
    const perPurposeMetrics = [
      'generation_cost', 'ranking_cost', 'reflection_cost', 'seed_cost',
      'evaluation_cost', 'iterative_edit_cost', 'proposer_approver_criteria_cost',
      'paragraph_recombine_cost', 'debate_cost',
    ] as const;
    const maps = await Promise.all(
      perPurposeMetrics.map((m) => readCostMetrics(db, m, stillMissing1)),
    );
    for (const id of stillMissing1) {
      let sum = 0;
      let anyHit = false;
      for (const m of maps) {
        if (m.has(id)) {
          anyHit = true;
          sum += m.get(id) ?? 0;
        }
      }
      if (anyHit) layer2.set(id, sum);
    }
  }
  const stillMissing2 = stillMissing1.filter(id => !layer2.has(id));

  // Layer 3 (`evolution_run_costs` view) was removed (Option G9) — the view was
  // dropped in 20260323000004_drop_legacy_metrics.sql and queries against it have
  // been erroring silently since. Layers 1+2 now cover all cases. Runs that
  // miss both fall through to 0 with a warn log.

  if (stillMissing2.length > 0) {
    logger.warn('getRunCostsWithFallback: runs with no cost data at any layer', {
      count: stillMissing2.length,
      sample: stillMissing2.slice(0, 5),
    });
  }

  const out = new Map<string, number>();
  for (const id of runIds) {
    out.set(id, layer1.get(id) ?? layer2.get(id) ?? 0);
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
