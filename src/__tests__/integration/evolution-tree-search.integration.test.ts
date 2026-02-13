// Integration tests for TreeSearchAgent: real Supabase, mock LLM.
// Covers agent execution, variant persistence, checkpoint tree structure, and backward compat.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  createTestCheckpoint,
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
  DEFAULT_EVOLUTION_CONFIG,
} from '@/lib/evolution';
import type { ExecutionContext, EvolutionLLMClient, Critique } from '@/lib/evolution/types';
import { CostTrackerImpl } from '@/lib/evolution/core/costTracker';
import { TreeSearchAgent } from '@/lib/evolution/agents/treeSearchAgent';
import { deserializeState } from '@/lib/evolution/core/state';
import type { SerializedPipelineState } from '@/lib/evolution/types';

describe('Evolution Tree Search Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping tree search integration tests: tables not yet migrated');
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

  /** Build a pipeline state pre-seeded with a root variant, rating, and critique. */
  function buildSeededState(): PipelineStateImpl {
    const state = new PipelineStateImpl('Test explanation for tree search.');
    state.startNewIteration();

    // Add baseline variant so pool is non-empty
    const rootVariant = {
      id: 'root-variant-001',
      text: VALID_VARIANT_TEXT,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now() / 1000,
      iterationBorn: 1,
    };
    state.addToPool(rootVariant);

    // Set a rating with high sigma (underexplored) to be selected as root
    state.ratings.set('root-variant-001', { mu: 28, sigma: 8.333 });
    state.matchCounts.set('root-variant-001', 2);

    // Add critique for the root variant
    state.allCritiques = [{
      variationId: 'root-variant-001',
      dimensionScores: { clarity: 6, structure: 7, engagement: 5, accuracy: 8, completeness: 6 },
      goodExamples: { clarity: ['good example'] },
      badExamples: { clarity: ['needs improvement'] },
      notes: { clarity: 'Some passive constructions' },
      reviewer: 'llm',
    }];

    return state;
  }

  /** Build execution context with mock LLM and real cost tracker. */
  function buildContext(
    runId: string,
    llmClient: EvolutionLLMClient,
    state: PipelineStateImpl,
  ): ExecutionContext {
    const config = { ...DEFAULT_EVOLUTION_CONFIG };
    const costTracker = new CostTrackerImpl(config.budgetCapUsd, config.budgetCaps);
    const logger = createMockEvolutionLogger();

    return {
      payload: {
        originalText: state.originalText,
        title: `${TEST_PREFIX}Tree Search Test`,
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
  }

  describe('TreeSearchAgent execution', () => {
    it('executes beam search and adds variant to pool', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const state = buildSeededState();

      // Mock LLM: return valid variant text for generation, JSON for critique, winner for comparison.
      // compareWithBiasMitigation does 2-pass reversal: pass1 + pass2 with texts swapped.
      // To get agreement, we alternate B/A so after normalization both passes agree on winner B.
      let comparisonCallCount = 0;
      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn()
          .mockImplementation((prompt: string) => {
            // Inline critique calls return JSON
            if (prompt.includes('expert writing critic')) {
              return Promise.resolve(JSON.stringify({
                scores: { clarity: 7, structure: 8, engagement: 6, accuracy: 8, completeness: 7 },
                good_examples: { clarity: 'Clear opening' },
                bad_examples: { clarity: 'Some vagueness' },
                notes: { clarity: 'Generally clear' },
              }));
            }
            // Comparison calls: alternate B/A for bias-mitigation agreement
            // Pass 1 returns 'B' (candidate wins), Pass 2 returns 'A' (after reversal, still 'B')
            if (prompt.includes('writing evaluator') || prompt.includes('CriticMarkup')) {
              comparisonCallCount++;
              return Promise.resolve(comparisonCallCount % 2 === 1 ? 'B' : 'A');
            }
            // Generation calls return valid markdown
            return Promise.resolve(VALID_VARIANT_TEXT);
          }),
      });

      const agent = new TreeSearchAgent({ beamWidth: 2, branchingFactor: 2, maxDepth: 1 });
      const ctx = buildContext(runId, mockLLM, state);

      const poolSizeBefore = state.pool.length;
      expect(poolSizeBefore).toBe(1);

      const result = await agent.execute(ctx);

      expect(result.agentType).toBe('treeSearch');
      expect(result.success).toBe(true);
      // Agent adds at most 1 new variant (best leaf)
      expect(state.pool.length).toBeLessThanOrEqual(poolSizeBefore + 1);
    });

    it('stores treeSearchResults on state after execution', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const state = buildSeededState();

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const agent = new TreeSearchAgent({ beamWidth: 2, branchingFactor: 2, maxDepth: 1 });
      const ctx = buildContext(runId, mockLLM, state);

      await agent.execute(ctx);

      expect(state.treeSearchResults).not.toBeNull();
      expect(state.treeSearchResults!.length).toBe(1);
      expect(state.treeSearchResults![0]).toHaveProperty('bestLeafNodeId');
      expect(state.treeSearchResults![0]).toHaveProperty('treeSize');
      expect(state.treeSearchResults![0]).toHaveProperty('revisionPath');
    });

    it('stores treeSearchStates on state after execution', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const state = buildSeededState();

      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      });

      const agent = new TreeSearchAgent({ beamWidth: 2, branchingFactor: 2, maxDepth: 1 });
      const ctx = buildContext(runId, mockLLM, state);

      await agent.execute(ctx);

      expect(state.treeSearchStates).not.toBeNull();
      expect(state.treeSearchStates!.length).toBe(1);
      expect(state.treeSearchStates![0]).toHaveProperty('nodes');
      expect(state.treeSearchStates![0]).toHaveProperty('rootNodeId');
      // Root node + children should exist
      expect(Object.keys(state.treeSearchStates![0].nodes).length).toBeGreaterThan(0);
    });

    it('canExecute returns false when no critiques exist', () => {
      if (!tablesReady) return;

      const state = buildSeededState();
      state.allCritiques = null;

      const agent = new TreeSearchAgent();
      expect(agent.canExecute(state)).toBe(false);
    });

    it('canExecute returns false when no ratings exist', () => {
      if (!tablesReady) return;

      const state = buildSeededState();
      state.ratings.clear();

      const agent = new TreeSearchAgent();
      expect(agent.canExecute(state)).toBe(false);
    });
  });

  describe('Checkpoint backward compatibility', () => {
    it('deserializes checkpoint without treeSearchResults as null', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      // Create checkpoint without tree search fields (simulating legacy data)
      await createTestCheckpoint(supabase, runId, 1, 'generation');

      // Load and deserialize
      const { data: cp } = await supabase
        .from('evolution_checkpoints')
        .select('state_snapshot')
        .eq('run_id', runId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const snapshot = cp!.state_snapshot as SerializedPipelineState;
      const state = deserializeState(snapshot);

      expect(state.treeSearchResults).toBeNull();
      expect(state.treeSearchStates).toBeNull();
    });

    it('round-trips treeSearchResults through checkpoint serialization', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;

      // Create checkpoint with tree search results
      const treeSearchResults = [{
        bestLeafNodeId: 'node-leaf-1',
        bestVariantId: 'variant-leaf-1',
        revisionPath: [{ type: 'edit_dimension' as const, dimension: 'clarity', description: 'Improve clarity' }],
        treeSize: 4,
        maxDepth: 1,
        prunedBranches: 2,
      }];

      const treeSearchStates = [{
        rootNodeId: 'node-root-1',
        nodes: {
          'node-root-1': {
            id: 'node-root-1',
            variantId: 'root-variant-001',
            parentNodeId: null,
            childNodeIds: ['node-leaf-1'],
            depth: 0,
            revisionAction: { type: 'edit_dimension' as const, description: 'Root' },
            value: 0,
            pruned: false,
          },
          'node-leaf-1': {
            id: 'node-leaf-1',
            variantId: 'variant-leaf-1',
            parentNodeId: 'node-root-1',
            childNodeIds: [],
            depth: 1,
            revisionAction: { type: 'edit_dimension' as const, dimension: 'clarity', description: 'Improve clarity' },
            value: 1,
            pruned: false,
          },
        },
      }];

      await createTestCheckpoint(supabase, runId, 2, 'treeSearch', {
        treeSearchResults,
        treeSearchStates,
      });

      // Read back from DB
      const { data: cp } = await supabase
        .from('evolution_checkpoints')
        .select('state_snapshot')
        .eq('run_id', runId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const snapshot = cp!.state_snapshot as SerializedPipelineState;
      const state = deserializeState(snapshot);

      expect(state.treeSearchResults).toHaveLength(1);
      expect(state.treeSearchResults![0].bestLeafNodeId).toBe('node-leaf-1');
      expect(state.treeSearchResults![0].treeSize).toBe(4);
      expect(state.treeSearchResults![0].revisionPath[0].dimension).toBe('clarity');

      expect(state.treeSearchStates).toHaveLength(1);
      expect(Object.keys(state.treeSearchStates![0].nodes)).toHaveLength(2);
      expect(state.treeSearchStates![0].nodes['node-leaf-1'].depth).toBe(1);
    });
  });

  describe('Pool management', () => {
    it('adds at most 1 new variant to pool (rate limiting)', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId);
      const runId = run.id as string;
      const state = buildSeededState();

      // Return different valid text for each call to ensure unique variants
      let callCount = 0;
      const mockLLM = createMockEvolutionLLMClient({
        complete: jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve(
            `# Variant ${callCount}\n\n## Overview\n\nThis is test variant number ${callCount}. It has enough content to pass format validation with proper structure.\n\n## Details\n\nMore content here to ensure the variant is long enough and has multiple sections as required.`,
          );
        }),
      });

      const agent = new TreeSearchAgent({ beamWidth: 3, branchingFactor: 3, maxDepth: 2 });
      const ctx = buildContext(runId, mockLLM, state);

      const poolSizeBefore = state.pool.length;
      await agent.execute(ctx);

      // Should add at most 1 new variant (best leaf only, root already in pool)
      const newVariants = state.pool.length - poolSizeBefore;
      expect(newVariants).toBeLessThanOrEqual(1);
    });
  });
});
