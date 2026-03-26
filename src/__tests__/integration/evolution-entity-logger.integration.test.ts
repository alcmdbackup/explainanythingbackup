// Integration tests for the structured entity logger writing to real Supabase DB.
// Verifies that createEntityLogger correctly writes to evolution_logs with entity context columns.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
} from '@evolution/testing/evolution-test-helpers';
import { createEntityLogger } from '@evolution/lib/pipeline/infra/createEntityLogger';

describe('Evolution Entity Logger Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  // Track created IDs for cleanup
  const runIds: string[] = [];
  const strategyIds: string[] = [];
  const promptIds: string[] = [];
  const logIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    // Clean up log rows
    if (logIds.length > 0) {
      await supabase.from('evolution_logs').delete().in('id', logIds);
    }
    // Also delete by run_id for safety
    for (const runId of runIds) {
      await supabase.from('evolution_logs').delete().eq('run_id', runId);
    }
    await cleanupEvolutionData(supabase, {
      runIds,
      strategyIds,
      promptIds,
    });
  });

  it('info log writes correct level and entity columns', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    runIds.push(runId);
    strategyIds.push(run.strategy_id as string);
    promptIds.push(run.prompt_id as string);

    const logger = createEntityLogger(
      { entityType: 'run', entityId: runId, runId },
      supabase,
    );

    logger.info('[TEST] entity logger info test');

    // Fire-and-forget — wait for insert to complete
    await new Promise((r) => setTimeout(r, 200));

    const { data: logs } = await supabase
      .from('evolution_logs')
      .select('id, entity_type, entity_id, level, run_id, message')
      .eq('run_id', runId)
      .eq('message', '[TEST] entity logger info test');

    expect(logs).toBeDefined();
    expect(logs!.length).toBeGreaterThanOrEqual(1);

    const log = logs![0]!;
    logIds.push(log.id);
    expect(log.entity_type).toBe('run');
    expect(log.entity_id).toBe(runId);
    expect(log.level).toBe('info');
    expect(log.run_id).toBe(runId);
  });

  it('context fields extracted to columns', async () => {
    if (!tablesExist) return;

    const run = await createTestEvolutionRun(supabase, null);
    const runId = run.id as string;
    runIds.push(runId);
    strategyIds.push(run.strategy_id as string);
    promptIds.push(run.prompt_id as string);

    const logger = createEntityLogger(
      { entityType: 'run', entityId: runId, runId },
      supabase,
    );

    logger.info('[TEST] context extraction test', {
      iteration: 3,
      phaseName: 'ranking',
      variantId: 'v1',
      custom: 'data',
    });

    await new Promise((r) => setTimeout(r, 200));

    const { data: logs } = await supabase
      .from('evolution_logs')
      .select('id, iteration, agent_name, variant_id, context')
      .eq('run_id', runId)
      .eq('message', '[TEST] context extraction test');

    expect(logs).toBeDefined();
    expect(logs!.length).toBeGreaterThanOrEqual(1);

    const log = logs![0]!;
    logIds.push(log.id);
    expect(log.iteration).toBe(3);
    expect(log.agent_name).toBe('ranking');
    expect(log.variant_id).toBe('v1');
    expect(log.context).toEqual({ custom: 'data' });
  });

  it('fire-and-forget: DB error does not throw', async () => {
    if (!tablesExist) return;

    // Use a very long entity_id that may violate constraints, or an invalid entity_type.
    // The key assertion is that no exception propagates.
    const logger = createEntityLogger(
      {
        entityType: 'run',
        entityId: 'x'.repeat(500), // Likely too long for UUID column
        runId: 'x'.repeat(500),
      },
      supabase,
    );

    // Should not throw despite the invalid data
    expect(() => {
      logger.info('[TEST] fire-and-forget error test');
    }).not.toThrow();

    // Wait a bit to ensure the async insert completes (and fails silently)
    await new Promise((r) => setTimeout(r, 200));
  });
});
