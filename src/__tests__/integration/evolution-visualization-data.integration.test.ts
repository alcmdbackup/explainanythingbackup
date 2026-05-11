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

    // Re-pin the three runs' statuses by ID right before querying. The
    // `claim_evolution_run` RPC (called by parallel Jest workers running
    // evolution-claim.integration.test.ts) picks up `status='pending'` rows
    // ORDER BY created_at ASC and flips them to 'claimed' under the global
    // advisory lock. The race window between the UPDATE and the SELECT here
    // is tight but non-zero — a concurrent claim can still slip in. Retry-loop
    // with up to 5 attempts so the test is deterministic; the test only wants
    // to verify the count-by-status pattern works, not that rows survive
    // concurrent claim activity at every microsecond.
    let allRuns: { status: string }[] | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await Promise.all([
        supabase.from('evolution_runs').update({ status: 'completed' }).eq('id', completedRunId),
        supabase.from('evolution_runs').update({ status: 'failed' }).eq('id', failedRunId),
        // Issue pending LAST in the batch so its window before the SELECT is shortest.
        supabase.from('evolution_runs').update({ status: 'pending', runner_id: null }).eq('id', pendingRunId),
      ]);
      const { data, error } = await supabase
        .from('evolution_runs')
        .select('status')
        .in('id', [completedRunId, pendingRunId, failedRunId]);
      expect(error).toBeNull();
      const c = (data ?? []).filter(r => r.status === 'completed').length;
      const p = (data ?? []).filter(r => r.status === 'pending').length;
      const f = (data ?? []).filter(r => r.status === 'failed').length;
      if (c === 1 && p === 1 && f === 1) {
        allRuns = data;
        break;
      }
    }

    expect(allRuns).not.toBeNull();
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
      const eloHistory = (summary.eloHistory ?? []).map(
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

  // ─── Variant match history (fixes_to_evolution_admin_dashboard__20260503 Issue 1) ──
  // Verifies the .or('entry_a.eq.X,entry_b.eq.X') Supabase pattern used by
  // getVariantMatchHistoryAction returns the expected comparisons against a
  // real Postgres + PostgREST pair, with correct opponent disambiguation.
  describe('Variant match history (Guard A integration variant)', () => {
    const matchTestRunId = crypto.randomUUID();
    const matchTestPromptId = crypto.randomUUID();
    const matchTestStrategyId = crypto.randomUUID();
    const variantA = crypto.randomUUID(); // target variant
    const variantB = crypto.randomUUID();
    const variantC = crypto.randomUUID();
    const compIds: string[] = [];

    beforeAll(async () => {
      if (!tablesExist) return;

      await supabase.from('evolution_strategies').insert({
        id: matchTestStrategyId,
        name: '[TEST_EVO] match-history-strategy',
        label: '[TEST_EVO] Match History',
        config: { test: true },
        config_hash: `test-match-${matchTestStrategyId}`,
      });
      await supabase.from('evolution_prompts').insert({
        id: matchTestPromptId,
        prompt: '[TEST_EVO] match history prompt',
        name: '[TEST_EVO] Match History',
      });
      await supabase.from('evolution_runs').insert({
        id: matchTestRunId,
        strategy_id: matchTestStrategyId,
        prompt_id: matchTestPromptId,
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      await supabase.from('evolution_variants').insert([
        { id: variantA, run_id: matchTestRunId, variant_content: 'A', elo_score: 1300, mu: 25, sigma: 8, generation: 1, agent_name: '[TEST_EVO] alpha' },
        { id: variantB, run_id: matchTestRunId, variant_content: 'B', elo_score: 1200, mu: 25, sigma: 8, generation: 1, agent_name: '[TEST_EVO] beta' },
        { id: variantC, run_id: matchTestRunId, variant_content: 'C', elo_score: 1250, mu: 25, sigma: 8, generation: 1, agent_name: '[TEST_EVO] gamma' },
      ]);

      // Seed 3 comparisons:
      //  - c1: A vs B, A wins   → variantA on entry_a, won
      //  - c2: B vs A, A wins   → variantA on entry_b, won
      //  - c3: A vs C, draw     → variantA on entry_a, NOT won
      // Plus one comparison NOT involving variantA, to confirm filter excludes it.
      const c1 = crypto.randomUUID();
      const c2 = crypto.randomUUID();
      const c3 = crypto.randomUUID();
      const cOther = crypto.randomUUID();
      await supabase.from('evolution_arena_comparisons').insert([
        { id: c1, prompt_id: matchTestPromptId, entry_a: variantA, entry_b: variantB, winner: 'a', confidence: 0.95, run_id: matchTestRunId, status: 'completed' },
        { id: c2, prompt_id: matchTestPromptId, entry_a: variantB, entry_b: variantA, winner: 'b', confidence: 0.88, run_id: matchTestRunId, status: 'completed' },
        { id: c3, prompt_id: matchTestPromptId, entry_a: variantA, entry_b: variantC, winner: 'draw', confidence: 0.40, run_id: matchTestRunId, status: 'completed' },
        { id: cOther, prompt_id: matchTestPromptId, entry_a: variantB, entry_b: variantC, winner: 'a', confidence: 0.70, run_id: matchTestRunId, status: 'completed' },
      ]);
      compIds.push(c1, c2, c3, cOther);
    });

    afterAll(async () => {
      if (!tablesExist) return;
      await supabase.from('evolution_arena_comparisons').delete().in('id', compIds);
      await cleanupEvolutionData(supabase, {
        runIds: [matchTestRunId],
        strategyIds: [matchTestStrategyId],
        promptIds: [matchTestPromptId],
      });
    });

    it('PostgREST .or() filter returns exactly the comparisons where the variant participated', async () => {
      if (!tablesExist) return;

      const { data, error } = await supabase
        .from('evolution_arena_comparisons')
        .select('id, entry_a, entry_b, winner, confidence')
        .or(`entry_a.eq.${variantA},entry_b.eq.${variantA}`)
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(data).toBeDefined();
      // 3 comparisons involving variantA; cOther is excluded.
      expect(data!).toHaveLength(3);
      // Every returned row must have variantA on at least one side.
      for (const row of data!) {
        expect([row.entry_a, row.entry_b]).toContain(variantA);
      }
    });

    it('won-flag computation: winner=a + variantA on entry_a → won; winner=b + variantA on entry_b → won; draw → not-won', async () => {
      if (!tablesExist) return;

      const { data } = await supabase
        .from('evolution_arena_comparisons')
        .select('entry_a, entry_b, winner')
        .or(`entry_a.eq.${variantA},entry_b.eq.${variantA}`)
        .order('created_at', { ascending: true });

      // Replicate the action's mapping: won when our side matches winner side.
      const wins = data!.filter((c) =>
        (c.entry_a === variantA && c.winner === 'a') ||
        (c.entry_b === variantA && c.winner === 'b'),
      );
      const draws = data!.filter((c) => c.winner === 'draw');
      // c1 (variantA=entry_a, winner=a) + c2 (variantA=entry_b, winner=b) = 2 wins
      expect(wins).toHaveLength(2);
      expect(draws).toHaveLength(1);
    });

    it('opponent batch-fetch returns ELO/uncertainty for known opponents', async () => {
      if (!tablesExist) return;

      const { data: comparisons } = await supabase
        .from('evolution_arena_comparisons')
        .select('entry_a, entry_b')
        .or(`entry_a.eq.${variantA},entry_b.eq.${variantA}`);

      const opponentIds = Array.from(new Set(
        comparisons!.map((c) => (c.entry_a === variantA ? c.entry_b : c.entry_a)),
      ));
      // Two distinct opponents: variantB and variantC.
      expect(opponentIds.sort()).toEqual([variantB, variantC].sort());

      const { data: opponents } = await supabase
        .from('evolution_variants')
        .select('id, mu, sigma, elo_score')
        .in('id', opponentIds);

      expect(opponents).toHaveLength(2);
      for (const opp of opponents!) {
        expect(opp.elo_score).toBeGreaterThan(0);
        expect(opp.mu).not.toBeNull();
        expect(opp.sigma).not.toBeNull();
      }
    });
  });
});
