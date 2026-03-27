// Tests the update_strategy_aggregates RPC against real Supabase DB.
// Verifies run_count, total_cost, avg_elo initialization and cumulative updates.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Strategy Aggregates Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const createdStrategyIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    // Also check that the aggregate columns exist (added by later migration)
    if (tablesExist) {
      const { error } = await supabase.from('evolution_strategies').select('run_count').limit(1);
      if (error) tablesExist = false; // Column not migrated yet
    }
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      strategyIds: createdStrategyIds,
    });
  });

  it('first run initializes aggregates correctly', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);

    const { error } = await supabase.rpc('update_strategy_aggregates', {
      p_strategy_id: strategyId,
      p_cost_usd: 0.50,
      p_final_elo: 1300,
    });
    expect(error).toBeNull();

    const { data } = await supabase
      .from('evolution_strategies')
      .select('run_count, total_cost_usd, avg_final_elo, best_final_elo, worst_final_elo')
      .eq('id', strategyId)
      .single();

    expect(data!.run_count).toBe(1);
    expect(Number(data!.total_cost_usd)).toBeCloseTo(0.50, 4);
    expect(Number(data!.avg_final_elo)).toBeCloseTo(1300, 2);
    expect(Number(data!.best_final_elo)).toBeCloseTo(1300, 2);
    expect(Number(data!.worst_final_elo)).toBeCloseTo(1300, 2);
  });

  it('cumulative updates compute running mean correctly', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);

    const elos = [1200, 1400, 1500];
    const costs = [0.30, 0.50, 0.20];

    for (let i = 0; i < elos.length; i++) {
      const { error } = await supabase.rpc('update_strategy_aggregates', {
        p_strategy_id: strategyId,
        p_cost_usd: costs[i],
        p_final_elo: elos[i],
      });
      expect(error).toBeNull();
    }

    const { data } = await supabase
      .from('evolution_strategies')
      .select('run_count, total_cost_usd, avg_final_elo, best_final_elo, worst_final_elo')
      .eq('id', strategyId)
      .single();

    expect(data!.run_count).toBe(3);

    const expectedTotalCost = costs.reduce((s, c) => s + c, 0); // 1.00
    expect(Number(data!.total_cost_usd)).toBeCloseTo(expectedTotalCost, 4);

    // Running mean: ((1200)*1 + 1400) / 2 = 1300, then (1300*2 + 1500) / 3 = 1366.67
    const expectedAvgElo = (1200 + 1400 + 1500) / 3;
    expect(Number(data!.avg_final_elo)).toBeCloseTo(expectedAvgElo, 1);

    expect(Number(data!.best_final_elo)).toBeCloseTo(1500, 2);
    expect(Number(data!.worst_final_elo)).toBeCloseTo(1200, 2);
  });

  it('NULL cost is handled correctly — total_cost unchanged', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);

    // First call with a known cost
    await supabase.rpc('update_strategy_aggregates', {
      p_strategy_id: strategyId,
      p_cost_usd: 0.75,
      p_final_elo: 1250,
    });

    // Second call with null cost
    const { error } = await supabase.rpc('update_strategy_aggregates', {
      p_strategy_id: strategyId,
      p_cost_usd: null,
      p_final_elo: 1350,
    });
    expect(error).toBeNull();

    const { data } = await supabase
      .from('evolution_strategies')
      .select('run_count, total_cost_usd, avg_final_elo')
      .eq('id', strategyId)
      .single();

    expect(data!.run_count).toBe(2);
    // COALESCE(null, 0) = 0, so total_cost should remain 0.75
    expect(Number(data!.total_cost_usd)).toBeCloseTo(0.75, 4);
    // avg_elo = (1250 * 1 + 1350) / 2 = 1300
    expect(Number(data!.avg_final_elo)).toBeCloseTo(1300, 2);
  });
});
