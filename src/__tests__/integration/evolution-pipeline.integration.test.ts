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
} from '@evolution/testing/evolution-test-helpers';
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
} from '@evolution/lib';
import type { ExecutionContext, EvolutionLLMClient } from '@evolution/lib/types';
import { CostTrackerImpl } from '@evolution/lib/core/costTracker';

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
    const costTracker = new CostTrackerImpl(config.budgetCapUsd);
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

  it('verifies evolution tables exist (skip-sentinel)', () => {
    expect(tablesReady).toBe(true);
  });

  describe('Minimal pipeline', () => {
    it('completes run with generation + calibration', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
        .from('evolution_runs')
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
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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

      // After finalizePipelineRun, pruneCheckpoints keeps only the latest checkpoint
      // per (run_id, iteration). Since calibration runs after generation, only 'calibration' survives.
      const agentNames = checkpoints!.map((c) => c.last_agent);
      expect(agentNames).toContain('calibration');
    });

    it('records timing and cost on completed run', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
        .from('evolution_runs')
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
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
        .from('evolution_runs')
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
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
        .from('evolution_runs')
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
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

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
        .from('evolution_runs')
        .select('status')
        .eq('id', runId)
        .single();

      expect(updatedRun!.status).toBe('completed');
    });
  });

  describe('Config auto-clamping', () => {
    it('resolveConfig clamps expansion.maxIterations for short runs', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const { resolveConfig } = await import('@evolution/lib/config');
      const clamped = resolveConfig({ maxIterations: 3 });

      // maxIterations=3 → expansion clamped to max(0, 3 - 1) = 2
      expect(clamped.expansion.maxIterations).toBe(2);
      expect(clamped.maxIterations).toBe(3);
    });

    it('auto-clamped config runs minimal pipeline without supervisor crash', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      // Build context with clamped config (maxIterations=3 → expansion=0)
      const { resolveConfig } = await import('@evolution/lib/config');
      const config = resolveConfig({ maxIterations: 3 });
      const state = new PipelineStateImpl('Test auto-clamp integration.');
      const costTracker = new CostTrackerImpl(config.budgetCapUsd);
      const logger = createMockEvolutionLogger();

      const ctx: ExecutionContext = {
        payload: {
          originalText: state.originalText,
          title: 'Auto-Clamp Test',
          explanationId: testExplanationId,
          runId,
          config,
        },
        state,
        llmClient: mockLLM,
        logger,
        costTracker,
        runId,
      };

      state.startNewIteration();
      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, logger);

      const { data: updatedRun } = await supabase
        .from('evolution_runs')
        .select('status')
        .eq('id', runId)
        .single();

      expect(updatedRun!.status).toBe('completed');
    });
  });

  describe('Status guard', () => {
    it('does not overwrite terminal status (completed) via status-guarded update', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      const runId = run.id as string;

      // Attempt a status-guarded update that mimics markRunFailed's SQL
      const { data, error } = await supabase
        .from('evolution_runs')
        .update({
          status: 'failed',
          error_message: 'Should not overwrite completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .in('status', ['pending', 'claimed', 'running'])
        .select('status')
        .single();

      // The .in guard should prevent the update — row stays completed
      // Supabase returns null data (no rows matched) rather than an error
      if (data) {
        // If somehow returned, it must still be completed
        expect(data.status).toBe('completed');
      }

      // Verify run is still completed
      const { data: verify } = await supabase
        .from('evolution_runs')
        .select('status, error_message')
        .eq('id', runId)
        .single();

      expect(verify!.status).toBe('completed');
      expect(verify!.error_message).not.toBe('Should not overwrite completed');
    });

    it('does overwrite non-terminal status (running) via status-guarded update', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
      });
      const runId = run.id as string;

      await supabase
        .from('evolution_runs')
        .update({
          status: 'failed',
          error_message: 'Agent generation: test error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .in('status', ['pending', 'claimed', 'running']);

      const { data: verify } = await supabase
        .from('evolution_runs')
        .select('status, error_message, completed_at')
        .eq('id', runId)
        .single();

      expect(verify!.status).toBe('failed');
      expect(verify!.error_message).toBe('Agent generation: test error');
      expect(verify!.completed_at).toBeTruthy();
    });
  });

  describe('Time-aware tournament', () => {
    it('tournament yields with time_limit when timeContext indicates low remaining time', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      // Seed pool with baseline + generated variants so tournament has pairs
      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      // Now run tournament with tight timeContext (simulates near-deadline)
      const { Tournament } = await import('@evolution/lib/agents/tournament');
      const tournament = new Tournament();

      // Set timeContext indicating only 60s remaining (below 120s threshold)
      ctx.timeContext = { startMs: Date.now() - 240_000, maxDurationMs: 300_000 };

      if (tournament.canExecute(state)) {
        const result = await tournament.execute(ctx);
        expect(result.success).toBe(true);
        expect(result.executionDetail).toBeDefined();
        expect(result.executionDetail!.detailType).toBe('tournament');
        const detail = result.executionDetail as import('@evolution/lib/types').TournamentExecutionDetail;
        expect(detail.exitReason).toBe('time_limit');
        expect(detail.totalComparisons).toBe(0);
      }
    });

    it('tournament starts fresh completedPairs each invocation (allows cross-iteration refinement)', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue('A'),
      });

      const { ctx, state } = buildContext(runId, mockLLM);
      state.startNewIteration();

      // Seed pool
      const agents = [new GenerationAgent(), new CalibrationRanker()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      const { Tournament } = await import('@evolution/lib/agents/tournament');
      const tournament = new Tournament();

      if (tournament.canExecute(state) && state.pool.length >= 2) {
        // Pre-populate matchHistory (simulating prior iteration)
        const v0 = state.pool[0];
        const v1 = state.pool[1];
        state.matchHistory.push({
          variationA: v0.id,
          variationB: v1.id,
          winner: v0.id,
          confidence: 0.8,
          turns: 2,
          dimensionScores: {},
        });

        const historyBefore = state.matchHistory.length;
        await tournament.execute(ctx);

        // Fresh completedPairs means the pair CAN be re-compared
        const newMatches = state.matchHistory.slice(historyBefore);
        expect(newMatches.length).toBeGreaterThan(0);
      }
    });
  });

  describe.skip('Staging (real OpenAI)', () => {
    it('runs minimal pipeline with real OpenAI', async () => {
      if (!process.env.OPENAI_API_KEY) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const { createEvolutionLLMClient, createCostTracker, createEvolutionLogger } =
        await import('@evolution/lib');

      const config = { ...DEFAULT_EVOLUTION_CONFIG };
      const costTracker = createCostTracker(config);
      const logger = createEvolutionLogger(runId);
      const llmClient = createEvolutionLLMClient(costTracker, logger);

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
