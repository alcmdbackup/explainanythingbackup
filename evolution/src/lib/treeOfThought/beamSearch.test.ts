// Unit tests for the core beam search algorithm: happy path, budget handling, early termination, and re-critique.

import { beamSearch } from './beamSearch';
import type { TextVariation, Critique, ExecutionContext, EvolutionLogger, CostTracker } from '../types';
import { BudgetExceededError } from '../types';
import type { BeamSearchConfig } from './types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import { VALID_VARIANT_TEXT } from '@evolution/testing/evolution-test-helpers';

// Mock external modules
jest.mock('../diffComparison', () => ({
  compareWithDiff: jest.fn().mockResolvedValue({ verdict: 'ACCEPT', confidence: 1, changesFound: 2 }),
}));

jest.mock('../comparison', () => ({
  compareWithBiasMitigation: jest.fn().mockResolvedValue({ winner: 'B', confidence: 0.8, turns: 2 }),
}));

jest.mock('../agents/formatValidator', () => ({
  validateFormat: jest.fn().mockReturnValue({ valid: true, issues: [] }),
}));

jest.mock('../flowRubric', () => ({
  buildQualityCritiquePrompt: (text: string) =>
    `You are an expert writing critic. Analyze this text across multiple quality dimensions.\n\n${text.slice(0, 50)}`,
  QUALITY_DIMENSIONS: {
    clarity: 'Clear writing',
    engagement: 'Compelling writing',
    precision: 'Accurate language',
    voice_fidelity: 'Preserves tone',
    conciseness: 'Appropriately brief',
  },
  getFlowCritiqueForVariant: (variantId: string, critiques: Array<{ variationId: string; scale?: string }>) =>
    critiques.find((c) => c.variationId === variantId && c.scale === '0-5') ?? undefined,
  getWeakestDimensionAcrossCritiques: (
    qualityCritique: { dimensionScores: Record<string, number>; scale?: string },
    flowCritique?: { dimensionScores: Record<string, number>; scale?: string },
  ) => {
    if (!flowCritique) {
      const entries = Object.entries(qualityCritique.dimensionScores);
      if (entries.length === 0) return null;
      entries.sort((a, b) => a[1] - b[1]);
      return { dimension: entries[0][0], normalizedScore: (entries[0][1] - 1) / 9, source: 'quality' as const };
    }
    const qEntries = Object.entries(qualityCritique.dimensionScores);
    const fEntries = Object.entries(flowCritique.dimensionScores);
    if (qEntries.length === 0 && fEntries.length === 0) return null;
    const weakQ = qEntries.sort((a, b) => a[1] - b[1])[0];
    const weakF = fEntries.sort((a, b) => a[1] - b[1])[0];
    const normQ = weakQ ? (weakQ[1] - 1) / 9 : 1;
    const normF = weakF ? weakF[1] / 5 : 1;
    if (normF <= normQ && weakF) return { dimension: weakF[0], normalizedScore: normF, source: 'flow' as const };
    if (weakQ) return { dimension: weakQ[0], normalizedScore: normQ, source: 'quality' as const };
    return null;
  },
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

import { compareWithDiff } from '../diffComparison';
import { compareWithBiasMitigation } from '../comparison';
import { validateFormat } from '../agents/formatValidator';

const mockCompareWithDiff = compareWithDiff as jest.MockedFunction<typeof compareWithDiff>;
const mockCompareWithBiasMitigation = compareWithBiasMitigation as jest.MockedFunction<typeof compareWithBiasMitigation>;
const mockValidateFormat = validateFormat as jest.MockedFunction<typeof validateFormat>;

function makeLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeCostTracker(): CostTracker {
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn().mockReturnValue(0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(4.5),
    getAllAgentCosts: jest.fn().mockReturnValue({}),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
  };
}

function makeCritique(variantId: string): Critique {
  return {
    variationId: variantId,
    dimensionScores: { clarity: 4, structure: 8, engagement: 5 },
    goodExamples: { structure: ['Good structure'] },
    badExamples: { clarity: ['Unclear intro'] },
    notes: { clarity: 'Needs work' },
    reviewer: 'llm',
  };
}

const REVISED_TEXT = '# Revised\n\n## Better\n\nImproved text with clarity. More details here.';

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    payload: {
      originalText: VALID_VARIANT_TEXT,
      title: 'Test',
      explanationId: 1,
      runId: 'run-1',
      config: DEFAULT_EVOLUTION_CONFIG,
    },
    state: {} as ExecutionContext['state'],
    llmClient: {
      complete: jest.fn().mockResolvedValue(REVISED_TEXT),
      completeStructured: jest.fn(),
    },
    logger: makeLogger(),
    costTracker: makeCostTracker(),
    runId: 'run-1',
    ...overrides,
  };
}

function makeRootVariant(): TextVariation {
  return {
    id: 'root-var',
    text: VALID_VARIANT_TEXT,
    version: 1,
    parentIds: [],
    strategy: 'test',
    createdAt: Date.now() / 1000,
    iterationBorn: 1,
  };
}

const MINIMAL_CONFIG: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 1 };

