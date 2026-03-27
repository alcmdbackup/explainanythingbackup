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
