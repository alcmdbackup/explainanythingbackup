// Integration tests for the sync_to_arena RPC.
// Verifies upsert behavior, ON CONFLICT updates, and over-limit rejection against real Supabase DB.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
  VALID_VARIANT_TEXT,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Sync to Arena Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  // Track created IDs for cleanup
  const runIds: string[] = [];
  const strategyIds: string[] = [];
  const promptIds: string[] = [];
  const variantIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    // Clean up variants inserted by sync_to_arena (not covered by cleanupEvolutionData run_id delete)
    if (variantIds.length > 0) {
      await supabase.from('evolution_variants').delete().in('id', variantIds);
    }
    await cleanupEvolutionData(supabase, {
      runIds,
      strategyIds,
      promptIds,
    });
  });

  it('basic upsert inserts new entries', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    const promptId = run.prompt_id as string;
    const strategyId = run.strategy_id as string;
    runIds.push(runId);
    strategyIds.push(strategyId);
    promptIds.push(promptId);

    const entries = Array.from({ length: 3 }, () => {
      const id = crypto.randomUUID();
      variantIds.push(id);
      return {
        id,
        variant_content: VALID_VARIANT_TEXT,
        mu: 25,
        sigma: 8.333,
        elo_score: 1200,
      };
    });

    const { error } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: entries,
      p_matches: [],
    });
    expect(error).toBeNull();

    // Verify 3 rows with synced_to_arena=true
    const { data: rows } = await supabase
      .from('evolution_variants')
      .select('id, synced_to_arena, mu')
      .in('id', entries.map((e) => e.id));

    expect(rows).toHaveLength(3);
    for (const row of rows!) {
      expect(row.synced_to_arena).toBe(true);
    }
  });

  it('ON CONFLICT updates existing entry', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    const promptId = run.prompt_id as string;
    const strategyId = run.strategy_id as string;
    runIds.push(runId);
    strategyIds.push(strategyId);
    promptIds.push(promptId);

    const variantId = crypto.randomUUID();
    variantIds.push(variantId);

    // First sync — insert
    const entry = {
      id: variantId,
      variant_content: VALID_VARIANT_TEXT,
      mu: 25,
      sigma: 8.333,
      elo_score: 1200,
    };
    const { error: firstErr } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: [entry],
      p_matches: [],
    });
    expect(firstErr).toBeNull();

    // Second sync — update mu
    const updatedEntry = { ...entry, mu: 30 };
    const { error: secondErr } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: [updatedEntry],
      p_matches: [],
    });
    expect(secondErr).toBeNull();

    // Verify mu updated, not duplicated
    const { data: rows } = await supabase
      .from('evolution_variants')
      .select('id, mu')
      .eq('id', variantId);

    expect(rows).toHaveLength(1);
    expect(Number(rows![0].mu)).toBe(30);
  });

  it('over-limit rejection (201 entries)', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    const promptId = run.prompt_id as string;
    const strategyId = run.strategy_id as string;
    runIds.push(runId);
    strategyIds.push(strategyId);
    promptIds.push(promptId);

    // Create 201 entries (limit is 200)
    const entries = Array.from({ length: 201 }, () => ({
      id: crypto.randomUUID(),
      variant_content: VALID_VARIANT_TEXT,
      mu: 25,
      sigma: 8.333,
      elo_score: 1200,
    }));

    const { error } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: entries,
      p_matches: [],
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('exceeds maximum');
  });
});
