// Integration tests for evolution server actions with real Supabase.
// Covers queue, get runs, cost breakdown, kill, and config validation.
// Auto-skips when evolution DB tables are not yet migrated.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createTestAgentInvocation,
  createTestPrompt,
  createTestStrategyConfig,
  evolutionTablesExist,
} from '@evolution/testing/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestData,
  TEST_PREFIX,
} from '@/testing/utils/integration-helpers';

// ─── Mocks (must be before imports) ─────────────────────────────

const MOCK_ADMIN_UUID = '00000000-0000-4000-8000-000000000001';

jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(MOCK_ADMIN_UUID),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

jest.mock('@/lib/services/auditLog', () => ({ logAdminAction: jest.fn() }));

import { SupabaseClient } from '@supabase/supabase-js';
import {
  queueEvolutionRunAction,
  getEvolutionRunsAction,
  getEvolutionRunByIdAction,
  getEvolutionCostBreakdownAction,
  killEvolutionRunAction,
} from '@evolution/services/evolutionActions';

describe('Evolution Server Actions Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  let testStrategyConfigId: string;
  let testPromptId: string;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping evolution actions tests: tables not yet migrated');
      return;
    }
    // Create shared fixtures for strategy config and prompt
    testStrategyConfigId = await createTestStrategyConfig(supabase);
    testPromptId = await createTestPrompt(supabase);
  });

  afterAll(async () => {
    if (tablesReady) {
      await cleanupEvolutionData(supabase, trackedExplanationIds);
      // Clean up shared fixtures
      await supabase.from('evolution_strategy_configs').delete().eq('id', testStrategyConfigId);
      await supabase.from('evolution_arena_topics').delete().eq('id', testPromptId);
    }
    await teardownTestDatabase(supabase);
  });

  beforeEach(async () => {
    if (!tablesReady) return;
    const seed = await seedTestData(supabase);
    testExplanationId = seed.explanationId;
    trackedExplanationIds.push(testExplanationId);
    jest.clearAllMocks();
    // Re-apply admin mock after clearAllMocks
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    (requireAdmin as jest.Mock).mockResolvedValue(MOCK_ADMIN_UUID);
  });

  afterEach(async () => {
    if (!tablesReady) return;
    await cleanupEvolutionData(supabase, [testExplanationId]);
  });

  // ─── Queue ──────────────────────────────────────────────────────

  describe('Queue', () => {
    it('creates pending run', async () => {
      if (!tablesReady) return;

      const prompt = await createTestPrompt(supabase);
      const strategy = await createTestStrategyConfig(supabase);

      const result = await queueEvolutionRunAction({
        explanationId: testExplanationId,
        promptId: testPromptId,
        strategyId: testStrategyConfigId,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.status).toBe('pending');
      expect(result.data!.explanation_id).toBe(testExplanationId);
    });

    it('uses custom budget cap', async () => {
      if (!tablesReady) return;

      const result = await queueEvolutionRunAction({
        explanationId: testExplanationId,
        promptId: testPromptId,
        strategyId: testStrategyConfigId,
        budgetCapUsd: 10.0,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(Number(result.data!.budget_cap_usd)).toBeCloseTo(10.0);
    });
  });

  // ─── Get runs ─────────────────────────────────────────────────

  describe('Get runs', () => {
    it('returns runs filtered by status', async () => {
      if (!tablesReady) return;

      await createTestEvolutionRun(supabase, testExplanationId, { status: 'completed' });
      await createTestEvolutionRun(supabase, testExplanationId, { status: 'pending' });

      const result = await getEvolutionRunsAction({
        explanationId: testExplanationId,
        status: 'completed',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      for (const run of result.data!) {
        expect(run.status).toBe('completed');
      }
    });

    it('filters by startDate', async () => {
      if (!tablesReady) return;

      await createTestEvolutionRun(supabase, testExplanationId);

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = await getEvolutionRunsAction({
        explanationId: testExplanationId,
        startDate: futureDate,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── Get single run by ID ──────────────────────────────────────

  describe('Get run by ID', () => {
    it('returns a single run with all fields', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        total_cost_usd: 1.23,
      });
      const runId = run.id as string;

      const result = await getEvolutionRunByIdAction(runId);
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.id).toBe(runId);
      expect(result.data!.status).toBe('running');
      expect(result.data!.total_cost_usd).toBe(1.23);
    });

    it('returns error for non-existent run', async () => {
      if (!tablesReady) return;

      const result = await getEvolutionRunByIdAction('00000000-0000-0000-0000-000000000000');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Cost breakdown ───────────────────────────────────────────

  describe('Cost breakdown', () => {
    it('returns grouped costs by agent', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
      });
      const runId = run.id as string;

      // Seed agent invocations — one row per (run_id, iteration, agent_name)
      await createTestAgentInvocation(supabase, runId, 0, 'generation', { costUsd: 0.005, executionOrder: 0 });
      await createTestAgentInvocation(supabase, runId, 1, 'generation', { costUsd: 0.009, executionOrder: 0 });
      await createTestAgentInvocation(supabase, runId, 0, 'calibration', { costUsd: 0.003, executionOrder: 1 });

      const result = await getEvolutionCostBreakdownAction(runId);

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();

      const agents = result.data!.map((b) => b.agent);
      expect(agents).toContain('generation');
      expect(agents).toContain('calibration');

      const gen = result.data!.find((b) => b.agent === 'generation');
      expect(gen).toBeTruthy();
      // 2 invocations (iteration 0 and 1), total cost = 0.005 + 0.009 = 0.014
      expect(gen!.calls).toBe(2);
      expect(gen!.costUsd).toBeCloseTo(0.014, 4);
    });
  });

  // ─── Config propagation (strategy → run) ────────────────────

  describe('Config propagation', () => {
    it('copies strategy config fields into run config JSONB', async () => {
      if (!tablesReady) return;

      // Create a prompt (required by prompt_id NOT NULL constraint on runs)
      const promptText = `${TEST_PREFIX}_config_prop_${Date.now()}`;
      const { data: prompt, error: promptErr } = await supabase
        .from('evolution_arena_topics')
        .insert({ title: promptText, prompt: promptText })
        .select('id')
        .single();
      if (promptErr || !prompt) throw new Error(`Prompt insert failed: ${promptErr?.message}`);

      // Create a strategy config with all propagatable fields
      const strategyConfig = {
        iterations: 3,
        generationModel: 'deepseek-chat',
        judgeModel: 'deepseek-chat',
        enabledAgents: ['reflection', 'debate'],
        singleArticle: true,
      };

      const { data: strategy, error: stratErr } = await supabase
        .from('evolution_strategy_configs')
        .insert({
          name: `${TEST_PREFIX}_config_propagation`,
          label: 'Test config propagation',
          config: strategyConfig,
          config_hash: `test_${Date.now()}`,
        })
        .select('id')
        .single();

      if (stratErr || !strategy) throw new Error(`Strategy insert failed: ${stratErr?.message}`);

      try {
        const result = await queueEvolutionRunAction({
          explanationId: testExplanationId,
          promptId: prompt.id,
          strategyId: strategy.id,
        });

        expect(result.success).toBe(true);
        expect(result.data).toBeTruthy();

        // Read back the run's config JSONB
        const { data: run } = await supabase
          .from('evolution_runs')
          .select('config')
          .eq('id', result.data!.id)
          .single();

        const runConfig = run?.config as Record<string, unknown>;
        expect(runConfig).toBeTruthy();

        // Strategy fields should be propagated
        expect(runConfig.maxIterations).toBe(3);
        expect(runConfig.generationModel).toBe('deepseek-chat');
        expect(runConfig.judgeModel).toBe('deepseek-chat');
        expect(runConfig.enabledAgents).toEqual(['reflection', 'debate']);
        expect(runConfig.singleArticle).toBe(true);

        // Verify resolveConfig() produces strategy values, not defaults
        const { resolveConfig } = await import('@evolution/lib/config');
        const resolved = resolveConfig(runConfig);
        expect(resolved.maxIterations).toBe(3);
        expect(resolved.generationModel).toBe('deepseek-chat');
        expect(resolved.judgeModel).toBe('deepseek-chat');
        expect(resolved.singleArticle).toBe(true);
      } finally {
        // Cleanup strategy config and prompt
        await supabase.from('evolution_strategy_configs').delete().eq('id', strategy.id);
        await supabase.from('evolution_arena_topics').delete().eq('id', prompt.id);
      }
    });
  });

  // ─── Kill action ───────────────────────────────────────────────

  describe('Kill action', () => {
    it('kills a running run -- status transitions to failed with error_message', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        started_at: new Date().toISOString(),
      });
      const runId = run.id as string;

      const result = await killEvolutionRunAction(runId);

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.status).toBe('failed');
      expect(result.data!.error_message).toBe('Manually killed by admin');
      expect(result.data!.completed_at).toBeTruthy();
    });

    it('rejects kill of a completed run', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      const runId = run.id as string;

      const result = await killEvolutionRunAction(runId);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not found or already in terminal state');
    });
  });

  // ─── Config validation at queue time ──────────────────────────

  describe('Config validation', () => {
    it('rejects queue with invalid model name in strategy config', async () => {
      if (!tablesReady) return;

      const promptText = `${TEST_PREFIX}_invalid_config_${Date.now()}`;
      const { data: prompt } = await supabase
        .from('evolution_arena_topics')
        .insert({ title: promptText, prompt: promptText })
        .select('id')
        .single();

      const { data: strategy } = await supabase
        .from('evolution_strategy_configs')
        .insert({
          name: `${TEST_PREFIX}_invalid_model`,
          label: 'Invalid model test',
          config: {
            generationModel: 'nonexistent-model-xyz',
            judgeModel: 'gpt-4.1-nano',
            iterations: 5,
          },
          config_hash: `test_invalid_${Date.now()}`,
        })
        .select('id')
        .single();

      try {
        const result = await queueEvolutionRunAction({
          explanationId: testExplanationId,
          promptId: prompt!.id,
          strategyId: strategy!.id,
        });

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Invalid strategy config');
        expect(result.error?.message).toContain('nonexistent-model-xyz');
      } finally {
        await supabase.from('evolution_strategy_configs').delete().eq('id', strategy!.id);
        await supabase.from('evolution_arena_topics').delete().eq('id', prompt!.id);
      }
    });
  });
});
