// Unit tests for CalibrationRanker: model passthrough, bias mitigation, and rating updates.
// Verifies judgeModel is forwarded to LLM client and calibration produces correct results.

import { CalibrationRanker } from './calibrationRanker';
import { PipelineStateImpl } from '../core/state';
import type { EvolutionLLMClient, EvolutionRunConfig, CalibrationExecutionDetail } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import { BudgetExceededError } from '../types';
import { resolveConfig } from '../config';
import { createRating, type Rating } from '../core/rating';
import { createMockExecutionContext } from '@evolution/testing/evolution-test-helpers';

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

function makeCtx(
  responses: string[],
  configOverrides: Partial<EvolutionRunConfig> = {},
) {
  const config = resolveConfig(configOverrides);
  const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

  for (let i = 0; i < 5; i++) {
    state.addToPool({
      id: `existing-${i}`,
      text: `# Variant ${i}\n\n## Section\n\nVariant ${i} text content.`,
      version: 1,
      parentIds: [],
      strategy: 'structural_transform',
      createdAt: Date.now(),
      iterationBorn: 0,
    });
    state.ratings.set(`existing-${i}`, { mu: 25 + i * (25 / 400) * 50, sigma: 4 });
    state.matchCounts.set(`existing-${i}`, 5);
  }

  state.startNewIteration();

  state.addToPool({
    id: 'new-1',
    text: '# New Variant\n\n## Section\n\nNew entrant text.',
    version: 2,
    parentIds: [],
    strategy: 'lexical_simplify',
    createdAt: Date.now(),
    iterationBorn: 1,
  });

  return createMockExecutionContext({
    state,
    llmClient: makeMockLLMClient(responses),
    payload: {
      originalText: state.originalText,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
      config,
    },
  });
}

