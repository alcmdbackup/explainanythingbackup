// Tests for EvaluateCriteriaThenGenerateFromPreviousArticleAgent: combined prompt
// builder, two-pass parser (filter to wrapper-determined weakest set), execute() flow
// happy path + error preserving partial detail before re-throw.

import {
  EvaluateCriteriaThenGenerateFromPreviousArticleAgent,
  buildEvaluateAndSuggestPrompt,
  parseEvaluateAndSuggest,
  EvaluateAndSuggestLLMError,
  EvaluateAndSuggestParseError,
  type CriterionRow,
  type EvaluateCriteriaInput,
} from './evaluateCriteriaThenGenerateFromPreviousArticle';
import type { AgentContext } from '../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';

jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-eval'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

// Permissive format validator so the inner GFPA's generation phase passes.
jest.mock('../../shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  FORMAT_RULES: 'mock-format-rules',
}));

// Stub comparison helper so binary-search ranking phase doesn't need a real LLM judge.
jest.mock('../../shared/computeRatings', () => {
  const actual = jest.requireActual('../../shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({ winner: 'A' as const, confidence: 1.0, turns: 2 })),
  };
});

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const INV_ID = '00000000-0000-4000-8000-000000000002';
const PARENT_ID = '00000000-0000-4000-8000-000000000003';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

function mkCriterion(id: string, name: string, withRubric = false): CriterionRow {
  return {
    id,
    name,
    description: `${name} measures something`,
    min_rating: 1,
    max_rating: 5,
    evaluation_guidance: withRubric ? [
      { score: 1, description: 'poor' },
      { score: 3, description: 'fair' },
      { score: 5, description: 'excellent' },
    ] : null,
  };
}

const SAMPLE_CRITERIA: CriterionRow[] = [
  mkCriterion(C1, 'clarity', true),
  mkCriterion(C2, 'engagement'),
  mkCriterion(C3, 'depth', true),
];

function makeMockLlm(responseFn: () => string | Promise<string>): EvolutionLLMClient {
  return {
    complete: jest.fn(async (_prompt: string, agentName: string) => {
      if (agentName === 'generation') return '# T\n## S\nGenerated body. Two sentences.';
      if (agentName === 'evaluate_and_suggest') return responseFn();
      return 'A'; // ranking
    }),
    completeStructured: jest.fn(async () => { throw new Error('not used'); }),
  } as unknown as EvolutionLLMClient;
}

function makeCtx(): AgentContext {
  return {
    db: {} as never,
    runId: RUN_ID,
    iteration: 1,
    executionOrder: 1,
    invocationId: INV_ID,
    randomSeed: BigInt(42),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(() => 0.001),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn(() => 0),
      getOwnSpent: jest.fn(() => 0.0005),
      getPhaseCosts: jest.fn(() => ({})),
      getAvailableBudget: jest.fn(() => 10),
    } as unknown as AgentContext['costTracker'],
    config: {
      iterationConfigs: [{ agentType: 'criteria_and_generate', budgetPercent: 100 }],
      budgetUsd: 10,
      judgeModel: 'gpt-4.1-nano',
      generationModel: 'gpt-4.1-nano',
      maxComparisonsPerVariant: 5,
    } as never,
  };
}

function baseInput(llm: EvolutionLLMClient, criteria = SAMPLE_CRITERIA, weakestK = 1): EvaluateCriteriaInput {
  return {
    parentText: '# Sample Article\n\nThe quick brown fox jumps.',
    parentVariantId: PARENT_ID,
    criteria,
    criteriaIds: criteria.map(c => c.id),
    weakestK,
    llm,
    initialPool: [{ id: PARENT_ID, text: 'parent', version: 0, parentIds: [], tactic: 'baseline', createdAt: 0, iterationBorn: 0 }] as ReadonlyArray<Variant>,
    initialRatings: new Map<string, Rating>([[PARENT_ID, createRating()]]),
    initialMatchCounts: new Map<string, number>(),
    cache: new Map(),
  };
}

const SAMPLE_RESPONSE_3SCORES_2SUGG = `clarity: 1
engagement: 5
depth: 2

### Suggestion 1
Criterion: clarity
Example: The quick brown fox jumps.
Issue: This sentence has no context.
Fix: Add a transition explaining why the fox matters.

### Suggestion 2
Criterion: depth
Example: The quick brown fox jumps.
Issue: Lacks technical detail.
Fix: Expand on the locomotion mechanics.`;

