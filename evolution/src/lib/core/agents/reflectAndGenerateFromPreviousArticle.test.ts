// Tests for ReflectAndGenerateFromPreviousArticleAgent: reflection prompt building,
// parser, and execute() flow happy path + failure modes.

import {
  ReflectAndGenerateFromPreviousArticleAgent,
  buildReflectionPrompt,
  parseReflectionRanking,
  ReflectionLLMError,
  ReflectionParseError,
  type ReflectAndGenerateInput,
  type TacticCandidate,
} from './reflectAndGenerateFromPreviousArticle';
import type { AgentContext } from '../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import { BudgetExceededError } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';

// Mock trackInvocations so wrapper's pre-throw partial-detail writes don't error in tests.
jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-reflect'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const INV_ID = '00000000-0000-4000-8000-000000000002';
const PARENT_ID = '00000000-0000-4000-8000-000000000003';

function mkCandidate(name: string): TacticCandidate {
  return { name, label: name.replace('_', ' '), summary: `${name} — does X to the article` };
}

const SAMPLE_CANDIDATES: TacticCandidate[] = [
  mkCandidate('structural_transform'),
  mkCandidate('lexical_simplify'),
  mkCandidate('grounding_enhance'),
];

const SAMPLE_BOOSTS = new Map<string, number | null>([
  ['structural_transform', 50],
  ['lexical_simplify', null],
  ['grounding_enhance', 30],
]);

function makeMockLlm(responseFn: () => string | Promise<string>): EvolutionLLMClient {
  return {
    complete: jest.fn(async (_prompt: string, _label: string) => responseFn()),
  } as unknown as EvolutionLLMClient;
}

function makeCtx(): AgentContext {
  return {
    db: { from: jest.fn() } as never,
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
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
      budgetUsd: 10,
      judgeModel: 'gpt-4.1-nano',
      generationModel: 'gpt-4.1-nano',
      maxComparisonsPerVariant: 5,
    } as never,
  };
}

function baseInput(llm: EvolutionLLMClient): ReflectAndGenerateInput {
  return {
    parentText: '# Sample Article\n\nThe quick brown fox jumps over the lazy dog.',
    parentVariantId: PARENT_ID,
    tacticCandidates: SAMPLE_CANDIDATES,
    tacticEloBoosts: SAMPLE_BOOSTS,
    reflectionTopN: 3,
    llm,
    initialPool: [] as Variant[],
    initialRatings: new Map<string, Rating>([['baseline', createRating()]]),
    initialMatchCounts: new Map<string, number>(),
    cache: new Map(),
  };
}

describe('buildReflectionPrompt', () => {
  it('includes parent text, all candidates, ELO boosts, and topN', () => {
    const prompt = buildReflectionPrompt('PARENT TEXT HERE', SAMPLE_CANDIDATES, SAMPLE_BOOSTS, 3);
    expect(prompt).toContain('PARENT TEXT HERE');
    expect(prompt).toContain('structural_transform');
    expect(prompt).toContain('lexical_simplify');
    expect(prompt).toContain('grounding_enhance');
    expect(prompt).toContain('+50'); // boost for structural_transform
    expect(prompt).toContain('—'); // null boost for lexical_simplify
    expect(prompt).toContain('+30'); // boost for grounding_enhance
    expect(prompt).toMatch(/top 3/i);
  });

  it('formats positive boost with +', () => {
    const prompt = buildReflectionPrompt('text', [mkCandidate('structural_transform')],
      new Map([['structural_transform', 25]]), 1);
    expect(prompt).toContain('+25');
  });

  it('formats negative boost without leading +', () => {
    const prompt = buildReflectionPrompt('text', [mkCandidate('structural_transform')],
      new Map([['structural_transform', -10]]), 1);
    expect(prompt).toContain('-10');
  });
});

