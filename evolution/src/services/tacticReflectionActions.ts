// Mid-run live aggregate of recent tactic ELO performance, used by the
// ReflectAndGenerateFromPreviousArticleAgent's reflection prompt to give the LLM
// data-driven signal about which tactics tend to work for this prompt.
//
// Phase 4 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
//
// Two-trip query strategy:
//   Trip 1: live aggregate over evolution_variants joined to evolution_runs +
//           evolution_strategies (status='completed', is_test_content=false,
//           prompt_id=<run's prompt>), grouped by agent_name (= tactic name).
//           Compute mean(elo_score - 1200) per tactic. Tactics with n<3 in this
//           prompt's history fall through to Trip 2.
//   Trip 2: read pre-aggregated `avg_elo_delta` rows from evolution_metrics
//           (entity_type='tactic') for global tactic-quality fallback.
//
// is_test_content lives on evolution_strategies (NOT evolution_runs), so the
// inner-join filter goes through the strategies table. See evolution/src/services/shared.ts
// for the canonical applyNonTestStrategyFilter helper pattern.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLogger } from '../lib/pipeline/infra/createEntityLogger';
import { getMetricsForEntities } from '../lib/metrics/readMetrics';

/** Minimum samples in this prompt's history before we trust the live aggregate. */
const MIN_SAMPLES_PER_TACTIC = 3;

/** Baseline Elo all variants start at; ELO delta is computed against this. */
const BASELINE_ELO = 1200;

interface VariantRow {
  agent_name: string | null;
  elo_score: number | null;
}

/**
 * Compute recent ELO deltas per tactic for a given prompt.
 *
 * @returns Map keyed by tactic name. Value is mean(elo_score - 1200) across recent
 *          completed-run variants for this prompt (or globally as fallback), or
 *          `null` if no data is available for that tactic.
 */
export async function getTacticEloBoostsForReflection(
  db: SupabaseClient,
  promptId: string,
  tacticNames: ReadonlyArray<string>,
  logger?: EntityLogger,
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  for (const name of tacticNames) result.set(name, null);

  // Trip 1: live aggregate scoped to this prompt + non-test runs.
  const localStats = new Map<string, { sum: number; count: number }>();
  try {
    const { data, error } = await db
      .from('evolution_variants')
      .select(`
        agent_name,
        elo_score,
        evolution_runs!inner(
          status,
          prompt_id,
          evolution_strategies!inner(is_test_content)
        )
      `)
      .eq('evolution_runs.status', 'completed')
      .eq('evolution_runs.prompt_id', promptId)
      .eq('evolution_runs.evolution_strategies.is_test_content', false)
      .not('agent_name', 'is', null);

    if (error) {
      logger?.warn('tacticReflection: live ELO aggregate query failed', {
        phaseName: 'reflection_prep',
        error: error.message,
      });
    } else {
      for (const row of (data ?? []) as VariantRow[]) {
        if (row.agent_name == null || row.elo_score == null) continue;
        const delta = row.elo_score - BASELINE_ELO;
        const existing = localStats.get(row.agent_name) ?? { sum: 0, count: 0 };
        existing.sum += delta;
        existing.count += 1;
        localStats.set(row.agent_name, existing);
      }
    }
  } catch (err) {
    logger?.warn('tacticReflection: live ELO aggregate threw', {
      phaseName: 'reflection_prep',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Apply local stats with sufficient sample size.
  const tacticsNeedingFallback: string[] = [];
  for (const tactic of tacticNames) {
    const stats = localStats.get(tactic);
    if (stats && stats.count >= MIN_SAMPLES_PER_TACTIC) {
      result.set(tactic, stats.sum / stats.count);
    } else {
      tacticsNeedingFallback.push(tactic);
    }
  }

  if (tacticsNeedingFallback.length === 0) return result;

  // Trip 2: global avg_elo_delta from evolution_metrics for tactics with insufficient
  // local data. Need to map tactic-name → tactic-id (UUIDs) for the metrics lookup.
  try {
    const { data: tacticRows, error: tacticErr } = await db
      .from('evolution_tactics')
      .select('id, name')
      .in('name', tacticsNeedingFallback);

    if (tacticErr) {
      logger?.warn('tacticReflection: tactic-id lookup failed', {
        phaseName: 'reflection_prep',
        error: tacticErr.message,
      });
      return result;
    }

    const idToName = new Map<string, string>();
    const tacticIds: string[] = [];
    for (const row of (tacticRows ?? []) as Array<{ id: string; name: string }>) {
      idToName.set(row.id, row.name);
      tacticIds.push(row.id);
    }
    if (tacticIds.length === 0) return result;

    const metricsResult = await getMetricsForEntities(db, 'tactic', tacticIds, ['avg_elo_delta']);
    if (metricsResult.errors.length > 0) {
      logger?.warn('tacticReflection: metrics fetch had partial errors', {
        phaseName: 'reflection_prep',
        errors: metricsResult.errors.map((e) => e.error).slice(0, 3),
      });
    }

    for (const [tacticId, rows] of metricsResult.data) {
      const tacticName = idToName.get(tacticId);
      if (!tacticName) continue;
      const avgEloDelta = rows.find((r) => r.metric_name === 'avg_elo_delta');
      if (avgEloDelta && Number.isFinite(avgEloDelta.value)) {
        // Only set if we don't already have a local value (defensive — local check above
        // already excluded tactics with sufficient samples, so this is just for partial-stats tactics).
        if (result.get(tacticName) === null) {
          result.set(tacticName, avgEloDelta.value);
        }
      }
    }
  } catch (err) {
    logger?.warn('tacticReflection: global fallback threw', {
      phaseName: 'reflection_prep',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
