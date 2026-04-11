// Integration test for empty-run cost zero-init.
//
// Verifies the Phase 4b behavior in evolution/src/lib/pipeline/claimAndExecuteRun.ts:
// at the start of executePipeline(), the orchestrator writes value=0 rows for
// cost / generation_cost / ranking_cost via writeMetricMax. This guarantees that
// even runs that fail before any LLM call have rows in evolution_metrics, so
// downstream propagation to strategy/experiment doesn't skip empty runs in averages.
//
// The test exercises the writeMetricMax + propagateMetrics path against a real DB
// rather than mocking it, because the GREATEST upsert RPC and the propagation
// aggregation logic both depend on real Postgres behavior.
//
// LOCAL SETUP: Run `supabase db reset` (or `supabase migration up --local`) before
//              `npm run test:integration` to ensure the upsert_metric_max RPC is
//              available in the local DB.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import { writeMetricMax } from '@evolution/lib/metrics/writeMetrics';
import { propagateMetrics } from '@evolution/lib/pipeline/finalize/persistRunResults';
import type { SupabaseClient } from '@supabase/supabase-js';

async function rpcExists(sb: SupabaseClient): Promise<boolean> {
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

describe('Empty-run cost zero-init integration tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let migrationApplied: boolean;

  const strategyId = crypto.randomUUID();
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping empty-run init tests');
      return;
    }
    migrationApplied = await rpcExists(supabase);
    if (!migrationApplied) {
      console.warn('upsert_metric_max RPC does not exist — run `supabase db reset` locally');
      return;
    }
    // Clean up the probe row from rpcExists
    await supabase
      .from('evolution_metrics')
      .delete()
      .eq('entity_type', 'run')
      .eq('metric_name', '__probe__');

    // Create strategy
    const { error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        id: strategyId,
        name: '[TEST_EVO] empty-run-init-strategy',
        label: '[TEST_EVO] Empty Run Init',
        config: { test: true },
        config_hash: `test-empty-run-init-hash-${strategyId}`,
      });
    if (stratErr) throw new Error(`Failed to create strategy: ${stratErr.message}`);

    // Create a single run that we'll treat as "completed but empty"
    const { error: runErr } = await supabase
      .from('evolution_runs')
      .insert({ id: runId, strategy_id: strategyId, status: 'completed' });
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
    // Clear metric rows for this run + parent strategy so each test starts fresh
    await supabase
      .from('evolution_metrics')
      .delete()
      .in('entity_id', [runId, strategyId]);
  });

  it('writeMetricMax with value=0 creates rows for all three cost metrics', async () => {
    if (!tablesExist || !migrationApplied) return;

    // Simulate the executePipeline zero-init block
    for (const metricName of ['cost', 'generation_cost', 'ranking_cost'] as const) {
      await writeMetricMax(supabase, 'run', runId, metricName, 0, 'during_execution');
    }

    // All three rows should exist with value=0
    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .in('metric_name', ['cost', 'generation_cost', 'ranking_cost']);

    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    for (const row of data!) {
      expect(Number(row.value)).toBe(0);
    }
  });

  it('zero-init does not overwrite a real value written later (GREATEST keeps the larger)', async () => {
    if (!tablesExist || !migrationApplied) return;

    // Init to 0 first (like executePipeline does)
    await writeMetricMax(supabase, 'run', runId, 'generation_cost', 0, 'during_execution');

    // Then a real LLM call writes 0.05 (like createLLMClient does)
    await writeMetricMax(supabase, 'run', runId, 'generation_cost', 0.05, 'during_execution');

    // GREATEST means the value should be 0.05, not 0
    const { data } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', 'generation_cost')
      .single();

    expect(Number(data!.value)).toBeCloseTo(0.05, 6);

    // And a subsequent zero-init MUST NOT overwrite it back to 0
    await writeMetricMax(supabase, 'run', runId, 'generation_cost', 0, 'during_execution');

    const { data: afterReinit } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', 'generation_cost')
      .single();

    expect(Number(afterReinit!.value)).toBeCloseTo(0.05, 6);
  });

  it('strategy propagation produces total/avg = 0 over an empty run (not null/skipped)', async () => {
    if (!tablesExist || !migrationApplied) return;

    // Zero-init the run's cost metrics like executePipeline does
    for (const metricName of ['cost', 'generation_cost', 'ranking_cost'] as const) {
      await writeMetricMax(supabase, 'run', runId, metricName, 0, 'during_execution');
    }

    // Run propagation as finalizeRun would
    await propagateMetrics(supabase, 'strategy', strategyId);

    // Strategy should have total_generation_cost / avg_generation_cost_per_run rows = 0
    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('metric_name, value, n')
      .eq('entity_type', 'strategy')
      .eq('entity_id', strategyId)
      .in('metric_name', [
        'total_cost',
        'avg_cost_per_run',
        'total_generation_cost',
        'avg_generation_cost_per_run',
        'total_ranking_cost',
        'avg_ranking_cost_per_run',
      ]);

    expect(error).toBeNull();
    // Each propagated metric should exist with value 0 (not undefined/skipped)
    const byName = new Map(data!.map(r => [r.metric_name, Number(r.value)]));
    expect(byName.get('total_cost')).toBe(0);
    expect(byName.get('avg_cost_per_run')).toBe(0);
    expect(byName.get('total_generation_cost')).toBe(0);
    expect(byName.get('avg_generation_cost_per_run')).toBe(0);
    expect(byName.get('total_ranking_cost')).toBe(0);
    expect(byName.get('avg_ranking_cost_per_run')).toBe(0);
  });
});
