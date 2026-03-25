// Integration tests for experiment creation and completion lifecycle via direct DB operations.
// Verifies experiment CRUD, run linking, and status transitions using real Supabase queries.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
  createTestPrompt,
} from '@evolution/testing/evolution-test-helpers';

describe('Evolution Experiment Create & Complete Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  // Track IDs for cleanup
  let promptId: string;
  let strategyId: string;
  let expId: string;
  const runIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) return;

    promptId = await createTestPrompt(supabase);
    strategyId = await createTestStrategyConfig(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      runIds,
      strategyIds: [strategyId],
      promptIds: [promptId],
    });
    if (expId) {
      await supabase.from('evolution_experiments').delete().eq('id', expId);
    }
  });

  it('creates an experiment with correct fields', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_experiments')
      .insert({
        name: '[TEST_EVO] create-complete experiment',
        prompt_id: promptId,
        status: 'draft',
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.name).toBe('[TEST_EVO] create-complete experiment');
    expect(data.prompt_id).toBe(promptId);
    expect(data.status).toBe('draft');
    expect(data.id).toBeDefined();
    expId = data.id;
  });

  it('verifies experiment row exists after creation', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_experiments')
      .select('*')
      .eq('id', expId)
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.name).toBe('[TEST_EVO] create-complete experiment');
    expect(data.prompt_id).toBe(promptId);
    expect(data.created_at).toBeDefined();
  });

  it('adds a run linked to the experiment via DB insert', async () => {
    if (!tablesExist) return;

    const runId = crypto.randomUUID();
    runIds.push(runId);

    const { data, error } = await supabase
      .from('evolution_runs')
      .insert({
        id: runId,
        strategy_id: strategyId,
        prompt_id: promptId,
        experiment_id: expId,
        status: 'pending',
        budget_cap_usd: 5.0,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.experiment_id).toBe(expId);
    expect(data.strategy_id).toBe(strategyId);
  });

  it('verifies run is linked to experiment', async () => {
    if (!tablesExist) return;

    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, experiment_id, status')
      .eq('experiment_id', expId);

    expect(error).toBeNull();
    expect(runs).toBeDefined();
    expect(runs!.length).toBe(1);
    expect(runs![0].experiment_id).toBe(expId);
  });

  it('updates experiment status to completed', async () => {
    if (!tablesExist) return;

    const { error } = await supabase
      .from('evolution_experiments')
      .update({ status: 'completed' })
      .eq('id', expId);

    expect(error).toBeNull();

    const { data, error: readErr } = await supabase
      .from('evolution_experiments')
      .select('status')
      .eq('id', expId)
      .single();

    expect(readErr).toBeNull();
    expect(data?.status).toBe('completed');
  });

  it('completed experiment preserves all linked runs', async () => {
    if (!tablesExist) return;

    // Add a second run to the completed experiment
    const run2Id = crypto.randomUUID();
    runIds.push(run2Id);

    const { error: insertErr } = await supabase
      .from('evolution_runs')
      .insert({
        id: run2Id,
        strategy_id: strategyId,
        prompt_id: promptId,
        experiment_id: expId,
        status: 'completed',
        budget_cap_usd: 3.0,
      });
    expect(insertErr).toBeNull();

    // Verify both runs still linked
    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('id, experiment_id')
      .eq('experiment_id', expId)
      .order('created_at', { ascending: true });

    expect(error).toBeNull();
    expect(runs).toBeDefined();
    expect(runs!.length).toBe(2);
    expect(runs!.every(r => r.experiment_id === expId)).toBe(true);

    // Verify experiment is still completed
    const { data: exp } = await supabase
      .from('evolution_experiments')
      .select('status, name')
      .eq('id', expId)
      .single();

    expect(exp?.status).toBe('completed');
    expect(exp?.name).toBe('[TEST_EVO] create-complete experiment');
  });
});
