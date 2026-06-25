// Integration test for the claim_evolution_run is_test_content gate
// (reduce_e2e_testing_llm_costs_20260621). Real-DB test — exercises the actual
// Postgres RPC against the test DB, not mocks.
//
// The gate (added by 20260621000001_evolution_claim_gate.sql) makes queue claims
// (`claim_evolution_run` called without p_run_id) skip pending runs on strategies
// flagged `is_test_content=true`, UNLESS the run row's `allow_test_execution=true`.
// Targeted claims (p_run_id != NULL) bypass the gate entirely.
//
// Verifies four invariants:
//   1. Test-content strategy + queue claim + opt-out → SKIPPED (returns empty)
//   2. Test-content strategy + queue claim + opt-in (allow_test_execution=true) → CLAIMED
//   3. Real-name strategy + queue claim → CLAIMED (regression check, no behavior change)
//   4. Test-content strategy + targeted claim (p_run_id passed) → CLAIMED (bypass)
//
// LOCAL SETUP: `npm run test:integration` requires staging DB credentials in
// .env.local. The test inserts/deletes rows; no real LLM money spent (the RPC just
// returns the row or empty; no pipeline execution is triggered).

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { evolutionTablesExist } from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const RUNNER_ID = 'integration-test-runner-claim-gate';

interface CleanupTracker {
  strategyIds: string[];
  promptIds: string[];
  runIds: string[];
}

async function cleanup(sb: SupabaseClient, tracker: CleanupTracker): Promise<void> {
  // Runs first → CASCADE cleans dependents
  if (tracker.runIds.length > 0) {
    await sb.from('evolution_runs').delete().in('id', tracker.runIds);
  }
  if (tracker.promptIds.length > 0) {
    await sb.from('evolution_prompts').delete().in('id', tracker.promptIds);
  }
  if (tracker.strategyIds.length > 0) {
    await sb.from('evolution_strategies').delete().in('id', tracker.strategyIds);
  }
}

async function makeStrategy(
  sb: SupabaseClient,
  tracker: CleanupTracker,
  name: string,
): Promise<string> {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await sb
    .from('evolution_strategies')
    .insert({
      name,
      config_hash: `claim_gate_test_${uniqueSuffix}`,
      config: { generationModel: 'deepseek-v4-flash', judgeModel: 'deepseek-v4-flash' },
    })
    .select('id')
    .single();
  if (error) throw new Error(`makeStrategy failed: ${error.message}`);
  tracker.strategyIds.push(data.id);
  return data.id;
}

async function makePrompt(
  sb: SupabaseClient,
  tracker: CleanupTracker,
  isTest: boolean,
): Promise<string> {
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Prefix non-test prompts with non-matching text so the trigger keeps them is_test_content=false
  const namePrefix = isTest ? '[TEST]' : 'Claim Gate';
  const { data, error } = await sb
    .from('evolution_prompts')
    .insert({
      prompt: `${namePrefix} prompt ${uniqueSuffix}`,
      name: `${namePrefix} Prompt ${uniqueSuffix}`,
    })
    .select('id')
    .single();
  if (error) throw new Error(`makePrompt failed: ${error.message}`);
  tracker.promptIds.push(data.id);
  return data.id;
}

async function makeRun(
  sb: SupabaseClient,
  tracker: CleanupTracker,
  strategyId: string,
  promptId: string,
  opts: { status: 'pending'; allowTestExecution?: boolean },
): Promise<string> {
  const { data, error } = await sb
    .from('evolution_runs')
    .insert({
      strategy_id: strategyId,
      prompt_id: promptId,
      status: opts.status,
      allow_test_execution: opts.allowTestExecution ?? false,
    })
    .select('id')
    .single();
  if (error) throw new Error(`makeRun failed: ${error.message}`);
  tracker.runIds.push(data.id);
  return data.id;
}

async function callClaim(
  sb: SupabaseClient,
  opts: { runId?: string } = {},
): Promise<Array<{ id: string }>> {
  const { data, error } = await sb.rpc('claim_evolution_run', {
    p_runner_id: RUNNER_ID,
    p_run_id: opts.runId ?? null,
    p_max_concurrent: 99,
  });
  if (error) throw new Error(`claim_evolution_run failed: ${error.message}`);
  return (data ?? []) as Array<{ id: string }>;
}

/** Race-safe assertion that the gate ALLOWED the run to be claimed. The test's `callClaim`
 *  races against the live staging minicomputer's 60s queue-claim cron — both call the same
 *  `claim_evolution_run` RPC with `LIMIT 1 FOR UPDATE SKIP LOCKED`, so one of them wins the
 *  row's lock and the other gets nothing. The test's intent is to verify the gate's behavior
 *  (run becomes claimable), not to assert this specific RPC call is the claimer.
 *
 *  Outcomes:
 *  - Our `callClaim` returned the run → we won the race, gate verified directly.
 *  - Our `callClaim` returned a different/empty set → another claimer (likely the minicomputer)
 *    won the race. Query the run's status: if 'claimed' then the gate let it through.
 *  - Status still 'pending' → genuine gate bug or our call's transaction collided. Wait
 *    briefly (≤ 2s, well under the minicomputer's next 60s tick) and re-poll once: this
 *    covers the narrow window where another claimer's UPDATE is still in flight when we
 *    read. If still 'pending' after the wait, fail — the gate genuinely blocked it.
 *
 *  This replaces the flaky `expect(claimed.find(r => r.id === runId)).toBeDefined()` that
 *  intermittently failed on CI when the minicomputer claimed first (~50% of evolution
 *  integration runs against staging — see PR #1281). */
