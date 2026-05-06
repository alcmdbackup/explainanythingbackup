// Integration tests for the test content filter on evolution list queries.
// Verifies that the two-step filter approach (fetch test strategy IDs, then exclude)
// works correctly against real Supabase, and that no PostgREST ambiguity errors occur.
//
// Phase 1 (use_playwright_find_bugs_ux_issues_20260422, plan B17) adds a
// "evolution_prompts column filter" block covering the prompts list via
// applyTestContentColumnFilter after migration 20260423000001.

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
  const e2eStrategyId = crypto.randomUUID();
  const realStrategyId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const testRunId = crypto.randomUUID();
  const e2eRunId = crypto.randomUUID();
  const realRunId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping test content filter tests');
      return;
    }

    // Create three strategies: [TEST], [E2E], and a real one
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
          id: e2eStrategyId,
          name: '[E2E] Anchor Strategy 1774967596078',
          label: '[E2E] Anchor Strategy',
          config: { test: true },
          config_hash: `e2e-filter-hash-${e2eStrategyId}`,
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

    // Create runs: one linked to [TEST] strategy, one to [E2E] strategy, one to real strategy
    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert([
        { id: testRunId, strategy_id: testStrategyId, prompt_id: promptId, status: 'completed' },
        { id: e2eRunId, strategy_id: e2eStrategyId, prompt_id: promptId, status: 'completed' },
        { id: realRunId, strategy_id: realStrategyId, prompt_id: promptId, status: 'completed' },
      ]);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      runIds: [testRunId, e2eRunId, realRunId],
      strategyIds: [testStrategyId, e2eStrategyId, realStrategyId],
      promptIds: [promptId],
    });
  });

  it('two-step filter excludes test and E2E runs and keeps real runs', async () => {
    if (!tablesExist) return;

    // Step 1: Fetch test strategy IDs matching [TEST], [E2E], or [TEST_EVO] (same as getTestStrategyIds)
    const { data: testStrategies, error: tsErr } = await supabase
      .from('evolution_strategies')
      .select('id')
      .or('name.ilike.%[TEST]%,name.ilike.%[E2E]%,name.ilike.%[TEST_EVO]%,name.ilike.test');

    expect(tsErr).toBeNull();
    expect(testStrategies!.length).toBeGreaterThanOrEqual(2);
    const testIds = testStrategies!.map(s => s.id as string);
    expect(testIds).toContain(testStrategyId);
    expect(testIds).toContain(e2eStrategyId);
    expect(testIds).not.toContain(realStrategyId);

    // Step 2: Query runs excluding test strategy IDs, scoped to our test data
    const { data: filteredRuns, error: runErr } = await supabase
      .from('evolution_runs')
      .select('id, strategy_id')
      .in('id', [testRunId, e2eRunId, realRunId])
      .not('strategy_id', 'in', `(${testStrategyId},${e2eStrategyId})`);

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

    // With no IDs to exclude, query should return all runs
    const { data: allRuns, error: runErr } = await supabase
      .from('evolution_runs')
      .select('id')
      .in('id', [testRunId, e2eRunId, realRunId]);

    expect(runErr).toBeNull();
    expect(allRuns).toHaveLength(3);
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
      .not('strategy_id', 'in', `(${testStrategyId},${e2eStrategyId})`)
      .in('id', [testRunId, e2eRunId, realRunId]);

    expect(error).toBeNull();
    expect(runs).toHaveLength(1);
    expect(runs?.[0]?.id).toBe(realRunId);
  });
});

// ─── Phase 1 (plan_file/_planning.md) B17 — prompts column filter ────────────

describe('evolution_prompts applyTestContentColumnFilter (Phase 1 B17 fix)', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const createdPromptIds: string[] = [];
  let realName = '';

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) return;

    // Seed four prompts: [TEST], [E2E], timestamp-pattern (e2e-*), real-named.
    // After migration 20260423000001 the evolution_prompts BEFORE trigger
    // should set is_test_content=true for the first three and false for
    // the last one.
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    realName = `Real Prompt ${suffix}`;
    const seeds = [
      { prompt: `body A ${suffix}`, name: `[TEST] Bracket ${suffix}` },
      { prompt: `body B ${suffix}`, name: `[E2E] Bracket ${suffix}` },
      { prompt: `body C ${suffix}`, name: `e2e-nav-${Date.now()}-prompt` },
      { prompt: `body D ${suffix}`, name: realName },
    ];
    for (const seed of seeds) {
      const { data, error } = await supabase
        .from('evolution_prompts')
        .insert(seed)
        .select('id')
        .single();
      if (error) throw new Error(`seed ${seed.name} failed: ${error.message}`);
      createdPromptIds.push(data.id as string);
    }
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, { promptIds: createdPromptIds });
  });

  it('trigger marks test-named prompts as is_test_content=true and real-named as false', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_prompts')
      .select('id, name, is_test_content')
      .in('id', createdPromptIds);

    expect(error).toBeNull();
    expect(data).toHaveLength(4);
    for (const row of data ?? []) {
      if (row.name === realName) {
        expect(row.is_test_content).toBe(false);
      } else {
        expect(row.is_test_content).toBe(true);
      }
    }
  });

  it('applying .eq(is_test_content, false) returns only the real-named prompt', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_prompts')
      .select('id, name')
      .eq('is_test_content', false)
      .in('id', createdPromptIds);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe(realName);
  });
});

