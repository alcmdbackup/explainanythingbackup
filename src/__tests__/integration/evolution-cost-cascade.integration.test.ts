// Integration tests for cost cascade: invocation costs aggregate to run level via get_run_total_cost
// RPC and evolution_run_costs view, and further to strategy level.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestAgentInvocation,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Check if get_run_total_cost RPC and evolution_run_costs view exist. */
async function costHelpersExist(sb: SupabaseClient): Promise<boolean> {
  const { error } = await sb.from('evolution_run_costs').select('run_id').limit(1);
  if (error && (error.code === '42P01' || error.message?.includes('does not exist'))) return false;
  return true;
}

describe('Evolution Cost Cascade Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let costViewExists: boolean;

  // Shared test data IDs
  const strategyId = crypto.randomUUID();
  const runWithCosts = crypto.randomUUID();
  const runWithZeroCosts = crypto.randomUUID();
  const runWithNoCosts = crypto.randomUUID();
  const secondRunWithCosts = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping cost cascade tests');
      return;
    }
    costViewExists = await costHelpersExist(supabase);
    if (!costViewExists) {
      console.warn('evolution_run_costs view does not exist — skipping cost cascade tests');
      return;
    }

    // Create strategy
    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: '[TEST_EVO] cost-cascade-strategy',
        label: '[TEST_EVO] Cost Cascade',
        config: { test: true },
        config_hash: `test-cascade-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    // Create prompt for runs
    const { data: promptData, error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ prompt: '[TEST_EVO] cascade prompt', name: '[TEST_EVO] Cascade Prompt' })
      .select('id')
      .single();
    if (promptErr) throw new Error(`Failed to create prompt: ${promptErr.message}`);
    const promptId = promptData.id;

    // Create runs
    const runs = [
      { id: runWithCosts, strategy_id: strategyId, prompt_id: promptId, status: 'completed' },
      { id: runWithZeroCosts, strategy_id: strategyId, prompt_id: promptId, status: 'completed' },
      { id: runWithNoCosts, strategy_id: strategyId, prompt_id: promptId, status: 'completed' },
      { id: secondRunWithCosts, strategy_id: strategyId, prompt_id: promptId, status: 'completed' },
    ];
    const { error: runErr } = await supabase.from('evolution_runs').insert(runs);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);

    // Create invocations with costs for runWithCosts
    await createTestAgentInvocation(supabase, runWithCosts, 0, 'gen-agent', { costUsd: 0.0100, executionOrder: 0 });
    await createTestAgentInvocation(supabase, runWithCosts, 0, 'judge-agent', { costUsd: 0.0200, executionOrder: 1 });
    await createTestAgentInvocation(supabase, runWithCosts, 1, 'gen-agent', { costUsd: 0.0150, executionOrder: 0 });

    // Zero-cost invocations for runWithZeroCosts
    await createTestAgentInvocation(supabase, runWithZeroCosts, 0, 'gen-agent', { costUsd: 0, executionOrder: 0 });
    await createTestAgentInvocation(supabase, runWithZeroCosts, 0, 'judge-agent', { costUsd: 0, executionOrder: 1 });

    // No invocations for runWithNoCosts (left empty)

    // Costs for secondRunWithCosts
    await createTestAgentInvocation(supabase, secondRunWithCosts, 0, 'gen-agent', { costUsd: 0.0500, executionOrder: 0 });
  });

  afterAll(async () => {
    if (!tablesExist || !costViewExists) return;
    await cleanupEvolutionData(supabase, {
      runIds: [runWithCosts, runWithZeroCosts, runWithNoCosts, secondRunWithCosts],
      strategyIds: [strategyId],
    });
    // Clean up prompts too
    await supabase.from('evolution_prompts').delete().ilike('name', '[TEST_EVO]%');
  });

  it('get_run_total_cost RPC sums invocation costs correctly', async () => {
    if (!tablesExist || !costViewExists) return;

    const { data, error } = await supabase.rpc('get_run_total_cost', {
      p_run_id: runWithCosts,
    });

    expect(error).toBeNull();
    // 0.0100 + 0.0200 + 0.0150 = 0.0450
    expect(Number(data)).toBeCloseTo(0.045, 4);
  });

  it('get_run_total_cost returns 0 for run with zero-cost invocations', async () => {
    if (!tablesExist || !costViewExists) return;

    const { data, error } = await supabase.rpc('get_run_total_cost', {
      p_run_id: runWithZeroCosts,
    });

    expect(error).toBeNull();
    expect(Number(data)).toBe(0);
  });

  it('get_run_total_cost returns 0 for run with no invocations', async () => {
    if (!tablesExist || !costViewExists) return;

    const { data, error } = await supabase.rpc('get_run_total_cost', {
      p_run_id: runWithNoCosts,
    });

    expect(error).toBeNull();
    expect(Number(data)).toBe(0);
  });

  it('evolution_run_costs view reflects correct cost per run', async () => {
    if (!tablesExist || !costViewExists) return;

    const { data, error } = await supabase
      .from('evolution_run_costs')
      .select('run_id, total_cost_usd')
      .in('run_id', [runWithCosts, secondRunWithCosts])
      .order('total_cost_usd', { ascending: true });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);

    const costMap = new Map(data!.map((r: Record<string, unknown>) => [r.run_id, Number(r.total_cost_usd)]));
    expect(costMap.get(runWithCosts)).toBeCloseTo(0.045, 4);
    expect(costMap.get(secondRunWithCosts)).toBeCloseTo(0.05, 4);
  });

  it('multiple runs under same strategy aggregate total costs', async () => {
    if (!tablesExist || !costViewExists) return;

    // Query all run costs for runs under this strategy
    const { data: runs, error: runsErr } = await supabase
      .from('evolution_runs')
      .select('id')
      .eq('strategy_id', strategyId);

    expect(runsErr).toBeNull();
    const runIds = runs!.map((r: Record<string, unknown>) => r.id as string);

    const { data: costs, error: costsErr } = await supabase
      .from('evolution_run_costs')
      .select('run_id, total_cost_usd')
      .in('run_id', runIds);

    expect(costsErr).toBeNull();

    // Sum all run costs for strategy-level aggregation
    const totalStrategyCost = (costs ?? []).reduce(
      (sum: number, c: Record<string, unknown>) => sum + (Number(c.total_cost_usd) || 0),
      0,
    );

    // runWithCosts: 0.045, secondRunWithCosts: 0.05, others: 0
    expect(totalStrategyCost).toBeCloseTo(0.095, 4);
  });
});
