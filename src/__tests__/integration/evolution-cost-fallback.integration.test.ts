// Integration tests for cost fallback: when evolution_metrics has no cost data,
// dashboard and runs list fall back to evolution_run_costs view.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestAgentInvocation,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

async function costViewExists(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('evolution_run_costs').select('run_id').limit(1);
  if (error && (error.code === '42P01' || error.message?.includes('does not exist'))) return false;
  return true;
}

async function metricsTableExists(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('evolution_metrics').select('entity_id').limit(1);
  if (error && (error.code === '42P01' || error.message?.includes('does not exist'))) return false;
  return true;
}

describe('Evolution Cost Fallback Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let viewExists: boolean;
  let metricsExist: boolean;

  const strategyId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping cost fallback tests');
      return;
    }
    viewExists = await costViewExists(supabase);
    metricsExist = await metricsTableExists(supabase);
    if (!viewExists || !metricsExist) {
      console.warn('Required views/tables do not exist — skipping cost fallback tests');
      return;
    }

    // Create strategy
    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: '[TEST_EVO] cost-fallback-strategy',
        label: '[TEST_EVO] Cost Fallback',
        config: { test: true },
        config_hash: `test-fallback-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    // Create prompt
    const { data: promptData, error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ prompt: '[TEST_EVO] fallback prompt', name: '[TEST_EVO] Fallback Prompt' })
      .select('id')
      .single();
    if (promptErr) throw new Error(`Failed to create prompt: ${promptErr.message}`);

    // Create run with invocations but NO metrics entry
    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert({ id: runId, strategy_id: strategyId, prompt_id: promptData.id, status: 'completed' });
    if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);

    // Create invocations with real costs
    await createTestAgentInvocation(supabase, runId, 0, 'gen-agent', { costUsd: 0.025, executionOrder: 0 });
    await createTestAgentInvocation(supabase, runId, 0, 'judge-agent', { costUsd: 0.015, executionOrder: 1 });
  });

  afterAll(async () => {
    if (!tablesExist || !viewExists || !metricsExist) return;
    await cleanupEvolutionData(supabase, {
      runIds: [runId],
      strategyIds: [strategyId],
    });
    await supabase.from('evolution_prompts').delete().ilike('name', '[TEST_EVO]%');
  });

  it('evolution_run_costs view shows cost even without evolution_metrics entry', async () => {
    if (!tablesExist || !viewExists || !metricsExist) return;

    // Verify NO cost metric exists for this run
    const { data: metrics } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', 'cost');
    expect(metrics).toHaveLength(0);

    // But evolution_run_costs view should aggregate from invocations
    const { data: viewCost, error } = await supabase
      .from('evolution_run_costs')
      .select('total_cost_usd')
      .eq('run_id', runId)
      .single();

    expect(error).toBeNull();
    // 0.025 + 0.015 = 0.04
    expect(Number(viewCost?.total_cost_usd)).toBeCloseTo(0.04, 4);
  });

  it('get_run_total_cost RPC returns cost from invocations', async () => {
    if (!tablesExist || !viewExists || !metricsExist) return;

    const { data, error } = await supabase.rpc('get_run_total_cost', { p_run_id: runId });
    expect(error).toBeNull();
    expect(Number(data)).toBeCloseTo(0.04, 4);
  });
});
