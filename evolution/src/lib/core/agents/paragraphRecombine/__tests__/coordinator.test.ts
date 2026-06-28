// Unit tests for runCoordinator — Phase A of Sequential Context-Aware Generation
// (debug_performance_paragraph_recombine_20260612). Verifies parse-then-retry-then-throw
// contract + AgentName attribution.

import { runCoordinator, CoordinatorLLMError, CoordinatorParseError } from '../coordinator';
import type { EvolutionLLMClient } from '../../../../types';
import type { CoordinatorPlan } from '../../../../schemas';

const VALID_PLAN: CoordinatorPlan = {
  paragraphPlans: [
    {
      paragraphIndex: 0,
      role: 'lede',
      shouldRewrite: true,
      priority: 'high',
      M: 2,
      candidates: [
        { directive: 'Tighten with controlling metaphor.', temperature: 0.7 },
        { directive: 'Concrete narrative opening.', temperature: 1.0 },
      ],
      rationale: 'Lede needs to set up the article',
    },
    {
      paragraphIndex: 1,
      role: 'body',
      shouldRewrite: true,
      priority: 'medium',
      M: 2,
      candidates: [
        { directive: 'Tighten and preserve fact density.', temperature: 0.7 },
        { directive: 'Add a concrete example.', temperature: 1.1 },
      ],
      rationale: 'Body should preserve concretion',
    },
  ],
};

function makeLlmStub(responses: string[]): EvolutionLLMClient {
  let callIndex = 0;
  const complete = jest.fn(async () => {
    const r = responses[callIndex];
    callIndex++;
    if (r === undefined) throw new Error('no more stubbed responses');
    return r;
  });
  return {
    complete,
    completeStructured: jest.fn(),
  } as unknown as EvolutionLLMClient;
}

