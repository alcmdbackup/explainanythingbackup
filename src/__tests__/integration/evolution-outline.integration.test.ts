// Integration tests for OutlineGenerationAgent: verifies outline variant creation,
// step metadata persistence, mixed pool with regular variants, and checkpoint serialization.
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
  OutlineGenerationAgent,
  executeMinimalPipeline,
  DEFAULT_EVOLUTION_CONFIG,
  isOutlineVariant,
} from '@evolution/lib';
import { serializeState, deserializeState } from '@evolution/lib/core/state';
import type { ExecutionContext, EvolutionLLMClient } from '@evolution/lib/types';
import { CostTrackerImpl } from '@evolution/lib/core/costTracker';

const VALID_OUTLINE = `## Introduction
This section introduces the topic and provides context for the reader.

## Main Concepts
This section covers the core ideas and principles discussed in the article.

## Applications
This section explores real-world applications and examples.`;

const VALID_EXPANDED = `# Understanding the Topic

## Introduction

This article introduces the topic and provides important context. The reader will gain a foundational understanding of the key concepts involved.

## Main Concepts

The core ideas center around several principles. These principles have been developed over decades of research and practice.

## Applications

Real-world applications of these concepts are numerous. They span industries from technology to healthcare.`;

const VALID_POLISHED = `# Understanding the Topic

## Introduction

This article introduces the topic and provides essential context for understanding the subject matter. The reader will develop a strong foundational grasp of the key concepts and their significance.

## Main Concepts

At the heart of this field lie several interconnected principles that form a cohesive framework. These principles have evolved through decades of rigorous research and practical application.

## Applications

The real-world applications of these concepts extend across numerous domains and industries. From cutting-edge technology to modern healthcare, practitioners leverage these ideas daily.`;

