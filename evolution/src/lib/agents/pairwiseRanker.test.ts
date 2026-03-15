// Unit tests for PairwiseRanker: parsing, bias mitigation, model passthrough, caching, and disagreement resolution.

import { PairwiseRanker, parseWinner, parseStructuredResponse } from './pairwiseRanker';
import { PipelineStateImpl } from '../core/state';
import { applyActions } from '../core/reducer';
import { ComparisonCache } from '../core/comparisonCache';
import type { ExecutionContext, EvolutionLLMClient, EvolutionLogger, CostTracker, EvolutionRunConfig, Match } from '../types';
import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';

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

function makeCtx(responses: string[], overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  const state = new PipelineStateImpl('# Test Article\n\n## Section\n\nOriginal text here. With content.');
  state.addToPool({
    id: 'v1', text: '# A\n\n## S\n\nVariant A text. More content here.', version: 1,
    parentIds: [], strategy: 'structural_transform', createdAt: Date.now(), iterationBorn: 0,
  });
  state.addToPool({
    id: 'v2', text: '# B\n\n## S\n\nVariant B text. Different content.', version: 1,
    parentIds: [], strategy: 'lexical_simplify', createdAt: Date.now(), iterationBorn: 0,
  });
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
    ...overrides,
  };
}

describe('parseWinner', () => {
  it('parses clean A/B/TIE', () => {
    expect(parseWinner('A')).toBe('A');
    expect(parseWinner('B')).toBe('B');
    expect(parseWinner('TIE')).toBe('TIE');
  });

  it('parses with extra text', () => {
    expect(parseWinner('A is better')).toBe('A');
    expect(parseWinner('B wins')).toBe('B');
    expect(parseWinner("It's a TIE")).toBe('TIE');
  });

  it('parses TEXT A / TEXT B', () => {
    expect(parseWinner('Text A is the winner')).toBe('A');
    expect(parseWinner('I prefer Text B')).toBe('B');
  });

  it('returns null for unparseable', () => {
    expect(parseWinner('Neither is better')).toBeNull();
    expect(parseWinner('')).toBeNull();
  });
});

describe('parseStructuredResponse', () => {
  it('parses full structured response', () => {
    const response = `clarity: A
engagement: B
precision: A
voice_fidelity: TIE
conciseness: A
OVERALL_WINNER: A
CONFIDENCE: high`;
    const result = parseStructuredResponse(response);
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
    expect(result.dimensionScores.clarity).toBe('A');
    expect(result.dimensionScores.engagement).toBe('B');
    expect(result.dimensionScores.voice_fidelity).toBe('TIE');
  });

  it('derives winner from dimension majority when no explicit winner', () => {
    const response = `clarity: A
engagement: A
precision: B
voice_fidelity: A
conciseness: TIE`;
    const result = parseStructuredResponse(response);
    expect(result.winner).toBe('A');
  });

  it('handles low confidence', () => {
    const response = `clarity: A
OVERALL_WINNER: A
CONFIDENCE: low`;
    const result = parseStructuredResponse(response);
    expect(result.confidence).toBe(0.5);
  });
});

