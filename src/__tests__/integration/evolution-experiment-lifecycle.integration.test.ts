// Integration tests for experiment auto-completion lifecycle via complete_experiment_if_done RPC.
// Verifies that experiments only complete when all sibling runs are done.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
  createTestPrompt,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Experiment Lifecycle Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  // Shared test data
  let expId: string;
  let strategyId: string;
  let promptId: string;
  const run1Id = crypto.randomUUID();
  const run2Id = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) return;

    strategyId = await createTestStrategyConfig(supabase);
    promptId = await createTestPrompt(supabase);

    // Create experiment with status='running'
    const { data: exp, error: expErr } = await supabase
      .from('evolution_experiments')
      .insert({ name: '[TEST] lifecycle experiment', prompt_id: promptId, status: 'running' })
      .select('id')
      .single();
    if (expErr) throw new Error(`Failed to create experiment: ${expErr.message}`);
    expId = exp.id;

    // Create 2 runs, both pending initially
    const { error: runErr } = await supabase.from('evolution_runs').insert([
      { id: run1Id, strategy_id: strategyId, prompt_id: promptId, experiment_id: expId, status: 'running' },
      { id: run2Id, strategy_id: strategyId, prompt_id: promptId, experiment_id: expId, status: 'running' },
    ]);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      runIds: [run1Id, run2Id],
      strategyIds: [strategyId],
      promptIds: [promptId],
    });
    if (expId) {
      await supabase.from('evolution_experiments').delete().eq('id', expId);
    }
  });

  it('experiment stays running when not all runs complete', async () => {
    if (!tablesExist) return;

    // Complete run 1
    await supabase
      .from('evolution_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', run1Id);

    const { error: rpcErr } = await supabase.rpc('complete_experiment_if_done', {
      p_experiment_id: expId,
      p_completed_run_id: run1Id,
    });
    expect(rpcErr).toBeNull();

    // Experiment should still be 'running' because run2 is not done
    const { data: expAfter } = await supabase
      .from('evolution_experiments')
      .select('status')
      .eq('id', expId)
      .single();
    expect(expAfter?.status).toBe('running');
  });

  it('experiment completes when all runs done', async () => {
    if (!tablesExist) return;

    // Complete run 2
    await supabase
      .from('evolution_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', run2Id);

    const { error: rpcErr } = await supabase.rpc('complete_experiment_if_done', {
      p_experiment_id: expId,
      p_completed_run_id: run2Id,
    });
    expect(rpcErr).toBeNull();

    // Experiment should now be 'completed'
    const { data: expAfter } = await supabase
      .from('evolution_experiments')
      .select('status')
      .eq('id', expId)
      .single();
    expect(expAfter?.status).toBe('completed');
  });
});
