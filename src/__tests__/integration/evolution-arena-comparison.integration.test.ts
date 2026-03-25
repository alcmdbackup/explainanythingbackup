// Integration tests for arena comparison workflow via direct DB operations.
// Verifies prompt creation, variant linking, arena comparisons, and archiving using real Supabase.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
  createTestPrompt,
  createTestVariant,
  createTestEvolutionRun,
  VALID_VARIANT_TEXT,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Arena Comparison Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  // Track IDs for cleanup
  let promptId: string;
  let strategyId: string;
  let runId: string;
  let variantAId: string;
  let variantBId: string;
  const comparisonIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) return;

    // Create supporting data: strategy, prompt, run, and two variants
    strategyId = await createTestStrategyConfig(supabase);
    promptId = await createTestPrompt(supabase);

    const run = await createTestEvolutionRun(supabase, null, {
      strategy_id: strategyId,
      prompt_id: promptId,
    });
    runId = run.id as string;

    const varA = await createTestVariant(supabase, runId, null, {
      prompt_id: promptId,
      synced_to_arena: true,
      elo_score: 1200,
      mu: 25.0,
      sigma: 8.333,
      arena_match_count: 0,
    });
    variantAId = varA.id as string;

    const varB = await createTestVariant(supabase, runId, null, {
      prompt_id: promptId,
      synced_to_arena: true,
      elo_score: 1200,
      mu: 25.0,
      sigma: 8.333,
      arena_match_count: 0,
    });
    variantBId = varB.id as string;
  });

  afterAll(async () => {
    if (!tablesExist) return;

    // Delete comparisons first (FK to variants)
    if (comparisonIds.length > 0) {
      await supabase
        .from('evolution_arena_comparisons')
        .delete()
        .in('id', comparisonIds);
    }

    await cleanupEvolutionData(supabase, {
      runIds: [runId],
      strategyIds: [strategyId],
      promptIds: [promptId],
    });
  });

  it('creates a prompt (arena topic) with correct fields', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_prompts')
      .select('*')
      .eq('id', promptId)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.name).toContain('[TEST]');
    expect(data.status).toBe('active');
    expect(data.created_at).toBeDefined();
  });

  it('creates variants linked to the prompt', async () => {
    if (!tablesExist) return;

    const { data: variants, error } = await supabase
      .from('evolution_variants')
      .select('id, prompt_id, synced_to_arena, elo_score')
      .eq('prompt_id', promptId)
      .eq('synced_to_arena', true);

    expect(error).toBeNull();
    expect(variants).toBeDefined();
    expect(variants!.length).toBe(2);
    expect(variants!.every(v => v.prompt_id === promptId)).toBe(true);
    expect(variants!.every(v => v.synced_to_arena === true)).toBe(true);
  });

  it('inserts an arena comparison record', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_arena_comparisons')
      .insert({
        prompt_id: promptId,
        entry_a: variantAId,
        entry_b: variantBId,
        winner: 'a',
        confidence: 0.85,
        run_id: runId,
        status: 'completed',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.id).toBeDefined();
    comparisonIds.push(data.id);
    expect(data.winner).toBe('a');
    expect(data.confidence).toBe(0.85);
  });

  it('reads comparisons back for the prompt', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_arena_comparisons')
      .select('*')
      .eq('prompt_id', promptId)
      .order('created_at', { ascending: false });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThanOrEqual(1);

    const comparison = data![0];
    expect(comparison.prompt_id).toBe(promptId);
    expect(comparison.status).toBe('completed');
  });

  it('verifies comparison links to correct variants', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_arena_comparisons')
      .select('entry_a, entry_b, winner')
      .eq('id', comparisonIds[0])
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.entry_a).toBe(variantAId);
    expect(data!.entry_b).toBe(variantBId);
    expect(data!.winner).toBe('a');
  });

  it('archives prompt and verifies status change', async () => {
    if (!tablesExist) return;

    const { error: updateErr } = await supabase
      .from('evolution_prompts')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', promptId);

    expect(updateErr).toBeNull();

    const { data, error } = await supabase
      .from('evolution_prompts')
      .select('status, archived_at')
      .eq('id', promptId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe('archived');
    expect(data?.archived_at).toBeDefined();
    expect(data?.archived_at).not.toBeNull();
  });
});
