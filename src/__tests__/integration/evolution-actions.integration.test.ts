// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Entire suite is describe.skip (staging DB mid-migration).
// Type errors from stale API signatures are expected until the code cleanup
// PR lands and tests are re-enabled. See header comment for details.
//
// Integration tests for evolution server actions with real Supabase.
// Covers queue, get runs, apply winner, rollback, cost breakdown, and comparison.
// Auto-skips when evolution DB tables are not yet migrated.
//
// NOTE: Entire suite skipped because migration 20260221000002_evolution_table_rename.sql
// (PR #508) renamed 9 tables and dropped 3. The staging DB PostgREST schema cache
// doesn't fully recognize the backward-compatible views yet. Additionally,
// content_history/content_quality_scores tables were dropped (code cleanup pending).
// Re-enable once staging migration is stable and code cleanup PR lands.

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
  getEvolutionComparisonAction,
  getEvolutionCostBreakdownAction,
} from '@evolution/services/evolutionActions';

let supabase: SupabaseClient;
let testExplanationId: number;
let tablesReady: boolean;

beforeAll(async () => {
  supabase = await setupTestDatabase();
  const seeded = await seedTestData(supabase);
  testExplanationId = seeded.explanationId;
  tablesReady = await evolutionTablesExist(supabase);
  if (!tablesReady) {
    console.warn('Evolution tables not found — skipping evolution-actions integration tests');
  }
});

afterAll(async () => {
  if (tablesReady) {
    await cleanupEvolutionData(supabase, testExplanationId);
  }
  await teardownTestDatabase(supabase, testExplanationId);
});

