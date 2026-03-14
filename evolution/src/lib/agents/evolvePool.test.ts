// Unit tests for EvolutionAgent: mutation, crossover, creative exploration, outline mutation, and format validation.

import { EvolutionAgent, getDominantStrategies, shouldTriggerCreativeExploration, EVOLUTION_STRATEGIES } from './evolvePool';
import { PipelineStateImpl } from '../core/state';
import { applyActions } from '../core/reducer';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, TextVariation, OutlineVariant, GenerationStep, EvolutionExecutionDetail } from '../types';
import { BASELINE_STRATEGY, isOutlineVariant } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

const VALID_TEXT = `# Test Title

## Section One

This is a paragraph with at least two sentences. It meets the format requirements nicely.

## Section Two

Another paragraph that satisfies the validator. This ensures we have proper section headings.`;

function makeMockLLMClient(responses: string[]): EvolutionLLMClient {
  let callIndex = 0;
  return {
    complete: jest.fn().mockImplementation(() => {
      const resp = responses[callIndex % responses.length];
      callIndex++;
      return Promise.resolve(resp);
    }),
    completeStructured: jest.fn(),
  };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeMockCostTracker(): CostTracker {
  const agentCosts = new Map<string, number>();
  return {
    reserveBudget: jest.fn().mockResolvedValue(undefined),
    recordSpend: jest.fn((name: string, cost: number) => { agentCosts.set(name, (agentCosts.get(name) ?? 0) + cost); }),
    getAgentCost: jest.fn((name: string) => agentCosts.get(name) ?? 0),
    getTotalSpent: jest.fn().mockReturnValue(0),
    getAvailableBudget: jest.fn().mockReturnValue(5),
    getAllAgentCosts: jest.fn(() => Object.fromEntries(agentCosts)),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
    isOverflowed: false,
  };
}

function makeState(poolSize: number): PipelineStateImpl {
  const state = new PipelineStateImpl('# Original\n\n## Sec\n\nOriginal text content here. More text to make it valid.');
  for (let i = 0; i < poolSize; i++) {
    state.addToPool({
      id: `v-${i}`,
      text: `# Variant ${i}\n\n## Sec\n\nVariant ${i} text content. More content here.`,
      version: 1,
      parentIds: [],
      strategy: i % 2 === 0 ? 'structural_transform' : 'lexical_simplify',
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
    });
    state.ratings.set(`v-${i}`, { mu: 25 + i * (25 / 400) * 50, sigma: 4 });
    state.matchCounts.set(`v-${i}`, 3);
  }
  return state;
}

function makeCtx(responses: string[], poolSize = 4): ExecutionContext {
  const state = makeState(poolSize);
  return {
    payload: {
      originalText: state.originalText,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    },
    state,
    llmClient: makeMockLLMClient(responses),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run',
  };
}

// ─── getDominantStrategies tests ─────────────────────────────────

describe('getDominantStrategies', () => {
  it('returns empty for empty pool', () => {
    expect(getDominantStrategies([])).toEqual([]);
  });

  it('identifies overrepresented strategies', () => {
    const pool: TextVariation[] = [
      { id: '1', text: 'a', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
      { id: '2', text: 'b', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
      { id: '3', text: 'c', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
      { id: '4', text: 'd', version: 1, parentIds: [], strategy: 'lexical_simplify', createdAt: 0, iterationBorn: 0 },
    ];
    // avg = 4/2 = 2, structural_transform has 3 > 2*1.5 = 3 → no (not strictly greater)
    // Actually 3 > 3 is false, so need 4 to be dominant
    // Let's test with clearer numbers
    const pool2: TextVariation[] = [
      ...pool,
      { id: '5', text: 'e', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
    ];
    // 5 variants, 2 strategies, avg = 2.5, structural_transform = 4 > 2.5*1.5 = 3.75 → yes
    expect(getDominantStrategies(pool2)).toEqual(['structural_transform']);
  });

  it('returns empty when balanced', () => {
    const pool: TextVariation[] = [
      { id: '1', text: 'a', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
      { id: '2', text: 'b', version: 1, parentIds: [], strategy: 'lexical_simplify', createdAt: 0, iterationBorn: 0 },
    ];
    expect(getDominantStrategies(pool)).toEqual([]);
  });

  it('excludes baseline from strategy count', () => {
    const pool: TextVariation[] = [
      { id: 'b', text: 'orig', version: 0, parentIds: [], strategy: BASELINE_STRATEGY, createdAt: 0, iterationBorn: 0 },
      { id: '1', text: 'a', version: 1, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 0 },
      { id: '2', text: 'b', version: 1, parentIds: [], strategy: 'lexical_simplify', createdAt: 0, iterationBorn: 0 },
    ];
    // Without baseline: 2 variants, 2 strategies, balanced → empty
    expect(getDominantStrategies(pool)).toEqual([]);
  });

  it('returns empty when only baseline in pool', () => {
    const pool: TextVariation[] = [
      { id: 'b', text: 'orig', version: 0, parentIds: [], strategy: BASELINE_STRATEGY, createdAt: 0, iterationBorn: 0 },
    ];
    expect(getDominantStrategies(pool)).toEqual([]);
  });
});

// ─── shouldTriggerCreativeExploration tests ──────────────────────

describe('shouldTriggerCreativeExploration', () => {
  it('triggers on low random value (<0.3)', () => {
    const state = new PipelineStateImpl('text');
    expect(shouldTriggerCreativeExploration(state, 0.1)).toBe(true);
  });

  it('does not trigger on high random value with normal diversity', () => {
    const state = new PipelineStateImpl('text');
    state.diversityScore = 0.8;
    expect(shouldTriggerCreativeExploration(state, 0.5)).toBe(false);
  });

  it('triggers on low diversity', () => {
    const state = new PipelineStateImpl('text');
    state.diversityScore = 0.3;
    expect(shouldTriggerCreativeExploration(state, 0.9)).toBe(true);
  });
});

// ─── EvolutionAgent tests ────────────────────────────────────────

describe('EvolutionAgent', () => {
  const agent = new EvolutionAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('evolution');
  });

  it('canExecute requires pool + ratings', () => {
    const emptyState = new PipelineStateImpl('text');
    expect(agent.canExecute(emptyState)).toBe(false);

    const rated = makeState(2);
    expect(agent.canExecute(rated)).toBe(true);
  });

  it('produces variants from top parents', async () => {
    // All LLM calls return valid format text
    const ctx = makeCtx([VALID_TEXT], 4);
    // Mock Math.random to NOT trigger creative exploration
    const originalRandom = Math.random;
    Math.random = () => 0.9;
    try {
      const result = await agent.execute(ctx);
      expect(result.success).toBe(true);
      expect(result.variantsAdded).toBeGreaterThanOrEqual(3);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('applies all 3 strategies', async () => {
    const ctx = makeCtx([VALID_TEXT], 4);
    Math.random = () => 0.9;
    try {
      await agent.execute(ctx);
      const calls = (ctx.llmClient.complete as jest.Mock).mock.calls;
      // 3 strategies = 3 LLM calls (no creative exploration)
      expect(calls.length).toBe(3);
      // First call should be mutate_clarity prompt
      expect(calls[0][0]).toContain('clarity');
      // Second call should be mutate_structure prompt
      expect(calls[1][0]).toContain('structure');
      // Third call should be crossover prompt
      expect(calls[2][0]).toContain('Combine the best elements');
    } finally {
      Math.random = () => originalRandom();
    }
  });

  it('skips format-invalid outputs', async () => {
    // Return text without H1 (invalid format)
    const ctx = makeCtx(['No heading here. Just bare text.'], 4);
    Math.random = () => 0.9;
    try {
      const result = await agent.execute(ctx);
      // All should be rejected
      expect(result.success).toBe(false);
      expect(result.error).toContain('All evolution strategies failed');
    } finally {
      Math.random = () => originalRandom();
    }
  });

  it('continues on individual strategy errors', async () => {
    const ctx = makeCtx([VALID_TEXT], 3);
    let callCount = 0;
    (ctx.llmClient.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error('API error');
      return Promise.resolve(VALID_TEXT);
    });
    Math.random = () => 0.9;
    try {
      const result = await agent.execute(ctx);
      expect(result.success).toBe(true);
      // First strategy failed, remaining 2 should succeed
      expect(result.variantsAdded).toBe(2);
    } finally {
      Math.random = () => originalRandom();
    }
  });

  it('handles crossover fallback when only 1 parent', async () => {
    // Pool with 1 variant — crossover should fall back to mutate_clarity
    const ctx = makeCtx([VALID_TEXT], 1);
    Math.random = () => 0.9;
    try {
      const result = await agent.execute(ctx);
      expect(result.success).toBe(true);
    } finally {
      Math.random = () => originalRandom();
    }
  });

  it('triggers creative exploration on low random value', async () => {
    const ctx = makeCtx([VALID_TEXT], 4);
    // Force creative exploration (random < 0.3)
    Math.random = () => 0.1;
    try {
      const result = await agent.execute(ctx);
      expect(result.success).toBe(true);
      // 3 strategies + 1 creative = 4
      expect(result.variantsAdded).toBeGreaterThanOrEqual(4);
    } finally {
      Math.random = () => originalRandom();
    }
  });

  describe('executionDetail', () => {
    it('captures per-mutation detail on success', async () => {
      const ctx = makeCtx([VALID_TEXT], 4);
      Math.random = () => 0.9;
      try {
        const result = await agent.execute(ctx);

        expect(result.executionDetail).toBeDefined();
        const detail = result.executionDetail as EvolutionExecutionDetail;
        expect(detail.detailType).toBe('evolution');
        expect(detail.parents.length).toBeGreaterThanOrEqual(1);
        expect(detail.parents[0].mu).toBeGreaterThan(0);
        expect(detail.mutations.length).toBe(3); // 3 strategies
        for (const m of detail.mutations) {
          expect(m.status).toBe('success');
          expect(m.variantId).toBeDefined();
          expect(m.textLength).toBeGreaterThan(0);
        }
        expect(detail.creativeExploration).toBe(false);
        expect(detail.feedbackUsed).toBe(false);
      } finally {
        Math.random = originalRandom;
      }
    });

    it('tracks format_rejected mutations', async () => {
      const ctx = makeCtx(['No heading here. Just bare text.'], 4);
      Math.random = () => 0.9;
      try {
        const result = await agent.execute(ctx);

        const detail = result.executionDetail as EvolutionExecutionDetail;
        for (const m of detail.mutations) {
          expect(m.status).toBe('format_rejected');
        }
      } finally {
        Math.random = originalRandom;
      }
    });

    it('captures creative exploration detail', async () => {
      const ctx = makeCtx([VALID_TEXT], 4);
      Math.random = () => 0.1; // triggers creative exploration (< 0.3)
      try {
        const result = await agent.execute(ctx);

        const detail = result.executionDetail as EvolutionExecutionDetail;
        expect(detail.creativeExploration).toBe(true);
        expect(detail.creativeReason).toBe('random');
        // Should have 3 strategies + 1 creative = 4 mutations
        expect(detail.mutations.length).toBe(4);
        const creative = detail.mutations.find(m => m.strategy === 'creative_exploration');
        expect(creative).toBeDefined();
        expect(creative!.status).toBe('success');
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  it('estimateCost returns zero (cost estimated centrally)', () => {
    const cost = agent.estimateCost({
      originalText: 'x'.repeat(4000),
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBe(0);
  });

  it('includes all 4 meta-feedback types in prompts', async () => {
    const ctx = makeCtx([VALID_TEXT], 4);
    (ctx.state as PipelineStateImpl).metaFeedback = {
      priorityImprovements: ['add transitions'],
      recurringWeaknesses: ['lacks examples'],
      successfulStrategies: ['clear headings'],
      patternsToAvoid: ['run-on sentences'],
    };
    Math.random = () => 0.9; // suppress creative exploration
    const savedRandom = Math.random;
    try {
      Math.random = () => 0.9;
      await agent.execute(ctx);

      const calls = (ctx.llmClient.complete as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);
      for (const [prompt] of calls) {
        expect(prompt).toContain('add transitions');
        expect(prompt).toContain('lacks examples');
        expect(prompt).toContain('clear headings');
        expect(prompt).toContain('run-on sentences');
      }
    } finally {
      Math.random = savedRandom;
    }
  });

  it('returns failure when no parents available', async () => {
    const emptyState = new PipelineStateImpl('text');
    emptyState.ratings.set('phantom', { mu: 25, sigma: 8.333 });
    const ctx: ExecutionContext = {
      payload: {
        originalText: 'text',
        title: 'Test',
        explanationId: 1,
        runId: 'test',
        config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
      },
      state: emptyState,
      llmClient: makeMockLLMClient([]),
      logger: makeMockLogger(),
      costTracker: makeMockCostTracker(),
      runId: 'test',
    };
    const result = await agent.execute(ctx);
    expect(result.success).toBe(false);
  });
});

// Save original to restore
const originalRandom = Math.random;
afterEach(() => {
  Math.random = originalRandom;
});

// ─── Outline mutation tests ─────────────────────────────────────

describe('EvolutionAgent outline mutation', () => {
  const agent = new EvolutionAgent();

  function makeOutlineVariant(id: string): OutlineVariant {
    const steps: GenerationStep[] = [
      { name: 'outline', input: 'original', output: '## Intro\nSummary of intro.', score: 0.85, costUsd: 0.001 },
      { name: 'expand', input: '## Intro\nSummary', output: VALID_TEXT, score: 0.7, costUsd: 0.002 },
      { name: 'polish', input: VALID_TEXT, output: VALID_TEXT, score: 0.9, costUsd: 0.001 },
    ];
    return {
      id,
      text: VALID_TEXT,
      version: 1,
      parentIds: [],
      strategy: 'outline_generation',
      createdAt: Date.now() / 1000,
      iterationBorn: 0,
      steps,
      outline: '## Intro\nSummary of intro.',
      weakestStep: 'expand',
    };
  }

  it('produces mutate_outline variant when parent is OutlineVariant', async () => {
    const state = new PipelineStateImpl('# Original\n\n## Sec\n\nOriginal text. More text here.');
    const ov = makeOutlineVariant('ov-1');
    state.addToPool(ov);
    state.addToPool({
      id: 'pv-1', text: VALID_TEXT, version: 1, parentIds: [],
      strategy: 'structural_transform', createdAt: Date.now() / 1000, iterationBorn: 0,
    });
    state.ratings.set('ov-1', { mu: 30, sigma: 4 });
    state.ratings.set('pv-1', { mu: 28, sigma: 4 });
    state.matchCounts.set('ov-1', 3);
    state.matchCounts.set('pv-1', 3);

    // Suppress creative exploration
    Math.random = () => 0.9;
    try {
      const ctx: ExecutionContext = {
        payload: {
          originalText: state.originalText,
          title: 'Test',
          explanationId: 1,
          runId: 'test-run',
          config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
        },
        state,
        llmClient: makeMockLLMClient([VALID_TEXT]),
        logger: makeMockLogger(),
        costTracker: makeMockCostTracker(),
        runId: 'test-run',
      };

      const result = await agent.execute(ctx);
      expect(result.success).toBe(true);

      const newState = applyActions(state, result.actions ?? []);
      const outlineVariants = newState.pool.filter(v => v.strategy === 'mutate_outline');
      expect(outlineVariants.length).toBe(1);
      expect(isOutlineVariant(outlineVariants[0])).toBe(true);
      if (isOutlineVariant(outlineVariants[0])) {
        expect(outlineVariants[0].parentIds).toContain('ov-1');
        expect(outlineVariants[0].steps).toHaveLength(2);
        expect(outlineVariants[0].steps[0].name).toBe('outline');
        expect(outlineVariants[0].steps[1].name).toBe('expand');
      }
    } finally {
      Math.random = originalRandom;
    }
  });

  it('does not produce mutate_outline when no OutlineVariant parents', async () => {
    const ctx = makeCtx([VALID_TEXT], 4);
    Math.random = () => 0.9;
    try {
      await agent.execute(ctx);

      const outlineVariants = ctx.state.pool.filter(v => v.strategy === 'mutate_outline');
      expect(outlineVariants.length).toBe(0);
    } finally {
      Math.random = originalRandom;
    }
  });
});
