// Compute cross-run tactic metrics from variant data.
// Unlike propagateMetrics() (which aggregates child entity metric rows for strategy/experiment),
// tactic metrics aggregate directly from evolution_variants grouped by agent_name (tactic name).

import type { SupabaseClient } from '@supabase/supabase-js';
import { dbToRating } from '../../shared/computeRatings';

export interface TacticMetricRow {
  entity_type: 'tactic';
  entity_id: string;
  metric_name: string;
  value: number;
  uncertainty?: number | null;
  ci_lower?: number | null;
  ci_upper?: number | null;
  n?: number;
  aggregation_method?: string | null;
  source?: string | null;
}

/**
 * Compute cross-run metrics for a single tactic by querying all completed-run variants
 * with matching agent_name. Writes metrics to evolution_metrics.
 *
 * Requires the tactic's evolution_tactics.id (not the name string).
 */
export async function computeTacticMetrics(
  db: SupabaseClient,
  tacticId: string,
  tacticName: string,
): Promise<void> {
  // Query all variants with this tactic from completed runs
  const { data: variants, error } = await db
    .from('evolution_variants')
    .select('id, mu, sigma, elo_score, cost_usd, run_id, is_winner')
    .eq('agent_name', tacticName)
    .not('run_id', 'is', null);

  if (error || !variants || variants.length === 0) return;

  // Filter to completed runs only — query run statuses in bulk
  const runIds = [...new Set(variants.map((v) => v.run_id as string))];
  const { data: runs } = await db
    .from('evolution_runs')
    .select('id, status')
    .in('id', runIds.slice(0, 100)); // Chunk to avoid PostgREST .in() limits

  if (!runs) return;
  const completedRunIds = new Set(runs.filter((r) => r.status === 'completed').map((r) => r.id));
  const completedVariants = variants.filter((v) => completedRunIds.has(v.run_id));

  if (completedVariants.length === 0) return;

  // Compute metrics
  const elos = completedVariants
    .map((v) => dbToRating(v.mu ?? 25, v.sigma ?? 8.333))
    .map((r) => r.elo);

  const avgElo = elos.reduce((s, e) => s + e, 0) / elos.length;
  const bestElo = Math.max(...elos);
  const totalCost = completedVariants.reduce((s, v) => s + (v.cost_usd ?? 0), 0);
  const winnerCount = completedVariants.filter((v) => v.is_winner).length;

  const rows: TacticMetricRow[] = [
    { entity_type: 'tactic', entity_id: tacticId, metric_name: 'avg_elo', value: avgElo, n: elos.length, aggregation_method: 'avg', source: 'propagation' },
    { entity_type: 'tactic', entity_id: tacticId, metric_name: 'best_elo', value: bestElo, n: 1, aggregation_method: 'max', source: 'propagation' },
    { entity_type: 'tactic', entity_id: tacticId, metric_name: 'total_variants', value: completedVariants.length, n: 1, aggregation_method: 'count', source: 'propagation' },
    { entity_type: 'tactic', entity_id: tacticId, metric_name: 'total_cost', value: totalCost, n: 1, aggregation_method: 'sum', source: 'propagation' },
    { entity_type: 'tactic', entity_id: tacticId, metric_name: 'run_count', value: completedRunIds.size, n: 1, aggregation_method: 'count', source: 'propagation' },
    { entity_type: 'tactic', entity_id: tacticId, metric_name: 'winner_count', value: winnerCount, n: 1, aggregation_method: 'count', source: 'propagation' },
  ];

  // Upsert to evolution_metrics
  const { error: writeError } = await db
    .from('evolution_metrics')
    .upsert(
      rows.map((r) => ({
        ...r,
        stale: false,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'entity_type,entity_id,metric_name' },
    );

  if (writeError) {
    console.warn(`[tacticMetrics] Failed to write metrics for tactic ${tacticName}: ${writeError.message}`);
  }
}

/**
 * Compute tactic metrics for all tactics used in a specific run.
 * Called at run finalization after strategy/experiment propagation.
 */
export async function computeTacticMetricsForRun(
  db: SupabaseClient,
  runId: string,
): Promise<void> {
  // Get distinct tactic names used in this run
  const { data: variants } = await db
    .from('evolution_variants')
    .select('agent_name')
    .eq('run_id', runId)
    .not('agent_name', 'is', null);

  if (!variants) return;
  const tacticNames = [...new Set(variants.map((v) => v.agent_name as string).filter(Boolean))];

  // Look up tactic entity IDs
  for (const name of tacticNames) {
    const { data: tactic } = await db
      .from('evolution_tactics')
      .select('id')
      .eq('name', name)
      .single();

    if (tactic) {
      await computeTacticMetrics(db, tactic.id, name);
    }
    // If no tactic row exists (e.g., sync hasn't run yet), skip silently
  }
}
