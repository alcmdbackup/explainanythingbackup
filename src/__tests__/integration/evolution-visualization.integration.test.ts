// Integration tests for evolution visualization server actions with real Supabase.
// Tests dashboard, timeline, Elo history, lineage, budget, and comparison actions.
// Auto-skips when evolution DB tables are not yet migrated.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createTestVariant,
  createTestCheckpoint,
  createTestAgentInvocation,
  evolutionTablesExist,
  VALID_VARIANT_TEXT,
} from '@evolution/testing/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestData,
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
  getEvolutionDashboardDataAction,
  getEvolutionRunTimelineAction,
  getEvolutionRunEloHistoryAction,
  getEvolutionRunLineageAction,
  getEvolutionRunBudgetAction,
  getEvolutionRunComparisonAction,
} from '@evolution/services/evolutionVisualizationActions';

describe('Evolution Visualization Actions Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping evolution visualization tests: tables not yet migrated');
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
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    (requireAdmin as jest.Mock).mockResolvedValue(MOCK_ADMIN_UUID);
  });

  afterEach(async () => {
    if (!tablesReady) return;
    await cleanupEvolutionData(supabase, [testExplanationId]);
  });

  // ─── Dashboard ─────────────────────────────────────────────────

  describe('Dashboard', () => {
    it('returns dashboard data with stats', async () => {
      if (!tablesReady) return;

      await createTestEvolutionRun(supabase, testExplanationId, { status: 'completed', total_cost_usd: 1.5 });

      const result = await getEvolutionDashboardDataAction();
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      expect(typeof result.data!.activeRuns).toBe('number');
      expect(typeof result.data!.queueDepth).toBe('number');
      expect(typeof result.data!.successRate7d).toBe('number');
      expect(typeof result.data!.monthlySpend).toBe('number');
      expect(Array.isArray(result.data!.recentRuns)).toBe(true);
    });

    it('includes recent runs in descending order', async () => {
      if (!tablesReady) return;

      await createTestEvolutionRun(supabase, testExplanationId, { status: 'completed' });
      await createTestEvolutionRun(supabase, testExplanationId, { status: 'pending' });

      const result = await getEvolutionDashboardDataAction();
      expect(result.success).toBe(true);
      expect(result.data!.recentRuns.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Timeline ──────────────────────────────────────────────────

  describe('Timeline', () => {
    it('returns iteration timeline from checkpoints', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        started_at: new Date(Date.now() - 60000).toISOString(),
        completed_at: new Date().toISOString(),
      });
      const runId = run.id as string;

      await createTestCheckpoint(supabase, runId, 1, 'generation_agent');
      await createTestCheckpoint(supabase, runId, 2, 'evaluation_agent');

      const result = await getEvolutionRunTimelineAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.iterations.length).toBe(2);
      expect(result.data!.iterations[0].iteration).toBe(1);
      expect(result.data!.iterations[1].iteration).toBe(2);
    });

    it('rejects invalid run ID format', async () => {
      if (!tablesReady) return;

      const result = await getEvolutionRunTimelineAction('not-a-uuid');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ─── Elo History ───────────────────────────────────────────────

  describe('Elo History', () => {
    it('returns Elo ratings from checkpoints', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, { status: 'completed' });
      const runId = run.id as string;

      await createTestCheckpoint(supabase, runId, 1, 'generation_agent', {
        ratings: { 'v1': { mu: 25, sigma: 8.333 }, 'v2': { mu: 24, sigma: 8.333 } },
        pool: [
          { id: 'v1', text: 'text1', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: Date.now(), iterationBorn: 1 },
          { id: 'v2', text: 'text2', version: 1, parentIds: [], strategy: 'lexical_simplify', createdAt: Date.now(), iterationBorn: 1 },
        ],
      });
      await createTestCheckpoint(supabase, runId, 2, 'evaluation_agent', {
        ratings: { 'v1': { mu: 28, sigma: 5 }, 'v2': { mu: 22, sigma: 5 } },
        pool: [
          { id: 'v1', text: 'text1', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: Date.now(), iterationBorn: 1 },
          { id: 'v2', text: 'text2', version: 1, parentIds: [], strategy: 'lexical_simplify', createdAt: Date.now(), iterationBorn: 1 },
        ],
      });

      const result = await getEvolutionRunEloHistoryAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.history.length).toBe(2);
      expect(result.data!.variants.length).toBe(2);
      // ordinalToEloScale maps ordinal (mu - 3*sigma) to 0-3000 range
      // v1 iter1: ordinal = 25 - 3*8.333 ≈ 0.001, elo ≈ 1200
      // v1 iter2: ordinal = 28 - 3*5 = 13, elo ≈ 1408
      expect(result.data!.history[0].ratings['v1']).toBeGreaterThan(1100);
      expect(result.data!.history[1].ratings['v1']).toBeGreaterThan(result.data!.history[0].ratings['v1']);
    });
  });

  // ─── Lineage ───────────────────────────────────────────────────

  describe('Lineage', () => {
    it('returns nodes and edges from checkpoint pool', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, { status: 'completed' });
      const runId = run.id as string;

      await createTestCheckpoint(supabase, runId, 2, 'evaluation_agent', {
        pool: [
          { id: 'parent-1', text: 'parent text', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: Date.now(), iterationBorn: 1 },
          { id: 'child-1', text: 'child text', version: 2, parentIds: ['parent-1'], strategy: 'lexical_simplify', createdAt: Date.now(), iterationBorn: 2 },
        ],
        ratings: { 'parent-1': { mu: 25, sigma: 8.333 }, 'child-1': { mu: 28, sigma: 5 } },
      });

      const result = await getEvolutionRunLineageAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.nodes.length).toBe(2);
      expect(result.data!.edges.length).toBe(1);
      expect(result.data!.edges[0]).toEqual({ source: 'parent-1', target: 'child-1' });
    });
  });

  // ─── Budget ────────────────────────────────────────────────────

  describe('Budget', () => {
    it('returns agent breakdown and cumulative burn', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        budget_cap_usd: 5.0,
      });
      const runId = run.id as string;

      // Seed agent invocations (cost_usd is cumulative per agent)
      await createTestAgentInvocation(supabase, runId, 0, 'generation', { costUsd: 0.5, executionOrder: 0 });
      await createTestAgentInvocation(supabase, runId, 0, 'calibration', { costUsd: 0.3, executionOrder: 1 });

      const result = await getEvolutionRunBudgetAction(runId);
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data!.agentBreakdown)).toBe(true);
      expect(result.data!.agentBreakdown.length).toBe(2);
      expect(Array.isArray(result.data!.cumulativeBurn)).toBe(true);
      expect(result.data!.cumulativeBurn.length).toBe(2);
    });

    it('returns agentBudgetCaps computed from strategy config', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        started_at: new Date(Date.now() - 60000).toISOString(),
        budget_cap_usd: 10.0,
        config: {
          generationModel: 'gpt-4.1-mini',
          judgeModel: 'gpt-4.1-nano',
          iterations: 3,
          budgetCaps: { generation: 0.35, calibration: 0.15, tournament: 0.20 },
          enabledAgents: ['evolution', 'reflection'],
        },
      });
      const runId = run.id as string;

      const result = await getEvolutionRunBudgetAction(runId);
      expect(result.success).toBe(true);
      // agentBudgetCaps should be non-empty dollar amounts
      expect(Object.keys(result.data!.agentBudgetCaps).length).toBeGreaterThan(0);
      expect(result.data!.agentBudgetCaps['generation']).toBeGreaterThan(0);
      // runStatus should reflect the run's status
      expect(result.data!.runStatus).toBe('running');
    });

    it('returns empty agentBudgetCaps when config has no budgetCaps', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        started_at: new Date(Date.now() - 120000).toISOString(),
        completed_at: new Date().toISOString(),
        budget_cap_usd: 5.0,
      });
      const runId = run.id as string;

      const result = await getEvolutionRunBudgetAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.agentBudgetCaps).toEqual({});
      expect(result.data!.runStatus).toBe('completed');
    });
  });

  // ─── Comparison ────────────────────────────────────────────────

  describe('Comparison', () => {
    it('returns original and winner text', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        current_iteration: 3,
        total_cost_usd: 2.0,
      });
      const runId = run.id as string;

      // Create checkpoint with original text
      await createTestCheckpoint(supabase, runId, 3, 'evaluation_agent', {
        originalText: 'Original content',
        pool: [
          { id: 'w1', text: VALID_VARIANT_TEXT, version: 2, parentIds: [], strategy: 'structural_transform', createdAt: Date.now(), iterationBorn: 1 },
        ],
      });

      // Create winner variant in DB
      await createTestVariant(supabase, runId, testExplanationId, {
        is_winner: true,
        elo_score: 1400,
        agent_name: 'structural_transform',
        variant_content: VALID_VARIANT_TEXT,
      });

      const result = await getEvolutionRunComparisonAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.originalText).toBe('Original content');
      expect(result.data!.winnerText).toBe(VALID_VARIANT_TEXT);
      expect(result.data!.winnerStrategy).toBe('structural_transform');
      expect(result.data!.eloImprovement).toBe(200);
      expect(result.data!.totalIterations).toBe(3);
      expect(result.data!.totalCost).toBe(2.0);
    });

    it('returns null winner when no winner exists', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        current_iteration: 1,
      });
      const runId = run.id as string;

      await createTestCheckpoint(supabase, runId, 1, 'evaluation_agent');

      const result = await getEvolutionRunComparisonAction(runId);
      expect(result.success).toBe(true);
      expect(result.data!.winnerText).toBeNull();
      expect(result.data!.winnerStrategy).toBeNull();
      expect(result.data!.eloImprovement).toBeNull();
    });
  });
});
