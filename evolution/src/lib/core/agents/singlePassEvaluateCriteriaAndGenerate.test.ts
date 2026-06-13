// Tests for buildSinglePassCustomPromptFromSuggestions (pure function) AND
// SinglePassEvaluateCriteriaAndGenerateAgent.execute() flow — verifying that
// the parent-Elo lookup correctly gates the surgical-edits directive at the
// integration boundary (LLM call) of the full execute path.

import {
  buildSinglePassCustomPromptFromSuggestions,
  SinglePassEvaluateCriteriaAndGenerateAgent,
  SINGLE_PASS_HIGH_ELO_THRESHOLD,
} from './singlePassEvaluateCriteriaAndGenerate';
import type { AgentContext } from '../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';
import type { CriterionRow, EvaluateCriteriaInput } from './evaluateCriteriaThenGenerateFromPreviousArticle';

// Mocks for the execute() integration tests — same set the cousin agent uses.
jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-sp'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  FORMAT_RULES: 'mock-format-rules',
}));
jest.mock('../../shared/computeRatings', () => {
  const actual = jest.requireActual('../../shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({ winner: 'A' as const, confidence: 1.0, turns: 2 })),
  };
});

const SUGGESTIONS = [
  {
    criteriaName: 'engagement',
    examplePassage: 'Some passage.',
    whatNeedsAddressing: 'Needs an analogy.',
    suggestedFix: 'Add a concrete real-world example.',
    score: 2,
    maxRating: 5,
  },
  {
    criteriaName: 'depth',
    examplePassage: 'A brief mention of monetary policy.',
    whatNeedsAddressing: 'Surface-level treatment.',
    suggestedFix: 'Expand with a mechanism walkthrough.',
    score: 3,
    maxRating: 5,
  },
];

describe('buildSinglePassCustomPromptFromSuggestions', () => {
  describe('without highEloParent flag (default behavior)', () => {
    it('emits the base prompt with all three guardrail directives', () => {
      const { preamble, instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      expect(preamble).toContain('expert article reviser');
      expect(instructions).toContain('**Length**');
      expect(instructions).toContain('**Redundancy**');
      expect(instructions).toContain('**Flow**');
      expect(instructions).toContain('Do not introduce meta-commentary');
    });

    it('enumerates each suggestion with criteria name + example + fix', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      expect(instructions).toContain('Issue 1 (engagement)');
      expect(instructions).toContain('Some passage.');
      expect(instructions).toContain('Add a concrete real-world example.');
      expect(instructions).toContain('Issue 2 (depth)');
      expect(instructions).toContain('Expand with a mechanism walkthrough.');
    });

    it('does NOT emit the surgical-edits / high-Elo block', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      expect(instructions).not.toContain('SURGICAL EDITS ONLY');
      expect(instructions).not.toContain('Preserve the title');
      expect(instructions).not.toContain('5-15 atomic edits');
    });

    it('treats highEloParent=false the same as the absent flag', () => {
      const { instructions: a } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      const { instructions: b } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: false });
      expect(a).toEqual(b);
    });
  });

  describe('with highEloParent=true (parent Elo > 1300)', () => {
    it('emits the surgical-edits block with all five directives', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      // Block header
      expect(instructions).toContain('SURGICAL EDITS ONLY');
      // Each of the 5 bullets, by its leading bold marker
      expect(instructions).toContain('Preserve the title (H1) exactly');
      expect(instructions).toContain('Preserve heading levels and section order');
      expect(instructions).toContain('Preserve bold/italic emphasis on key terms');
      expect(instructions).toContain('Prefer ADDITIVE edits');
      expect(instructions).toContain('Aim for 5-15 atomic edits');
    });

    it('inlines the threshold value in the block header', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      expect(instructions).toContain(`Elo > ${SINGLE_PASS_HIGH_ELO_THRESHOLD}`);
    });

    it('still emits the base prompt (Length/Redundancy/Flow + meta-commentary clause)', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      expect(instructions).toContain('**Length**');
      expect(instructions).toContain('**Redundancy**');
      expect(instructions).toContain('**Flow**');
      expect(instructions).toContain('Do not introduce meta-commentary');
    });

    it('places the surgical-edits block AFTER the base guardrails (so they take precedence visually)', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      const flowIdx = instructions.indexOf('**Flow**');
      const surgicalIdx = instructions.indexOf('SURGICAL EDITS ONLY');
      expect(flowIdx).toBeGreaterThan(-1);
      expect(surgicalIdx).toBeGreaterThan(flowIdx);
    });
  });

  it('exports a numeric threshold that the call-site can compare against', () => {
    expect(typeof SINGLE_PASS_HIGH_ELO_THRESHOLD).toBe('number');
    expect(SINGLE_PASS_HIGH_ELO_THRESHOLD).toBe(1300);
  });
});

// ─── Agent.execute() integration: parent-Elo lookup gates the directive ─────
//
// These tests run the agent's full execute() flow with a mocked LLM client and
// inspect the prompt sent to the inner generation phase. They verify that:
//   1. When parentVariantId resolves to Elo > 1300 in initialRatings, the
//      generation-phase prompt contains "SURGICAL EDITS ONLY".
//   2. When parent Elo is at/below threshold, it does not.
//   3. When parentVariantId is missing or has no rating, defaults to off.