describe('CalibrationRanker', () => {
  const ranker = new CalibrationRanker();

  it('has correct name', () => {
    expect(ranker.name).toBe('calibration');
  });

  it('passes judgeModel and taskType to LLM client', async () => {
    // Both rounds say A → full agreement
    const ctx = makeCtx(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'], {
      judgeModel: 'gpt-4.1-nano',
    });
    await ranker.execute(ctx);

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn).toHaveBeenCalled();
    for (const call of completeFn.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ model: 'gpt-4.1-nano', taskType: 'comparison' }));
    }
  });

  it('uses default judgeModel from config when not overridden, always includes taskType', async () => {
    const ctx = makeCtx(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    await ranker.execute(ctx);

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn).toHaveBeenCalled();
    for (const call of completeFn.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ model: 'gpt-4.1-nano', taskType: 'comparison' }));
    }
  });

  it('full agreement updates rating with confidence 1.0', async () => {
    // A, B pattern: round1=A, round2=B(normalized→A) = agreement on A
    const ctx = makeCtx(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    const result = await ranker.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.matchesPlayed).toBeGreaterThan(0);
    // New entrant should have a rating set
    expect(ctx.state.ratings.has('new-1')).toBe(true);
  });

  it('canExecute returns false with no new entrants', () => {
    const state = new PipelineStateImpl('text');
    state.addToPool({
      id: 'v1', text: 'A', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now(), iterationBorn: 0,
    });
    state.addToPool({
      id: 'v2', text: 'B', version: 1, parentIds: [],
      strategy: 'test', createdAt: Date.now(), iterationBorn: 0,
    });
    state.startNewIteration();
    // No new entrants added after startNewIteration
    expect(ranker.canExecute(state)).toBe(false);
  });

  it('estimateCost returns zero (cost estimated centrally)', () => {
    const cost = ranker.estimateCost({
      originalText: 'x'.repeat(4000),
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBe(0);
  });

  describe('adaptive early exit', () => {
    it('exits early after minOpponents decisive matches in first batch', async () => {
      // With Promise.all inside run2PassReversal, each comparison consumes fwd+rev
      // before the next: comp1-fwd, comp1-rev, comp2-fwd, comp2-rev
      // For both to agree (conf 1.0): each needs fwd='A', rev='B'(norm→A)
      const responses = ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'];
      const ctx = makeCtx(responses, { calibration: { opponents: 5, minOpponents: 2 } });
      const completeFn = ctx.llmClient.complete as jest.Mock;

      await ranker.execute(ctx);

      // First batch: 2 opponents × 2 calls each = 4 LLM calls
      // Both decisive → early exit, no second batch
      expect(completeFn.mock.calls.length).toBe(4);
    });

    it('runs remaining batch when first batch is not all decisive', async () => {
      // With Promise.all: comp1-fwd='A', comp1-rev='A', comp2-fwd='A', comp2-rev='A'
      // comp1: fwd='A', rev='A' normalized='B' → disagree → conf 0.5 (not decisive)
      // comp2: fwd='A', rev='A' normalized='B' → disagree → conf 0.5 (not decisive)
      // This triggers the remaining batch (more opponents)
      const responses = Array(20).fill('A'); // all 'A' → disagreement pattern
      const ctx = makeCtx(responses, { calibration: { opponents: 5, minOpponents: 2 } });
      const completeFn = ctx.llmClient.complete as jest.Mock;

      await ranker.execute(ctx);

      // First batch: 2×2=4 calls, remaining opponents also run → more than 4 total
      expect(completeFn.mock.calls.length).toBeGreaterThan(4);
    });

    it('respects default minOpponents=2 from config', () => {
      const config = resolveConfig({});
      expect(config.calibration.minOpponents).toBe(2);
    });
  });

  describe('BudgetExceededError propagation from allSettled', () => {
    it('re-throws BudgetExceededError from first allSettled batch', async () => {
      const mockClient = makeMockLLMClient(['A']);
      // First call succeeds (for the callLLM wrapper's try-catch), but then
      // budget error is thrown on the second call within the comparison
      (mockClient.complete as jest.Mock)
        .mockResolvedValueOnce('A')  // first comparison fwd pass
        .mockRejectedValueOnce(new BudgetExceededError('calibration', 5.0, 0, 5.0));
      const ctx = makeCtx(['A'], { calibration: { opponents: 3, minOpponents: 2 } });
      ctx.llmClient = mockClient;

      await expect(ranker.execute(ctx)).rejects.toThrow(BudgetExceededError);
    });

    it('re-throws BudgetExceededError from second allSettled batch', async () => {
      // First batch: all disagree (confidence 0.5) to force second batch
      // Then second batch throws BudgetExceededError
      const mockClient = makeMockLLMClient([]);
      const calls: string[] = [];
      let callIdx = 0;
      (mockClient.complete as jest.Mock).mockImplementation(() => {
        callIdx++;
        // First 4 calls (2 comparisons × 2 passes each, parallel via Promise.all) all return 'A' → disagreement → not decisive
        if (callIdx <= 4) return Promise.resolve('A');
        // 5th call (start of second batch): throw budget error
        return Promise.reject(new BudgetExceededError('calibration', 5.0, 0, 5.0));
      });
      const ctx = makeCtx([], { calibration: { opponents: 5, minOpponents: 2 } });
      ctx.llmClient = mockClient;

      await expect(ranker.execute(ctx)).rejects.toThrow(BudgetExceededError);
    });
  });

  describe('low-sigma skip (Arena-calibrated entries)', () => {
    it('skips calibration for entries with sigma < 5.0', async () => {
      // Create context with a new entrant that has a pre-seeded low sigma (from Arena)
      const config = resolveConfig({});
      const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

      // Add existing opponents
      for (let i = 0; i < 3; i++) {
        state.addToPool({
          id: `existing-${i}`,
          text: `# Variant ${i}\n\n## Section\n\nVariant ${i} text content.`,
          version: 1, parentIds: [], strategy: 'structural_transform',
          createdAt: Date.now(), iterationBorn: 0,
        });
        state.ratings.set(`existing-${i}`, { mu: 25 + i * 2, sigma: 4 });
        state.matchCounts.set(`existing-${i}`, 5);
      }

      state.startNewIteration();

      // Add new entrant with low sigma (pre-calibrated from Arena)
      state.addToPool({
        id: 'arena-low-sigma',
        text: '# Arena\n\n## Section\n\nArena variant with low sigma.',
        version: 1, parentIds: [], strategy: 'evolution',
        createdAt: Date.now(), iterationBorn: 1, fromArena: true,
      });
      state.ratings.set('arena-low-sigma', { mu: 30, sigma: 3.5 }); // sigma < 5.0

      const ctx = createMockExecutionContext({
        state,
        llmClient: makeMockLLMClient([]),
        payload: {
          originalText: state.originalText,
          title: 'Test', explanationId: 1, runId: 'test-run', config,
        },
      });

      const result = await ranker.execute(ctx);

      // No matches should be played since the only new entrant is low-sigma
      expect(result.matchesPlayed).toBe(0);
      expect(result.success).toBe(true);
      // LLM should not have been called at all
      expect((ctx.llmClient.complete as jest.Mock).mock.calls.length).toBe(0);
    });

    it('low-sigma entries still serve as opponents for other new entrants', async () => {
      const config = resolveConfig({});
      const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

      // Add low-sigma Arena entry as an existing pool member (added before iteration start)
      state.addToPool({
        id: 'arena-opponent',
        text: '# Arena Opp\n\n## Section\n\nArena variant serving as opponent.',
        version: 1, parentIds: [], strategy: 'evolution',
        createdAt: Date.now(), iterationBorn: 0, fromArena: true,
      });
      state.ratings.set('arena-opponent', { mu: 30, sigma: 3.0 }); // low sigma
      state.matchCounts.set('arena-opponent', 15);

      // Add a few more existing opponents
      for (let i = 0; i < 3; i++) {
        state.addToPool({
          id: `existing-${i}`,
          text: `# Variant ${i}\n\n## Section\n\nVariant ${i} text content.`,
          version: 1, parentIds: [], strategy: 'structural_transform',
          createdAt: Date.now(), iterationBorn: 0,
        });
        state.ratings.set(`existing-${i}`, { mu: 25 + i * 2, sigma: 4 });
        state.matchCounts.set(`existing-${i}`, 5);
      }

      state.startNewIteration();

      // Add a fresh new entrant with default high sigma (needs calibration)
      state.addToPool({
        id: 'new-fresh',
        text: '# Fresh\n\n## Section\n\nFresh new entrant needing calibration.',
        version: 2, parentIds: [], strategy: 'lexical_simplify',
        createdAt: Date.now(), iterationBorn: 1,
      });

      const ctx = createMockExecutionContext({
        state,
        llmClient: makeMockLLMClient(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']),
        payload: {
          originalText: state.originalText,
          title: 'Test', explanationId: 1, runId: 'test-run', config,
        },
      });

      const result = await ranker.execute(ctx);

      // The fresh entrant should have been calibrated (matches played > 0)
      expect(result.matchesPlayed).toBeGreaterThan(0);
      // The arena-opponent is available in the pool as a potential opponent
      expect(state.pool.some((v) => v.id === 'arena-opponent')).toBe(true);
    });
  });

  describe('executionDetail', () => {
    it('captures per-entrant detail with matches and ratings', async () => {
      const ctx = makeCtx(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
      const result = await ranker.execute(ctx);

      expect(result.executionDetail).toBeDefined();
      expect(result.executionDetail!.detailType).toBe('calibration');
      const detail = result.executionDetail as CalibrationExecutionDetail;
      expect(detail.entrants).toHaveLength(1); // one new entrant (new-1)
      expect(detail.entrants[0].variantId).toBe('new-1');
      expect(detail.entrants[0].opponents.length).toBeGreaterThan(0);
      expect(detail.entrants[0].matches.length).toBeGreaterThan(0);
      expect(detail.entrants[0].ratingBefore).toBeDefined();
      expect(detail.entrants[0].ratingAfter).toBeDefined();
      expect(detail.totalMatches).toBe(result.matchesPlayed);
      expect(detail.avgConfidence).toBeGreaterThanOrEqual(0);
    });

    it('marks earlyExit when first batch is decisive', async () => {
      // With Promise.all inside run2PassReversal, each comparison consumes fwd+rev
      // sequentially: fwd='A', rev='B'(norm→A) → agreement → confidence 1.0 → decisive
      const responses = ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'];
      const ctx = makeCtx(responses, { calibration: { opponents: 5, minOpponents: 2 } });
      const result = await ranker.execute(ctx);

      const detail = result.executionDetail as CalibrationExecutionDetail;
      expect(detail.entrants[0].earlyExit).toBe(true);
      // Should only have minOpponents matches
      expect(detail.entrants[0].matches.length).toBe(2);
    });
  });
});
