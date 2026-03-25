// Integration tests for the cancel_experiment RPC.
// Verifies that cancelling an experiment fails pending/claimed/running runs and leaves completed runs unchanged.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
  createTestPrompt,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Cancel Experiment Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  // Track created IDs for cleanup
  const experimentIds: string[] = [];
  const runIds: string[] = [];
  const strategyIds: string[] = [];
  const promptIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    // Clean runs first (FK dependency)
    await cleanupEvolutionData(supabase, {
      runIds,
      strategyIds,
      promptIds,
    });
    // Clean experiments (no FK helper — do it manually)
    for (const expId of experimentIds) {
      await supabase.from('evolution_experiments').delete().eq('id', expId);
    }
  });

  it('cancel running experiment fails pending/claimed/running runs and leaves completed unchanged', async () => {
    if (!tablesExist) return;

    const strategyId = await createTestStrategyConfig(supabase);
    strategyIds.push(strategyId);
    const promptId = await createTestPrompt(supabase);
    promptIds.push(promptId);

    // Create experiment with status='running'
    const { data: exp, error: expErr } = await supabase
      .from('evolution_experiments')
      .insert({ name: '[TEST] cancel experiment', prompt_id: promptId, status: 'running' })
      .select('id')
      .single();
    if (expErr) throw new Error(`Failed to create experiment: ${expErr.message}`);
    experimentIds.push(exp.id);

    // Create 3 runs: pending, running, completed
    const pendingRunId = crypto.randomUUID();
    const runningRunId = crypto.randomUUID();
    const completedRunId = crypto.randomUUID();
    runIds.push(pendingRunId, runningRunId, completedRunId);

    const { error: runErr } = await supabase.from('evolution_runs').insert([
      { id: pendingRunId, strategy_id: strategyId, prompt_id: promptId, experiment_id: exp.id, status: 'pending' },
      { id: runningRunId, strategy_id: strategyId, prompt_id: promptId, experiment_id: exp.id, status: 'running' },
      { id: completedRunId, strategy_id: strategyId, prompt_id: promptId, experiment_id: exp.id, status: 'completed', completed_at: new Date().toISOString() },
    ]);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);

    // Call cancel_experiment RPC
    const { error: rpcErr } = await supabase.rpc('cancel_experiment', { p_experiment_id: exp.id });
    expect(rpcErr).toBeNull();

    // Assert experiment status='cancelled'
    const { data: expAfter } = await supabase
      .from('evolution_experiments')
      .select('status')
      .eq('id', exp.id)
      .single();
    expect(expAfter?.status).toBe('cancelled');

    // Assert pending+running runs → 'failed' with error_message
    const { data: failedRuns } = await supabase
      .from('evolution_runs')
      .select('id, status, error_message')
      .in('id', [pendingRunId, runningRunId]);
    expect(failedRuns).toHaveLength(2);
    for (const run of failedRuns!) {
      expect(run.status).toBe('failed');
      expect(run.error_message).toBe('Experiment cancelled');
    }

    // Assert completed run unchanged
    const { data: completedRun } = await supabase
      .from('evolution_runs')
      .select('status')
      .eq('id', completedRunId)
      .single();
    expect(completedRun?.status).toBe('completed');
  });

  it('cancel already-cancelled experiment is idempotent', async () => {
    if (!tablesExist) return;

    const promptId = await createTestPrompt(supabase);
    promptIds.push(promptId);

    // Create experiment with status='cancelled'
    const { data: exp, error: expErr } = await supabase
      .from('evolution_experiments')
      .insert({ name: '[TEST] already cancelled', prompt_id: promptId, status: 'cancelled' })
      .select('id')
      .single();
    if (expErr) throw new Error(`Failed to create experiment: ${expErr.message}`);
    experimentIds.push(exp.id);

    // Call cancel again — should not error
    const { error: rpcErr } = await supabase.rpc('cancel_experiment', { p_experiment_id: exp.id });
    expect(rpcErr).toBeNull();
  });

  it('cancel experiment with no runs only updates experiment status', async () => {
    if (!tablesExist) return;

    const promptId = await createTestPrompt(supabase);
    promptIds.push(promptId);

    // Create running experiment with no runs
    const { data: exp, error: expErr } = await supabase
      .from('evolution_experiments')
      .insert({ name: '[TEST] no runs cancel', prompt_id: promptId, status: 'running' })
      .select('id')
      .single();
    if (expErr) throw new Error(`Failed to create experiment: ${expErr.message}`);
    experimentIds.push(exp.id);

    const { error: rpcErr } = await supabase.rpc('cancel_experiment', { p_experiment_id: exp.id });
    expect(rpcErr).toBeNull();

    // Assert status changed to 'cancelled'
    const { data: expAfter } = await supabase
      .from('evolution_experiments')
      .select('status')
      .eq('id', exp.id)
      .single();
    expect(expAfter?.status).toBe('cancelled');
  });
});