const RUN_ID = '00000000-0000-4000-8000-000000000010';
const INV_ID = '00000000-0000-4000-8000-000000000011';
const PARENT_ID = '00000000-0000-4000-8000-000000000012';
const C1 = '00000000-0000-4000-8000-0000000000d1';

const ONE_CRITERION: CriterionRow[] = [
  { id: C1, name: 'engagement', description: 'engagement measures hooks',
    min_rating: 1, max_rating: 5, evaluation_guidance: null },
];

const EVAL_RESPONSE_ONE_SUGGESTION = `engagement: 2

### Suggestion 1
Criterion: engagement
Example: The opening sentence.
Issue: lacks a hook.
Fix: open with a concrete scenario.`;

interface MockLlm extends EvolutionLLMClient {
  complete: jest.Mock;
}

function makeMockLlm(): MockLlm {
  return {
    complete: jest.fn(async (_prompt: string, label: string) => {
      if (label === 'evaluate_and_suggest') return EVAL_RESPONSE_ONE_SUGGESTION;
      if (label === 'generation') return '# Title\n\n## Section\nFirst sentence. Second sentence.';
      return 'A';
    }),
    completeStructured: jest.fn(async () => { throw new Error('not used'); }),
  } as unknown as MockLlm;
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
      iterationConfigs: [{ agentType: 'single_pass_evaluate_criteria_and_generate', budgetPercent: 100 }],
      budgetUsd: 10,
      judgeModel: 'gpt-4.1-nano',
      generationModel: 'gpt-4.1-nano',
      maxComparisonsPerVariant: 5,
    } as never,
  };
}

function makeRating(elo: number): Rating {
  return { ...createRating(), elo };
}

function makeInput(llm: MockLlm, parentElo: number | undefined): EvaluateCriteriaInput {
  const ratings = new Map<string, Rating>();
  if (parentElo != null) ratings.set(PARENT_ID, makeRating(parentElo));
  return {
    parentText: '# Sample Article\n\nFirst sentence. Second sentence.',
    parentVariantId: PARENT_ID,
    criteria: ONE_CRITERION,
    criteriaIds: [C1],
    weakestK: 1,
    llm,
    initialPool: [{ id: PARENT_ID, text: 'parent', version: 0, parentIds: [], tactic: 'baseline', createdAt: 0, iterationBorn: 0 }] as ReadonlyArray<Variant>,
    initialRatings: ratings,
    initialMatchCounts: new Map<string, number>(),
    cache: new Map(),
  };
}

/** Pull the prompt arg of the LLM call made by the inner generation phase. */
function findGenerationPrompt(llm: MockLlm): string {
  const generationCall = llm.complete.mock.calls.find((args) => args[1] === 'generation');
  if (!generationCall) throw new Error('No generation-phase LLM call captured');
  return generationCall[0];
}

describe('SinglePassEvaluateCriteriaAndGenerateAgent.execute() — parent-Elo gating (integration)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('when parent Elo > 1300 the generation prompt contains the SURGICAL EDITS directive', async () => {
    const llm = makeMockLlm();
    const agent = new SinglePassEvaluateCriteriaAndGenerateAgent();
    await agent.execute(makeInput(llm, 1400), makeCtx());
    const genPrompt = findGenerationPrompt(llm);
    expect(genPrompt).toContain('SURGICAL EDITS ONLY');
    expect(genPrompt).toContain('Preserve the title');
    expect(genPrompt).toContain('5-15 atomic edits');
  });

  it('when parent Elo == 1300 (exactly at threshold, not strictly greater) the directive is OMITTED', async () => {
    const llm = makeMockLlm();
    const agent = new SinglePassEvaluateCriteriaAndGenerateAgent();
    await agent.execute(makeInput(llm, 1300), makeCtx());
    expect(findGenerationPrompt(llm)).not.toContain('SURGICAL EDITS ONLY');
  });

  it('when parent Elo = 1200 (typical mid-range) the directive is OMITTED', async () => {
    const llm = makeMockLlm();
    const agent = new SinglePassEvaluateCriteriaAndGenerateAgent();
    await agent.execute(makeInput(llm, 1200), makeCtx());
    expect(findGenerationPrompt(llm)).not.toContain('SURGICAL EDITS ONLY');
  });

  it('when parent has no rating in initialRatings the directive is OMITTED (safe fallback)', async () => {
    const llm = makeMockLlm();
    const agent = new SinglePassEvaluateCriteriaAndGenerateAgent();
    await agent.execute(makeInput(llm, undefined), makeCtx());
    expect(findGenerationPrompt(llm)).not.toContain('SURGICAL EDITS ONLY');
  });

  it('D1: forwards inner GFPA hard-fail (generation error) as output.failure', async () => {
    const llm = {
      complete: jest.fn(async (_p: string, label: string) => {
        if (label === 'evaluate_and_suggest') return EVAL_RESPONSE_ONE_SUGGESTION;
        if (label === 'generation') throw new Error('402 This request requires more credits, or fewer max_tokens.');
        return 'A';
      }),
      completeStructured: jest.fn(async () => { throw new Error('not used'); }),
    } as unknown as MockLlm;
    const agent = new SinglePassEvaluateCriteriaAndGenerateAgent();
    const result = await agent.execute(makeInput(llm, 1200), makeCtx());
    expect(result.failure).toBeDefined();
    expect(result.failure?.code).toBe('generation_failed');
    expect(result.result.variant).toBeNull();
  });
});