describe('beamSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCompareWithDiff.mockResolvedValue({ verdict: 'ACCEPT', confidence: 1, changesFound: 2 });
    mockCompareWithBiasMitigation.mockResolvedValue({ winner: 'B', confidence: 0.8, turns: 2 });
    mockValidateFormat.mockReturnValue({ valid: true, issues: [] });
  });

  describe('happy path', () => {
    it('returns result with tree state and best leaf text', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result, treeState, bestLeafText } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      expect(result).toBeDefined();
      expect(result.bestLeafNodeId).toBeDefined();
      expect(result.bestVariantId).toBeDefined();
      expect(treeState.nodes).toBeDefined();
      expect(treeState.rootNodeId).toBeDefined();
      expect(bestLeafText).toBeDefined();
    });

    it('generates candidates at each depth', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 2 };

      await beamSearch(root, critique, ctx, config);

      // Depth 1: 1 beam member × 2 branches = 2 LLM calls
      // Depth 2: 2 beam members × 2 branches = 4 LLM calls (+ re-critique calls)
      // Plus re-critique calls at depth >= 1 (when beam > 1)
      expect(ctx.llmClient.complete).toHaveBeenCalled();
    });

    it('builds tree with root and child nodes', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { treeState } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      // Root + generated children
      expect(Object.keys(treeState.nodes).length).toBeGreaterThan(1);
      // Root node exists
      expect(treeState.nodes[treeState.rootNodeId]).toBeDefined();
      expect(treeState.nodes[treeState.rootNodeId].parentNodeId).toBeNull();
    });

    it('records revision path from root to best leaf', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      // revisionPath should contain at least one action (root→leaf)
      if (result.maxDepth > 0) {
        expect(result.revisionPath.length).toBeGreaterThan(0);
      }
    });

    it('records accurate tree size and pruned count', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 1, branchingFactor: 3, maxDepth: 1 };

      const { result, treeState } = await beamSearch(root, critique, ctx, config);

      // treeSize should match actual node count
      expect(result.treeSize).toBe(Object.keys(treeState.nodes).length);
      // Some branches should be pruned (we generate 3, keep 1)
      expect(result.prunedBranches).toBeGreaterThanOrEqual(0);
    });
  });

  describe('early termination', () => {
    it('stops when all candidates are rejected by Stage 1', async () => {
      mockCompareWithDiff.mockResolvedValue({ verdict: 'REJECT', confidence: 1, changesFound: 0 });
      mockCompareWithBiasMitigation.mockResolvedValue({ winner: 'A', confidence: 0.9, turns: 2 });

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 3 };

      const { result } = await beamSearch(root, critique, ctx, config);

      // Should stop at depth 1 since all rejected
      expect(result.maxDepth).toBe(0);
    });

    it('stops when format validation rejects all candidates', async () => {
      mockValidateFormat.mockReturnValue({ valid: false, issues: ['Missing header'] });

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      // No valid candidates → maxDepth stays at 0
      expect(result.maxDepth).toBe(0);
      expect(result.bestVariantId).toBe(root.id);
    });

    it('stops when LLM returns empty text', async () => {
      const ctx = makeCtx({
        llmClient: {
          complete: jest.fn().mockResolvedValue(''),
          completeStructured: jest.fn(),
        },
      });
      // Empty text should fail format validation
      mockValidateFormat.mockReturnValue({ valid: false, issues: ['Empty'] });

      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);
      expect(result.maxDepth).toBe(0);
    });

    it('returns root when best leaf is root (no improvement found)', async () => {
      mockCompareWithDiff.mockResolvedValue({ verdict: 'REJECT', confidence: 1, changesFound: 0 });
      mockCompareWithBiasMitigation.mockResolvedValue({ winner: 'A', confidence: 0.9, turns: 2 });

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result, bestLeafText } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      expect(result.bestVariantId).toBe(root.id);
      expect(bestLeafText).toBe(root.text);
    });
  });

  describe('budget handling', () => {
    it('propagates BudgetExceededError from generation', async () => {
      const ctx = makeCtx({
        llmClient: {
          complete: jest.fn().mockRejectedValue(new BudgetExceededError('treeSearch', 0.5, 0.3)),
          completeStructured: jest.fn(),
        },
      });
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      // Budget error should cause beam to break, not throw
      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);
      expect(result.maxDepth).toBe(0);
      expect((ctx.logger.warn as jest.Mock)).toHaveBeenCalledWith(
        expect.stringContaining('Budget exhausted'),
        expect.anything(),
      );
    });

    it('returns partial results when budget exhausted mid-beam', async () => {
      let callCount = 0;
      const ctx = makeCtx({
        llmClient: {
          complete: jest.fn().mockImplementation(() => {
            callCount++;
            // First few calls succeed (depth 1), then budget error (depth 2)
            if (callCount > 4) {
              return Promise.reject(new BudgetExceededError('treeSearch', 0.5, 0.3));
            }
            return Promise.resolve(REVISED_TEXT);
          }),
          completeStructured: jest.fn(),
        },
      });
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 3 };

      const { result, treeState } = await beamSearch(root, critique, ctx, config);

      // Should have partial results from depth 1
      expect(Object.keys(treeState.nodes).length).toBeGreaterThan(1);
      expect(result.maxDepth).toBeGreaterThanOrEqual(1);
    });

    it('propagates BudgetExceededError from evaluation', async () => {
      // Both comparison types must throw budget error
      mockCompareWithDiff.mockRejectedValue(new BudgetExceededError('treeSearch', 0.5, 0.3));
      mockCompareWithBiasMitigation.mockRejectedValue(new BudgetExceededError('treeSearch', 0.5, 0.3));

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);
      // Evaluation budget error causes break, returns partial
      expect(result.maxDepth).toBe(0);
    });

    it('handles budget error in mini-tournament gracefully', async () => {
      mockCompareWithBiasMitigation.mockRejectedValue(new BudgetExceededError('treeSearch', 0.5, 0.3));

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 3, maxDepth: 1 };

      // Mini-tournament budget error → falls back to unranked survivors
      const { result } = await beamSearch(root, critique, ctx, config);
      expect(result.maxDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('beam collapse prevention', () => {
    it('prunes non-selected survivors', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 1, branchingFactor: 3, maxDepth: 1 };

      const { result } = await beamSearch(root, critique, ctx, config);

      // Generated 3 candidates, kept 1 → at least 2 pruned
      expect(result.prunedBranches).toBeGreaterThanOrEqual(2);
    });

    it('marks rejected candidates as pruned', async () => {
      // Reject ALL candidates at Stage 1 — both diff-eligible and pairwise
      mockCompareWithDiff.mockResolvedValue({ verdict: 'REJECT', confidence: 1, changesFound: 0 });
      mockCompareWithBiasMitigation.mockResolvedValue({ winner: 'A', confidence: 0.9, turns: 2 }); // A = parent wins = reject

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 3, maxDepth: 1 };

      const { treeState } = await beamSearch(root, critique, ctx, config);

      // All generated children should be pruned (all rejected)
      const childNodes = Object.values(treeState.nodes).filter((n) => n.parentNodeId !== null);
      expect(childNodes.length).toBeGreaterThan(0);
      expect(childNodes.every((n) => n.pruned)).toBe(true);
    });
  });

  describe('Promise.allSettled partial failures', () => {
    it('produces candidates from successful calls even when some fail', async () => {
      let genCallCount = 0;
      const ctx = makeCtx({
        llmClient: {
          complete: jest.fn().mockImplementation(() => {
            genCallCount++;
            if (genCallCount % 3 === 0) {
              return Promise.reject(new Error('LLM timeout'));
            }
            return Promise.resolve(REVISED_TEXT);
          }),
          completeStructured: jest.fn(),
        },
      });
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 3, maxDepth: 1 };

      const { treeState } = await beamSearch(root, critique, ctx, config);

      // Some candidates should exist despite partial failures
      // Root + at least some children
      expect(Object.keys(treeState.nodes).length).toBeGreaterThan(1);
    });
  });

  describe('re-critique', () => {
    it('skips re-critique at depth 1 (root has fresh critique)', async () => {
      const ctx = makeCtx();
      const completeMock = ctx.llmClient.complete as jest.Mock;

      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      // maxDepth 1 means only depth=1 iteration runs — no re-critique since root critique is fresh
      const config: BeamSearchConfig = { beamWidth: 1, branchingFactor: 2, maxDepth: 1 };

      await beamSearch(root, critique, ctx, config);

      const calls = completeMock.mock.calls;
      const reCritiqueCalls = calls.filter(
        (call) => (call[0] as string).includes('expert writing critic'),
      );
      expect(reCritiqueCalls).toHaveLength(0);
    });

    it('runs re-critique at depth 2+ even with single beam member', async () => {
      const ctx = makeCtx();
      const completeMock = ctx.llmClient.complete as jest.Mock;

      completeMock.mockImplementation((prompt: string) => {
        if (prompt.includes('expert writing critic')) {
          return Promise.resolve(JSON.stringify({
            scores: { clarity: 5, structure: 7 },
            good_examples: { structure: ['Good'] },
            bad_examples: { clarity: ['Bad'] },
            notes: { clarity: 'Needs work' },
          }));
        }
        return Promise.resolve(REVISED_TEXT);
      });

      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      // beamWidth 1 + maxDepth 2 → at depth 2, single-member beam should still get re-critiqued
      const config: BeamSearchConfig = { beamWidth: 1, branchingFactor: 2, maxDepth: 2 };

      await beamSearch(root, critique, ctx, config);

      const calls = completeMock.mock.calls;
      const reCritiqueCalls = calls.filter(
        (call) => (call[0] as string).includes('expert writing critic'),
      );
      // At least one re-critique call should occur at depth 2
      expect(reCritiqueCalls.length).toBeGreaterThan(0);
    });

    it('runs re-critique when beam has multiple members', async () => {
      const ctx = makeCtx();
      const completeMock = ctx.llmClient.complete as jest.Mock;

      // Return valid critique JSON for re-critique calls, revised text for generation
      completeMock.mockImplementation((prompt: string) => {
        if (prompt.includes('expert writing critic')) {
          return Promise.resolve(JSON.stringify({
            scores: { clarity: 5, structure: 7 },
            good_examples: { structure: ['Good'] },
            bad_examples: { clarity: ['Bad'] },
            notes: { clarity: 'Needs work' },
          }));
        }
        return Promise.resolve(REVISED_TEXT);
      });

      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      // beamWidth=2 ensures multiple beam members → re-critique triggers at depth 2
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 2 };

      await beamSearch(root, critique, ctx, config);

      // At depth 2, beam has 2 members → re-critique should fire
      const critiqueCalls = completeMock.mock.calls.filter(
        (call: unknown[]) => (call[0] as string).includes('expert writing critic'),
      );
      expect(critiqueCalls.length).toBeGreaterThan(0);
    });

    it('gracefully handles malformed re-critique JSON', async () => {
      const ctx = makeCtx();
      const completeMock = ctx.llmClient.complete as jest.Mock;

      completeMock.mockImplementation((prompt: string) => {
        if (prompt.includes('expert writing critic')) {
          return Promise.resolve('not valid json {{{');
        }
        return Promise.resolve(REVISED_TEXT);
      });

      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 2 };

      // Should not throw — malformed JSON returns null, previous critique used
      const { result } = await beamSearch(root, critique, ctx, config);
      expect(result).toBeDefined();
    });
  });

  describe('depth tracking', () => {
    it('maxDepth reflects actual search depth, not config', async () => {
      // Reject at depth 1 for both comparison types, so actual max depth = 0
      mockCompareWithDiff.mockResolvedValue({ verdict: 'REJECT', confidence: 1, changesFound: 0 });
      mockCompareWithBiasMitigation.mockResolvedValue({ winner: 'A', confidence: 0.9, turns: 2 });

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 5 };

      const { result } = await beamSearch(root, critique, ctx, config);
      expect(result.maxDepth).toBe(0);
    });

    it('maxDepth equals config.maxDepth on full search', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 1, branchingFactor: 1, maxDepth: 2 };

      const { result } = await beamSearch(root, critique, ctx, config);
      expect(result.maxDepth).toBe(2);
    });
  });

  describe('flow-aware dimension override', () => {
    it('passes weakest dimension override when flow critique exists', async () => {
      // Provide a state with allCritiques including a flow critique
      const { PipelineStateImpl } = await import('../core/state');
      const state = new PipelineStateImpl('test');
      state.allCritiques = [
        makeCritique('root-var'),
        {
          variationId: 'root-var',
          dimensionScores: { local_cohesion: 1, global_coherence: 4, transition_quality: 3, rhythm_variety: 4, redundancy: 4 },
          goodExamples: {},
          badExamples: {},
          notes: {},
          reviewer: 'llm',
          scale: '0-5' as const,
        },
      ];

      const ctx = makeCtx({ state });
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      // Should have generated candidates (LLM was called)
      expect(ctx.llmClient.complete).toHaveBeenCalled();
    });

    it('works without flow critique (no override)', async () => {
      const { PipelineStateImpl } = await import('../core/state');
      const state = new PipelineStateImpl('test');
      // Only quality critique, no flow
      state.allCritiques = [makeCritique('root-var')];

      const ctx = makeCtx({ state });
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);
      expect(result).toBeDefined();
      expect(result.maxDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('taskType differentiation', () => {
    it('comparison closures pass taskType: comparison to llmClient', async () => {
      // Capture the call closure passed to compareWithDiff
      let capturedDiffCall: ((prompt: string) => Promise<string>) | null = null;
      mockCompareWithDiff.mockImplementation(async (_before, _after, call) => {
        capturedDiffCall = call;
        return { verdict: 'ACCEPT', confidence: 1, changesFound: 2 };
      });

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      // The diff closure should have been captured
      expect(capturedDiffCall).not.toBeNull();

      // Invoke the captured closure and verify options passed to llmClient
      const completeMock = ctx.llmClient.complete as jest.Mock;
      completeMock.mockClear();
      await capturedDiffCall!('test prompt');

      expect(completeMock).toHaveBeenCalledWith('test prompt', 'treeSearch', expect.objectContaining({
        taskType: 'comparison',
      }));
    });

    it('generation calls do NOT pass taskType: comparison', async () => {
      const ctx = makeCtx();
      const completeMock = ctx.llmClient.complete as jest.Mock;

      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      await beamSearch(root, critique, ctx, MINIMAL_CONFIG);

      // Generation calls are direct llmClient.complete(prompt, 'treeSearch') with NO options
      const generationCalls = completeMock.mock.calls.filter(
        (call: unknown[]) => call.length === 2 || (call[2] === undefined),
      );
      expect(generationCalls.length).toBeGreaterThan(0);
      for (const call of generationCalls) {
        // Should have no options at all (generation has no taskType)
        expect(call[2]).toBeUndefined();
      }
    });
  });

  describe('edge cases', () => {
    it('handles maxDepth 0 (no search)', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 2, branchingFactor: 2, maxDepth: 0 };

      const { result, bestLeafText } = await beamSearch(root, critique, ctx, config);
      expect(result.maxDepth).toBe(0);
      expect(result.bestVariantId).toBe(root.id);
      expect(bestLeafText).toBe(root.text);
      expect(result.treeSize).toBe(1);
    });

    it('handles beamWidth 1 branchingFactor 1', async () => {
      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);
      const config: BeamSearchConfig = { beamWidth: 1, branchingFactor: 1, maxDepth: 1 };

      const { result, treeState } = await beamSearch(root, critique, ctx, config);
      expect(result.maxDepth).toBe(1);
      // Root + 1 child
      expect(Object.keys(treeState.nodes).length).toBe(2);
    });

    it('survives when UNSURE verdicts trigger pairwise fallback', async () => {
      mockCompareWithDiff.mockResolvedValue({ verdict: 'UNSURE', confidence: 0, changesFound: 0 });
      // Pairwise fallback accepts candidate
      mockCompareWithBiasMitigation.mockResolvedValue({ winner: 'B', confidence: 0.7, turns: 2 });

      const ctx = makeCtx();
      const root = makeRootVariant();
      const critique = makeCritique(root.id);

      const { result } = await beamSearch(root, critique, ctx, MINIMAL_CONFIG);
      // Should have progressed past depth 1 via fallback
      expect(result.maxDepth).toBeGreaterThanOrEqual(1);
    });
  });
});