describe('Evolution Outline Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping outline integration tests: tables not yet migrated');
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

  /** Build an ExecutionContext with outline-compatible mock responses. */
  function buildOutlineContext(
    runId: string,
    llmClient: EvolutionLLMClient,
    originalText = '# Original Article\n\n## Intro\n\nOriginal text here. With some detailed content to transform.',
  ): { ctx: ExecutionContext; state: PipelineStateImpl; costTracker: CostTrackerImpl } {
    const config = { ...DEFAULT_EVOLUTION_CONFIG };
    const state = new PipelineStateImpl(originalText);
    const costTracker = new CostTrackerImpl(config.budgetCapUsd);
    const logger = createMockEvolutionLogger();

    const ctx: ExecutionContext = {
      payload: {
        originalText,
        title: `${TEST_PREFIX}Outline Test`,
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

  /** Create a mock LLM that returns outline pipeline responses in sequence. */
  function createOutlineMockLLM(): EvolutionLLMClient {
    let callIndex = 0;
    const responses = [
      VALID_OUTLINE,    // step 1: outline
      '0.85',           // step 2: score outline
      VALID_EXPANDED,   // step 3: expand
      '0.7',            // step 4: score expand
      VALID_POLISHED,   // step 5: polish
      '0.9',            // step 6: score polish
    ];

    return {
      complete: jest.fn().mockImplementation(() => {
        const resp = responses[callIndex % responses.length];
        callIndex++;
        return Promise.resolve(resp);
      }),
      completeStructured: jest.fn(),
    };
  }

  it('verifies evolution tables exist (skip-sentinel)', () => {
    expect(tablesReady).toBe(true);
  });

  describe('OutlineGenerationAgent in minimal pipeline', () => {
    it('produces OutlineVariant with step metadata', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const mockLLM = createOutlineMockLLM();
      const { ctx, state } = buildOutlineContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new OutlineGenerationAgent()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      // Pool includes baseline + outline variant
      expect(state.pool.length).toBeGreaterThanOrEqual(1);
      const variant = state.pool.find(v => isOutlineVariant(v));
      expect(variant).toBeTruthy();

      if (variant && isOutlineVariant(variant)) {
        expect(variant.strategy).toBe('outline_generation');
        expect(variant.steps).toHaveLength(4); // outline, expand, polish, verify
        expect(variant.steps[0].name).toBe('outline');
        expect(variant.steps[0].score).toBeCloseTo(0.85);
        expect(variant.steps[1].name).toBe('expand');
        expect(variant.steps[1].score).toBeCloseTo(0.7);
        expect(variant.steps[2].name).toBe('polish');
        expect(variant.steps[2].score).toBeCloseTo(0.9);
        expect(variant.steps[3].name).toBe('verify');
        expect(variant.outline).toBeTruthy();
        expect(variant.weakestStep).toBe('expand');
        expect(variant.text).toBe(VALID_POLISHED);
      }
    });

    it('persists outline variant checkpoint with steps', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const mockLLM = createOutlineMockLLM();
      const { ctx, state } = buildOutlineContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new OutlineGenerationAgent()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      // Check checkpoint was persisted
      const { data: checkpoints } = await supabase
        .from('evolution_checkpoints')
        .select('state_snapshot')
        .eq('run_id', runId);

      expect(checkpoints).toBeTruthy();
      expect(checkpoints!.length).toBeGreaterThanOrEqual(1);

      // Verify checkpoint contains outline variant with step data
      const lastCheckpoint = checkpoints![checkpoints!.length - 1];
      const snapshot = lastCheckpoint.state_snapshot as { pool?: Array<Record<string, unknown>> };
      expect(snapshot.pool).toBeTruthy();
      expect(snapshot.pool!.length).toBeGreaterThanOrEqual(1);

      const serializedVariant = snapshot.pool!.find(
        (v: Record<string, unknown>) => v.strategy === 'outline_generation',
      );
      expect(serializedVariant).toBeTruthy();
      expect(Array.isArray(serializedVariant!.steps)).toBe(true);
      expect((serializedVariant!.steps as Array<Record<string, unknown>>).length).toBe(4);
    });
  });

  describe('Mixed pool (OutlineVariant + TextVariation)', () => {
    it('both variant types coexist and can be calibrated', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      // Create a mock LLM that handles both generation agent and outline agent calls
      let callIndex = 0;
      const outlineResponses = [VALID_OUTLINE, '0.85', VALID_EXPANDED, '0.7', VALID_POLISHED, '0.9'];
      const mockLLM: EvolutionLLMClient = {
        complete: jest.fn().mockImplementation((_prompt: string, agentName?: string) => {
          if (agentName === 'outlineGeneration') {
            const resp = outlineResponses[callIndex % outlineResponses.length];
            callIndex++;
            return Promise.resolve(resp);
          }
          // GenerationAgent and CalibrationRanker calls
          return Promise.resolve(VALID_VARIANT_TEXT);
        }),
        completeStructured: jest.fn(),
      };

      const { ctx, state } = buildOutlineContext(runId, mockLLM);
      state.startNewIteration();

      // Run generation + outline + calibration
      const agents = [
        new GenerationAgent(),
        new OutlineGenerationAgent(),
        new CalibrationRanker(),
      ];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      // Pool should have both types
      const outlineVariants = state.pool.filter(v => isOutlineVariant(v));
      const regularVariants = state.pool.filter(v => !isOutlineVariant(v));

      expect(outlineVariants.length).toBeGreaterThanOrEqual(1);
      expect(regularVariants.length).toBeGreaterThanOrEqual(1);

      // All variants should have ratings after calibration
      for (const v of state.pool) {
        const rating = state.ratings.get(v.id);
        expect(rating).toBeDefined();
      }
    });
  });

  describe('Checkpoint serialization round-trip', () => {
    it('OutlineVariant survives serialize → deserialize', async () => {
      if (!tablesReady) throw new Error('Evolution tables not migrated — test cannot run');

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const mockLLM = createOutlineMockLLM();
      const { ctx, state } = buildOutlineContext(runId, mockLLM);
      state.startNewIteration();

      const agents = [new OutlineGenerationAgent()];
      await executeMinimalPipeline(runId, agents, ctx, ctx.logger);

      // Serialize
      const serialized = serializeState(state);
      const json = JSON.stringify(serialized);

      // Deserialize into a new state
      const parsed = JSON.parse(json);
      const restoredState = deserializeState(parsed);

      // Verify round-trip — pool may include a baseline variant added by pipeline
      expect(restoredState.pool.length).toBeGreaterThanOrEqual(1);
      const restored = restoredState.pool.find(v => isOutlineVariant(v));
      expect(restored).toBeTruthy();

      if (restored && isOutlineVariant(restored)) {
        expect(restored.steps).toHaveLength(4);
        expect(restored.steps[0].name).toBe('outline');
        expect(restored.steps[0].score).toBeCloseTo(0.85);
        expect(restored.outline).toBeTruthy();
        expect(restored.weakestStep).toBe('expand');
        expect(restored.text).toBe(VALID_POLISHED);
      }
    });
  });
});
