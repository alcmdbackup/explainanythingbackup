// Compute cross-run criteria metrics from variant + execution_detail data.
// Aggregates directly from evolution_variants (criteria_set_used,
// weakest_criteria_ids columns) plus evolution_agent_invocations.execution_detail
// for per-criteria scores. Mirrors the pattern of computeTacticMetricsForRun.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dbToRating } from '../../shared/computeRatings';

const DEFAULT_ELO = 1200;

interface CriteriaMetricRow {
  entity_type: 'criteria';
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

/** Compute the 5 criteria metrics for a single criteria across all completed-run
 *  variants that referenced it. Writes upsert rows to evolution_metrics. */
export async function computeCriteriaMetrics(
  db: SupabaseClient,
  criteriaId: string,
): Promise<void> {
  // Pull variants where this criteria appears in either criteria_set_used (was evaluated)
  // OR weakest_criteria_ids (was the focus). frequency_as_weakest is computed across
  // criteria_set_used rows; total_variants_focused + avg_elo_delta_when_focused
  // are computed across weakest_criteria_ids rows.
  const { data: evaluatedVariants, error: evalErr } = await db
    .from('evolution_variants')
    .select('id, run_id, mu, sigma, elo_score, parent_variant_id, weakest_criteria_ids')
    .contains('criteria_set_used', [criteriaId]);
  if (evalErr || !evaluatedVariants) return;

  if (evaluatedVariants.length === 0) {
    // No data for this criteria yet; skip writing zero rows.
    return;
  }

  // Filter to completed runs only.
  const runIds = [...new Set(evaluatedVariants.map((v) => v.run_id as string))];
  const completedRunIds = new Set<string>();
  const RUN_ID_CHUNK = 100;
  for (let i = 0; i < runIds.length; i += RUN_ID_CHUNK) {
    const chunk = runIds.slice(i, i + RUN_ID_CHUNK);
    const { data: runs, error: runsErr } = await db
      .from('evolution_runs')
      .select('id, status')
      .in('id', chunk);
    if (runsErr) {
      console.warn(`[computeCriteriaMetrics] partial run-status fetch failed at chunk ${i}`, runsErr.message);
      continue;
    }
    for (const r of runs ?? []) {
      if (r.status === 'completed') completedRunIds.add(r.id as string);
    }
  }

  const completedEvaluated = evaluatedVariants.filter((v) => completedRunIds.has(v.run_id));
  if (completedEvaluated.length === 0) return;

  // Variants where this criteria was in weakest_criteria_ids (the focused subset)
  const focusedVariants = completedEvaluated.filter((v) => {
    const w = v.weakest_criteria_ids as string[] | null;
    return Array.isArray(w) && w.includes(criteriaId);
  });

  // Frequency-as-weakest = focused / evaluated (within completed runs)
  const frequencyAsWeakest = focusedVariants.length / completedEvaluated.length;

  // avg_elo_delta_when_focused: mean(child.elo - parent.elo) across focused variants
  // Pull parent variant elo via parent_variant_id JOIN; chunked for safety.
  const focusedParentIds = focusedVariants
    .map((v) => v.parent_variant_id as string | null)
    .filter((id): id is string => Boolean(id));
  const parentEloById = new Map<string, number>();
  for (let i = 0; i < focusedParentIds.length; i += 100) {
    const chunk = focusedParentIds.slice(i, i + 100);
    const { data: parents } = await db
      .from('evolution_variants')
      .select('id, mu, sigma')
      .in('id', chunk);
    for (const p of parents ?? []) {
      const r = dbToRating((p.mu ?? 25) as number, (p.sigma ?? 8.333) as number);
      parentEloById.set(p.id as string, r.elo);
    }
  }
  const deltas: number[] = [];
  for (const v of focusedVariants) {
    const parentId = v.parent_variant_id as string | null;
    if (!parentId) continue;
    const parentElo = parentEloById.get(parentId);
    if (parentElo === undefined) continue;
    const childRating = dbToRating((v.mu ?? 25) as number, (v.sigma ?? 8.333) as number);
    deltas.push(childRating.elo - parentElo);
  }
  const avgEloDeltaWhenFocused = deltas.length > 0
    ? deltas.reduce((s, d) => s + d, 0) / deltas.length
    : 0;

  // avg_score: pull execution_detail.evaluateAndSuggest.criteriaScored from
  // invocations of this run-set; aggregate per-criteria-id score.
  let scoreSum = 0;
  let scoreCount = 0;
  {
    const completedRunIdsArr = [...completedRunIds];
    for (let i = 0; i < completedRunIdsArr.length; i += 100) {
      const chunk = completedRunIdsArr.slice(i, i + 100);
      const { data: invocations } = await db
        .from('evolution_agent_invocations')
        .select('execution_detail')
        .in('run_id', chunk)
        .eq('agent_name', 'evaluate_criteria_then_generate_from_previous_article');
      for (const inv of invocations ?? []) {
        const detail = inv.execution_detail as { evaluateAndSuggest?: { criteriaScored?: Array<{ criteriaId?: string; score?: number }> } } | null;
        const scored = detail?.evaluateAndSuggest?.criteriaScored;
        if (!Array.isArray(scored)) continue;
        for (const entry of scored) {
          if (entry.criteriaId === criteriaId && typeof entry.score === 'number' && Number.isFinite(entry.score)) {
            scoreSum += entry.score;
            scoreCount += 1;
          }
        }
      }
    }
  }
  const avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;

  const rows: CriteriaMetricRow[] = [
    { entity_type: 'criteria', entity_id: criteriaId, metric_name: 'avg_score',
      value: avgScore, n: scoreCount, aggregation_method: 'avg', source: 'propagation' },
    { entity_type: 'criteria', entity_id: criteriaId, metric_name: 'frequency_as_weakest',
      value: frequencyAsWeakest, n: completedEvaluated.length, aggregation_method: 'avg', source: 'propagation' },
    { entity_type: 'criteria', entity_id: criteriaId, metric_name: 'total_variants_focused',
      value: focusedVariants.length, n: 1, aggregation_method: 'count', source: 'propagation' },
    { entity_type: 'criteria', entity_id: criteriaId, metric_name: 'avg_elo_delta_when_focused',
      value: avgEloDeltaWhenFocused, n: deltas.length, aggregation_method: 'avg', source: 'propagation' },
    { entity_type: 'criteria', entity_id: criteriaId, metric_name: 'run_count',
      value: completedRunIds.size, n: 1, aggregation_method: 'count', source: 'propagation' },
  ];

  const { error: writeError } = await db
    .from('evolution_metrics')
    .upsert(
      rows.map((r) => {
        const { uncertainty, ...rest } = r;
        return {
          ...rest,
          sigma: uncertainty ?? null,
          stale: false,
          updated_at: new Date().toISOString(),
        };
      }),
      { onConflict: 'entity_type,entity_id,metric_name' },
    );

  if (writeError) {
    console.warn(`[criteriaMetrics] Failed to write metrics for criteria ${criteriaId}: ${writeError.message}`);
  }
}

/** Compute criteria metrics for every criteria referenced by variants in the
 *  given run. Called at run finalization (after strategy/experiment propagation)
 *  alongside computeTacticMetricsForRun. */
export async function computeCriteriaMetricsForRun(
  db: SupabaseClient,
  runId: string,
): Promise<void> {
  // Pull distinct criteria UUIDs from variants in this run.
  const { data: variants } = await db
    .from('evolution_variants')
    .select('criteria_set_used')
    .eq('run_id', runId)
    .not('criteria_set_used', 'is', null);

  if (!variants) return;

  const criteriaIdSet = new Set<string>();
  for (const row of variants) {
    const ids = row.criteria_set_used as string[] | null;
    if (Array.isArray(ids)) {
      for (const id of ids) criteriaIdSet.add(id);
    }
  }

  for (const criteriaId of criteriaIdSet) {
    await computeCriteriaMetrics(db, criteriaId);
  }
}