async function assertClaimAllowed(
  sb: SupabaseClient,
  claimedByUs: Array<{ id: string }>,
  runId: string,
): Promise<void> {
  if (claimedByUs.find((r) => r.id === runId)) return;
  // Brief poll for the run to transition to 'claimed' by some other concurrent claimer.
  for (let i = 0; i < 5; i++) {
    const { data: run } = await sb
      .from('evolution_runs')
      .select('status')
      .eq('id', runId)
      .single();
    if (run?.status === 'claimed') return;
    if (i < 4) await new Promise((r) => setTimeout(r, 400));
  }
  // Still pending after ~2s: gate genuinely blocked the claim — real test failure.
  expect(`run ${runId} still pending after gate-allowed claim window`).toBe(
    `run ${runId} claimed (gate allowed)`,
  );
}

async function gateMigrationApplied(sb: SupabaseClient): Promise<boolean> {
  // Probe whether evolution_runs has the new allow_test_execution column by trying
  // to SELECT it. If the column doesn't exist, the migration hasn't been applied
  // locally — skip the test (it'll run against staging in CI after deploy-migrations).
  const { error } = await sb.from('evolution_runs').select('allow_test_execution').limit(1);
  return error === null;
}

describe('claim_evolution_run is_test_content gate', () => {
  let sb: SupabaseClient;
  let tracker: CleanupTracker;
  let tablesExist = true;
  let migrationApplied = true;

  beforeAll(async () => {
    sb = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(sb);
    if (tablesExist) {
      migrationApplied = await gateMigrationApplied(sb);
      if (!migrationApplied) {
        console.warn(
          'evolution-claim-gate: SKIPPING — 20260621000001_evolution_claim_gate.sql not applied to local DB. ' +
            'Run `supabase db reset` or wait for CI deploy-migrations to apply against staging.',
        );
      }
    }
  });

  beforeEach(() => {
    tracker = { strategyIds: [], promptIds: [], runIds: [] };
  });

  afterEach(async () => {
    if (!tablesExist || !migrationApplied) return;
    // Always release any rows we accidentally claimed back to pending so they don't
    // block other concurrent runs. Then cascade-delete via tracker.
    if (tracker.runIds.length > 0) {
      await sb
        .from('evolution_runs')
        .update({ status: 'pending', runner_id: null })
        .in('id', tracker.runIds);
    }
    await cleanup(sb, tracker);
  });

  test('queue claim SKIPS pending run on is_test_content strategy without opt-in', async () => {
    if (!tablesExist || !migrationApplied) return;
    const stratId = await makeStrategy(sb, tracker, '[TEST] gate strategy A');
    const promptId = await makePrompt(sb, tracker, true);
    const runId = await makeRun(sb, tracker, stratId, promptId, { status: 'pending' });

    const claimed = await callClaim(sb); // queue claim (no runId)

    expect(claimed.find(r => r.id === runId)).toBeUndefined();
  });

  test('queue claim CLAIMS pending run on is_test_content strategy WITH opt-in', async () => {
    if (!tablesExist || !migrationApplied) return;
    const stratId = await makeStrategy(sb, tracker, '[TEST] gate strategy B');
    const promptId = await makePrompt(sb, tracker, true);
    const runId = await makeRun(sb, tracker, stratId, promptId, {
      status: 'pending',
      allowTestExecution: true,
    });

    const claimed = await callClaim(sb); // queue claim (no runId)

    // Race-safe verification (see comment on assertClaimAllowed).
    await assertClaimAllowed(sb, claimed, runId);
  });

  test('queue claim CLAIMS pending run on non-test strategy (regression check)', async () => {
    if (!tablesExist || !migrationApplied) return;
    const stratId = await makeStrategy(sb, tracker, 'Claim Gate Real Strategy');
    const promptId = await makePrompt(sb, tracker, false);
    const runId = await makeRun(sb, tracker, stratId, promptId, { status: 'pending' });

    const claimed = await callClaim(sb); // queue claim (no runId)

    // Race-safe verification (see comment on assertClaimAllowed).
    await assertClaimAllowed(sb, claimed, runId);
  });

  test('targeted claim BYPASSES gate on is_test_content strategy (no opt-in needed)', async () => {
    if (!tablesExist || !migrationApplied) return;
    const stratId = await makeStrategy(sb, tracker, '[TEST] gate strategy C');
    const promptId = await makePrompt(sb, tracker, true);
    const runId = await makeRun(sb, tracker, stratId, promptId, { status: 'pending' });

    const claimed = await callClaim(sb, { runId }); // targeted claim

    expect(claimed.find(r => r.id === runId)).toBeDefined();
  });
});
