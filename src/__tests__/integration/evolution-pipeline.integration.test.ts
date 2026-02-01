// Integration tests for executeMinimalPipeline: generation + calibration with real Supabase, mock LLM.
// Covers happy path, budget overflow, agent failure, format validation, and staging scaffold.
// Auto-skips when evolution DB tables are not yet migrated.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createMockEvolutionLLMClient,
  createMockEvolutionLogger,
  evolutionTablesExist,
  VALID_VARIANT_TEXT,
} from '@/testing/utils/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestData,
  TEST_PREFIX,
} from '@/testing/utils/integration-helpers';

// Mock instrumentation before any pipeline imports
jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

import { SupabaseClient } from '@supabase/supabase-js';
import {
  PipelineStateImpl,
  GenerationAgent,
  CalibrationRanker,
  executeMinimalPipeline,
  DEFAULT_EVOLUTION_CONFIG,
  BudgetExceededError,
} from '@/lib/evolution';
import type { ExecutionContext, EvolutionLLMClient } from '@/lib/evolution/types';
import { CostTrackerImpl } from '@/lib/evolution/core/costTracker';

describe('Evolution Pipeline Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping evolution pipeline tests: tables not yet migrated');
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
  });

  afterEach(async () => {
    if (!tablesReady) return;
    await cleanupEvolutionData(supabase, [testExplanationId]);
  });

  /** Build a full ExecutionContext for pipeline tests. */
  function buildContext(
    runId: string,
    llmClient: EvolutionLLMClient,
    originalText = 'Test explanation content for evolution pipeline.',
  ): { ctx: ExecutionContext; state: PipelineStateImpl; costTracker: CostTrackerImpl } {
    const config = { ...DEFAULT_EVOLUTION_CONFIG };
    const state = new PipelineStateImpl(originalText);
    const costTracker = new CostTrackerImpl(config.budgetCapUsd, config.budgetCaps);
    const logger = createMockEvolutionLogger();

    const ctx: ExecutionContext = {
      payload: {
        originalText,
        title: `${TEST_PREFIX}Pipeline Test`,
        explanationId: testExplanationId,
        runId,
        config,
      },
      state,
      llmClient,
      logger,
      costTracker,
      runId,
    };

    return { ctx, state, costTracker };
  }

  describe('Minimal pipeline', () => {
    it('completes run with generation + calibration', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      const { data: updatedRun } = await supabase
        .from('content_evolution_runs')
        .select('status, started_at, completed_at, total_variants')
        .eq('id', runId)
        .single();

      expect(updatedRun).toBeTruthy();
      expect(updatedRun!.status).toBe('completed');
      expect(updatedRun!.started_at).toBeTruthy();
      expect(updatedRun!.completed_at).toBeTruthy();
      expect(state.pool.length).toBeGreaterThan(0);
    });

    it('persists checkpoints to DB', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      const { data: checkpoints } = await supabase
        .from('evolution_checkpoints')
        .select('*')
        .eq('run_id', runId);

      expect(checkpoints).toBeTruthy();
      expect(checkpoints!.length).toBeGreaterThanOrEqual(1);

      const agentNames = checkpoints!.map((c) => c.last_agent);
      expect(agentNames).toContain('generation');
    });

    it('records timing and cost on completed run', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      const { data: updatedRun } = await supabase
        .from('content_evolution_runs')
        .select('started_at, completed_at, total_cost_usd')
        .eq('id', runId)
        .single();

      expect(updatedRun).toBeTruthy();
      expect(updatedRun!.started_at).toBeTruthy();
      expect(updatedRun!.completed_at).toBeTruthy();
      expect(updatedRun!.total_cost_usd).toBeDefined();
    });
  });

  describe('Budget overflow', () => {
    it('pauses run when budget exceeded', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockRejectedValue(
          new BudgetExceededError('generation', 0.02, 0.01),
        ),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      const { data: updatedRun } = await supabase
        .from('content_evolution_runs')
        .select('status, error_message')
        .eq('id', runId)
        .single();

      expect(updatedRun).toBeTruthy();
      expect(updatedRun!.status).toBe('paused');
      expect(updatedRun!.error_message).toContain('Budget exceeded');
    });
  });

  describe('Agent failure', () => {
    it('completes with 0 variants when all strategies fail', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockRejectedValue(new Error('LLM service unavailable')),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new GenerationAgent(), new CalibrationRanker()];

      // GenerationAgent catches per-strategy errors internally, returns success:false.
      // Pipeline doesn't throw on that — completes with 0 variants.
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      const { data: updatedRun } = await supabase
        .from('content_evolution_runs')
        .select('status, total_variants')
        .eq('id', runId)
        .single();

      expect(updatedRun).toBeTruthy();
      expect(updatedRun!.status).toBe('completed');
      // Baseline variant is always inserted, so even when all LLM strategies fail we get 1
      expect(updatedRun!.total_variants).toBe(1);
    });
  });

  describe('Format validation', () => {
    it('rejects variants with invalid format', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const invalidText = 'This is plain text without any headings or structure. Just a paragraph.';
      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(invalidText),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      // Baseline variant is always present even when LLM-generated variants are rejected
      expect(state.pool.length).toBe(1);

      const { data: updatedRun } = await supabase
        .from('content_evolution_runs')
        .select('status')
        .eq('id', runId)
        .single();

      expect(updatedRun!.status).toBe('completed');
    });
  });

  describe.skip('Staging (real OpenAI)', () => {
    it('runs minimal pipeline with real OpenAI', async () => {
      if (!process.env.OPENAI_API_KEY) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const { createEvolutionLLMClient, createCostTracker, createEvolutionLogger } =
        await import('@/lib/evolution');

      const config = { ...DEFAULT_EVOLUTION_CONFIG };
      const costTracker = createCostTracker(config);
      const logger = createEvolutionLogger(runId);
      const llmClient = createEvolutionLLMClient('test-staging', costTracker, logger);

      const state = new PipelineStateImpl('Explain how photosynthesis works in simple terms.');
      state.startNewIteration();

      const ctx: ExecutionContext = {
        payload: {
          originalText: state.originalText,
          title: `${TEST_PREFIX}Staging Pipeline Test`,
          explanationId: testExplanationId,
          runId,
          config,
        },
        state,
        llmClient,
        logger,
        costTracker,
        runId,
      };

      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, logger);

      expect(state.pool.length).toBeGreaterThan(0);
      expect(costTracker.getTotalSpent()).toBeGreaterThan(0);
    });
  });
});
