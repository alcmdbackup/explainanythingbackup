// Integration tests for evolution server actions with real Supabase.
// Covers queue, get runs, apply winner, rollback, cost breakdown, and comparison.
// Auto-skips when evolution DB tables are not yet migrated.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createTestVariant,
  createTestAgentInvocation,
  createTestLLMCallTracking,
  createTestPrompt,
  createTestStrategyConfig,
  evolutionTablesExist,
  VALID_VARIANT_TEXT,
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

// Mock the post-evolution eval trigger to be a no-op
jest.mock('@/lib/services/contentQualityEval', () => ({
  evaluateAndSaveContentQuality: jest.fn().mockResolvedValue(undefined),
}));

import { SupabaseClient } from '@supabase/supabase-js';
import {
  queueEvolutionRunAction,
  getEvolutionRunsAction,
  getEvolutionRunByIdAction,
  applyWinnerAction,
  rollbackEvolutionAction,
  getEvolutionCostBreakdownAction,
  killEvolutionRunAction,
} from '@evolution/services/evolutionActions';
import { getEvolutionComparisonAction } from '@/lib/services/contentQualityActions';

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
      await supabase.from('strategy_configs').delete().eq('id', testStrategyConfigId);
      await supabase.from('hall_of_fame_topics').delete().eq('id', testPromptId);
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

  // ─── Apply winner ─────────────────────────────────────────────

  describe('Apply winner', () => {
    it('updates content with variant', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
      });
      const runId = run.id as string;

      const newContent = '# Evolved Content\n\n## Section\n\nThis is the evolved version. It has been improved through the pipeline.';
      const variant = await createTestVariant(supabase, runId, testExplanationId, {
        variant_content: newContent,
      });

      const result = await applyWinnerAction({
        explanationId: testExplanationId,
        variantId: variant.id as string,
        runId,
      });

      expect(result.success).toBe(true);

      const { data: explanation } = await supabase
        .from('explanations')
        .select('content')
        .eq('id', testExplanationId)
        .single();

      expect(explanation!.content).toBe(newContent);
    });

    it('preserves previous content in history', async () => {
      if (!tablesReady) return;

      const { data: original } = await supabase
        .from('explanations')
        .select('content')
        .eq('id', testExplanationId)
        .single();

      const originalContent = original!.content;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
      });
      const runId = run.id as string;

      const variant = await createTestVariant(supabase, runId, testExplanationId, {
        variant_content: '# New Content\n\n## Section\n\nEvolved text here. Significantly improved.',
      });

      await applyWinnerAction({
        explanationId: testExplanationId,
        variantId: variant.id as string,
        runId,
      });

      const { data: history } = await supabase
        .from('content_history')
        .select('previous_content, new_content, source')
        .eq('explanation_id', testExplanationId)
        .eq('source', 'evolution_pipeline')
        .order('applied_at', { ascending: false })
        .limit(1)
        .single();

      expect(history).toBeTruthy();
      expect(history!.previous_content).toBe(originalContent);
    });
  });

  // ─── Rollback ─────────────────────────────────────────────────

  describe('Rollback', () => {
    it('restores previous content', async () => {
      if (!tablesReady) return;

      const { data: original } = await supabase
        .from('explanations')
        .select('content')
        .eq('id', testExplanationId)
        .single();

      const originalContent = original!.content;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
      });
      const runId = run.id as string;

      const variant = await createTestVariant(supabase, runId, testExplanationId, {
        variant_content: '# Evolved\n\n## Section\n\nEvolved text for rollback testing. Should be reverted.',
      });

      await applyWinnerAction({
        explanationId: testExplanationId,
        variantId: variant.id as string,
        runId,
      });

      const { data: history } = await supabase
        .from('content_history')
        .select('id')
        .eq('explanation_id', testExplanationId)
        .eq('source', 'evolution_pipeline')
        .order('applied_at', { ascending: false })
        .limit(1)
        .single();

      const result = await rollbackEvolutionAction({
        explanationId: testExplanationId,
        historyId: history!.id,
      });

      expect(result.success).toBe(true);

      const { data: restored } = await supabase
        .from('explanations')
        .select('content')
        .eq('id', testExplanationId)
        .single();

      expect(restored!.content).toBe(originalContent);
    });

    it('fails for non-existent history', async () => {
      if (!tablesReady) return;

      const result = await rollbackEvolutionAction({
        explanationId: testExplanationId,
        historyId: 99999999,
      });

      expect(result.success).toBe(false);
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
        .from('hall_of_fame_topics')
        .insert({ title: promptText, prompt: promptText })
        .select('id')
        .single();
      if (promptErr || !prompt) throw new Error(`Prompt insert failed: ${promptErr?.message}`);

      // Create a strategy config with all propagatable fields
      const strategyConfig = {
        iterations: 3,
        generationModel: 'deepseek-chat',
        judgeModel: 'deepseek-chat',
        budgetCaps: { generation: 0.2, pairwise: 0.3 },
        enabledAgents: ['reflection', 'debate'],
        singleArticle: true,
      };

      const { data: strategy, error: stratErr } = await supabase
        .from('strategy_configs')
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
          .from('content_evolution_runs')
          .select('config')
          .eq('id', result.data!.id)
          .single();

        const runConfig = run?.config as Record<string, unknown>;
        expect(runConfig).toBeTruthy();

        // Strategy fields should be propagated
        expect(runConfig.maxIterations).toBe(3);
        expect(runConfig.generationModel).toBe('deepseek-chat');
        expect(runConfig.judgeModel).toBe('deepseek-chat');
        expect(runConfig.budgetCaps).toEqual({ generation: 0.2, pairwise: 0.3 });
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
        await supabase.from('strategy_configs').delete().eq('id', strategy.id);
        await supabase.from('hall_of_fame_topics').delete().eq('id', prompt.id);
      }
    });
  });

  // ─── Comparison ───────────────────────────────────────────────

  describe('Comparison', () => {
    it('returns before/after quality scores', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
      });
      const runId = run.id as string;

      await supabase.from('content_history').insert({
        explanation_id: testExplanationId,
        previous_content: 'old content',
        new_content: 'new content',
        source: 'evolution_pipeline',
        evolution_run_id: runId,
        applied_by: MOCK_ADMIN_UUID,
      });

      const { data: historyRow } = await supabase
        .from('content_history')
        .select('applied_at')
        .eq('explanation_id', testExplanationId)
        .eq('source', 'evolution_pipeline')
        .order('applied_at', { ascending: false })
        .limit(1)
        .single();

      const historyAppliedAt = historyRow!.applied_at as string;

      const beforeTime = new Date(new Date(historyAppliedAt).getTime() - 60000).toISOString();
      await supabase.from('content_quality_scores').insert([
        {
          explanation_id: testExplanationId,
          dimension: 'clarity',
          score: 0.6,
          rationale: 'Before evolution',
          model: 'test',
          created_at: beforeTime,
        },
        {
          explanation_id: testExplanationId,
          dimension: 'structure',
          score: 0.5,
          rationale: 'Before evolution',
          model: 'test',
          created_at: beforeTime,
        },
      ]);

      const afterTime = new Date(new Date(historyAppliedAt).getTime() + 60000).toISOString();
      await supabase.from('content_quality_scores').insert([
        {
          explanation_id: testExplanationId,
          dimension: 'clarity',
          score: 0.8,
          rationale: 'After evolution',
          model: 'test',
          created_at: afterTime,
        },
        {
          explanation_id: testExplanationId,
          dimension: 'structure',
          score: 0.7,
          rationale: 'After evolution',
          model: 'test',
          created_at: afterTime,
        },
      ]);

      const result = await getEvolutionComparisonAction(testExplanationId);

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.improvement).toBeGreaterThan(0);
      expect(result.data!.before).toBeTruthy();
      expect(result.data!.after).toBeTruthy();
    });
  });

  // ─── Kill action ───────────────────────────────────────────────

  describe('Kill action', () => {
    it('kills a running run — status transitions to failed with error_message', async () => {
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
        .from('hall_of_fame_topics')
        .insert({ title: promptText, prompt: promptText })
        .select('id')
        .single();

      const { data: strategy } = await supabase
        .from('strategy_configs')
        .insert({
          name: `${TEST_PREFIX}_invalid_model`,
          label: 'Invalid model test',
          config: {
            generationModel: 'nonexistent-model-xyz',
            judgeModel: 'gpt-4.1-nano',
            iterations: 5,
            budgetCaps: { generation: 0.2 },
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
        await supabase.from('strategy_configs').delete().eq('id', strategy!.id);
        await supabase.from('hall_of_fame_topics').delete().eq('id', prompt!.id);
      }
    });
  });
});
