// Guards the invariant that run-level cost metrics do NOT become stale when a
// variant's mu/sigma changes. The mark_elo_metrics_stale trigger uses explicit
// per-entity allowlists (see 20260328000002_expand_stale_trigger_invocations.sql);
// cost metrics are intentionally excluded at the run level. This test catches
// future regressions where someone adds cost metric names to the trigger.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  createTestStrategyConfig,
  createTestEvolutionRun,
  createTestPrompt,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Evolution stale-trigger cost-metric invariant', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const createdRunIds: string[] = [];
  const createdStrategyIds: string[] = [];
  const createdPromptIds: string[] = [];
  const createdMetricEntityIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping stale-trigger invariant tests');
    }
  });

  afterAll(async () => {
    if (!tablesExist) return;

    if (createdMetricEntityIds.length > 0) {
      await supabase
        .from('evolution_metrics')
        .delete()
        .in('entity_id', createdMetricEntityIds);
    }

    await cleanupEvolutionData(supabase, {
      runIds: createdRunIds,
      strategyIds: createdStrategyIds,
      promptIds: createdPromptIds,
    });
  });

  async function insertMetricRow(opts: {
    entity_type: string;
    entity_id: string;
    metric_name: string;
    value: number;
    stale?: boolean;
  }) {
    const row = {
      entity_type: opts.entity_type,
      entity_id: opts.entity_id,
      metric_name: opts.metric_name,
      value: opts.value,
      stale: opts.stale ?? false,
      sigma: null,
      ci_lower: null,
      ci_upper: null,
      n: 1,
      origin_entity_type: null,
      origin_entity_id: null,
      aggregation_method: null,
      source: 'test',
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('evolution_metrics')
      .upsert(row, { onConflict: 'entity_type,entity_id,metric_name' });
    if (error) throw new Error(`insertMetricRow failed: ${error.message}`);
  }

  // Every run-level cost metric that must remain stale=false when an arena match
  // updates a variant's mu/sigma. Includes both existing metrics and the new ones
  // introduced by the cost-estimate-accuracy project.
  const COST_METRICS_AT_RUN = [
    // Existing
    'cost',
    'generation_cost',
    'ranking_cost',
    'seed_cost',
    'cost_estimation_error_pct',
    // New (Phase 2 of cost_estimate_accuracy_analysis_20260414)
    'estimated_cost',
    'generation_estimation_error_pct',
    'ranking_estimation_error_pct',
    'estimation_abs_error_usd',
    'agent_cost_projected',
    'agent_cost_actual',
    'parallel_dispatched',
    'sequential_dispatched',
    'median_sequential_gfsa_duration_ms',
    'avg_sequential_gfsa_duration_ms',
  ];

  // Sanity-check controls: these are in the trigger allowlist and MUST go stale.
  const ELO_METRICS_AT_RUN = ['winner_elo', 'median_elo'];

  it('variant mu/sigma update does NOT stale run-level cost metrics, DOES stale run-level elo metrics', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);
    const promptId = await createTestPrompt(supabase);
    createdPromptIds.push(promptId);

    const run = await createTestEvolutionRun(supabase, null, {
      strategy_id: strategyId,
      prompt_id: promptId,
      status: 'completed',
    });
    const runId = run.id as string;
    createdRunIds.push(runId);
    createdMetricEntityIds.push(runId);

    // Trigger fires on UPDATE of mu or sigma.
    const { data: variant } = await supabase
      .from('evolution_variants')
      .insert({
        run_id: runId,
        variant_content: '[TEST] variant for cost-metric invariant',
        elo_score: 1200,
        generation: 1,
        agent_name: 'test',
        match_count: 0,
        mu: 25,
        sigma: 8.333,
      })
      .select('id')
      .single();
    if (!variant) throw new Error('Failed to create variant');

    // Seed all cost metrics (stale=false) and the control elo metrics.
    for (const name of COST_METRICS_AT_RUN) {
      await insertMetricRow({ entity_type: 'run', entity_id: runId, metric_name: name, value: 0.1 });
    }
    for (const name of ELO_METRICS_AT_RUN) {
      await insertMetricRow({ entity_type: 'run', entity_id: runId, metric_name: name, value: 1500 });
    }

    // Trigger the stale cascade.
    const { error: updateErr } = await supabase
      .from('evolution_variants')
      .update({ mu: 30, sigma: 5.0 })
      .eq('id', variant.id);
    expect(updateErr).toBeNull();

    const { data: rows } = await supabase
      .from('evolution_metrics')
      .select('metric_name, stale')
      .eq('entity_type', 'run')
      .eq('entity_id', runId);

    const byName = new Map<string, boolean>(
      (rows ?? []).map((r: Record<string, unknown>) => [r.metric_name as string, r.stale as boolean]),
    );

    // Cost metrics must still be fresh.
    const staledCostMetrics = COST_METRICS_AT_RUN.filter((name) => byName.get(name) === true);
    expect(staledCostMetrics).toEqual([]);

    // Control: elo metrics must be stale (confirms the trigger fired).
    const staledEloMetrics = ELO_METRICS_AT_RUN.filter((name) => byName.get(name) === true);
    expect(staledEloMetrics.sort()).toEqual(ELO_METRICS_AT_RUN.sort());

    // Cleanup the variant so the strategy/run cleanup in afterAll can run cleanly.
    await supabase.from('evolution_variants').delete().eq('id', variant.id);
  });
});
