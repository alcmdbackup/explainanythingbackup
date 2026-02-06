// Unit tests for CalibrationRanker: model passthrough, bias mitigation, and rating updates.
// Verifies judgeModel is forwarded to LLM client and calibration produces correct results.

import { CalibrationRanker } from './calibrationRanker';
import { PipelineStateImpl } from '../core/state';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';
import { createRating, type Rating } from '../core/rating';

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
  };
}

function makeCtx(
  responses: string[],
  configOverrides: Partial<EvolutionRunConfig> = {},
): ExecutionContext {
  const config = resolveConfig(configOverrides);
  const state = new PipelineStateImpl('# Test\n\n## Section\n\nOriginal text content here.');

  // Add enough variants so calibration has opponents
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

  // Start a new iteration so newEntrantsThisIteration is empty
  state.startNewIteration();

  // Add a new entrant
  state.addToPool({
    id: 'new-1',
    text: '# New Variant\n\n## Section\n\nNew entrant text.',
    version: 2,
    parentIds: [],
    strategy: 'lexical_simplify',
    createdAt: Date.now(),
    iterationBorn: 1,
  });

  return {
    payload: {
      originalText: state.originalText,
      title: 'Test',
      explanationId: 1,
      runId: 'test-run',
      config,
    },
    state,
    llmClient: makeMockLLMClient(responses),
    logger: makeMockLogger(),
    costTracker: makeMockCostTracker(),
    runId: 'test-run',
  };
}

describe('CalibrationRanker', () => {
  const ranker = new CalibrationRanker();

  it('has correct name', () => {
    expect(ranker.name).toBe('calibration');
  });

  it('passes judgeModel to LLM client', async () => {
    // Both rounds say A → full agreement
    const ctx = makeCtx(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'], {
      judgeModel: 'gpt-4.1-nano',
    });
    await ranker.execute(ctx);

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn).toHaveBeenCalled();
    // Every call should have model option
    for (const call of completeFn.mock.calls) {
      expect(call[2]).toEqual({ model: 'gpt-4.1-nano' });
    }
  });

  it('uses default judgeModel from config when not overridden', async () => {
    const ctx = makeCtx(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B']);
    await ranker.execute(ctx);

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn).toHaveBeenCalled();
    for (const call of completeFn.mock.calls) {
      expect(call[2]).toEqual({ model: 'gpt-4.1-nano' });
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

  it('estimateCost returns positive', () => {
    const cost = ranker.estimateCost({
      originalText: 'x'.repeat(4000),
      title: 'Test',
      explanationId: 1,
      runId: 'test',
      config: DEFAULT_EVOLUTION_CONFIG as EvolutionRunConfig,
    });
    expect(cost).toBeGreaterThan(0);
  });

  describe('adaptive early exit', () => {
    it('exits early after minOpponents decisive matches in first batch', async () => {
      // With standalone compareWithBiasMitigation (sequential fwd+rev) + Promise.allSettled,
      // calls interleave: comp1-fwd, comp2-fwd, comp1-rev, comp2-rev
      // For both to agree (conf 1.0): fwd='A' for both, rev='B'(norm→A) for both
      const responses = ['A', 'A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B', 'B'];
      const ctx = makeCtx(responses, { calibration: { opponents: 5, minOpponents: 2 } });
      const completeFn = ctx.llmClient.complete as jest.Mock;

      await ranker.execute(ctx);

      // First batch: 2 opponents × 2 calls each = 4 LLM calls
      // Both decisive → early exit, no second batch
      expect(completeFn.mock.calls.length).toBe(4);
    });

    it('runs remaining batch when first batch is not all decisive', async () => {
      // First batch interleaved: comp1-fwd='A', comp2-fwd='A', comp1-rev='A', comp2-rev='A'
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
});
