// Tests the runWatchdog function against real Supabase DB.
// Verifies stale run detection, heartbeat thresholds, and status filtering.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
} from '@evolution/testing/evolution-test-helpers';
import { runWatchdog } from '@evolution/lib/maintenance/watchdog';

describe('Evolution Watchdog Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  // Track all created IDs for cleanup
  const createdRunIds: string[] = [];
  const createdStrategyIds: string[] = [];
  const createdPromptIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      runIds: createdRunIds,
      strategyIds: createdStrategyIds,
      promptIds: createdPromptIds,
    });
  });

  /** Helper: create a run and track its IDs for cleanup. */
  async function createTrackedRun(overrides: Record<string, unknown>) {
    const run = await createTestEvolutionRun(supabase, null, overrides);
    createdRunIds.push(run.id as string);
    if (run.strategy_id && !createdStrategyIds.includes(run.strategy_id as string)) {
      createdStrategyIds.push(run.strategy_id as string);
    }
    if (run.prompt_id && !createdPromptIds.includes(run.prompt_id as string)) {
      createdPromptIds.push(run.prompt_id as string);
    }
    return run;
  }

  it('marks running run with stale heartbeat as failed', async () => {
    if (!tablesExist) return;

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const run = await createTrackedRun({
      status: 'running',
      runner_id: 'test-runner-stale',
      last_heartbeat: fifteenMinAgo,
    });
    const runId = run.id as string;

    const result = await runWatchdog(supabase, 10);

    expect(result.markedFailed).toContain(runId);

    // Verify DB state
    const { data } = await supabase
      .from('evolution_runs')
      .select('status, runner_id, error_message')
      .eq('id', runId)
      .single();

    expect(data!.status).toBe('failed');
    expect(data!.runner_id).toBeNull();
    expect(data!.error_message).toContain('abandoned');
  });

  it('does NOT mark running run with fresh heartbeat', async () => {
    if (!tablesExist) return;

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const run = await createTrackedRun({
      status: 'running',
      runner_id: 'test-runner-fresh',
      last_heartbeat: fiveMinAgo,
    });
    const runId = run.id as string;

    const result = await runWatchdog(supabase, 10);

    expect(result.markedFailed).not.toContain(runId);

    // Verify DB state unchanged
    const { data } = await supabase
      .from('evolution_runs')
      .select('status, runner_id')
      .eq('id', runId)
      .single();

    expect(data!.status).toBe('running');
    expect(data!.runner_id).toBe('test-runner-fresh');
  });

  it('marks claimed run with null heartbeat and old created_at as failed', async () => {
    if (!tablesExist) return;

    const run = await createTrackedRun({
      status: 'claimed',
      runner_id: 'test-runner-null-hb',
      last_heartbeat: null,
    });
    const runId = run.id as string;

    // Manually backdate created_at to 15 minutes ago
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await supabase
      .from('evolution_runs')
      .update({ created_at: fifteenMinAgo })
      .eq('id', runId);

    const result = await runWatchdog(supabase, 10);

    expect(result.markedFailed).toContain(runId);

    const { data } = await supabase
      .from('evolution_runs')
      .select('status, runner_id, error_message')
      .eq('id', runId)
      .single();

    expect(data!.status).toBe('failed');
    expect(data!.runner_id).toBeNull();
    expect(data!.error_message).toContain('abandoned');
  });

  it('never selects pending or completed runs', async () => {
    if (!tablesExist) return;

    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const pendingRun = await createTrackedRun({
      status: 'pending',
      last_heartbeat: fifteenMinAgo,
    });
    const completedRun = await createTrackedRun({
      status: 'completed',
      last_heartbeat: fifteenMinAgo,
    });

    const result = await runWatchdog(supabase, 10);

    expect(result.markedFailed).not.toContain(pendingRun.id as string);
    expect(result.markedFailed).not.toContain(completedRun.id as string);

    // Verify statuses unchanged
    const { data: pData } = await supabase
      .from('evolution_runs')
      .select('status')
      .eq('id', pendingRun.id as string)
      .single();
    expect(pData!.status).toBe('pending');

    const { data: cData } = await supabase
      .from('evolution_runs')
      .select('status')
      .eq('id', completedRun.id as string)
      .single();
    expect(cData!.status).toBe('completed');
  });
});
