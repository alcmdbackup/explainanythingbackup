// Integration test for strategy archiving enforcement.
// Verifies getStrategiesAction status filtering and archiveStrategyAction with real Supabase.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  evolutionTablesExist,
} from '@evolution/testing/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
} from '@/testing/utils/integration-helpers';

jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin'),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

import { SupabaseClient } from '@supabase/supabase-js';
import {
  getStrategiesAction,
  createStrategyAction,
  archiveStrategyAction,
} from '@evolution/services/strategyRegistryActions';

describe('Strategy Archiving Integration', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  const createdIds: string[] = [];

  // Use high random iteration counts to produce unique config hashes (hash includes iterations)
  function uniqueIterations(): number {
    return 1000 + Math.floor(Math.random() * 99000);
  }

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping strategy archiving tests: tables not yet migrated');
    }
  });

  afterAll(async () => {
    if (tablesReady && createdIds.length > 0) {
      await supabase
        .from('evolution_strategy_configs')
        .delete()
        .in('id', createdIds);
    }
    await teardownTestDatabase(supabase);
  });

  it('verifies evolution tables exist (skip-sentinel)', () => {
    expect(tablesReady).toBe(true);
  });

  it('getStrategiesAction defaults to active strategies only', async () => {
    if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

    const ts = Date.now();

    // Create an active strategy (unique iterations → unique config hash)
    const activeResult = await createStrategyAction({
      name: `[TEST] Active Strategy ${ts}`,
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: uniqueIterations() },
    });
    expect(activeResult.success).toBe(true);
    createdIds.push(activeResult.data!.id);

    // Create a strategy and archive it via direct DB update
    const archivedResult = await createStrategyAction({
      name: `[TEST] Archived Strategy ${ts}`,
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano', iterations: uniqueIterations() },
    });
    expect(archivedResult.success).toBe(true);
    createdIds.push(archivedResult.data!.id);

    await supabase
      .from('evolution_strategy_configs')
      .update({ status: 'archived' })
      .eq('id', archivedResult.data!.id);

    // Default call (no filter) should return only active
    const listResult = await getStrategiesAction();
    expect(listResult.success).toBe(true);

    const returnedIds = listResult.data!.map((s) => s.id);
    expect(returnedIds).toContain(activeResult.data!.id);
    expect(returnedIds).not.toContain(archivedResult.data!.id);
  });

  it('getStrategiesAction with status "all" returns both active and archived', async () => {
    if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

    const ts = Date.now();

    // Create an active strategy
    const activeResult = await createStrategyAction({
      name: `[TEST] Active All ${ts}`,
      config: { generationModel: 'deepseek-chat', judgeModel: 'gpt-4.1-nano', iterations: uniqueIterations() },
    });
    expect(activeResult.success).toBe(true);
    createdIds.push(activeResult.data!.id);

    // Create a strategy and archive it
    const archivedResult = await createStrategyAction({
      name: `[TEST] Archived All ${ts}`,
      config: { generationModel: 'deepseek-chat', judgeModel: 'gpt-4.1-nano', iterations: uniqueIterations() },
    });
    expect(archivedResult.success).toBe(true);
    createdIds.push(archivedResult.data!.id);

    await supabase
      .from('evolution_strategy_configs')
      .update({ status: 'archived' })
      .eq('id', archivedResult.data!.id);

    // Call with status: 'all' should return both
    const listResult = await getStrategiesAction({ status: 'all' });
    expect(listResult.success).toBe(true);

    const returnedIds = listResult.data!.map((s) => s.id);
    expect(returnedIds).toContain(activeResult.data!.id);
    expect(returnedIds).toContain(archivedResult.data!.id);
  });

  it('archiveStrategyAction sets status to archived', async () => {
    if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

    const ts = Date.now();

    // Create a predefined strategy
    const createResult = await createStrategyAction({
      name: `[TEST] To Archive ${ts}`,
      config: { generationModel: 'gpt-4o-mini', judgeModel: 'gpt-4.1-nano', iterations: uniqueIterations() },
    });
    expect(createResult.success).toBe(true);
    createdIds.push(createResult.data!.id);

    // Archive it via action
    const archiveResult = await archiveStrategyAction(createResult.data!.id);
    expect(archiveResult.success).toBe(true);
    expect(archiveResult.data!.archived).toBe(true);

    // Verify status changed in DB
    const { data: row } = await supabase
      .from('evolution_strategy_configs')
      .select('status')
      .eq('id', createResult.data!.id)
      .single();

    expect(row?.status).toBe('archived');
  });
});