describe('parseReflectionRanking', () => {
  // Use a permissive validator that accepts our 3 sample tactics.
  const validate = (n: string) => SAMPLE_CANDIDATES.some((c) => c.name === n);

  it('parses well-formed ranking with reasoning', () => {
    const response = `1. Tactic: structural_transform
   Reasoning: Article structure feels disorganized.

2. Tactic: lexical_simplify
   Reasoning: Vocabulary is too dense.

3. Tactic: grounding_enhance
   Reasoning: Needs concrete examples.`;
    const result = parseReflectionRanking(response, validate);
    expect(result).toHaveLength(3);
    expect(result[0]?.tactic).toBe('structural_transform');
    expect(result[0]?.reasoning).toContain('disorganized');
    expect(result[1]?.tactic).toBe('lexical_simplify');
    expect(result[2]?.tactic).toBe('grounding_enhance');
  });

  it('handles mixed-case tactic names', () => {
    const response = `1. Tactic: Structural_Transform
   Reasoning: x
2. Tactic: LEXICAL_SIMPLIFY
   Reasoning: y`;
    const result = parseReflectionRanking(response, validate);
    expect(result[0]?.tactic).toBe('structural_transform');
    expect(result[1]?.tactic).toBe('lexical_simplify');
  });

  it('drops unknown tactic names', () => {
    const response = `1. Tactic: nonexistent_tactic
   Reasoning: x
2. Tactic: structural_transform
   Reasoning: y`;
    const result = parseReflectionRanking(response, validate);
    expect(result).toHaveLength(1);
    expect(result[0]?.tactic).toBe('structural_transform');
  });

  it('throws ReflectionParseError when zero valid entries', () => {
    expect(() => parseReflectionRanking('not a ranking at all', validate)).toThrow(ReflectionParseError);
    expect(() => parseReflectionRanking('1. Tactic: bogus\n   Reasoning: x', validate)).toThrow(ReflectionParseError);
  });

  it('preserves raw response in thrown error', () => {
    try {
      parseReflectionRanking('garbage', validate);
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ReflectionParseError);
      expect((err as ReflectionParseError).rawResponse).toContain('garbage');
    }
  });

  it('handles multi-line reasoning', () => {
    const response = `1. Tactic: structural_transform
   Reasoning: First line of reasoning.
   Continuation of reasoning on second line.

2. Tactic: lexical_simplify
   Reasoning: Single line.`;
    const result = parseReflectionRanking(response, validate);
    expect(result).toHaveLength(2);
    expect(result[0]?.reasoning).toContain('First line');
    expect(result[0]?.reasoning).toContain('Continuation');
  });
});

describe('ReflectAndGenerateFromPreviousArticleAgent', () => {
  const agent = new ReflectAndGenerateFromPreviousArticleAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('reflect_and_generate_from_previous_article');
  });

  it('getAttributionDimension returns detail.tactic', () => {
    expect(agent.getAttributionDimension({ tactic: 'lexical_simplify' } as never)).toBe('lexical_simplify');
    expect(agent.getAttributionDimension({} as never)).toBeNull();
  });

  it('throws ReflectionLLMError when reflection LLM throws', async () => {
    const llm = makeMockLlm(() => {
      throw new Error('LLM down');
    });
    const ctx = makeCtx();
    const input = baseInput(llm);

    await expect(agent.execute(input, ctx)).rejects.toThrow(ReflectionLLMError);
  });

  it('throws ReflectionParseError when LLM returns garbage', async () => {
    const llm = makeMockLlm(() => 'this is not a valid ranking');
    const ctx = makeCtx();
    const input = baseInput(llm);

    await expect(agent.execute(input, ctx)).rejects.toThrow(ReflectionParseError);
  });

  it('throws when input has empty tactic candidates', async () => {
    const llm = makeMockLlm(() => 'unused');
    const ctx = makeCtx();
    const input = { ...baseInput(llm), tacticCandidates: [] };

    await expect(agent.execute(input, ctx)).rejects.toThrow('tacticCandidates is empty');
  });

  it('propagates BudgetExceededError thrown by reflection LLM as ReflectionLLMError', async () => {
    const llm = makeMockLlm(() => {
      throw new BudgetExceededError('reflection', 0, 0, 0);
    });
    const ctx = makeCtx();
    const input = baseInput(llm);

    await expect(agent.execute(input, ctx)).rejects.toThrow(ReflectionLLMError);
  });
});
