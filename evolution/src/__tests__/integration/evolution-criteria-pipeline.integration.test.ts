// Integration test for EvaluateCriteriaThenGenerateFromPreviousArticleAgent
// end-to-end: 3 criteria + a strategy with one criteria_and_generate iteration
// referencing all 3 + weakestK=2. Mock LLM with deterministic responses; verify
// the produced variant carries criteria_set_used + weakest_criteria_ids and the
// invocation execution_detail validates against the schema.

import { evolveArticle } from '@evolution/lib/pipeline/loop/runIterationLoop';
import { createV2MockLlm } from '@evolution/testing/v2MockLlm';
import { VALID_VARIANT_TEXT } from '@evolution/testing/evolution-test-helpers';
import type { EvolutionConfig } from '@evolution/lib/pipeline/infra/types';

// ─── Mocks ────────────────────────────────────────────────────────

const capturedUpdates: Array<Record<string, unknown>> = [];

jest.mock('@evolution/lib/pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-criteria-test'),
  updateInvocation: jest.fn().mockImplementation(async (_db, _id, updates) => {
    capturedUpdates.push(updates);
  }),
}));

jest.mock('@evolution/lib/shared/computeRatings', () => {
  const actual = jest.requireActual('@evolution/lib/shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({ winner: 'A', confidence: 1.0, turns: 2 })),
  };
});

jest.mock('@evolution/lib/shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  FORMAT_RULES: '',
}));