describe('buildEvaluateAndSuggestPrompt', () => {
  it('includes parent text, all criteria, and the effectiveWeakestK', () => {
    const prompt = buildEvaluateAndSuggestPrompt('PARENT_ARTICLE', SAMPLE_CRITERIA, 2);
    expect(prompt).toContain('PARENT_ARTICLE');
    expect(prompt).toContain('clarity');
    expect(prompt).toContain('engagement');
    expect(prompt).toContain('depth');
    expect(prompt).toMatch(/2 lowest-scoring/);
  });

  it('includes Rubric: blocks for criteria that have rubric, omits for those that don\'t', () => {
    const prompt = buildEvaluateAndSuggestPrompt('text', SAMPLE_CRITERIA, 1);
    // clarity has a rubric (defined above)
    expect(prompt).toContain('Rubric:');
    // Count Rubric: occurrences — should equal number of criteria with rubrics (clarity, depth = 2)
    const matches = prompt.match(/Rubric:/g);
    expect(matches?.length).toBe(2);
  });

  it('sorts rubric anchors by score asc', () => {
    const c: CriterionRow = {
      id: C1, name: 'x', description: 'd', min_rating: 1, max_rating: 5,
      evaluation_guidance: [
        { score: 5, description: 'top' },
        { score: 1, description: 'bottom' },
        { score: 3, description: 'middle' },
      ],
    };
    const prompt = buildEvaluateAndSuggestPrompt('text', [c], 1);
    const idxBottom = prompt.indexOf('bottom');
    const idxMiddle = prompt.indexOf('middle');
    const idxTop = prompt.indexOf('top');
    expect(idxBottom).toBeLessThan(idxMiddle);
    expect(idxMiddle).toBeLessThan(idxTop);
  });

  it('emits no Rubric: line when criterion has empty rubric array', () => {
    const c: CriterionRow = {
      id: C1, name: 'no_rubric', description: 'd', min_rating: 1, max_rating: 5, evaluation_guidance: [],
    };
    const prompt = buildEvaluateAndSuggestPrompt('text', [c], 1);
    expect(prompt).not.toContain('Rubric:');
  });
});

describe('parseEvaluateAndSuggest', () => {
  it('happy path: scores + 2 valid suggestions filtered to weakest set', () => {
    // Wrapper picks clarity + depth as weakest by score asc.
    const result = parseEvaluateAndSuggest(SAMPLE_RESPONSE_3SCORES_2SUGG, SAMPLE_CRITERIA, [C1, C3]);
    expect(result.criteriaScored).toHaveLength(3);
    expect(result.suggestions).toHaveLength(2);
    expect(result.droppedSuggestions).toHaveLength(0);
  });

  it('LLM-vs-wrapper disagreement: drops suggestions for non-weakest criteria', () => {
    // Wrapper says only depth is weakest, but LLM wrote suggestions for clarity + depth.
    const result = parseEvaluateAndSuggest(SAMPLE_RESPONSE_3SCORES_2SUGG, SAMPLE_CRITERIA, [C3]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.criteriaName).toBe('depth');
    expect(result.droppedSuggestions).toHaveLength(1);
    expect(result.droppedSuggestions[0]?.criteriaName).toBe('clarity');
  });

  it('throws when zero score lines extracted', () => {
    expect(() => parseEvaluateAndSuggest('this is garbage', SAMPLE_CRITERIA, [C1]))
      .toThrow(EvaluateAndSuggestParseError);
  });

  it('throws when zero suggestions remain after filtering', () => {
    // Wrapper picks engagement, LLM wrote suggestions for clarity + depth → all dropped.
    expect(() => parseEvaluateAndSuggest(SAMPLE_RESPONSE_3SCORES_2SUGG, SAMPLE_CRITERIA, [C2]))
      .toThrow(EvaluateAndSuggestParseError);
  });

  it('drops unknown criterion names from scores', () => {
    const response = `clarity: 3
unknown_criterion: 4
engagement: 2

### Suggestion 1
Criterion: clarity
Example: foo
Issue: bar
Fix: baz`;
    const result = parseEvaluateAndSuggest(response, SAMPLE_CRITERIA, [C1]);
    // unknown_criterion silently dropped → 2 valid scores
    expect(result.criteriaScored).toHaveLength(2);
  });

  it('drops scores out of range', () => {
    const response = `clarity: 99
engagement: 3
depth: -5

### Suggestion 1
Criterion: engagement
Example: foo
Issue: bar
Fix: baz`;
    const result = parseEvaluateAndSuggest(response, SAMPLE_CRITERIA, [C2]);
    expect(result.criteriaScored).toHaveLength(1);
    expect(result.criteriaScored[0]?.criteriaName).toBe('engagement');
  });

  it('preserves rawResponse on parse failure', () => {
    try {
      parseEvaluateAndSuggest('garbage', SAMPLE_CRITERIA, [C1]);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EvaluateAndSuggestParseError);
      expect((err as EvaluateAndSuggestParseError).rawResponse).toContain('garbage');
    }
  });

  it('drop unknown suggestion criterion goes to droppedSuggestions', () => {
    const response = `clarity: 1
engagement: 5

### Suggestion 1
Criterion: bogus_name
Example: foo
Issue: bar
Fix: baz

### Suggestion 2
Criterion: clarity
Example: x
Issue: y
Fix: z`;
    const result = parseEvaluateAndSuggest(response, SAMPLE_CRITERIA, [C1]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.criteriaName).toBe('clarity');
    expect(result.droppedSuggestions).toHaveLength(1);
    expect(result.droppedSuggestions[0]?.reason).toContain('unknown');
  });
});

