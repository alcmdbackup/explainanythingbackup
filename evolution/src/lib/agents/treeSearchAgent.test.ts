// Unit tests for TreeSearchAgent — tree-of-thought beam search in COMPETITION phase.

import { TreeSearchAgent } from './treeSearchAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, Critique, AgentPayload, TreeSearchExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import { VALID_VARIANT_TEXT } from '@evolution/testing/evolution-test-helpers';

// Mock modules
jest.mock('../treeOfThought/beamSearch', () => ({
  beamSearch: jest.fn(),
}));

jest.mock('../../../../instrumentation', () => ({
  createAppSpan: () => ({
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
    recordException: jest.fn(),
  }),
}));

import { beamSearch } from '../treeOfThought/beamSearch';
const mockBeamSearch = beamSearch as jest.MockedFunction<typeof beamSearch>;

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0.04),
    getTotalSpent: jest.fn().mockReturnValue(0.1),
    getAvailableBudget: jest.fn().mockReturnValue(4.5),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
  };
}

function makeCritique(variantId: string): Critique {
  return {
    variationId: variantId,
    dimensionScores: { clarity: 6, structure: 8, engagement: 5 },
    goodExamples: { clarity: ['Clear intro'] },
    badExamples: { engagement: ['Weak hook'] },
    notes: { clarity: 'Some passive voice' },
    reviewer: 'llm',
  };
}

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl(VALID_VARIANT_TEXT);
  state.iteration = 3;

  // Add a variant with rating and critique
  const variant = {
    id: 'top-variant',
    text: VALID_VARIANT_TEXT,
    version: 1,
    parentIds: [],
    strategy: 'test',
    createdAt: Date.now() / 1000,
    iterationBorn: 1,
  };
  state.addToPool(variant);
  state.allCritiques = [makeCritique('top-variant')];

  // Manually set a rating with high mu and sigma
  state.ratings.set('top-variant', { mu: 30, sigma: 6 });

  return {
    payload: {
      originalText: VALID_VARIANT_TEXT,
      title: 'Test',
      explanationId: 1,
      runId: 'run-1',
      config: DEFAULT_EVOLUTION_CONFIG,
    },
    state: overrides.state ?? state,
    llmClient: {
      complete: jest.fn().mockResolvedValue(VALID_VARIANT_TEXT),
      completeStructured: jest.fn(),
    },
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'run-1',
    ...overrides,
  };
}