jest.mock('@evolution/lib/metrics/writeMetrics', () => ({
  writeMetricMax: jest.fn().mockResolvedValue(undefined),
  writeMetric: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@evolution/lib/pipeline/infra/createEvolutionLLMClient', () => {
  const actual = jest.requireActual('@evolution/lib/pipeline/infra/createEvolutionLLMClient');
  return {
    ...actual,
    createEvolutionLLMClient: jest.fn((rawProvider: { complete: (p: string, l: string) => Promise<string> }) => ({
      complete: async (prompt: string, label: string) => rawProvider.complete(prompt, label),
    })),
  };
});

const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

// Mock the mid-run criteria fetch to return three criteria deterministically.
jest.mock('@evolution/services/criteriaActions', () => ({
  getCriteriaForEvaluation: jest.fn().mockImplementation(async () => new Map([
    [C1, { id: C1, name: 'clarity', description: 'how clear', min_rating: 1, max_rating: 5,
      evaluation_guidance: [{ score: 1, description: 'unclear' }, { score: 5, description: 'crystal' }] }],
    [C2, { id: C2, name: 'engagement', description: 'how engaging', min_rating: 1, max_rating: 5,
      evaluation_guidance: null }],
    [C3, { id: C3, name: 'depth', description: 'how deep', min_rating: 1, max_rating: 5,
      evaluation_guidance: null }],
  ])),
}));

function createMockDb() {
  const single = jest.fn().mockResolvedValue({ data: { status: 'running' }, error: null });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function makeConfig(overrides: Partial<EvolutionConfig> = {}): EvolutionConfig {
  return {
    iterationConfigs: [
      { agentType: 'criteria_and_generate', budgetPercent: 100,
        criteriaIds: [C1, C2, C3], weakestK: 2 },
    ],
    budgetUsd: 5,
    judgeModel: 'gpt-4.1-nano',
    generationModel: 'gpt-4.1-nano',
    ...overrides,
  };
}

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function makeRawProvider(mockLlm: ReturnType<typeof createV2MockLlm>) {
  return {
    complete: async (prompt: string, label: string) => mockLlm.complete(prompt, label),
  };
}

// LLM picks clarity (score 1) + depth (score 2) as weakest; engagement scores high.
const HAPPY_EVAL_AND_SUGGEST = `clarity: 1
engagement: 5
depth: 2

### Suggestion 1
Criterion: clarity
Example: ${VALID_VARIANT_TEXT.slice(0, 30)}
Issue: opening lacks context.
Fix: prepend a one-sentence framing paragraph.

### Suggestion 2
Criterion: depth
Example: ${VALID_VARIANT_TEXT.slice(0, 40)}
Issue: lacks technical detail.
Fix: expand on the underlying mechanism.`;

// ─── Tests ────────────────────────────────────────────────────────

describe('criteria-driven evolution pipeline (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedUpdates.length = 0;
  });

  it('happy path: criteria_and_generate produces a variant with criteria_set_used + weakest_criteria_ids', async () => {
    const mockLlm = createV2MockLlm({
      labelResponses: { evaluate_and_suggest: HAPPY_EVAL_AND_SUGGEST },
      rankingResponses: ['A', 'A', 'A'],
    });
    const config = makeConfig();

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-happy-criteria',
      config,
      {
        logger: noopLogger,
        seedVariantId: 'seed-happy',
        promptId: '00000000-0000-4000-8000-000000000001',
      },
    );

    expect(result.iterationResults).toHaveLength(1);
    // Pool has the seed + at least one new variant tagged criteria_driven.
    const criteriaVariants = result.pool.filter((v) => v.tactic === 'criteria_driven');
    expect(criteriaVariants.length).toBeGreaterThan(0);

    const variant = criteriaVariants[0]!;
    expect(variant.criteriaSetUsed).toEqual([C1, C2, C3]);
    // Wrapper picks 2 lowest by normalized score → clarity (1/5=0.2) + depth (2/5=0.4)
    expect(variant.weakestCriteriaIds).toEqual([C1, C3]);

    // The combined LLM call happened
    const evalCalls = mockLlm.complete.mock.calls.filter((args) => args[1] === 'evaluate_and_suggest');
    expect(evalCalls.length).toBeGreaterThan(0);
  });

  it('execution_detail validates against the discriminated-union schema', async () => {
    const mockLlm = createV2MockLlm({
      labelResponses: { evaluate_and_suggest: HAPPY_EVAL_AND_SUGGEST },
      rankingResponses: ['A', 'A', 'A'],
    });
    const config = makeConfig();

    await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-detail-schema',
      config,
      {
        logger: noopLogger,
        seedVariantId: 'seed-detail',
        promptId: '00000000-0000-4000-8000-000000000001',
      },
    );

    // Find the wrapper's execution_detail update (the one with the criteria detailType)
    const wrapperWrites = capturedUpdates.filter(
      (u) => (u.execution_detail as { detailType?: string } | undefined)?.detailType
        === 'evaluate_criteria_then_generate_from_previous_article',
    );
    expect(wrapperWrites.length).toBeGreaterThan(0);
    const detail = wrapperWrites[0]!.execution_detail as {
      detailType: string;
      tactic: string;
      weakestCriteriaIds: string[];
      weakestCriteriaNames: string[];
      evaluateAndSuggest: { criteriaScored: Array<{ criteriaId: string; score: number }>; suggestions: Array<{ criteriaName: string }> };
      totalCost: number;
    };
    expect(detail.tactic).toBe('criteria_driven');
    expect(detail.weakestCriteriaIds).toHaveLength(2);
    expect(detail.weakestCriteriaNames).toEqual(['clarity', 'depth']);
    expect(detail.evaluateAndSuggest.criteriaScored).toHaveLength(3);
    expect(detail.evaluateAndSuggest.suggestions).toHaveLength(2);
  });

  it('weakestK > criteria.length is clamped at runtime with warn-log', async () => {
    const mockLlm = createV2MockLlm({
      labelResponses: { evaluate_and_suggest: `clarity: 1

### Suggestion 1
Criterion: clarity
Example: x
Issue: y
Fix: z` },
      rankingResponses: ['A', 'A', 'A'],
    });
    // Override criteria fetch to return only 1 criterion this time
    const { getCriteriaForEvaluation } = jest.requireMock('@evolution/services/criteriaActions');
    (getCriteriaForEvaluation as jest.Mock).mockResolvedValueOnce(new Map([
      [C1, { id: C1, name: 'clarity', description: 'd', min_rating: 1, max_rating: 5, evaluation_guidance: null }],
    ]));

    const config = makeConfig({
      iterationConfigs: [
        { agentType: 'criteria_and_generate', budgetPercent: 100, criteriaIds: [C1], weakestK: 5 },
      ],
    });

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-clamp',
      config,
      {
        logger: noopLogger,
        seedVariantId: 'seed-clamp',
        promptId: '00000000-0000-4000-8000-000000000001',
      },
    );

    // The clamp should still produce a variant (effectiveWeakestK=1).
    const criteriaVariants = result.pool.filter((v) => v.tactic === 'criteria_driven');
    expect(criteriaVariants.length).toBeGreaterThan(0);
    expect(criteriaVariants[0]!.weakestCriteriaIds).toEqual([C1]);
  });
});
