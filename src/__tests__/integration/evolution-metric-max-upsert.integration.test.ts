// Integration tests for the upsert_metric_max Postgres RPC.
// Verifies the GREATEST semantics that prevents lost-update races on monotonically-increasing
// cost metrics (cost / generation_cost / ranking_cost) when concurrent writers race.
//
// LOCAL SETUP: Run `supabase db reset` (or `supabase migration up --local`) before
//              `npm run test:integration` to ensure the upsert_metric_max RPC is
//              available in the local DB. Without this, all tests below fail with
//              `function upsert_metric_max does not exist`.
//
// CI: .github/workflows/ci.yml `deploy-migrations` job applies migrations to staging
//     before integration tests run, so no setup needed there.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

async function rpcExists(sb: SupabaseClient): Promise<boolean> {
  // Probe call with a throwaway entity_id; if function exists we'll get either success
  // or a constraint error, NOT a "function does not exist" error. Detects:
  //  - Postgres 42883 (undefined function) when calling via direct SQL
  //  - PostgREST PGRST202 ("not found in the schema cache") when calling via supabase-js
  const { error } = await sb.rpc('upsert_metric_max', {
    p_entity_type: 'run',
    p_entity_id: '00000000-0000-0000-0000-000000000000',
    p_metric_name: '__probe__',
    p_value: 0,
    p_source: 'probe',
  });
  if (error && (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.message?.includes('does not exist') ||
    error.message?.includes('schema cache')
  )) return false;
  return true;
}

describe('upsert_metric_max RPC integration tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let migrationApplied: boolean;

  // Test data: a single throwaway run we own across all tests
  const strategyId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const METRIC_NAME = 'cost'; // 'cost' is a real declared metric on run.duringExecution

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping upsert_metric_max tests');
      return;
    }
    migrationApplied = await rpcExists(supabase);
    if (!migrationApplied) {
      console.warn('upsert_metric_max RPC does not exist — run `supabase db reset` locally and retry');
      return;
    }

    // Clean up any leftover __probe__ row from rpcExists
    await supabase
      .from('evolution_metrics')
      .delete()
      .eq('entity_type', 'run')
      .eq('metric_name', '__probe__');

    // Create the run we'll write metrics for
    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: '[TEST_EVO] upsert-max-strategy',
        label: '[TEST_EVO] Upsert Max',
        config: { test: true },
        config_hash: `test-upsert-max-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert({ id: runId, strategy_id: strategyId, status: 'running' });
    if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  });

  afterAll(async () => {
    if (!tablesExist || !migrationApplied) return;
    await cleanupEvolutionData(supabase, {
      runIds: [runId],
      strategyIds: [strategyId],
    });
  });

  beforeEach(async () => {
    if (!tablesExist || !migrationApplied) return;
    // Reset the metric row so each test starts fresh
    await supabase
      .from('evolution_metrics')
      .delete()
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', METRIC_NAME);
  });

  // ─── Test 1: Deterministic correctness gate ──────────────────────
  // This is the REAL correctness check. A naive last-write-wins upsert would fail it
  // (final value would be 0.03). GREATEST keeps the largest value seen.

  it('GREATEST keeps the larger value across sequential descending writes', async () => {
    if (!tablesExist || !migrationApplied) return;

    // Write 0.10, then 0.05, then 0.03 — sequential, descending
    for (const value of [0.10, 0.05, 0.03]) {
      const { error } = await supabase.rpc('upsert_metric_max', {
        p_entity_type: 'run',
        p_entity_id: runId,
        p_metric_name: METRIC_NAME,
        p_value: value,
        p_source: 'during_execution',
      });
      expect(error).toBeNull();
    }

    // Final value MUST be 0.10 — the maximum across all writes
    const { data, error: readErr } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', METRIC_NAME)
      .single();

    expect(readErr).toBeNull();
    expect(Number(data!.value)).toBeCloseTo(0.10, 6);
  });

  it('GREATEST replaces the value when a larger one arrives', async () => {
    if (!tablesExist || !migrationApplied) return;

    // 0.05 → 0.10 → 0.15: each new value is larger so each replaces the previous
    for (const value of [0.05, 0.10, 0.15]) {
      const { error } = await supabase.rpc('upsert_metric_max', {
        p_entity_type: 'run',
        p_entity_id: runId,
        p_metric_name: METRIC_NAME,
        p_value: value,
        p_source: 'during_execution',
      });
      expect(error).toBeNull();
    }

    const { data } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', METRIC_NAME)
      .single();

    expect(Number(data!.value)).toBeCloseTo(0.15, 6);
  });

  it('exactly one row exists per (entity_type, entity_id, metric_name) after many writes', async () => {
    if (!tablesExist || !migrationApplied) return;

    // 10 writes — should produce exactly 1 row (UNIQUE constraint + ON CONFLICT DO UPDATE)
    for (const value of [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10]) {
      await supabase.rpc('upsert_metric_max', {
        p_entity_type: 'run',
        p_entity_id: runId,
        p_metric_name: METRIC_NAME,
        p_value: value,
        p_source: 'during_execution',
      });
    }

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', METRIC_NAME);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(Number(data![0]!.value)).toBeCloseTo(0.10, 6);
  });

  // ─── Test 2: Best-effort concurrency ─────────────────────────────
  // PostgREST RPC calls go through HTTP and may not achieve true OS-level concurrent
  // transactions; this test is best-effort. The deterministic descending-value test
  // above is the real correctness gate. If true concurrent testing is needed, use raw
  // `pg` connections with explicit `BEGIN`/`COMMIT` and `pg_advisory_lock`.

  it('Promise.all on two clients with mixed values converges to the maximum', async () => {
    if (!tablesExist || !migrationApplied) return;

    const clientA = createTestSupabaseClient();
    const clientB = createTestSupabaseClient();

    // Round 1: 0.10 vs 0.05 — final should be 0.10
    await Promise.all([
      clientA.rpc('upsert_metric_max', {
        p_entity_type: 'run', p_entity_id: runId, p_metric_name: METRIC_NAME,
        p_value: 0.10, p_source: 'during_execution',
      }),
      clientB.rpc('upsert_metric_max', {
        p_entity_type: 'run', p_entity_id: runId, p_metric_name: METRIC_NAME,
        p_value: 0.05, p_source: 'during_execution',
      }),
    ]);

    let { data } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', METRIC_NAME)
      .single();
    expect(Number(data!.value)).toBeCloseTo(0.10, 6);

    // Round 2: 0.15 vs 0.08 — final should be 0.15
    await Promise.all([
      clientA.rpc('upsert_metric_max', {
        p_entity_type: 'run', p_entity_id: runId, p_metric_name: METRIC_NAME,
        p_value: 0.15, p_source: 'during_execution',
      }),
      clientB.rpc('upsert_metric_max', {
        p_entity_type: 'run', p_entity_id: runId, p_metric_name: METRIC_NAME,
        p_value: 0.08, p_source: 'during_execution',
      }),
    ]);

    ({ data } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', METRIC_NAME)
      .single());
    expect(Number(data!.value)).toBeCloseTo(0.15, 6);
  });
});