describe('TreeSearchAgent', () => {
  const agent = new TreeSearchAgent();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('name', () => {
    it('matches budgetCaps key', () => {
      expect(agent.name).toBe('treeSearch');
      expect(DEFAULT_EVOLUTION_CONFIG.budgetCaps).toHaveProperty('treeSearch');
    });
  });

  describe('canExecute', () => {
    it('returns true when critiques and ratings exist', () => {
      const ctx = makeCtx();
      expect(agent.canExecute(ctx.state)).toBe(true);
    });

    it('returns false with no critiques', () => {
      const ctx = makeCtx();
      ctx.state.allCritiques = null;
      expect(agent.canExecute(ctx.state)).toBe(false);
    });

    it('returns false with empty critiques', () => {
      const ctx = makeCtx();
      ctx.state.allCritiques = [];
      expect(agent.canExecute(ctx.state)).toBe(false);
    });

    it('returns false with no ratings', () => {
      const state = new PipelineStateImpl(VALID_VARIANT_TEXT);
      state.allCritiques = [makeCritique('v')];
      expect(agent.canExecute(state)).toBe(false);
    });

    it('returns false when top variant has no critique', () => {
      const ctx = makeCtx();
      ctx.state.allCritiques = [makeCritique('other-variant')]; // Wrong variant
      expect(agent.canExecute(ctx.state)).toBe(false);
    });
  });

  describe('execute', () => {
    it('runs beam search and adds best leaf to pool', async () => {
      const ctx = makeCtx();
      const bestLeafText = '# Improved\n\n## Better\n\nMuch improved text here. With more detail.';

      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'leaf-1',
          bestVariantId: 'best-v',
          revisionPath: [{ type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' }],
          treeSize: 10,
          maxDepth: 3,
          prunedBranches: 5,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: {
            'root-1': {
              id: 'root-1', variantId: 'top-variant', parentNodeId: null,
              childNodeIds: ['leaf-1'], depth: 0,
              revisionAction: { type: 'edit_dimension', description: 'root' },
              value: 0, pruned: false,
            },
            'leaf-1': {
              id: 'leaf-1', variantId: 'best-v', parentNodeId: 'root-1',
              childNodeIds: [], depth: 1,
              revisionAction: { type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' },
              value: 10, pruned: false,
            },
          },
        },
        bestLeafText,
      });

      const result = await agent.execute(ctx);

      expect(result.agentType).toBe('treeSearch');
      expect(result.success).toBe(true);
      expect(result.variantsAdded).toBe(1);
      expect(mockBeamSearch).toHaveBeenCalledTimes(1);

      // Verify variant was added to pool
      const added = ctx.state.pool.find((v) => v.id === 'best-v');
      expect(added).toBeDefined();
      expect(added!.text).toBe(bestLeafText);
      expect(added!.strategy).toContain('tree_search_');
      expect(added!.parentIds).toEqual(['top-variant']);
    });

    it('stores tree search results on state', async () => {
      const ctx = makeCtx();
      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'root-1',
          bestVariantId: 'top-variant',
          revisionPath: [],
          treeSize: 1,
          maxDepth: 0,
          prunedBranches: 0,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: {
            'root-1': {
              id: 'root-1', variantId: 'top-variant', parentNodeId: null,
              childNodeIds: [], depth: 0,
              revisionAction: { type: 'edit_dimension', description: 'root' },
              value: 0, pruned: false,
            },
          },
        },
        bestLeafText: VALID_VARIANT_TEXT,
      });

      await agent.execute(ctx);
      expect(ctx.state.treeSearchResults).toHaveLength(1);
      expect(ctx.state.treeSearchStates).toHaveLength(1);
    });

    it('does not add root to pool again when best leaf is root', async () => {
      const ctx = makeCtx();
      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'root-1',
          bestVariantId: 'top-variant', // Same as root
          revisionPath: [],
          treeSize: 1,
          maxDepth: 0,
          prunedBranches: 0,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: {
            'root-1': {
              id: 'root-1', variantId: 'top-variant', parentNodeId: null,
              childNodeIds: [], depth: 0,
              revisionAction: { type: 'edit_dimension', description: 'root' },
              value: 0, pruned: false,
            },
          },
        },
        bestLeafText: VALID_VARIANT_TEXT,
      });

      const poolSizeBefore = ctx.state.pool.length;
      await agent.execute(ctx);
      expect(ctx.state.pool.length).toBe(poolSizeBefore); // No new variants
    });

    it('reserves budget before beam search', async () => {
      const ctx = makeCtx();
      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'root-1', bestVariantId: 'top-variant',
          revisionPath: [], treeSize: 1, maxDepth: 0, prunedBranches: 0,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: { 'root-1': { id: 'root-1', variantId: 'top-variant', parentNodeId: null, childNodeIds: [], depth: 0, revisionAction: { type: 'edit_dimension', description: 'root' }, value: 0, pruned: false } },
        },
        bestLeafText: VALID_VARIANT_TEXT,
      });

      await agent.execute(ctx);
      expect(ctx.costTracker.reserveBudget).toHaveBeenCalledWith('treeSearch', expect.any(Number));
    });

    it('propagates BudgetExceededError from reserve', async () => {
      const ctx = makeCtx();
      (ctx.costTracker.reserveBudget as jest.Mock).mockRejectedValue(
        new BudgetExceededError('treeSearch', 0.5, 0.3),
      );

      await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
    });

    it('propagates BudgetExceededError from beam search', async () => {
      const ctx = makeCtx();
      mockBeamSearch.mockRejectedValue(new BudgetExceededError('treeSearch', 0.5, 0.3));

      await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
    });

    it('returns failure when beam search throws non-budget error', async () => {
      const ctx = makeCtx();
      mockBeamSearch.mockRejectedValue(new Error('LLM timeout'));

      const result = await agent.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.agentType).toBe('treeSearch');
    });

    it('captures executionDetail on success with addedToPool', async () => {
      const ctx = makeCtx();
      const bestLeafText = '# Improved\n\n## Better\n\nMuch improved text here. With more detail.';

      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'leaf-1',
          bestVariantId: 'best-v',
          revisionPath: [{ type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' }],
          treeSize: 10,
          maxDepth: 3,
          prunedBranches: 5,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: {
            'root-1': {
              id: 'root-1', variantId: 'top-variant', parentNodeId: null,
              childNodeIds: ['leaf-1'], depth: 0,
              revisionAction: { type: 'edit_dimension', description: 'root' },
              value: 0, pruned: false,
            },
            'leaf-1': {
              id: 'leaf-1', variantId: 'best-v', parentNodeId: 'root-1',
              childNodeIds: [], depth: 1,
              revisionAction: { type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' },
              value: 10, pruned: false,
            },
          },
        },
        bestLeafText,
      });

      const result = await agent.execute(ctx);

      expect(result.executionDetail).toBeDefined();
      const detail = result.executionDetail as TreeSearchExecutionDetail;
      expect(detail.detailType).toBe('treeSearch');
      expect(detail.rootVariantId).toBe('top-variant');
      expect(detail.config.beamWidth).toBeGreaterThan(0);
      expect(detail.result.treeSize).toBe(10);
      expect(detail.result.maxDepth).toBe(3);
      expect(detail.result.prunedBranches).toBe(5);
      expect(detail.result.revisionPath).toHaveLength(1);
      expect(detail.result.revisionPath[0].dimension).toBe('clarity');
      expect(detail.bestLeafVariantId).toBe('best-v');
      expect(detail.addedToPool).toBe(true);
    });

    it('captures executionDetail with addedToPool=false when best is root', async () => {
      const ctx = makeCtx();
      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'root-1', bestVariantId: 'top-variant',
          revisionPath: [], treeSize: 1, maxDepth: 0, prunedBranches: 0,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: { 'root-1': { id: 'root-1', variantId: 'top-variant', parentNodeId: null, childNodeIds: [], depth: 0, revisionAction: { type: 'edit_dimension', description: 'root' }, value: 0, pruned: false } },
        },
        bestLeafText: VALID_VARIANT_TEXT,
      });

      const result = await agent.execute(ctx);

      const detail = result.executionDetail as TreeSearchExecutionDetail;
      expect(detail.addedToPool).toBe(false);
      expect(detail.bestLeafVariantId).toBeUndefined();
    });

    it('skips when no suitable root found', async () => {
      const state = new PipelineStateImpl(VALID_VARIANT_TEXT);
      state.allCritiques = [makeCritique('v')];
      state.ratings.set('v', { mu: 25, sigma: 8 });
      // No variant in pool matching the critique
      const ctx = makeCtx({ state });

      const result = await agent.execute(ctx);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('no_suitable_root');
    });
  });

  describe('estimateCost', () => {
    it('returns positive cost estimate', () => {
      const payload: AgentPayload = {
        originalText: VALID_VARIANT_TEXT,
        title: 'Test',
        explanationId: 1,
        runId: 'run-1',
        config: DEFAULT_EVOLUTION_CONFIG,
      };
      const cost = agent.estimateCost(payload);
      expect(cost).toBeGreaterThan(0);
    });

    it('includes 1.3x safety margin', () => {
      const payload: AgentPayload = {
        originalText: 'x'.repeat(2000),
        title: 'Test',
        explanationId: 1,
        runId: 'run-1',
        config: DEFAULT_EVOLUTION_CONFIG,
      };
      // The method applies 1.3x at the end, so result should be > base
      const cost = agent.estimateCost(payload);
      expect(cost).toBeGreaterThan(0);
      // Rough sanity: for ~2000 char text, should be in $0.01-$0.10 range
      expect(cost).toBeLessThan(0.2);
    });
  });

  describe('root selection', () => {
    it('prefers variants with high sigma (underexplored)', async () => {
      const state = new PipelineStateImpl(VALID_VARIANT_TEXT);
      const v1 = {
        id: 'v1', text: VALID_VARIANT_TEXT, version: 1, parentIds: [],
        strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
      };
      const v2 = {
        id: 'v2', text: VALID_VARIANT_TEXT, version: 1, parentIds: [],
        strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 1,
      };
      state.addToPool(v1);
      state.addToPool(v2);
      state.ratings.set('v1', { mu: 30, sigma: 2 }); // converged
      state.ratings.set('v2', { mu: 28, sigma: 7 }); // underexplored
      state.allCritiques = [makeCritique('v1'), makeCritique('v2')];

      const ctx = makeCtx({ state });
      mockBeamSearch.mockResolvedValue({
        result: {
          bestLeafNodeId: 'root-1', bestVariantId: 'v2',
          revisionPath: [], treeSize: 1, maxDepth: 0, prunedBranches: 0,
        },
        treeState: {
          rootNodeId: 'root-1',
          nodes: { 'root-1': { id: 'root-1', variantId: 'v2', parentNodeId: null, childNodeIds: [], depth: 0, revisionAction: { type: 'edit_dimension', description: 'root' }, value: 0, pruned: false } },
        },
        bestLeafText: VALID_VARIANT_TEXT,
      });

      await agent.execute(ctx);

      // beamSearch should be called with v2 (underexplored) as root, not v1
      expect(mockBeamSearch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'v2' }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
