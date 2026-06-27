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

// Insert test runs with an ancient created_at so FIFO `ORDER BY created_at ASC`
// in claim_evolution_run puts them at the FRONT of the staging queue. Without
// this, the next queue-claim RPC call may claim some other pending row (e.g. one
// of a fresh batch queued by an unrelated experiment), the gate test's polling
// window times out, AND the test pollutes the production queue with a stray
// claim under a runner_id that doesn't heartbeat → 10-min stale-claim expiry
// fails the unrelated row.
const ANCIENT_CREATED_AT = '2020-01-01T00:00:00Z';

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
      created_at: ANCIENT_CREATED_AT,
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
 *  races against the live staging minicomputer's queue-claim cron — both call the same
 *  `claim_evolution_run` RPC, and the row's advisory lock serializes them. The test's intent
 *  is to verify the gate's behavior (run becomes claimable), not to assert this specific
 *  RPC call is the claimer.
 *
 *  Outcomes:
 *  - Our `callClaim` returned the run → we won the race, gate verified directly.
 *  - Our `callClaim` returned a different/empty set → another claimer (likely the minicomputer)
 *    won the race. Query the run's status: if 'claimed' then the gate let it through.
 *  - Status still 'pending' → either the gate blocked it OR our row was behind some other
 *    eligible row in the FIFO queue and the claimer picked that one. We retry callClaim
 *    a few times — once the higher-priority rows drain, our row bubbles to the front.
 *
 *  Combined with the `ANCIENT_CREATED_AT` in makeRun (puts the test row at the FRONT of the
 *  FIFO queue), this should resolve essentially instantly. The retry window covers the rare
 *  case where staging has very-old pending rows ahead of ours.
 *
 *  This replaces the flaky `expect(claimed.find(r => r.id === runId)).toBeDefined()` that
 *  intermittently failed on CI when the minicomputer claimed first (~50% of evolution
 *  integration runs against staging — see PR #1281). */
async function assertClaimAllowed(
  sb: SupabaseClient,
  claimedByUs: Array<{ id: string }>,
  runId: string,
  callClaimFn: () => Promise<Array<{ id: string }>>,
): Promise<void> {
  if (claimedByUs.find((r) => r.id === runId)) return;
  // Poll up to ~5s for the run to transition to 'claimed'. On each poll, also fire
  // another callClaim to re-attempt directly — if the row was behind another eligible
  // row in FIFO order, draining one row per call lets ours surface.
  for (let i = 0; i < 10; i++) {
    const { data: run } = await sb
      .from('evolution_runs')
      .select('status')
      .eq('id', runId)
      .single();
    if (run?.status === 'claimed') return;
    if (i < 9) {
      // Re-attempt the queue claim ourselves. If we get runId back, we're done.
      const retry = await callClaimFn();
      if (retry.find((r) => r.id === runId)) return;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  // Still pending after ~5s + 9 retries: gate genuinely blocked the claim — real test failure.
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
    // Release every row our runner_id claimed — covers both tracker rows AND stray
    // claims. A stray claim happens when our queue-claim RPC's gate filter excludes
    // the test row (test 1 case) and the RPC instead claims the next gate-eligible
    // pending row in the queue (some unrelated experiment's row). Without releasing
    // strays, our dead runner_id would block them until the 10-min stale-claim
    // expiry fails them outright. Then cascade-delete via tracker.
    await sb
      .from('evolution_runs')
      .update({ status: 'pending', runner_id: null })
      .eq('runner_id', RUNNER_ID);
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
    await assertClaimAllowed(sb, claimed, runId, () => callClaim(sb));
  });

  test('queue claim CLAIMS pending run on non-test strategy (regression check)', async () => {
    if (!tablesExist || !migrationApplied) return;
    const stratId = await makeStrategy(sb, tracker, 'Claim Gate Real Strategy');
    const promptId = await makePrompt(sb, tracker, false);
    const runId = await makeRun(sb, tracker, stratId, promptId, { status: 'pending' });

    const claimed = await callClaim(sb); // queue claim (no runId)

    // Race-safe verification (see comment on assertClaimAllowed).
    await assertClaimAllowed(sb, claimed, runId, () => callClaim(sb));
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
