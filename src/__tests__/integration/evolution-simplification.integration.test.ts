// Integration tests for evolution pipeline simplification: unified preparePipelineRun,
// agent configuration consolidation, and checkpoint resume without comparison cache.
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
  preparePipelineRun,
  REQUIRED_AGENTS,
  OPTIONAL_AGENTS,
} from '@evolution/lib';
import {
  isAgentActive,
  getActiveAgents,
  validateAgentSelection,
  toggleAgent,
} from '@evolution/lib/core/agentConfiguration';
import { CostTrackerImpl, createCostTrackerFromCheckpoint } from '@evolution/lib/core/costTracker';
import { persistCheckpoint, loadCheckpointForResume } from '@evolution/lib/core/persistence';
import type { ExecutionContext, EvolutionLLMClient } from '@evolution/lib/types';

describe('Evolution Simplification Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('Skipping evolution simplification tests: tables not yet migrated');
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

  // ─── Agent Configuration Consolidation ──────────────────────────

  describe('Agent configuration (single source of truth)', () => {
    it('REQUIRED_AGENTS and OPTIONAL_AGENTS are disjoint sets', () => {
      const overlap = REQUIRED_AGENTS.filter((a) =>
        OPTIONAL_AGENTS.includes(a as typeof OPTIONAL_AGENTS[number]),
      );
      expect(overlap).toHaveLength(0);
    });

    it('isAgentActive respects enabledAgents for optional agents', () => {
      // Required agents always active regardless of enabledAgents
      expect(isAgentActive('generation', ['reflection'], false)).toBe(true);
      expect(isAgentActive('calibration', [], false)).toBe(true);

      // Optional agents respect enabledAgents
      expect(isAgentActive('reflection', ['reflection'], false)).toBe(true);
      expect(isAgentActive('reflection', [], false)).toBe(false);

      // undefined enabledAgents = all active (backward compat)
      expect(isAgentActive('reflection', undefined, false)).toBe(true);
    });

    it('isAgentActive respects singleArticle mode', () => {
      // generation disabled in singleArticle mode
      expect(isAgentActive('generation', undefined, true)).toBe(false);
      // reflection still active
      expect(isAgentActive('reflection', undefined, true)).toBe(true);
    });

    it('getActiveAgents returns EXPANSION-allowed agents only in EXPANSION phase', () => {
      const expansionAgents = getActiveAgents('EXPANSION', undefined, false);

      // EXPANSION only allows: generation, calibration, tournament, proximity
      expect(expansionAgents).toContain('generation');
      expect(expansionAgents).toContain('calibration');
      // Optional competition-only agents excluded
      expect(expansionAgents).not.toContain('reflection');
      expect(expansionAgents).not.toContain('iterativeEditing');
      expect(expansionAgents).not.toContain('debate');
    });

    it('getActiveAgents returns competition agents in COMPETITION phase', () => {
      const competitionAgents = getActiveAgents('COMPETITION', undefined, false);

      expect(competitionAgents).toContain('generation');
      expect(competitionAgents).toContain('reflection');
      expect(competitionAgents).toContain('calibration');
    });

    it('validateAgentSelection catches missing dependencies', () => {
      // iterativeEditing requires reflection
      const errors = validateAgentSelection(['iterativeEditing']);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('reflection'))).toBe(true);
    });

    it('toggleAgent auto-enables dependencies', () => {
      const agents: string[] = [];
      const result = toggleAgent(agents, 'iterativeEditing');
      // Should auto-enable reflection (dependency)
      expect(result).toContain('iterativeEditing');
      expect(result).toContain('reflection');
    });
  });

  // ─── Unified preparePipelineRun ─────────────────────────────────

  describe('Unified preparePipelineRun', () => {
    it('creates fresh pipeline run without checkpointData', () => {
      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const result = preparePipelineRun({
        runId: 'test-fresh-run',
        title: 'Fresh Run Test',
        explanationId: null,
        originalText: 'Test article for fresh pipeline run.',
        llmClient: mockLLM,
      });

      expect(result.ctx.state).toBeDefined();
      expect(result.ctx.state.pool).toHaveLength(0);
      expect(result.costTracker).toBeDefined();
      expect(result.agents).toBeDefined();
    });

    it('restores pipeline from checkpoint data', () => {
      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      // Create a state to simulate checkpoint data
      const state = new PipelineStateImpl('Test article for resumed run.');
      state.startNewIteration();

      const result = preparePipelineRun({
        runId: 'test-resume-run',
        title: 'Resume Run Test',
        explanationId: null,
        llmClient: mockLLM,
        checkpointData: {
          state,
          iteration: 2,
          phase: 'COMPETITION',
          costTrackerTotalSpent: 1.5,
        },
      });

      expect(result.ctx.state).toBe(state);
      expect(result.costTracker.getTotalSpent()).toBe(1.5);
      expect(result.costTracker.getAvailableBudget()).toBe(result.config.budgetCapUsd - 1.5);
    });
  });

  // ─── Checkpoint without ComparisonCache ─────────────────────────

  describe('Checkpoint persistence (no ComparisonCache serialization)', () => {
    it('persists and loads checkpoint without comparison cache entries', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const logger = createMockEvolutionLogger();

      // Create state with some data
      const state = new PipelineStateImpl('Checkpoint test article.');
      state.startNewIteration();

      // Persist checkpoint (no comparisonCache param — removed in simplification)
      await persistCheckpoint(runId, state, 'iteration_complete', 'EXPANSION', logger, 3, 0.5);

      // Load checkpoint — should not have comparisonCacheEntries
      const resumed = await loadCheckpointForResume(runId);
      expect(resumed.state).toBeDefined();
      expect(resumed.iteration).toBe(0);
      expect(resumed.phase).toBe('EXPANSION');
      expect(resumed.costTrackerTotalSpent).toBe(0.5);
      // ComparisonCache entries no longer serialized
      expect((resumed as unknown as Record<string, unknown>).comparisonCacheEntries).toBeUndefined();
    });

    it('persists checkpoint with supervisor state at iteration boundary', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const logger = createMockEvolutionLogger();

      const state = new PipelineStateImpl('Supervisor checkpoint test.');
      state.startNewIteration();

      const mockSupervisor = {
        getResumeState: () => ({
          phase: 'COMPETITION' as const,
          ordinalHistory: [0.5, 0.6],
          diversityHistory: [0.3, 0.25],
        }),
      };

      await persistCheckpoint(runId, state, 'iteration_complete', 'COMPETITION', logger, 3, 1.2, mockSupervisor);

      const resumed = await loadCheckpointForResume(runId);
      expect(resumed.supervisorState).toBeDefined();
      expect(resumed.supervisorState!.phase).toBe('COMPETITION');
      expect(resumed.supervisorState!.ordinalHistory).toEqual([0.5, 0.6]);
      expect(resumed.supervisorState!.diversityHistory).toEqual([0.3, 0.25]);
    });
  });

  // ─── Pipeline with consolidated agents ──────────────────────────

  describe('Pipeline execution with consolidated agent selection', () => {
    it('minimal pipeline still works after agent invocation moved to persistence.ts', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const config = { ...DEFAULT_EVOLUTION_CONFIG };
      const state = new PipelineStateImpl('Integration test for consolidated agents.');
      const costTracker = new CostTrackerImpl(config.budgetCapUsd);
      const logger = createMockEvolutionLogger();

      const ctx: ExecutionContext = {
        payload: {
          originalText: state.originalText,
          title: `${TEST_PREFIX}Simplification Test`,
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

  // ─── CostTracker from checkpoint ────────────────────────────────

  describe('CostTracker checkpoint restore', () => {
    it('createCostTrackerFromCheckpoint sets correct baseline', () => {
      const config = { ...DEFAULT_EVOLUTION_CONFIG, budgetCapUsd: 5.0 };
      const tracker = createCostTrackerFromCheckpoint(config, 2.0);

      expect(tracker.getTotalSpent()).toBe(2.0);
      expect(tracker.getAvailableBudget()).toBe(3.0);

      // Can still record additional spend
      tracker.recordSpend('generation', 0.5);
      expect(tracker.getTotalSpent()).toBe(2.5);
      expect(tracker.getAvailableBudget()).toBe(2.5);
    });
  });
});