describe('EvaluateCriteriaThenGenerateFromPreviousArticleAgent', () => {
  const agent = new EvaluateCriteriaThenGenerateFromPreviousArticleAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('evaluate_criteria_then_generate_from_previous_article');
  });

  it('getAttributionDimension returns first weakestCriteriaName', () => {
    expect(agent.getAttributionDimension({ weakestCriteriaNames: ['clarity', 'depth'] } as never))
      .toBe('clarity');
  });

  it('getAttributionDimension returns null when array empty', () => {
    expect(agent.getAttributionDimension({ weakestCriteriaNames: [] } as never)).toBeNull();
  });

  it('getAttributionDimension returns null when name contains colon (anti-injection)', () => {
    expect(agent.getAttributionDimension({ weakestCriteriaNames: ['bad:name'] } as never)).toBeNull();
  });

  it('throws when criteria array is empty', async () => {
    const llm = makeMockLlm(() => 'unused');
    const input = baseInput(llm, [], 1);
    await expect(agent.execute(input, makeCtx())).rejects.toThrow(/No active criteria/);
  });

  it('clamps weakestK > criteria.length and warn-logs', async () => {
    // Wrapper warns rather than rejecting — covers the runtime-archive scenario.
    // Single criterion + weakestK=3 should clamp to 1.
    const onlyOne = [SAMPLE_CRITERIA[0]!];
    const llm = makeMockLlm(() => `clarity: 2

### Suggestion 1
Criterion: clarity
Example: foo
Issue: bar
Fix: baz`);
    const ctx = makeCtx();
    const input = baseInput(llm, onlyOne, 3);
    await agent.execute(input, ctx);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('clamping'),
      expect.objectContaining({ requested: 3, fetched: 1, effective: 1 }),
    );
  });

  it('LLM throw preserves partial detail and re-throws as EvaluateAndSuggestLLMError', async () => {
    const llm = makeMockLlm(() => { throw new Error('LLM down'); });
    const input = baseInput(llm);
    await expect(agent.execute(input, makeCtx())).rejects.toThrow(EvaluateAndSuggestLLMError);
  });

  it('zero-valid-scores parser failure re-throws as EvaluateAndSuggestParseError', async () => {
    const llm = makeMockLlm(() => 'this is not a valid response at all');
    const input = baseInput(llm);
    await expect(agent.execute(input, makeCtx())).rejects.toThrow(EvaluateAndSuggestParseError);
  });

  it('happy path: produces a variant via inner GFPA', async () => {
    // 3 criteria, weakestK=1, LLM returns 3 scores + 1 suggestion. Inner GFPA generates variant.
    const llm = makeMockLlm(() => `clarity: 2
engagement: 5
depth: 4

### Suggestion 1
Criterion: clarity
Example: The quick brown fox.
Issue: too terse.
Fix: add context.`);
    const result = await agent.execute(baseInput(llm), makeCtx());
    expect(result.result.variant).not.toBeNull();
    expect(result.result.variant?.tactic).toBe('criteria_driven');
    expect(result.result.variant?.criteriaSetUsed).toEqual([C1, C2, C3]);
    // Wrapper picks clarity (lowest normalized) as weakest.
    expect(result.result.variant?.weakestCriteriaIds).toEqual([C1]);
    expect(result.detail.tactic).toBe('criteria_driven');
    expect(result.detail.weakestCriteriaIds).toEqual([C1]);
    expect(result.detail.weakestCriteriaNames).toEqual(['clarity']);
  });

  it('totalCost = combined LLM cost + inner GFPA totalCost (single AgentCostScope)', async () => {
    const llm = makeMockLlm(() => `clarity: 1
engagement: 5
depth: 5

### Suggestion 1
Criterion: clarity
Example: x
Issue: y
Fix: z`);
    let spent = 0;
    const ctx = makeCtx();
    (ctx.costTracker.getOwnSpent as jest.Mock).mockImplementation(() => spent);
    (ctx.costTracker.recordSpend as jest.Mock).mockImplementation((_p: string, c: number) => { spent += c; });
    // Simulate combined call costing 0.001 then GFPA generation costing 0.01.
    let llmCallCount = 0;
    (llm.complete as jest.Mock).mockImplementation(async (_prompt: string, agentName: string) => {
      llmCallCount++;
      if (agentName === 'evaluate_and_suggest') {
        spent += 0.001;
        return `clarity: 1
engagement: 5
depth: 5

### Suggestion 1
Criterion: clarity
Example: x
Issue: y
Fix: z`;
      }
      if (agentName === 'generation') {
        spent += 0.01;
        return '# T\n## S\nGenerated body. Two sentences.';
      }
      return 'A';
    });
    const result = await agent.execute(baseInput(llm), ctx);
    expect(result.detail.totalCost).toBeGreaterThan(0.001);
    // sanity: at least the combined call happened
    expect(llmCallCount).toBeGreaterThanOrEqual(2);
  });
});