describe('PairwiseRanker', () => {
  const ranker = new PairwiseRanker();

  it('has correct name', () => {
    expect(ranker.name).toBe('pairwise');
  });

  it('full agreement (both say A) → confidence 1.0', async () => {
    const ctx = makeCtx(['A', 'B']); // B in reversed frame = A in original
    const match = await ranker.compareWithBiasMitigation(
      ctx, 'id1', 'text1', 'id2', 'text2',
    );
    expect(match.winner).toBe('id1');
    expect(match.confidence).toBe(1.0);
  });

  it('full agreement (both say B) → confidence 1.0', async () => {
    const ctx = makeCtx(['B', 'A']); // A in reversed frame = B in original
    const match = await ranker.compareWithBiasMitigation(
      ctx, 'id1', 'text1', 'id2', 'text2',
    );
    expect(match.winner).toBe('id2');
    expect(match.confidence).toBe(1.0);
  });

  it('one TIE + one winner → confidence 0.7', async () => {
    const ctx = makeCtx(['A', 'TIE']); // TIE in reversed stays TIE
    const match = await ranker.compareWithBiasMitigation(
      ctx, 'id1', 'text1', 'id2', 'text2',
    );
    expect(match.winner).toBe('id1');
    expect(match.confidence).toBe(0.7);
  });

  it('complete disagreement → confidence 0.5', async () => {
    const ctx = makeCtx(['A', 'A']); // A in reversed = B in original → disagree
    const match = await ranker.compareWithBiasMitigation(
      ctx, 'id1', 'text1', 'id2', 'text2',
    );
    expect(match.confidence).toBe(0.5);
  });

  it('partial failure (one null) → confidence 0.3', async () => {
    const client = makeMockLLMClient(['A']);
    let callCount = 0;
    (client.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 2) throw new Error('API error');
      return Promise.resolve('A');
    });
    const ctx = makeCtx([], { llmClient: client });
    const match = await ranker.compareWithBiasMitigation(
      ctx, 'id1', 'text1', 'id2', 'text2',
    );
    expect(match.confidence).toBe(0.3);
    expect(match.winner).toBe('id1');
  });

  it('execute runs all pairs and records matches', async () => {
    const ctx = makeCtx(['A', 'B']); // Both comparisons agree on A
    const result = await ranker.execute(ctx);
    const newState = applyActions(ctx.state as PipelineStateImpl, result.actions ?? []);
    expect(result.success).toBe(true);
    // 2 variants = 1 pair = 1 match
    expect(result.matchesPlayed).toBe(1);
    expect(newState.matchHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('canExecute requires 2+ pool entries', () => {
    const emptyState = new PipelineStateImpl('text');
    expect(ranker.canExecute(emptyState)).toBe(false);
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

  it('passes judgeModel and taskType to LLM client in comparePair', async () => {
    const config = resolveConfig({ judgeModel: 'gpt-4.1-nano' });
    const ctx = makeCtx(['A', 'B'], {
      payload: {
        originalText: '# Test\n\n## S\n\nOriginal text here. With content.',
        title: 'Test',
        explanationId: 1,
        runId: 'test-run',
        config,
      },
    });
    await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn).toHaveBeenCalled();
    for (const call of completeFn.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ model: 'gpt-4.1-nano', taskType: 'comparison' }));
    }
  });

  it('without agentNameOverride, uses this.name (pairwise)', async () => {
    const ctx = makeCtx(['A', 'B']);
    await ranker.comparePair(ctx, 'text1', 'text2');

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn.mock.calls[0][1]).toBe('pairwise');
  });

  it('with agentNameOverride, uses override name for LLM calls', async () => {
    const ctx = makeCtx(['A', 'B']);
    await ranker.comparePair(ctx, 'text1', 'text2', false, 'tournament');

    const completeFn = ctx.llmClient.complete as jest.Mock;
    expect(completeFn.mock.calls[0][1]).toBe('tournament');
  });

  it('compareWithBiasMitigation passes agentNameOverride to both comparePair calls', async () => {
    const ctx = makeCtx(['A', 'B']);
    await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2', false, 'tournament');

    const completeFn = ctx.llmClient.complete as jest.Mock;
    for (const call of completeFn.mock.calls) {
      expect(call[1]).toBe('tournament');
    }
  });

  it('second call with same texts returns cached result (zero LLM calls)', async () => {
    const cache = new ComparisonCache();
    const ctx = makeCtx(['A', 'B'], { comparisonCache: cache });
    const completeFn = ctx.llmClient.complete as jest.Mock;

    // First call: LLM is called
    await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');
    const callsAfterFirst = completeFn.mock.calls.length;
    expect(callsAfterFirst).toBe(2); // forward + reverse

    // Second call with same texts: should hit cache
    const match2 = await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');
    expect(completeFn.mock.calls.length).toBe(callsAfterFirst); // no new calls
    expect(match2.confidence).toBe(1.0);
  });

  it('runs both bias mitigation rounds concurrently (Promise.all)', async () => {
    // Verify concurrent execution: both comparePair calls should be initiated
    // before either resolves, proving Promise.all is used (not sequential awaits).
    let resolveFirst: (v: string) => void;
    let resolveSecond: (v: string) => void;
    let callCount = 0;

    const llmClient = makeMockLLMClient([]);
    (llmClient.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise<string>((r) => { resolveFirst = r; });
      }
      return new Promise<string>((r) => { resolveSecond = r; });
    });

    const ctx = makeCtx([], { llmClient });
    const matchPromise = ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    // Allow microtasks to flush so Promise.all can start both calls
    await new Promise((r) => setTimeout(r, 0));

    // Both calls should have been initiated before either resolves
    expect(callCount).toBe(2);

    // Resolve both
    resolveFirst!('A');
    resolveSecond!('B'); // B in reversed frame normalizes to A → agreement
    const match = await matchPromise;
    expect(match.confidence).toBe(1.0);
  });

  it('failed comparison (null winner) is NOT cached, subsequent call retries LLM', async () => {
    const cache = new ComparisonCache();
    let callCount = 0;
    const llmClient = makeMockLLMClient([]);
    (llmClient.complete as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) throw new Error('API error'); // both calls fail
      return Promise.resolve('A');
    });
    const ctx = makeCtx([], { llmClient, comparisonCache: cache });

    // First call: both LLM calls fail → partial failure, not cached
    const match1 = await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');
    expect(match1.confidence).toBe(0.0);
    expect(cache.size).toBe(0);

    // Second call: LLM now works, should make new calls
    const match2 = await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');
    expect(match2.confidence).toBeGreaterThan(0.0);
    expect(callCount).toBe(4); // 2 failed + 2 successful
  });
});

// ─── Flow Comparison Tests ───────────────────────────────────────────────────

const VALID_FLOW_RESPONSE = `local_cohesion: A
global_coherence: B
transition_quality: A
rhythm_variety: TIE
redundancy: A
FRICTION_A: ["This leads to better outcomes."]
FRICTION_B: ["Moving on to the next topic."]
OVERALL_WINNER: A
CONFIDENCE: high`;

