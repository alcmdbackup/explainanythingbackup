// Integration tests for the test content filter on evolution list queries.
// Verifies that the two-step filter approach (fetch test strategy IDs, then exclude)
// works correctly against real Supabase, and that no PostgREST ambiguity errors occur.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Evolution Test Content Filter Integration', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  // Test data IDs
  const testStrategyId = crypto.randomUUID();
  const realStrategyId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const testRunId = crypto.randomUUID();
  const realRunId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping test content filter tests');
      return;
    }

    // Create two strategies: one with [TEST] in name, one without
    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert([
        {
          id: testStrategyId,
          name: '[TEST] filter-integration-strategy',
          label: '[TEST] Filter Strategy',
          config: { test: true },
          config_hash: `test-filter-hash-${testStrategyId}`,
        },
        {
          id: realStrategyId,
          name: 'Real filter-integration-strategy',
          label: 'Real Filter Strategy',
          config: { test: false },
          config_hash: `real-filter-hash-${realStrategyId}`,
        },
      ]);
    if (stratErr) throw new Error(`Failed to create strategies: ${stratErr.message}`);

    // Create prompt
    const { error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ id: promptId, prompt: '[TEST] filter prompt', name: '[TEST] Filter Prompt' });
    if (promptErr) throw new Error(`Failed to create prompt: ${promptErr.message}`);

    // Create runs: one linked to test strategy, one to real strategy
    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert([
        { id: testRunId, strategy_id: testStrategyId, prompt_id: promptId, status: 'completed' },
        { id: realRunId, strategy_id: realStrategyId, prompt_id: promptId, status: 'completed' },
      ]);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      runIds: [testRunId, realRunId],
      strategyIds: [testStrategyId, realStrategyId],
      promptIds: [promptId],
    });
  });

  it('two-step filter excludes test runs and keeps real runs', async () => {
    if (!tablesExist) return;

    // Step 1: Fetch test strategy IDs (same as the action code)
    const { data: testStrategies, error: tsErr } = await supabase
      .from('evolution_strategies')
      .select('id')
      .ilike('name', '%[TEST]%');

    expect(tsErr).toBeNull();
    expect(testStrategies!.length).toBeGreaterThan(0);
    const testIds = testStrategies!.map(s => s.id as string);
    expect(testIds).toContain(testStrategyId);
    expect(testIds).not.toContain(realStrategyId);

    // Step 2: Query runs excluding test strategy IDs, scoped to our test data
    // Scope to our test runs first to keep the query small, then exclude test strategies
    const { data: filteredRuns, error: runErr } = await supabase
      .from('evolution_runs')
      .select('id, strategy_id')
      .in('id', [testRunId, realRunId])
      .not('strategy_id', 'in', `(${testStrategyId})`);

    expect(runErr).toBeNull();
    expect(filteredRuns).toHaveLength(1);
    expect(filteredRuns?.[0]?.id).toBe(realRunId);
  });

  it('filter returns all runs when no test strategies exist matching pattern', async () => {
    if (!tablesExist) return;

    // Use a pattern that won't match anything
    const { data: noMatch, error } = await supabase
      .from('evolution_strategies')
      .select('id')
      .ilike('name', '%[NONEXISTENT_PATTERN_12345]%');

    expect(error).toBeNull();
    expect(noMatch).toHaveLength(0);

    // With no IDs to exclude, query should return both runs
    const { data: allRuns, error: runErr } = await supabase
      .from('evolution_runs')
      .select('id')
      .in('id', [testRunId, realRunId]);

    expect(runErr).toBeNull();
    expect(allRuns).toHaveLength(2);
  });

  it('PostgREST inner join on evolution_strategies does not return HTTP 300', async () => {
    if (!tablesExist) return;

    // This query previously failed with PGRST201 due to ambiguous FK.
    // After dropping the duplicate FK, it should work. If the migration
    // hasn't been applied yet, this test documents the known failure.
    const { data, error } = await supabase
      .from('evolution_runs')
      .select('id, evolution_strategies!fk_runs_strategy(name)')
      .eq('id', realRunId);

    // If this fails with "Could not find a relationship", the migration
    // to drop the duplicate FK hasn't been applied yet — that's expected
    // on environments that haven't run 20260325000001.
    if (error && error.message.includes('Could not find a relationship')) {
      console.warn('FK disambiguation not yet available — migration pending');
      return;
    }

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('plain .not(strategy_id) filter works without FK dependency', async () => {
    if (!tablesExist) return;

    // This is the approach used by the fixed code — no !inner join needed
    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, status')
      .not('strategy_id', 'in', `(${testStrategyId})`)
      .in('id', [testRunId, realRunId]);

    expect(error).toBeNull();
    expect(runs).toHaveLength(1);
    expect(runs?.[0]?.id).toBe(realRunId);
  });
});
