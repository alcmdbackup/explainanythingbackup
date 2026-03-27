// Integration tests for Entity.executeAction cascade delete, stale metrics, and rename.
// Uses real Supabase (service role) to verify cascade behavior against actual DB constraints.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
  createTestPrompt,
  createTestEvolutionRun,
  createTestVariant,
  createTestArenaComparison,
} from '@evolution/testing/evolution-test-helpers';
import { getEntity } from '@evolution/lib/core/entityRegistry';

describe('Entity Actions Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  // Tracked IDs for cleanup
  const strategyIds: string[] = [];
  const promptIds: string[] = [];
  const runIds: string[] = [];
  const experimentIds: string[] = [];
  const variantIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, { runIds, experimentIds, variantIds, strategyIds, promptIds });
  });

  // ─── Helpers ──────────────────────────────────────────────────

  async function createExperiment(promptId: string): Promise<string> {
    const { data, error } = await supabase
      .from('evolution_experiments')
      .insert({ name: `[TEST] exp_${Date.now()}`, prompt_id: promptId, status: 'completed' })
      .select('id')
      .single();
    if (error) throw error;
    experimentIds.push(data.id);
    return data.id;
  }

  async function writeMetric(entityType: string, entityId: string, metricName: string, value: number): Promise<void> {
    await supabase.from('evolution_metrics').insert({
      entity_type: entityType,
      entity_id: entityId,
      metric_name: metricName,
      source: 'at_finalization',
      value,
    });
  }

  async function countRows(table: string, column: string, value: string): Promise<number> {
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, value);
    return count ?? 0;
  }

  // ─── Prompt ───────────────────────────────────────────────────

  describe('Prompt', () => {
    it('rename updates name column', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);

      await getEntity('prompt').executeAction('rename', promptId, supabase, { name: 'Renamed Prompt' });

      const { data } = await supabase.from('evolution_prompts').select('name').eq('id', promptId).single();
      expect(data?.name).toBe('Renamed Prompt');
    });

    it('delete (no children) removes row', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);

      await getEntity('prompt').executeAction('delete', promptId, supabase);

      const { data } = await supabase.from('evolution_prompts').select('id').eq('id', promptId).single();
      expect(data).toBeNull();
    });

    it('delete with experiment+runs cascades all children', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const expId = await createExperiment(promptId);
      const run = await createTestEvolutionRun(supabase, null, { prompt_id: promptId, strategy_id: strategyId, experiment_id: expId, status: 'completed' });
      const variant = await createTestVariant(supabase, run.id as string, null);

      await getEntity('prompt').executeAction('delete', promptId, supabase);

      // Verify all children deleted
      expect(await countRows('evolution_experiments', 'id', expId)).toBe(0);
      expect(await countRows('evolution_runs', 'id', run.id as string)).toBe(0);
      expect(await countRows('evolution_variants', 'id', variant.id as string)).toBe(0);
      expect(await countRows('evolution_prompts', 'id', promptId)).toBe(0);
    });
  });

  // ─── Strategy ─────────────────────────────────────────────────

  describe('Strategy', () => {
    it('rename updates name column', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);

      await getEntity('strategy').executeAction('rename', strategyId, supabase, { name: 'Renamed Strategy' });

      const { data } = await supabase.from('evolution_strategies').select('name').eq('id', strategyId).single();
      expect(data?.name).toBe('Renamed Strategy');
    });

    it('delete (no children) removes row', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);

      await getEntity('strategy').executeAction('delete', strategyId, supabase);

      const { data } = await supabase.from('evolution_strategies').select('id').eq('id', strategyId).single();
      expect(data).toBeNull();
    });

    it('delete with runs cascades all children', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
      await createTestVariant(supabase, run.id as string, null);

      await getEntity('strategy').executeAction('delete', strategyId, supabase);

      expect(await countRows('evolution_runs', 'strategy_id', strategyId)).toBe(0);
      expect(await countRows('evolution_variants', 'run_id', run.id as string)).toBe(0);
      expect(await countRows('evolution_strategies', 'id', strategyId)).toBe(0);
    });
  });

  // ─── Run ──────────────────────────────────────────────────────

  describe('Run', () => {
    it('delete cascades variants, invocations, logs, metrics', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
      const variant = await createTestVariant(supabase, run.id as string, null);
      await writeMetric('run', run.id as string, 'cost', 1.5);
      await writeMetric('variant', variant.id as string, 'cost', 0.5);

      await getEntity('run').executeAction('delete', run.id as string, supabase);

      expect(await countRows('evolution_runs', 'id', run.id as string)).toBe(0);
      expect(await countRows('evolution_variants', 'run_id', run.id as string)).toBe(0);
      const { count: metricCount } = await supabase.from('evolution_metrics').select('id', { count: 'exact', head: true }).eq('entity_id', run.id as string);
      expect(metricCount).toBe(0);
    });

    it('cancel sets status to cancelled', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId, status: 'running' });
      runIds.push(run.id as string);

      await getEntity('run').executeAction('cancel', run.id as string, supabase);

      const { data } = await supabase.from('evolution_runs').select('status').eq('id', run.id as string).single();
      expect(data?.status).toBe('cancelled');
    });

    it('delete marks parent strategy metrics stale', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
      await writeMetric('strategy', strategyId, 'total_cost', 10.0);

      await getEntity('run').executeAction('delete', run.id as string, supabase);

      const { data } = await supabase.from('evolution_metrics')
        .select('stale')
        .eq('entity_type', 'strategy')
        .eq('entity_id', strategyId)
        .single();
      expect(data?.stale).toBe(true);
    });

    it('delete marks parent experiment metrics stale', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const expId = await createExperiment(promptId);
      const run = await createTestEvolutionRun(supabase, null, { experiment_id: expId, strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
      await writeMetric('experiment', expId, 'total_cost', 5.0);

      await getEntity('run').executeAction('delete', run.id as string, supabase);

      const { data } = await supabase.from('evolution_metrics')
        .select('stale')
        .eq('entity_type', 'experiment')
        .eq('entity_id', expId)
        .single();
      expect(data?.stale).toBe(true);
    });
  });

  // ─── Experiment ───────────────────────────────────────────────

  describe('Experiment', () => {
    it('rename updates name column', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const expId = await createExperiment(promptId);

      await getEntity('experiment').executeAction('rename', expId, supabase, { name: 'Renamed Exp' });

      const { data } = await supabase.from('evolution_experiments').select('name').eq('id', expId).single();
      expect(data?.name).toBe('Renamed Exp');
    });

    it('cancel sets status to cancelled', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const expId = await createExperiment(promptId);
      // Set to running first
      await supabase.from('evolution_experiments').update({ status: 'running' }).eq('id', expId);

      await getEntity('experiment').executeAction('cancel', expId, supabase);

      const { data } = await supabase.from('evolution_experiments').select('status').eq('id', expId).single();
      expect(data?.status).toBe('cancelled');
    });

    it('delete cascades runs and children', async () => {
      if (!tablesExist) return;
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const expId = await createExperiment(promptId);
      const run = await createTestEvolutionRun(supabase, null, { experiment_id: expId, strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
      await createTestVariant(supabase, run.id as string, null);

      await getEntity('experiment').executeAction('delete', expId, supabase);

      expect(await countRows('evolution_experiments', 'id', expId)).toBe(0);
      expect(await countRows('evolution_runs', 'experiment_id', expId)).toBe(0);
    });
  });

  // ─── Variant ──────────────────────────────────────────────────

  describe('Variant', () => {
    it('delete removes variant and arena comparisons', async () => {
      if (!tablesExist) return;
      const strategyId = await createTestStrategyConfig(supabase);
      strategyIds.push(strategyId);
      const promptId = await createTestPrompt(supabase);
      promptIds.push(promptId);
      const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId, status: 'completed' });
      runIds.push(run.id as string);
      const variantA = await createTestVariant(supabase, run.id as string, null);
      const variantB = await createTestVariant(supabase, run.id as string, null);
      await createTestArenaComparison(supabase, promptId, variantA.id as string, variantB.id as string);
      await writeMetric('variant', variantA.id as string, 'cost', 0.1);

      await getEntity('variant').executeAction('delete', variantA.id as string, supabase);

      expect(await countRows('evolution_variants', 'id', variantA.id as string)).toBe(0);
      // Arena comparison referencing deleted variant should be gone
      const { count } = await supabase.from('evolution_arena_comparisons')
        .select('id', { count: 'exact', head: true })
        .or(`entry_a.eq.${variantA.id},entry_b.eq.${variantA.id}`);
      expect(count).toBe(0);
      // Variant B should still exist
      expect(await countRows('evolution_variants', 'id', variantB.id as string)).toBe(1);
    });
  });
});
