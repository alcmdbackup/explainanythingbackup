// Unit tests for SectionDecompositionAgent: canExecute, decompose→edit→stitch flow, budget handling.

import { SectionDecompositionAgent } from './sectionDecompositionAgent';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, Critique } from '../types';
import { BudgetExceededError } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

// ─── Multi-section article fixture (passes validateFormat) ────────

const MULTI_SECTION_ARTICLE = `# Great Article Title

This is the preamble paragraph with multiple sentences. It introduces the topic well.

## First Section

This section discusses the basics of the topic. It provides foundational context for the reader to understand.

## Second Section

Another section with more detailed prose. This one covers advanced topics in considerable depth.

## Third Section

The final section wraps up the discussion thoroughly. It provides a clear conclusion for readers to take away.
`;

const SINGLE_SECTION_ARTICLE = `# Short Article

This article has no H2 sections at all. It is a simple single-block article.

It has multiple paragraphs though. Each paragraph provides important content.
`;

// ─── Mock factories ───────────────────────────────────────────────

function createMockLogger(): EvolutionLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function createMockCostTracker(): CostTracker {
  let totalSpent = 0;
  const agentCosts = new Map<string, number>();

  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((agent: string, cost: number) => {
      totalSpent += cost;
      agentCosts.set(agent, (agentCosts.get(agent) ?? 0) + cost);
    }),
    getAgentCost: jest.fn((agent: string) => agentCosts.get(agent) ?? 0),
    getTotalSpent: jest.fn(() => totalSpent),
    getAvailableBudget: jest.fn(() => 5.0 - totalSpent),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
  };
}

function createMockLLMClient(editResponse?: string): EvolutionLLMClient {
  const defaultEdit = `## Improved Section

This section has been significantly improved with better prose. It now provides clear and detailed explanations that help readers understand the topic.
`;

  return {
    complete: jest.fn().mockImplementation(async (prompt: string) => {
      // Judge calls
      if (prompt.includes('CriticMarkup') || prompt.includes('Evaluation Criteria')) {
        // Alternate: forward=ACCEPT, reverse=REJECT (consistent acceptance)
        if (prompt.includes('{--') || prompt.includes('{++') || prompt.includes('{~~')) {
          return 'ACCEPT';
        }
        return 'REJECT';
      }
      // Edit calls
      return editResponse ?? defaultEdit;
    }),
    completeStructured: jest.fn().mockRejectedValue(new Error('Not used')),
  };
}

function createMockCritique(variantId: string): Critique {
  return {
    variationId: variantId,
    dimensionScores: { clarity: 5, structure: 7, engagement: 6, precision: 8, coherence: 7 },
    goodExamples: { clarity: ['Some clear part'] },
    badExamples: { clarity: ['Some unclear passage'] },
    notes: { clarity: 'Needs improvement in several areas' },
    reviewer: 'llm',
  };
}

function createContext(
  text: string,
  opts?: { costTracker?: CostTracker; llmClient?: EvolutionLLMClient },
): { ctx: ExecutionContext; state: PipelineStateImpl } {
  const state = new PipelineStateImpl(text);
  state.iteration = 5;

  // Add a variant + rating + critique
  const variant = {
    id: 'top-variant',
    text,
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 3,
  };
  state.addToPool(variant);
  state.ratings.set('top-variant', { mu: 30, sigma: 3 });
  state.allCritiques = [createMockCritique('top-variant')];

  const ctx: ExecutionContext = {
    payload: {
      originalText: text,
      title: 'Test Article',
      explanationId: 1,
      runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG,
    },
    state,
    llmClient: opts?.llmClient ?? createMockLLMClient(),
    logger: createMockLogger(),
    costTracker: opts?.costTracker ?? createMockCostTracker(),
    runId: 'test-run',
  };

  return { ctx, state };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('SectionDecompositionAgent', () => {
  describe('canExecute', () => {
    it('returns true for article with ≥2 H2 sections + critique', () => {
      const agent = new SectionDecompositionAgent();
      const { state } = createContext(MULTI_SECTION_ARTICLE);
      expect(agent.canExecute(state)).toBe(true);
    });

    it('returns false for article with <2 H2 sections', () => {
      const agent = new SectionDecompositionAgent();
      const { state } = createContext(SINGLE_SECTION_ARTICLE);
      expect(agent.canExecute(state)).toBe(false);
    });

    it('returns false when no critiques exist', () => {
      const agent = new SectionDecompositionAgent();
      const { state } = createContext(MULTI_SECTION_ARTICLE);
      state.allCritiques = null;
      expect(agent.canExecute(state)).toBe(false);
    });

    it('returns false when no ratings exist', () => {
      const agent = new SectionDecompositionAgent();
      const { state } = createContext(MULTI_SECTION_ARTICLE);
      state.ratings.clear();
      expect(agent.canExecute(state)).toBe(false);
    });

    it('returns true for exactly 2 H2 sections (boundary)', () => {
      const twoSectionArticle = `# Title

Intro paragraph here. It sets the stage well.

## Section A

Content for section A. It explains the basics thoroughly.

## Section B

Content for section B. It covers the advanced topics well.
`;
      const agent = new SectionDecompositionAgent();
      const { state } = createContext(twoSectionArticle);
      expect(agent.canExecute(state)).toBe(true);
    });
  });

  describe('execute', () => {
    it('reserves budget once upfront (not per-section)', async () => {
      const agent = new SectionDecompositionAgent();
      const costTracker = createMockCostTracker();
      const { ctx } = createContext(MULTI_SECTION_ARTICLE, { costTracker });

      await agent.execute(ctx);

      // reserveBudget should be called exactly once (upfront)
      expect(costTracker.reserveBudget).toHaveBeenCalledTimes(1);
      expect(costTracker.reserveBudget).toHaveBeenCalledWith(
        'sectionDecomposition',
        expect.any(Number),
      );
    });

    it('returns skipped when budget reservation fails', async () => {
      const agent = new SectionDecompositionAgent();
      const costTracker = createMockCostTracker();
      (costTracker.reserveBudget as jest.Mock).mockRejectedValue(
        new BudgetExceededError('sectionDecomposition', 0.5, 0.1),
      );
      const { ctx } = createContext(MULTI_SECTION_ARTICLE, { costTracker });

      const result = await agent.execute(ctx);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('budget');
    });

    it('returns skipped when no critique exists for top variant', async () => {
      const agent = new SectionDecompositionAgent();
      const { ctx, state } = createContext(MULTI_SECTION_ARTICLE);
      state.allCritiques = [createMockCritique('other-variant')]; // wrong variant ID

      const result = await agent.execute(ctx);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it('agent name is sectionDecomposition', () => {
      const agent = new SectionDecompositionAgent();
      expect(agent.name).toBe('sectionDecomposition');
    });

    it('cost attribution uses sectionDecomposition agent name', async () => {
      const agent = new SectionDecompositionAgent();
      const costTracker = createMockCostTracker();
      const { ctx } = createContext(MULTI_SECTION_ARTICLE, { costTracker });

      const result = await agent.execute(ctx);

      // Budget reserved under correct agent name
      expect(costTracker.reserveBudget).toHaveBeenCalledWith(
        'sectionDecomposition',
        expect.any(Number),
      );
      // Cost reported from agent cost tracker
      expect(costTracker.getAgentCost).toHaveBeenCalledWith('sectionDecomposition');
      expect(typeof result.costUsd).toBe('number');
    });
  });
});
