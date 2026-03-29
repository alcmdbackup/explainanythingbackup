// Integration tests for the evolution metrics system: write, read, upsert, and batch operations
// against the real evolution_metrics table in Supabase.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  createTestStrategyConfig,
  createTestEvolutionRun,
  createTestPrompt,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Evolution Metrics Recomputation Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;
  let lockRpcExists: boolean;

  // IDs for cleanup
  const createdRunIds: string[] = [];
  const createdStrategyIds: string[] = [];
  const createdPromptIds: string[] = [];
  const createdMetricEntityIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping metrics integration tests');
    }

    // Check if lock_stale_metrics RPC migration has been applied
    lockRpcExists = false;
    if (tablesExist) {
      const probe = crypto.randomUUID();
      const { error } = await supabase.rpc('lock_stale_metrics', {
        p_entity_type: 'run',
        p_entity_id: probe,
        p_metric_names: [],
      });
      // PGRST202 = function not found in schema cache
      lockRpcExists = !error || error.code !== 'PGRST202';
      if (!lockRpcExists) {
        console.warn('lock_stale_metrics RPC not deployed — skipping RPC-dependent tests');
      }
    }
  });

  afterAll(async () => {
    if (!tablesExist) return;

    // Clean up metrics rows by entity_id
    if (createdMetricEntityIds.length > 0) {
      await supabase
        .from('evolution_metrics')
        .delete()
        .in('entity_id', createdMetricEntityIds);
    }

    await cleanupEvolutionData(supabase, {
      runIds: createdRunIds,
      strategyIds: createdStrategyIds,
      promptIds: createdPromptIds,
    });
  });

  /** Helper to insert a metric row directly */
  async function insertMetricRow(opts: {
    entity_type: string;
    entity_id: string;
    metric_name: string;
    value: number;
    stale?: boolean;
    sigma?: number | null;
    n?: number;
  }) {
    const row = {
      entity_type: opts.entity_type,
      entity_id: opts.entity_id,
      metric_name: opts.metric_name,
      value: opts.value,
      stale: opts.stale ?? false,
      sigma: opts.sigma ?? null,
      ci_lower: null,
      ci_upper: null,
      n: opts.n ?? 1,
      origin_entity_type: null,
      origin_entity_id: null,
      aggregation_method: null,
      source: 'test',
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('evolution_metrics')
      .upsert(row, { onConflict: 'entity_type,entity_id,metric_name' });
    if (error) throw new Error(`insertMetricRow failed: ${error.message}`);
  }

  it('write a metric row, read it back, verify values', async () => {
    if (!tablesExist) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    await insertMetricRow({
      entity_type: 'run',
      entity_id: entityId,
      metric_name: 'cost',
      value: 0.0123,
    });

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('metric_name', 'cost')
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Number(data!.value)).toBeCloseTo(0.0123, 4);
    expect(data!.entity_type).toBe('run');
    expect(data!.stale).toBe(false);
  });

  it('write a stale metric, verify stale flag is true', async () => {
    if (!tablesExist) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    await insertMetricRow({
      entity_type: 'run',
      entity_id: entityId,
      metric_name: 'winner_elo',
      value: 1500,
      stale: true,
    });

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('stale')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('metric_name', 'winner_elo')
      .single();

    expect(error).toBeNull();
    expect(data!.stale).toBe(true);
  });

  it('read metrics for entity with no metrics returns empty', async () => {
    if (!tablesExist) return;

    const entityId = crypto.randomUUID();
    // Don't track — nothing inserted

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('write multiple metrics for same entity, read all back', async () => {
    if (!tablesExist) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'cost', value: 0.05 });
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'winner_elo', value: 1600 });
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'total_matches', value: 42 });

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId);

    expect(error).toBeNull();
    expect(data).toHaveLength(3);

    const names = data!.map((r: Record<string, unknown>) => r.metric_name).sort();
    expect(names).toEqual(['cost', 'total_matches', 'winner_elo']);
  });

  it('overwrite existing metric value via upsert', async () => {
    if (!tablesExist) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    // Write initial value
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'cost', value: 0.01 });

    // Overwrite with new value
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'cost', value: 0.99 });

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('metric_name', 'cost')
      .single();

    expect(error).toBeNull();
    expect(Number(data!.value)).toBeCloseTo(0.99, 4);
  });

  it('read metrics for non-existent entity returns empty array', async () => {
    if (!tablesExist) return;

    const nonExistentId = crypto.randomUUID();

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'strategy')
      .eq('entity_id', nonExistentId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('batch read metrics for multiple entities', async () => {
    if (!tablesExist) return;

    const entityId1 = crypto.randomUUID();
    const entityId2 = crypto.randomUUID();
    createdMetricEntityIds.push(entityId1, entityId2);

    await insertMetricRow({ entity_type: 'run', entity_id: entityId1, metric_name: 'cost', value: 0.10 });
    await insertMetricRow({ entity_type: 'run', entity_id: entityId2, metric_name: 'cost', value: 0.20 });
    await insertMetricRow({ entity_type: 'run', entity_id: entityId1, metric_name: 'winner_elo', value: 1400 });

    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .in('entity_id', [entityId1, entityId2])
      .in('metric_name', ['cost', 'winner_elo']);

    expect(error).toBeNull();
    expect(data).toHaveLength(3);

    const entity1Metrics = data!.filter((r: Record<string, unknown>) => r.entity_id === entityId1);
    const entity2Metrics = data!.filter((r: Record<string, unknown>) => r.entity_id === entityId2);
    expect(entity1Metrics).toHaveLength(2);
    expect(entity2Metrics).toHaveLength(1);
  });

  // ─── New integration tests for metrics integrity fixes ────────────

  it('lock_stale_metrics RPC: first caller claims rows, second gets empty', async () => {
    if (!tablesExist || !lockRpcExists) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    // Insert two stale metrics
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'winner_elo', value: 1500, stale: true });
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'median_elo', value: 1400, stale: true });

    // First caller claims
    const { data: claimed1, error: err1 } = await supabase.rpc('lock_stale_metrics', {
      p_entity_type: 'run',
      p_entity_id: entityId,
      p_metric_names: ['winner_elo', 'median_elo'],
    });

    expect(err1).toBeNull();
    expect(claimed1).toHaveLength(2);
    const claimedNames = (claimed1 as { id: string; metric_name: string }[]).map(r => r.metric_name).sort();
    expect(claimedNames).toEqual(['median_elo', 'winner_elo']);

    // Second caller gets empty (stale already cleared)
    const { data: claimed2, error: err2 } = await supabase.rpc('lock_stale_metrics', {
      p_entity_type: 'run',
      p_entity_id: entityId,
      p_metric_names: ['winner_elo', 'median_elo'],
    });

    expect(err2).toBeNull();
    expect(claimed2).toHaveLength(0);

    // Verify rows are stale=false in DB
    const { data: rows } = await supabase
      .from('evolution_metrics')
      .select('stale')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId);
    expect(rows).toHaveLength(2);
    for (const row of rows!) {
      expect(row.stale).toBe(false);
    }
  });

  it('stale trigger cascade: update variant mu/sigma marks run/strategy/experiment metrics stale', async () => {
    if (!tablesExist) return;

    // Create strategy, prompt, experiment, run, and variant
    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);
    const promptId = await createTestPrompt(supabase);
    createdPromptIds.push(promptId);

    const { data: experiment } = await supabase
      .from('evolution_experiments')
      .insert({ name: '[TEST] stale cascade', prompt_id: promptId, status: 'running' })
      .select('id')
      .single();
    if (!experiment) throw new Error('Failed to create experiment');
    const experimentId = experiment.id;

    const run = await createTestEvolutionRun(supabase, null, {
      strategy_id: strategyId,
      prompt_id: promptId,
      experiment_id: experimentId,
      status: 'completed',
    });
    const runId = run.id as string;
    createdRunIds.push(runId);

    // Create a variant (trigger fires on UPDATE OF mu, sigma)
    const { data: variant } = await supabase
      .from('evolution_variants')
      .insert({
        run_id: runId,
        variant_content: '[TEST] variant for stale cascade',
        elo_score: 1200,
        generation: 1,
        agent_name: 'test',
        match_count: 0,
        mu: 25,
        sigma: 8.333,
      })
      .select('id')
      .single();
    if (!variant) throw new Error('Failed to create variant');

    // Seed metrics for run, strategy, experiment (non-stale)
    const runMetrics = ['winner_elo', 'median_elo', 'p90_elo', 'max_elo', 'total_matches', 'decisive_rate', 'variant_count'];
    for (const name of runMetrics) {
      await insertMetricRow({ entity_type: 'run', entity_id: runId, metric_name: name, value: 100 });
    }
    const parentMetrics = ['avg_final_elo', 'best_final_elo', 'worst_final_elo'];
    for (const name of parentMetrics) {
      await insertMetricRow({ entity_type: 'strategy', entity_id: strategyId, metric_name: name, value: 100 });
      await insertMetricRow({ entity_type: 'experiment', entity_id: experimentId, metric_name: name, value: 100 });
    }
    createdMetricEntityIds.push(runId, strategyId, experimentId);

    // Update variant mu/sigma to trigger stale cascade
    const { error: updateErr } = await supabase
      .from('evolution_variants')
      .update({ mu: 30, sigma: 5.0 })
      .eq('id', variant.id);
    expect(updateErr).toBeNull();

    // Verify run metrics marked stale
    const { data: runRows } = await supabase
      .from('evolution_metrics')
      .select('metric_name, stale')
      .eq('entity_type', 'run')
      .eq('entity_id', runId);
    const staleRunMetrics = runRows!.filter((r: Record<string, unknown>) => r.stale === true).map((r: Record<string, unknown>) => r.metric_name).sort();
    expect(staleRunMetrics).toEqual(expect.arrayContaining(['winner_elo', 'median_elo', 'p90_elo', 'max_elo', 'total_matches', 'decisive_rate', 'variant_count']));

    // Verify strategy metrics marked stale
    const { data: stratRows } = await supabase
      .from('evolution_metrics')
      .select('metric_name, stale')
      .eq('entity_type', 'strategy')
      .eq('entity_id', strategyId);
    const staleStratMetrics = stratRows!.filter((r: Record<string, unknown>) => r.stale === true).map((r: Record<string, unknown>) => r.metric_name).sort();
    expect(staleStratMetrics).toEqual(expect.arrayContaining(['avg_final_elo', 'best_final_elo', 'worst_final_elo']));

    // Verify experiment metrics marked stale
    const { data: expRows } = await supabase
      .from('evolution_metrics')
      .select('metric_name, stale')
      .eq('entity_type', 'experiment')
      .eq('entity_id', experimentId);
    const staleExpMetrics = expRows!.filter((r: Record<string, unknown>) => r.stale === true).map((r: Record<string, unknown>) => r.metric_name).sort();
    expect(staleExpMetrics).toEqual(expect.arrayContaining(['avg_final_elo', 'best_final_elo', 'worst_final_elo']));

    // Cleanup experiment
    await supabase.from('evolution_variants').delete().eq('id', variant.id);
    await cleanupEvolutionData(supabase, { experimentIds: [experimentId] });
  });

  it('end-to-end recompute: stale metric → lock → recompute → verify fresh', async () => {
    if (!tablesExist || !lockRpcExists) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    // Write a stale metric with an old value
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'winner_elo', value: 999, stale: true });

    // Detect stale rows
    const { data: staleRows } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('stale', true);
    expect(staleRows).toHaveLength(1);
    expect(staleRows![0].metric_name).toBe('winner_elo');

    // Lock via RPC (claim-and-clear)
    const { data: claimed } = await supabase.rpc('lock_stale_metrics', {
      p_entity_type: 'run',
      p_entity_id: entityId,
      p_metric_names: ['winner_elo'],
    });
    expect(claimed).toHaveLength(1);

    // Verify stale=false after lock (claimed but not yet recomputed)
    const { data: lockedRow } = await supabase
      .from('evolution_metrics')
      .select('stale, value')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('metric_name', 'winner_elo')
      .single();
    expect(lockedRow!.stale).toBe(false);
    // Value still old until recomputation writes new value
    expect(Number(lockedRow!.value)).toBeCloseTo(999, 0);

    // Simulate recomputation: write fresh value
    await insertMetricRow({ entity_type: 'run', entity_id: entityId, metric_name: 'winner_elo', value: 1500 });

    // Verify fresh value
    const { data: freshRow } = await supabase
      .from('evolution_metrics')
      .select('stale, value')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('metric_name', 'winner_elo')
      .single();
    expect(freshRow!.stale).toBe(false);
    expect(Number(freshRow!.value)).toBeCloseTo(1500, 0);
  });

  it('write run elo metric with sigma/CI → verify stored correctly in DB', async () => {
    if (!tablesExist) return;

    const entityId = crypto.randomUUID();
    createdMetricEntityIds.push(entityId);

    const sigma = 48.0;
    const value = 1402;
    const ciLower = value - 1.96 * sigma;
    const ciUpper = value + 1.96 * sigma;

    // Insert metric with sigma and CI
    const row = {
      entity_type: 'run',
      entity_id: entityId,
      metric_name: 'winner_elo',
      value,
      stale: false,
      sigma,
      ci_lower: ciLower,
      ci_upper: ciUpper,
      n: 1,
      origin_entity_type: null,
      origin_entity_id: null,
      aggregation_method: null,
      source: 'at_finalization',
      updated_at: new Date().toISOString(),
    };
    const { error: insertErr } = await supabase
      .from('evolution_metrics')
      .upsert(row, { onConflict: 'entity_type,entity_id,metric_name' });
    expect(insertErr).toBeNull();

    // Read back and verify all fields
    const { data, error } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .eq('entity_id', entityId)
      .eq('metric_name', 'winner_elo')
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(Number(data!.value)).toBeCloseTo(1402, 0);
    expect(Number(data!.sigma)).toBeCloseTo(48.0, 1);
    expect(Number(data!.ci_lower)).toBeCloseTo(ciLower, 1);
    expect(Number(data!.ci_upper)).toBeCloseTo(ciUpper, 1);
    expect(data!.n).toBe(1);
    expect(data!.source).toBe('at_finalization');
  });

  it('multiple run elo metrics with sigma → propagate to strategy → verify CI from bootstrap', async () => {
    if (!tablesExist) return;

    // Create strategy and two completed runs with elo metrics (including sigma)
    const strategyId = await createTestStrategyConfig(supabase);
    createdStrategyIds.push(strategyId);
    const promptId = await createTestPrompt(supabase);
    createdPromptIds.push(promptId);

    const run1 = await createTestEvolutionRun(supabase, null, {
      strategy_id: strategyId,
      prompt_id: promptId,
      status: 'completed',
    });
    const run2 = await createTestEvolutionRun(supabase, null, {
      strategy_id: strategyId,
      prompt_id: promptId,
      status: 'completed',
    });
    createdRunIds.push(run1.id as string, run2.id as string);

    // Write winner_elo for each run with sigma (simulating elo CI from finalization)
    const runs = [
      { id: run1.id as string, value: 1300, sigma: 40 },
      { id: run2.id as string, value: 1500, sigma: 50 },
    ];

    for (const r of runs) {
      const ciLower = r.value - 1.96 * r.sigma;
      const ciUpper = r.value + 1.96 * r.sigma;
      const row = {
        entity_type: 'run',
        entity_id: r.id,
        metric_name: 'winner_elo',
        value: r.value,
        stale: false,
        sigma: r.sigma,
        ci_lower: ciLower,
        ci_upper: ciUpper,
        n: 1,
        origin_entity_type: null,
        origin_entity_id: null,
        aggregation_method: null,
        source: 'at_finalization',
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('evolution_metrics')
        .upsert(row, { onConflict: 'entity_type,entity_id,metric_name' });
      if (error) throw new Error(`Failed to write run metric: ${error.message}`);
    }
    createdMetricEntityIds.push(run1.id as string, run2.id as string);

    // Now simulate propagation: write avg_final_elo to strategy with CI from bootstrap
    // (In production, recomputePropagatedMetrics does this; here we verify the DB stores CI correctly)
    const avgValue = (1300 + 1500) / 2; // 1400
    // Bootstrap CI would be computed from sampling; use approximate values for test
    const stratRow = {
      entity_type: 'strategy',
      entity_id: strategyId,
      metric_name: 'avg_final_elo',
      value: avgValue,
      stale: false,
      sigma: null,
      ci_lower: 1280,
      ci_upper: 1520,
      n: 2,
      origin_entity_type: null,
      origin_entity_id: null,
      aggregation_method: 'bootstrap_mean',
      source: 'at_propagation',
      updated_at: new Date().toISOString(),
    };
    const { error: stratErr } = await supabase
      .from('evolution_metrics')
      .upsert(stratRow, { onConflict: 'entity_type,entity_id,metric_name' });
    expect(stratErr).toBeNull();
    createdMetricEntityIds.push(strategyId);

    // Verify strategy metric has CI and aggregation_method
    const { data: stratMetric, error: readErr } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'strategy')
      .eq('entity_id', strategyId)
      .eq('metric_name', 'avg_final_elo')
      .single();

    expect(readErr).toBeNull();
    expect(stratMetric).toBeDefined();
    expect(Number(stratMetric!.value)).toBeCloseTo(avgValue, 0);
    expect(stratMetric!.ci_lower).not.toBeNull();
    expect(stratMetric!.ci_upper).not.toBeNull();
    expect(Number(stratMetric!.ci_lower)).toBeLessThan(Number(stratMetric!.value));
    expect(Number(stratMetric!.ci_upper)).toBeGreaterThan(Number(stratMetric!.value));
    expect(stratMetric!.n).toBe(2);
    expect(stratMetric!.aggregation_method).toBe('bootstrap_mean');
    expect(stratMetric!.source).toBe('at_propagation');

    // Also verify the child run metrics still have their sigma
    for (const r of runs) {
      const { data: runMetric } = await supabase
        .from('evolution_metrics')
        .select('sigma, ci_lower, ci_upper')
        .eq('entity_type', 'run')
        .eq('entity_id', r.id)
        .eq('metric_name', 'winner_elo')
        .single();
      expect(Number(runMetric!.sigma)).toBeCloseTo(r.sigma, 1);
      expect(runMetric!.ci_lower).not.toBeNull();
      expect(runMetric!.ci_upper).not.toBeNull();
    }
  });

  it('write metrics with different entity types', async () => {
    if (!tablesExist) return;

    const runId = crypto.randomUUID();
    const invocationId = crypto.randomUUID();
    const strategyId = crypto.randomUUID();
    createdMetricEntityIds.push(runId, invocationId, strategyId);

    await insertMetricRow({ entity_type: 'run', entity_id: runId, metric_name: 'cost', value: 0.05 });
    await insertMetricRow({ entity_type: 'invocation', entity_id: invocationId, metric_name: 'best_variant_elo', value: 1500 });
    await insertMetricRow({ entity_type: 'strategy', entity_id: strategyId, metric_name: 'total_cost', value: 1.25 });

    // Verify each entity type independently
    const { data: runData } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'run')
      .eq('entity_id', runId);
    expect(runData).toHaveLength(1);
    expect(Number(runData![0].value)).toBeCloseTo(0.05, 4);

    const { data: invData } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'invocation')
      .eq('entity_id', invocationId);
    expect(invData).toHaveLength(1);
    expect(Number(invData![0].value)).toBeCloseTo(1500, 0);

    const { data: stratData } = await supabase
      .from('evolution_metrics')
      .select('*')
      .eq('entity_type', 'strategy')
      .eq('entity_id', strategyId);
    expect(stratData).toHaveLength(1);
    expect(Number(stratData![0].value)).toBeCloseTo(1.25, 2);
  });
});
