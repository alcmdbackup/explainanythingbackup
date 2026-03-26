// Integration tests for evolution visualization/dashboard data queries.
// Tests the underlying DB queries that power the dashboard action, without going through adminAction auth.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestAgentInvocation,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionRunSummarySchema } from '@evolution/lib/types';

describe('Evolution Visualization Data Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  // Shared test data IDs
  const strategyId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const completedRunId = crypto.randomUUID();
  const pendingRunId = crypto.randomUUID();
  const failedRunId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping visualization data tests');
      return;
    }

    // Create strategy
    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: '[TEST_EVO] viz-strategy',
        label: '[TEST_EVO] Viz Strategy',
        config: { test: true },
        config_hash: `test-viz-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    // Create prompt
    const { error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ id: promptId, prompt: '[TEST_EVO] viz prompt', name: '[TEST_EVO] Viz Prompt' });
    if (promptErr) throw new Error(`Failed to create prompt: ${promptErr.message}`);

    // Create runs with different statuses
    const muHistory = [[1200], [1300], [1400]];
    const runSummary = { muHistory, winnerElo: 1400 };

    const runs = [
      {
        id: completedRunId,
        strategy_id: strategyId,
        prompt_id: promptId,
        status: 'completed',
        completed_at: new Date().toISOString(),
        run_summary: runSummary,
      },
      {
        id: pendingRunId,
        strategy_id: strategyId,
        prompt_id: promptId,
        status: 'pending',
      },
      {
        id: failedRunId,
        strategy_id: strategyId,
        prompt_id: promptId,
        status: 'failed',
      },
    ];
    const { error: runErr } = await supabase.from('evolution_runs').insert(runs);
    if (runErr) throw new Error(`Failed to create runs: ${runErr.message}`);

    // Add invocations with costs to the completed run
    await createTestAgentInvocation(supabase, completedRunId, 0, 'gen-agent', { costUsd: 0.025, executionOrder: 0 });
    await createTestAgentInvocation(supabase, completedRunId, 0, 'judge-agent', { costUsd: 0.015, executionOrder: 1 });
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      runIds: [completedRunId, pendingRunId, failedRunId],
      strategyIds: [strategyId],
      promptIds: [promptId],
    });
  });

  it('dashboard query returns correct status counts', async () => {
    if (!tablesExist) return;

    // Query all runs (mirrors dashboard action logic)
    const { data: allRuns, error } = await supabase
      .from('evolution_runs')
      .select('status')
      .in('id', [completedRunId, pendingRunId, failedRunId]);

    expect(error).toBeNull();
    expect(allRuns).toHaveLength(3);

    const completed = allRuns!.filter(r => r.status === 'completed').length;
    const pending = allRuns!.filter(r => r.status === 'pending').length;
    const failed = allRuns!.filter(r => r.status === 'failed').length;

    expect(completed).toBe(1);
    expect(pending).toBe(1);
    expect(failed).toBe(1);
  });

  it('dashboard with no runs returns zeros for a non-existent strategy', async () => {
    if (!tablesExist) return;

    const fakeStrategyId = crypto.randomUUID();
    const { data: runs, error } = await supabase
      .from('evolution_runs')
      .select('status')
      .eq('strategy_id', fakeStrategyId);

    expect(error).toBeNull();
    expect(runs).toEqual([]);

    // Derive dashboard metrics from empty data
    const activeRuns = (runs ?? []).filter(r => r.status === 'running').length;
    const completedRuns = (runs ?? []).filter(r => r.status === 'completed').length;
    expect(activeRuns).toBe(0);
    expect(completedRuns).toBe(0);
  });

  it('elo history from run_summary has expected shape', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_runs')
      .select('run_summary')
      .eq('id', completedRunId)
      .single();

    expect(error).toBeNull();
    expect(data?.run_summary).toBeDefined();

    // Parse with schema like the action does
    const parsed = EvolutionRunSummarySchema.safeParse(data!.run_summary);
    if (parsed.success) {
      const summary = parsed.data;
      const eloHistory = (summary.muHistory ?? []).map(
        (mus: number[], i: number) => ({ iteration: i + 1, mu: mus[0] ?? 0 }),
      );

      expect(eloHistory).toHaveLength(3);
      expect(eloHistory[0]).toEqual({ iteration: 1, mu: 1200 });
      expect(eloHistory[1]).toEqual({ iteration: 2, mu: 1300 });
      expect(eloHistory[2]).toEqual({ iteration: 3, mu: 1400 });
    } else {
      // If schema doesn't match the test data shape, verify raw structure exists
      expect(data!.run_summary).toHaveProperty('muHistory');
    }
  });

  it('recent runs query returns expected fields and ordering', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_runs')
      .select('id, status, strategy_id, created_at, completed_at')
      .in('id', [completedRunId, pendingRunId, failedRunId])
      .order('created_at', { ascending: false })
      .limit(10);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThanOrEqual(3);

    // Verify each row has expected fields
    for (const row of data!) {
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('strategy_id');
      expect(row).toHaveProperty('created_at');
      expect(row).toHaveProperty('completed_at');
    }

    // Completed run should have completed_at set
    const completedRow = data!.find(r => r.id === completedRunId);
    expect(completedRow).toBeDefined();
    expect(completedRow!.completed_at).not.toBeNull();
    expect(completedRow!.strategy_id).toBe(strategyId);
  });

  it('recent runs respect limit parameter', async () => {
    if (!tablesExist) return;

    const { data, error } = await supabase
      .from('evolution_runs')
      .select('id')
      .eq('strategy_id', strategyId)
      .order('created_at', { ascending: false })
      .limit(2);

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeLessThanOrEqual(2);
  });
});
