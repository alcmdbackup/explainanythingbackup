// Integration test for atomic strategy resolution.
// Verifies resolveOrCreateStrategy INSERT-first upsert pattern with real Supabase.

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
import { resolveOrCreateStrategy, resolveOrCreateStrategyFromRunConfig } from '@evolution/services/strategyResolution';
import type { StrategyConfig } from '@evolution/lib/core/strategyConfig';

describe('Strategy Resolution Integration', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  const createdStrategyIds: string[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping strategy resolution tests: tables not yet migrated');
    }
  });

  afterAll(async () => {
    if (tablesReady && createdStrategyIds.length > 0) {
      await supabase
        .from('evolution_strategy_configs')
        .delete()
        .in('id', createdStrategyIds);
    }
    await teardownTestDatabase(supabase);
  });

  it('creates a new strategy on first call', async () => {
    if (!tablesReady) return;

    const config: StrategyConfig = {
      generationModel: 'test-model-resolve-new',
      judgeModel: 'test-judge-resolve-new',
      iterations: 1,

    };

    const result = await resolveOrCreateStrategy(
      { config, createdBy: 'system' },
      supabase as never,
    );

    expect(result.id).toBeTruthy();
    expect(result.isNew).toBe(true);
    createdStrategyIds.push(result.id);
  });

  it('returns existing strategy on duplicate config hash', async () => {
    if (!tablesReady) return;

    const config: StrategyConfig = {
      generationModel: 'test-model-resolve-dup',
      judgeModel: 'test-judge-resolve-dup',
      iterations: 3,

    };

    // First call creates
    const first = await resolveOrCreateStrategy(
      { config, createdBy: 'experiment' },
      supabase as never,
    );
    expect(first.isNew).toBe(true);
    createdStrategyIds.push(first.id);

    // Second call finds existing
    const second = await resolveOrCreateStrategy(
      { config, createdBy: 'experiment' },
      supabase as never,
    );
    expect(second.id).toBe(first.id);
    expect(second.isNew).toBe(false);
  });

  it('resolves from run config with correct created_by', async () => {
    if (!tablesReady) return;

    const result = await resolveOrCreateStrategyFromRunConfig(
      {
        runConfig: {
          generationModel: 'test-from-runconfig',
          judgeModel: 'test-judge-runconfig',
          maxIterations: 5,
        },
        createdBy: 'batch',
      },
      supabase as never,
    );

    expect(result.id).toBeTruthy();
    createdStrategyIds.push(result.id);

    // Verify created_by was set correctly
    const { data } = await supabase
      .from('evolution_strategy_configs')
      .select('created_by')
      .eq('id', result.id)
      .single();

    expect(data?.created_by).toBe('batch');
  });

  it('normalizes enabledAgents before hashing', async () => {
    if (!tablesReady) return;

    const configA: StrategyConfig = {
      generationModel: 'test-normalize-agents',
      judgeModel: 'test-judge-normalize',
      iterations: 2,

      enabledAgents: ['debate', 'reflection'],
    };

    const configB: StrategyConfig = {
      ...configA,
      enabledAgents: ['reflection', 'debate'], // Different order, same agents
    };

    const first = await resolveOrCreateStrategy(
      { config: configA, createdBy: 'system' },
      supabase as never,
    );
    createdStrategyIds.push(first.id);

    const second = await resolveOrCreateStrategy(
      { config: configB, createdBy: 'system' },
      supabase as never,
    );

    // Same hash → same strategy
    expect(second.id).toBe(first.id);
    expect(second.isNew).toBe(false);
  });
});
