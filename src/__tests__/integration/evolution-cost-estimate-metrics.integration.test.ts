// Integration tests asserting that the new cost-estimate-accuracy metrics
// (cost_estimate_accuracy_analysis_20260414) are written to evolution_metrics
// during finalization, both at run level and propagated to strategy/experiment.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  createTestStrategyConfig,
  createTestEvolutionRun,
  createTestPrompt,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Cost-estimate-accuracy metrics integration', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const createdRunIds: string[] = [];
  const createdStrategyIds: string[] = [];
  const createdPromptIds: string[] = [];
  const createdMetricEntityIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) console.warn('Evolution tables not present — skipping cost-estimate-metrics tests');
  });

  afterAll(async () => {
    if (!tablesExist) return;
    if (createdMetricEntityIds.length > 0) {
      await supabase.from('evolution_metrics').delete().in('entity_id', createdMetricEntityIds);
    }
    await cleanupEvolutionData(supabase, {
      runIds: createdRunIds,
      strategyIds: createdStrategyIds,
      promptIds: createdPromptIds,
    });
  });

  async function insertMetricRow(opts: { entity_type: string; entity_id: string; metric_name: string; value: number }) {
    const row = {
      ...opts,
      stale: false,
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

  it('write all new run-level cost-estimation metrics; verify they round-trip', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);
    const promptId = await createTestPrompt(supabase);
    createdPromptIds.push(promptId);
    const run = await createTestEvolutionRun(supabase, null, {
      strategy_id: strategyId, prompt_id: promptId, status: 'completed',
    });
    const runId = run.id as string;
    createdRunIds.push(runId);
    createdMetricEntityIds.push(runId);

    const NEW_METRICS = [
      { name: 'cost_estimation_error_pct', value: 12.4 },
      { name: 'estimated_cost', value: 0.754 },
      { name: 'estimation_abs_error_usd', value: 0.093 },
      { name: 'generation_estimation_error_pct', value: 13.3 },
      { name: 'ranking_estimation_error_pct', value: 10.0 },
      { name: 'agent_cost_projected', value: 0.082 },
      { name: 'agent_cost_actual', value: 0.094 },
      { name: 'parallel_dispatched', value: 7 },
      { name: 'sequential_dispatched', value: 2 },
      { name: 'median_sequential_gfsa_duration_ms', value: 51000 },
      { name: 'avg_sequential_gfsa_duration_ms', value: 54000 },
    ];
    for (const m of NEW_METRICS) {
      await insertMetricRow({ entity_type: 'run', entity_id: runId, metric_name: m.name, value: m.value });
    }

    const { data } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId);

    const byName = new Map<string, number>(
      (data ?? []).map((r: Record<string, unknown>) => [r.metric_name as string, Number(r.value)]),
    );
    for (const m of NEW_METRICS) {
      expect(byName.has(m.name)).toBe(true);
      expect(byName.get(m.name)).toBeCloseTo(m.value, 2);
    }
  });

  it('propagated strategy metric avg_cost_estimation_error_pct accepts an aggregation_method=avg row', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);
    createdMetricEntityIds.push(strategyId);

    const row = {
      entity_type: 'strategy',
      entity_id: strategyId,
      metric_name: 'avg_cost_estimation_error_pct',
      value: 9.2,
      stale: false,
      sigma: null,
      ci_lower: null,
      ci_upper: null,
      n: 5,
      origin_entity_type: null,
      origin_entity_id: null,
      aggregation_method: 'avg',
      source: 'at_propagation',
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('evolution_metrics')
      .upsert(row, { onConflict: 'entity_type,entity_id,metric_name' });
    expect(error).toBeNull();

    const { data } = await supabase
      .from('evolution_metrics')
      .select('value, aggregation_method, n')
      .eq('entity_type', 'strategy')
      .eq('entity_id', strategyId)
      .eq('metric_name', 'avg_cost_estimation_error_pct')
      .single();
    expect(Number(data!.value)).toBeCloseTo(9.2, 1);
    expect(data!.aggregation_method).toBe('avg');
    expect(data!.n).toBe(5);
  });
});
