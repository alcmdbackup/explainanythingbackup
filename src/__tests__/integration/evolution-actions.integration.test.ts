// Integration tests for evolution server actions with real Supabase.
// Covers queue, get runs, apply winner, rollback, cost breakdown, and comparison.
// Auto-skips when evolution DB tables are not yet migrated.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createTestVariant,
  createTestLLMCallTracking,
  evolutionTablesExist,
  VALID_VARIANT_TEXT,
} from '@/testing/utils/evolution-test-helpers';
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
  applyWinnerAction,
  rollbackEvolutionAction,
  getEvolutionCostBreakdownAction,
} from '@/lib/services/evolutionActions';
import { getEvolutionComparisonAction } from '@/lib/services/contentQualityActions';

describe('Evolution Server Actions Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping evolution actions tests: tables not yet migrated');
    }
  });

  afterAll(async () => {
    if (tablesReady) {
      await cleanupEvolutionData(supabase, trackedExplanationIds);
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

      const result = await queueEvolutionRunAction({
        explanationId: testExplanationId,
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

      const now = new Date();
      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        started_at: new Date(now.getTime() - 60000).toISOString(),
        completed_at: now.toISOString(),
      });
      const runId = run.id as string;

      await createTestLLMCallTracking(supabase, 'evolution_generation', 0.005, new Date(now.getTime() - 30000).toISOString());
      await createTestLLMCallTracking(supabase, 'evolution_generation', 0.004, new Date(now.getTime() - 20000).toISOString());
      await createTestLLMCallTracking(supabase, 'evolution_calibration', 0.003, new Date(now.getTime() - 10000).toISOString());

      const result = await getEvolutionCostBreakdownAction(runId);

      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();

      const agents = result.data!.map((b) => b.agent);
      expect(agents).toContain('generation');
      expect(agents).toContain('calibration');

      const gen = result.data!.find((b) => b.agent === 'generation');
      expect(gen).toBeTruthy();
      expect(gen!.calls).toBe(2);

      // Cleanup tracking rows
      await supabase
        .from('llmCallTracking')
        .delete()
        .like('call_source', 'evolution_%')
        .gte('created_at', new Date(now.getTime() - 60000).toISOString());
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
});
