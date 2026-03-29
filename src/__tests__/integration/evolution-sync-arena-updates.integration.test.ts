// Integration tests for the p_arena_updates parameter of sync_to_arena RPC.
// Verifies that existing arena entries get mu/sigma/elo_score/arena_match_count updated without
// overwriting immutable fields (variant_content, run_id, generation_method).

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
  VALID_VARIANT_TEXT,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Sync to Arena — p_arena_updates', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

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
    if (variantIds.length > 0) {
      await supabase.from('evolution_variants').delete().in('id', variantIds);
    }
    await cleanupEvolutionData(supabase, { runIds, strategyIds, promptIds });
  });

  it('p_arena_updates updates mu/sigma/elo_score/arena_match_count for existing arena entries', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    const promptId = run.prompt_id as string;
    const strategyId = run.strategy_id as string;
    runIds.push(runId);
    strategyIds.push(strategyId);
    promptIds.push(promptId);

    // First: insert an arena entry via p_entries
    const arenaId = crypto.randomUUID();
    variantIds.push(arenaId);

    const { error: insertErr } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: [{
        id: arenaId,
        variant_content: VALID_VARIANT_TEXT,
        mu: 25,
        sigma: 8.333,
        elo_score: 1200,
        arena_match_count: 5,
        generation_method: 'pipeline',
      }],
      p_matches: [],
      p_arena_updates: [],
    });
    expect(insertErr).toBeNull();

    // Second: update via p_arena_updates (ratings only)
    const { error: updateErr } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: [],
      p_matches: [],
      p_arena_updates: [{
        id: arenaId,
        mu: 30,
        sigma: 4.5,
        elo_score: 1400,
        arena_match_count: 15,
      }],
    });
    expect(updateErr).toBeNull();

    // Verify: ratings updated, immutable fields preserved
    const { data: rows } = await supabase
      .from('evolution_variants')
      .select('id, mu, sigma, elo_score, arena_match_count, variant_content, run_id, generation_method')
      .eq('id', arenaId);

    expect(rows).toHaveLength(1);
    const row = rows![0]!;
    // Updated fields
    expect(Number(row.mu)).toBe(30);
    expect(Number(row.sigma)).toBe(4.5);
    expect(Number(row.elo_score)).toBe(1400);
    expect(row.arena_match_count).toBe(15);
    // Immutable fields preserved
    expect(row.variant_content).toBe(VALID_VARIANT_TEXT);
    expect(row.run_id).toBe(runId);
    expect(row.generation_method).toBe('pipeline');
  });

  it('p_arena_updates only affects synced_to_arena=true entries', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    const promptId = run.prompt_id as string;
    const strategyId = run.strategy_id as string;
    runIds.push(runId);
    strategyIds.push(strategyId);
    promptIds.push(promptId);

    // Insert a non-arena variant directly (synced_to_arena=false)
    const nonArenaId = crypto.randomUUID();
    variantIds.push(nonArenaId);
    await supabase.from('evolution_variants').insert({
      id: nonArenaId,
      run_id: runId,
      variant_content: VALID_VARIANT_TEXT,
      mu: 25,
      sigma: 8.333,
      elo_score: 1200,
      prompt_id: promptId,
      synced_to_arena: false,
    });

    // Try to update via p_arena_updates — should have no effect (WHERE synced_to_arena=true)
    const { error } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: [],
      p_matches: [],
      p_arena_updates: [{
        id: nonArenaId,
        mu: 50,
        sigma: 1.0,
        elo_score: 2000,
        arena_match_count: 100,
      }],
    });
    expect(error).toBeNull();

    // Verify: mu should still be 25 (unchanged)
    const { data: rows } = await supabase
      .from('evolution_variants')
      .select('mu')
      .eq('id', nonArenaId);
    expect(Number(rows![0]!.mu)).toBe(25);
  });

  it('p_arena_updates over-limit rejection (201 entries)', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    const promptId = run.prompt_id as string;
    const strategyId = run.strategy_id as string;
    runIds.push(runId);
    strategyIds.push(strategyId);
    promptIds.push(promptId);

    const updates = Array.from({ length: 201 }, () => ({
      id: crypto.randomUUID(),
      mu: 30,
      sigma: 4.0,
      elo_score: 1400,
      arena_match_count: 10,
    }));

    const { error } = await supabase.rpc('sync_to_arena', {
      p_prompt_id: promptId,
      p_run_id: runId,
      p_entries: [],
      p_matches: [],
      p_arena_updates: updates,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain('exceeds maximum');
  });
});
