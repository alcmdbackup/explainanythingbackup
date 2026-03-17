// Integration tests for evolution_explanations table and FK relationships.
// Verifies: table creation, run creation with dual columns, sync assertion, cleanup.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createTestEvolutionExplanation,
  createTestVariant,
  createTestPrompt,
  createTestStrategyConfig,
  evolutionTablesExist,
  assertEvolutionExplanationSync,
} from '@evolution/testing/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
} from '@/testing/utils/integration-helpers';

jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

import { SupabaseClient } from '@supabase/supabase-js';

describe('[TEST] Evolution Explanations Integration', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testStrategyConfigId: string;
  let testPromptId: string;
  const trackedRunIds: string[] = [];
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping evolution_explanations tests: tables not yet migrated');
      return;
    }

    // Check if evolution_explanations table exists
    const { error: tableCheck } = await supabase
      .from('evolution_explanations')
      .select('id')
      .limit(1);
    if (tableCheck && (tableCheck.code === '42P01' || tableCheck.message?.includes('does not exist'))) {
      tablesReady = false;
      console.warn('⏭️  Skipping: evolution_explanations table not yet migrated');
      return;
    }

    testStrategyConfigId = await createTestStrategyConfig(supabase);
    testPromptId = await createTestPrompt(supabase);
  });

  afterAll(async () => {
    if (tablesReady) {
      await cleanupEvolutionData(supabase, trackedExplanationIds, trackedRunIds);
      await supabase.from('evolution_strategy_configs').delete().eq('id', testStrategyConfigId);
      await supabase.from('evolution_arena_topics').delete().eq('id', testPromptId);
    }
    await teardownTestDatabase(supabase);
  });

  // ─── Table & Column Existence ──────────────────────────────────

  it('evolution_explanations table is queryable', async () => {
    if (!tablesReady) return;

    const { error } = await supabase
      .from('evolution_explanations')
      .select('id, explanation_id, prompt_id, title, content, source, created_at')
      .limit(1);

    expect(error).toBeNull();
  });

  it('evolution_runs has evolution_explanation_id column', async () => {
    if (!tablesReady) return;

    const { error } = await supabase
      .from('evolution_runs')
      .select('evolution_explanation_id')
      .limit(1);

    expect(error).toBeNull();
  });

  // ─── Factory Helpers ───────────────────────────────────────────

  it('createTestEvolutionExplanation inserts a row and returns UUID', async () => {
    if (!tablesReady) return;

    const id = await createTestEvolutionExplanation(supabase, {
      promptId: testPromptId,
      title: 'Test Explanation',
      content: 'Some test content',
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    // Verify row exists
    const { data, error } = await supabase
      .from('evolution_explanations')
      .select('*')
      .eq('id', id)
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe('Test Explanation');
    expect(data?.source).toBe('prompt_seed');

    // Clean up
    await supabase.from('evolution_explanations').delete().eq('id', id);
  });

  // ─── Run Creation with Dual Columns ────────────────────────────

  it('createTestEvolutionRun populates both explanation_id and evolution_explanation_id', async () => {
    if (!tablesReady) return;

    // Create a run with explanation_id = null (prompt-based)
    const run = await createTestEvolutionRun(supabase, null, {
      strategy_config_id: testStrategyConfigId,
      prompt_id: testPromptId,
    });
    trackedRunIds.push(run.id as string);

    expect(run.evolution_explanation_id).toBeDefined();
    expect(run.evolution_explanation_id).not.toBeNull();

    // Verify the evolution_explanation row exists
    const { data: evoExpl } = await supabase
      .from('evolution_explanations')
      .select('*')
      .eq('id', run.evolution_explanation_id)
      .single();

    expect(evoExpl).toBeDefined();
    expect(evoExpl?.source).toBe('prompt_seed');
  });

  // ─── Variant Creation with Dual Columns ────────────────────────

  it('createTestVariant works with runs that have evolution_explanation_id', async () => {
    if (!tablesReady) return;

    const run = await createTestEvolutionRun(supabase, null, {
      strategy_config_id: testStrategyConfigId,
      prompt_id: testPromptId,
    });
    trackedRunIds.push(run.id as string);

    const variant = await createTestVariant(supabase, run.id as string, null);

    expect(variant).toBeDefined();
    expect(variant.run_id).toBe(run.id);
  });

  // ─── Sync Assertion ────────────────────────────────────────────

  it('assertEvolutionExplanationSync passes for properly linked explanation-based runs', async () => {
    if (!tablesReady) return;

    // Create a test explanation in the main explanations table
    const { data: mainExpl } = await supabase
      .from('explanations')
      .insert({
        explanation_title: '[TEST] Sync Test',
        content: 'Test sync content',
        primary_topic_id: 1, // Assumes topic 1 exists
        status: 'draft',
      })
      .select('id')
      .single();

    if (!mainExpl) {
      console.warn('⏭️  Skipping sync test: could not create test explanation');
      return;
    }

    trackedExplanationIds.push(mainExpl.id);

    const evoExplId = await createTestEvolutionExplanation(supabase, {
      explanationId: mainExpl.id,
      title: '[TEST] Sync Test',
      content: 'Test sync content',
    });

    const run = await createTestEvolutionRun(supabase, mainExpl.id, {
      strategy_config_id: testStrategyConfigId,
      prompt_id: testPromptId,
      evolution_explanation_id: evoExplId,
    });
    trackedRunIds.push(run.id as string);

    // Should not throw
    await assertEvolutionExplanationSync(supabase, [run.id as string]);
  });

  // ─── Cleanup Includes evolution_explanations ───────────────────

  it('cleanupEvolutionData removes evolution_explanations rows', async () => {
    if (!tablesReady) return;

    const evoExplId = await createTestEvolutionExplanation(supabase, {
      promptId: testPromptId,
    });

    const run = await createTestEvolutionRun(supabase, null, {
      strategy_config_id: testStrategyConfigId,
      prompt_id: testPromptId,
      evolution_explanation_id: evoExplId,
    });

    // Clean up via helper
    await cleanupEvolutionData(supabase, [], [run.id as string]);

    // Verify run is deleted
    const { data: runCheck } = await supabase
      .from('evolution_runs')
      .select('id')
      .eq('id', run.id)
      .maybeSingle();
    expect(runCheck).toBeNull();

    // Verify evolution_explanation is deleted
    const { data: evoExplCheck } = await supabase
      .from('evolution_explanations')
      .select('id')
      .eq('id', evoExplId)
      .maybeSingle();
    expect(evoExplCheck).toBeNull();
  });
});