describe('runCoordinator', () => {
  it('parses valid JSON on first attempt; no retry', async () => {
    const llm = makeLlmStub([JSON.stringify(VALID_PLAN)]);
    const result = await runCoordinator({
      parentText: 'Para 0.\n\nPara 1.',
      paragraphCount: 2,
      llm,
      generationModel: 'gpt-4.1-nano',
    });
    expect(result.plan).toEqual(VALID_PLAN);
    expect(result.retried).toBe(false);
    expect((llm.complete as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('uses AgentName label "paragraph_recombine_coordinator"', async () => {
    const llm = makeLlmStub([JSON.stringify(VALID_PLAN)]);
    await runCoordinator({
      parentText: 'a\n\nb',
      paragraphCount: 2,
      llm,
      generationModel: 'gpt-4.1-nano',
    });
    const call = (llm.complete as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('paragraph_recombine_coordinator');
  });

  it('strips ```json fences before parsing', async () => {
    const wrapped = '```json\n' + JSON.stringify(VALID_PLAN) + '\n```';
    const llm = makeLlmStub([wrapped]);
    const result = await runCoordinator({
      parentText: 'a\n\nb',
      paragraphCount: 2,
      llm,
      generationModel: 'gpt-4.1-nano',
    });
    expect(result.plan).toEqual(VALID_PLAN);
  });

  it('retries once on malformed JSON; succeeds when retry returns valid', async () => {
    const llm = makeLlmStub([
      'not json at all',
      JSON.stringify(VALID_PLAN),
    ]);
    const result = await runCoordinator({
      parentText: 'a\n\nb',
      paragraphCount: 2,
      llm,
      generationModel: 'gpt-4.1-nano',
    });
    expect(result.plan).toEqual(VALID_PLAN);
    expect(result.retried).toBe(true);
    expect((llm.complete as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('retries once then throws CoordinatorParseError when retry also fails', async () => {
    const llm = makeLlmStub(['bad json', 'still bad json']);
    await expect(
      runCoordinator({
        parentText: 'a\n\nb',
        paragraphCount: 2,
        llm,
        generationModel: 'gpt-4.1-nano',
      }),
    ).rejects.toBeInstanceOf(CoordinatorParseError);
    expect((llm.complete as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('CoordinatorParseError carries rawResponse + parseError for partial-detail persistence', async () => {
    const llm = makeLlmStub(['bad json', 'still bad json']);
    let caught: Error | undefined;
    try {
      await runCoordinator({
        parentText: 'a\n\nb',
        paragraphCount: 2,
        llm,
        generationModel: 'gpt-4.1-nano',
      });
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(CoordinatorParseError);
    const parseErr = caught as CoordinatorParseError;
    expect(parseErr.rawResponse).toBe('still bad json');
    expect(parseErr.parseError).toMatch(/JSON.parse failed|Zod/i);
  });

  it('throws CoordinatorLLMError when LLM call itself rejects', async () => {
    const llm: EvolutionLLMClient = {
      complete: jest.fn().mockRejectedValue(new Error('network timeout')),
      completeStructured: jest.fn(),
    } as unknown as EvolutionLLMClient;
    await expect(
      runCoordinator({
        parentText: 'a\n\nb',
        paragraphCount: 2,
        llm,
        generationModel: 'gpt-4.1-nano',
      }),
    ).rejects.toBeInstanceOf(CoordinatorLLMError);
  });

  it('tolerates an under-count plan: pads the omitted slot as keep-original (no retry)', async () => {
    // VALID_PLAN has 2 entries (indices 0,1); ask for 3 paragraphs → index 2 omitted.
    // Small coordinator models routinely miscount; rather than throwing away the whole
    // invocation (the 20260626 elo-experiment zero-variant bug), pad the omitted slot.
    const llm = makeLlmStub([JSON.stringify(VALID_PLAN)]);
    const result = await runCoordinator({
      parentText: 'a\n\nb\n\nc',
      paragraphCount: 3,
      llm,
      generationModel: 'gpt-4.1-nano',
    });
    expect(result.retried).toBe(false);
    expect((llm.complete as jest.Mock).mock.calls).toHaveLength(1); // succeeded first try
    expect(result.plan.paragraphPlans.map((p) => p.paragraphIndex)).toEqual([0, 1, 2]);
    const padded = result.plan.paragraphPlans.find((p) => p.paragraphIndex === 2)!;
    expect(padded.shouldRewrite).toBe(false); // omitted slot keeps its original paragraph
  });

  it('rejects an over-count plan (out-of-range index) and throws after retry', async () => {
    // 2 entries but only 1 paragraph expected → index 1 is out of [0,1). Both attempts bad.
    const llm = makeLlmStub([JSON.stringify(VALID_PLAN), JSON.stringify(VALID_PLAN)]);
    await expect(
      runCoordinator({
        parentText: 'a',
        paragraphCount: 1, // expecting at most 1; plan has 2
        llm,
        generationModel: 'gpt-4.1-nano',
      }),
    ).rejects.toBeInstanceOf(CoordinatorParseError);
  });

  it('rejects plan where M does not match candidates length', async () => {
    const badPlan: CoordinatorPlan = {
      paragraphPlans: [
        {
          paragraphIndex: 0,
          role: 'lede',
          shouldRewrite: true,
          priority: 'high',
          M: 3, // says M=3
          candidates: [{ directive: 'd', temperature: 0.7 }], // only 1 candidate
          rationale: 'r',
        },
      ],
    };
    const llm = makeLlmStub([JSON.stringify(badPlan), JSON.stringify(badPlan)]);
    await expect(
      runCoordinator({
        parentText: 'a',
        paragraphCount: 1,
        llm,
        generationModel: 'gpt-4.1-nano',
      }),
    ).rejects.toBeInstanceOf(CoordinatorParseError);
  });

  it('tolerates under-count on the replan path (firstSlot>0)', async () => {
    // Replan covers [2,4): 2 slots. Model returns 1 entry (index 2), omitting index 3.
    const replanPlan: CoordinatorPlan = {
      paragraphPlans: [
        {
          paragraphIndex: 2,
          role: 'body',
          shouldRewrite: true,
          priority: 'medium',
          M: 1,
          candidates: [{ directive: 'd', temperature: 0.8 }],
          rationale: 'r',
        },
      ],
    };
    const llm = makeLlmStub([JSON.stringify(replanPlan)]);
    const result = await runCoordinator({
      parentText: 'a\n\nb\n\nc\n\nd',
      paragraphCount: 4,
      llm,
      generationModel: 'gpt-4.1-nano',
      priorPicks: ['kept0', 'kept1'],
      firstSlot: 2,
    });
    expect(result.kind).toBe('replan');
    expect(result.plan.paragraphPlans.map((p) => p.paragraphIndex)).toEqual([2, 3]);
    expect(result.plan.paragraphPlans.find((p) => p.paragraphIndex === 3)!.shouldRewrite).toBe(false);
  });
});