describe('PairwiseRanker flow comparison', () => {
  const ranker = new PairwiseRanker();

  it('compareFlowWithBiasMitigation returns flow: prefixed dimension scores', async () => {
    // Both passes agree on A (r2 returns B which normalizes to A)
    const ctx = makeCtx([VALID_FLOW_RESPONSE, VALID_FLOW_RESPONSE.replace(/A/g, 'B').replace(/B\n/g, 'A\n')]);
    // Simplify: just use direct A responses for both passes
    (ctx.llmClient.complete as jest.Mock).mockResolvedValue(VALID_FLOW_RESPONSE);

    const match = await ranker.compareFlowWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    expect(match.dimensionScores['flow:local_cohesion']).toBeDefined();
    expect(match.dimensionScores['flow:global_coherence']).toBeDefined();
    expect(match.dimensionScores['flow:transition_quality']).toBeDefined();
    expect(match.dimensionScores['flow:rhythm_variety']).toBeDefined();
    expect(match.dimensionScores['flow:redundancy']).toBeDefined();
    // Should NOT have unprefixed keys
    expect(match.dimensionScores['local_cohesion']).toBeUndefined();
  });

  it('collects friction spots from both passes (union, deduped)', async () => {
    const response1 = `local_cohesion: A
FRICTION_A: ["Sentence one.", "Sentence two."]
FRICTION_B: ["Bad sentence B."]
OVERALL_WINNER: A
CONFIDENCE: high`;
    const response2 = `local_cohesion: B
FRICTION_A: ["Sentence two.", "Unique from pass 2."]
FRICTION_B: ["Another B friction."]
OVERALL_WINNER: B
CONFIDENCE: high`;

    let callIdx = 0;
    const ctx = makeCtx([]);
    (ctx.llmClient.complete as jest.Mock).mockImplementation(() => {
      callIdx++;
      return Promise.resolve(callIdx === 1 ? response1 : response2);
    });

    const match = await ranker.compareFlowWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    expect(match.frictionSpots).toBeDefined();
    // r1.frictionSpotsA + r2.frictionSpotsB (which is for text A in reversed frame)
    expect(match.frictionSpots!.a).toContain('Sentence one.');
    expect(match.frictionSpots!.a).toContain('Sentence two.');
    expect(match.frictionSpots!.a).toContain('Another B friction.');
    // r1.frictionSpotsB + r2.frictionSpotsA (which is for text B in reversed frame)
    expect(match.frictionSpots!.b).toContain('Bad sentence B.');
    expect(match.frictionSpots!.b).toContain('Unique from pass 2.');
  });

  it('without override, flow comparison uses this.name (pairwise) for cost tracking', async () => {
    const ctx = makeCtx([VALID_FLOW_RESPONSE, VALID_FLOW_RESPONSE]);

    await ranker.compareFlowWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    const completeMock = ctx.llmClient.complete as jest.Mock;
    for (const call of completeMock.mock.calls) {
      expect(call[1]).toBe('pairwise');
    }
  });

  it('with agentNameOverride, flow comparison uses override for cost tracking', async () => {
    const ctx = makeCtx([VALID_FLOW_RESPONSE, VALID_FLOW_RESPONSE]);

    await ranker.compareFlowWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2', 'tournament');

    const completeMock = ctx.llmClient.complete as jest.Mock;
    for (const call of completeMock.mock.calls) {
      expect(call[1]).toBe('tournament');
    }
  });

  it('flow cache key is separate from quality cache key', async () => {
    const cache = new ComparisonCache();
    const ctx = makeCtx([VALID_FLOW_RESPONSE, VALID_FLOW_RESPONSE], { comparisonCache: cache });

    // Quality comparison first
    const qualityResponses = ['A', 'B'];
    let qIdx = 0;
    (ctx.llmClient.complete as jest.Mock).mockImplementation(() => {
      return Promise.resolve(qualityResponses[qIdx++ % 2] ?? 'A');
    });
    await ranker.compareWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    // Flow comparison with same texts
    (ctx.llmClient.complete as jest.Mock).mockResolvedValue(VALID_FLOW_RESPONSE);
    const flowMatch = await ranker.compareFlowWithBiasMitigation(ctx, 'id1', 'text1', 'id2', 'text2');

    // Flow should NOT have hit quality cache (LLM was called)
    expect(flowMatch.dimensionScores['flow:local_cohesion']).toBeDefined();
    // Cache should have 2 entries (quality + flow)
    expect(cache.size).toBe(2);
  });

  it('old Match records without frictionSpots deserialize cleanly', () => {
    const oldMatch: Match = {
      variationA: 'a', variationB: 'b', winner: 'a',
      confidence: 1.0, turns: 2, dimensionScores: { clarity: 'A' },
    };
    // frictionSpots is optional — accessing it should return undefined
    expect(oldMatch.frictionSpots).toBeUndefined();
  });
});
