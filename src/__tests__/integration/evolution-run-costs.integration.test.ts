// Tests the get_run_total_cost SQL function and evolution_run_costs view
// created by the 20260319000001_evolution_run_cost_helpers migration.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';

describe('Evolution Run Costs Integration Tests', () => {
  let supabase: SupabaseClient;

  // Test data IDs (generated once, reused across tests)
  const strategyId = crypto.randomUUID();
  const runWithCosts = crypto.randomUUID();
  const runWithNoCosts = crypto.randomUUID();
  const invocationIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

  // Known cost values for deterministic assertions
  const costs = [0.0042, 0.0158, 0.0300];
  const expectedTotal = costs.reduce((sum, c) => sum + c, 0); // 0.05

  beforeAll(async () => {
    supabase = createTestSupabaseClient();

    // 1. Create a test strategy config
    const { error: stratErr } = await supabase
      .from('evolution_strategy_configs')
      .insert({
        id: strategyId,
        name: `[TEST] cost-test-strategy`,
        label: 'Cost Test',
        config: { test: true },
        config_hash: `test-cost-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    // 2. Create two test runs: one with invocations, one without
    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert([
        {
          id: runWithCosts,
          strategy_config_id: strategyId,
          status: 'completed',
          config: {},
        },
        {
          id: runWithNoCosts,
          strategy_config_id: strategyId,
          status: 'completed',
          config: {},
        },
      ]);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);

    // 3. Create invocations with known cost_usd values for runWithCosts
    const invocations = costs.map((cost, i) => ({
      id: invocationIds[i],
      run_id: runWithCosts,
      agent_name: `test-agent-${i}`,
      iteration: i,
      execution_order: i,
      success: true,
      cost_usd: cost,
    }));

    const { error: invErr } = await supabase
      .from('evolution_agent_invocations')
      .insert(invocations);
    if (invErr) throw new Error(`Failed to create invocations: ${invErr.message}`);
  });

  afterAll(async () => {
    // Clean up in reverse FK order: invocations -> runs -> strategy
    await supabase
      .from('evolution_agent_invocations')
      .delete()
      .in('id', invocationIds);

    await supabase
      .from('evolution_runs')
      .delete()
      .in('id', [runWithCosts, runWithNoCosts]);

    await supabase
      .from('evolution_strategy_configs')
      .delete()
      .eq('id', strategyId);
  });

  it('get_run_total_cost RPC returns correct SUM for a run with invocations', async () => {
    const { data, error } = await supabase.rpc('get_run_total_cost', {
      p_run_id: runWithCosts,
    });

    expect(error).toBeNull();
    // The function returns NUMERIC which comes back as a number or string
    expect(Number(data)).toBeCloseTo(expectedTotal, 4);
  });

  it('evolution_run_costs view returns correct total for a run', async () => {
    const { data, error } = await supabase
      .from('evolution_run_costs')
      .select('run_id, total_cost_usd')
      .eq('run_id', runWithCosts)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.run_id).toBe(runWithCosts);
    expect(Number(data!.total_cost_usd)).toBeCloseTo(expectedTotal, 4);
  });

  it('get_run_total_cost returns 0 for a run with no invocations', async () => {
    const { data, error } = await supabase.rpc('get_run_total_cost', {
      p_run_id: runWithNoCosts,
    });

    expect(error).toBeNull();
    expect(Number(data)).toBe(0);
  });
});