// Entire suite skipped: staging DB mid-migration (table renames + dropped tables).
// See file header comment for details.
describe.skip('Evolution Server Actions Integration Tests', () => {
  // ─── Queue ─────────────────────────────────────────────────────

  describe('Queue', () => {
    it('creates a pending evolution run', async () => {
      if (!tablesReady) return;

      const result = await queueEvolutionRunAction({
        explanationId: testExplanationId,
      });

      expect(result.success).toBe(true);
      expect(result.runId).toBeTruthy();

      // Verify in DB
      const { data } = await supabase
        .from('content_evolution_runs')
        .select('status, explanation_id')
        .eq('id', result.runId!)
        .single();

      expect(data).toBeTruthy();
      expect(data!.status).toBe('pending');
      expect(data!.explanation_id).toBe(testExplanationId);
    });

    it('prevents duplicate pending runs for same explanation', async () => {
      if (!tablesReady) return;

      // First queue should succeed
      const first = await queueEvolutionRunAction({
        explanationId: testExplanationId,
      });
      expect(first.success).toBe(true);

      // Second queue should fail
      const second = await queueEvolutionRunAction({
        explanationId: testExplanationId,
      });
      expect(second.success).toBe(false);
      expect(second.error).toBeTruthy();
    });
  });

  // ─── Get runs ────────────────────────────────────────────────

  describe('Get runs', () => {
    it('returns runs for an explanation', async () => {
      if (!tablesReady) return;

      const result = await getEvolutionRunsAction(testExplanationId);

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data!.length).toBeGreaterThan(0);
    });
  });

  // ─── Get run by ID ──────────────────────────────────────────

  describe('Get run by ID', () => {
    it('returns detailed run info', async () => {
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

  describe.skip('Apply winner', () => {
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

  describe.skip('Rollback', () => {
    let history: { id: string } | null = null;

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

      const newContent = '# Winner Content\n\n## Section\n\nThis is the new winner content.';
      const variant = await createTestVariant(supabase, runId, testExplanationId, {
        variant_content: newContent,
      });

      await applyWinnerAction({
        explanationId: testExplanationId,
        variantId: variant.id as string,
        runId,
      });

      // Fetch the history entry to rollback
      const { data: historyEntry } = await supabase
        .from('content_history')
        .select('id')
        .eq('explanation_id', testExplanationId)
        .eq('source', 'evolution_pipeline')
        .order('applied_at', { ascending: false })
        .limit(1)
        .single();

      history = historyEntry;

      const result = await rollbackEvolutionAction({
        explanationId: testExplanationId,
        historyId: history!.id,
      });

      expect(result.success).toBe(true);

      const { data: reverted } = await supabase
        .from('explanations')
        .select('content')
        .eq('id', testExplanationId)
        .single();

      expect(reverted!.content).toBe(originalContent);
    });
  });

  // ─── Cost breakdown ─────────────────────────────────────────

  describe('Cost breakdown', () => {
    it('returns per-agent cost breakdown', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        total_cost_usd: 0.25,
      });
      const runId = run.id as string;

      await createTestAgentInvocation(supabase, runId, {
        agent_name: 'generation',
        cost_usd: 0.15,
        duration_ms: 2000,
      });
      await createTestAgentInvocation(supabase, runId, {
        agent_name: 'tournament',
        cost_usd: 0.10,
        duration_ms: 1000,
      });

      // Also add LLM call tracking entries
      await createTestLLMCallTracking(supabase, runId, {
        agent_name: 'generation',
        model_name: 'gpt-4o-mini',
        input_tokens: 1000,
        output_tokens: 500,
        cost_usd: 0.10,
      });

      const result = await getEvolutionCostBreakdownAction(runId);

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.agents).toBeTruthy();
      expect(result.data!.agents.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Queue with strategy config ────────────────────────────

  describe('Queue with strategy config', () => {
    it('stores strategy and prompt references in the run', async () => {
      if (!tablesReady) return;

      // Create test prompt and strategy
      const prompt = await createTestPrompt(supabase, {
        prompt: `${TEST_PREFIX} Explain quantum computing`,
      });
      const strategy = await createTestStrategyConfig(supabase, {
        name: `${TEST_PREFIX} test strategy`,
        generation_model: 'deepseek-chat',
        judge_model: 'deepseek-chat',
        max_iterations: 3,
        budget_cap_usd: 1.0,
        enabled_agents: ['reflection', 'debate'],
        single_article: true,
      });

      try {
        const result = await queueEvolutionRunAction({
          promptId: prompt.id as string,
          strategyConfigId: strategy.id as string,
        });
        expect(result.success).toBe(true);

        // Verify run has strategy + prompt refs
        const { data: run } = await supabase
          .from('content_evolution_runs')
          .select('prompt_id, strategy_config_id, config')
          .eq('id', result.runId!)
          .single();

        expect(run!.prompt_id).toBe(prompt.id);
        expect(run!.strategy_config_id).toBe(strategy.id);

        // Verify config was populated from strategy
        const runConfig = run!.config as Record<string, unknown>;
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
        await supabase.from('strategy_configs').delete().eq('id', strategy.id);
        await supabase.from('hall_of_fame_topics').delete().eq('id', prompt.id);
      }
    });
  });

  // ─── Comparison ───────────────────────────────────────────────

  describe.skip('Comparison', () => {
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

      const result = await getEvolutionComparisonAction({
        explanationId: testExplanationId,
        runId,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(result.data!.before).toBeTruthy();
      expect(result.data!.after).toBeTruthy();
    });
  });

  // ─── Watchdog ──────────────────────────────────────────────

  describe('Watchdog', () => {
    it('marks stale running run as failed', async () => {
      if (!tablesReady) return;

      const staleDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        started_at: staleDate,
        heartbeat_at: staleDate,
      });
      const runId = run.id as string;

      // Import the watchdog
      const { checkStalledRuns } = await import('@/app/api/cron/evolution-watchdog/route');

      const result = await checkStalledRuns(supabase);
      expect(result.stalledCount).toBeGreaterThanOrEqual(1);

      // Verify the run is now failed
      const { data: updated } = await supabase
        .from('content_evolution_runs')
        .select('status, error_message')
        .eq('id', runId)
        .single();

      expect(updated!.status).toBe('failed');
      expect(updated!.error_message).toContain('stale');
    });

    it('detects externally failed run', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'failed',
        error_message: 'Pipeline crashed',
      });
      const runId = run.id as string;

      const result = await getEvolutionRunByIdAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('failed');
      expect(result.data!.error_message).toBe('Pipeline crashed');
    });
  });
});
