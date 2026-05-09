// Tests for DebateThenGenerateFromPreviousArticleAgent: combined prompt builder,
// 9-field parser, execute() flow happy path + every failure mode preserving
// partial detail before re-throw, multi-parent emission contract, I4 invariant.
// (bring_back_debate_agent_20260506 Phase 2.6.)

import {
  DebateThenGenerateFromPreviousArticleAgent,
  type DebateInput,
} from './DebateAgent';
import { buildCombinedAnalyzeAndJudgePrompt, buildSynthesisCustomPrompt, type DebateVerdict } from './promptBuilders';
import { parseCombinedAnalyzeAndJudge } from './parser';
import { DebateLLMError, DebateParseError } from './errors';
import type { AgentContext } from '../../types';
import type { Variant, EvolutionLLMClient } from '../../../types';
import type { Rating } from '../../../shared/computeRatings';
import { createRating } from '../../../shared/computeRatings';

jest.mock('../../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-debate'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  FORMAT_RULES: 'mock-format-rules',
}));

jest.mock('../../../shared/computeRatings', () => {
  const actual = jest.requireActual('../../../shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({ winner: 'A' as const, confidence: 1.0, turns: 2 })),
  };
});

const RUN_ID = '00000000-0000-4000-8000-000000000001';
const INV_ID = '00000000-0000-4000-8000-000000000002';
const VARIANT_A = '00000000-0000-4000-8000-00000000000a';
const VARIANT_B = '00000000-0000-4000-8000-00000000000b';

function mkVariant(id: string, text: string): Variant {
  return {
    id,
    text,
    version: 1,
    parentIds: [],
    tactic: 'baseline',
    createdAt: 0,
    iterationBorn: 0,
  };
}

const SAMPLE_VERDICT_JSON = JSON.stringify({
  prosA: ['A is more concise', 'A has clear topic intro'],
  consA: ['A lacks vivid examples'],
  prosB: ['B uses vivid imagery'],
  consB: ['B has muddled structure', 'B is verbose'],
  winner: 'A',
  reasoning: 'A is clearer overall but could benefit from B\'s imagery.',
  strengthsFromA: ['Topic introduction', 'Concise prose'],
  strengthsFromB: ['Vivid sensory details'],
  improvements: ['Tighten the closing paragraph'],
});

function makeMockLlm(responses: { judge?: string | (() => string | Promise<string>); generation?: string }): EvolutionLLMClient {
  return {
    complete: jest.fn(async (_prompt: string, agentName: string) => {
      if (agentName === 'debate_judge') {
        const r = responses.judge ?? SAMPLE_VERDICT_JSON;
        return typeof r === 'function' ? r() : r;
      }
      // Inner GFPA's call goes through the I4 proxy which rewrites 'generation' → 'debate_synthesis';
      // by the time the mock sees it, the rewritten name fires.
      if (agentName === 'debate_synthesis' || agentName === 'generation') {
        return responses.generation ?? '# Synthesized\n## Section\nSynthesis body that combines strengths from both parents and adds detail in fresh prose so Jaccard against either parent stays well below the 0.95 threshold for surfacing contracts to hold.';
      }
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
      iterationConfigs: [{ agentType: 'debate_and_generate', budgetPercent: 100 }],
      budgetUsd: 10,
      judgeModel: 'qwen-2.5-7b-instruct',
      generationModel: 'gpt-4.1-nano',
      maxComparisonsPerVariant: 5,
    } as never,
  };
}

function baseInput(llm: EvolutionLLMClient, opts: Partial<DebateInput> = {}): DebateInput {
  const variantA = mkVariant(VARIANT_A, 'Variant A — original article text. Clear and concise.');
  const variantB = mkVariant(VARIANT_B, 'Variant B — original article text. Vivid imagery and longer prose, but muddled structure that loses the reader.');
  return {
    judgeModel: 'qwen-2.5-7b-instruct',
    variantA,
    variantB,
    llm,
    initialPool: [variantA, variantB],
    initialRatings: new Map<string, Rating>([
      [VARIANT_A, { ...createRating(), elo: 1300 }],
      [VARIANT_B, { ...createRating(), elo: 1280 }],
    ]),
    initialMatchCounts: new Map<string, number>(),
    cache: new Map(),
    ...opts,
  };
}

// ─── Prompt builder ───────────────────────────────────────────

describe('buildCombinedAnalyzeAndJudgePrompt', () => {
  it('includes both variant texts and the structured-output schema', () => {
    const prompt = buildCombinedAnalyzeAndJudgePrompt(
      { id: 'a', text: 'AAA' },
      { id: 'b', text: 'BBB' },
    );
    expect(prompt).toContain('AAA');
    expect(prompt).toContain('BBB');
    expect(prompt).toContain('"prosA"');
    expect(prompt).toContain('"prosB"');
    expect(prompt).toContain('"winner": "A" | "B" | "tie"');
    expect(prompt).toContain('"strengthsFromA"');
    expect(prompt).toContain('"strengthsFromB"');
    expect(prompt).toContain('"improvements"');
  });

  it('includes critique-context blocks when provided', () => {
    const prompt = buildCombinedAnalyzeAndJudgePrompt(
      { id: 'a', text: 'AAA' },
      { id: 'b', text: 'BBB' },
      { pastWins: [{ summary: 'win 1' }], pastLosses: [] },
      { pastWins: [], pastLosses: [{ summary: 'loss 1' }] },
    );
    expect(prompt).toContain('Variant A history:');
    expect(prompt).toContain('win 1');
    expect(prompt).toContain('Variant B history:');
    expect(prompt).toContain('loss 1');
  });

  it('omits critique blocks when neither is provided', () => {
    const prompt = buildCombinedAnalyzeAndJudgePrompt(
      { id: 'a', text: 'AAA' },
      { id: 'b', text: 'BBB' },
    );
    expect(prompt).not.toContain('history:');
  });
});

describe('buildSynthesisCustomPrompt', () => {
  it('embeds verdict strengths + improvements into instructions', () => {
    const verdict: DebateVerdict = {
      prosA: ['x'], consA: ['y'], prosB: ['z'], consB: ['w'],
      winner: 'A',
      reasoning: 'because',
      strengthsFromA: ['Strength A1', 'Strength A2'],
      strengthsFromB: ['Strength B1'],
      improvements: ['Improvement 1'],
    };
    const { preamble, instructions } = buildSynthesisCustomPrompt(verdict);
    expect(preamble).toContain('expert article reviser');
    expect(instructions).toContain('Strength A1');
    expect(instructions).toContain('Strength B1');
    expect(instructions).toContain('Improvement 1');
    expect(instructions).toContain('±10%');
  });
});

// ─── Parser ───────────────────────────────────────────────────

describe('parseCombinedAnalyzeAndJudge', () => {
  it('parses valid 9-field JSON', () => {
    const v = parseCombinedAnalyzeAndJudge(SAMPLE_VERDICT_JSON);
    expect(v.winner).toBe('A');
    expect(v.prosA).toHaveLength(2);
    expect(v.consA).toHaveLength(1);
    expect(v.improvements).toHaveLength(1);
  });

  it('strips ```json ... ``` markdown fences', () => {
    const fenced = '```json\n' + SAMPLE_VERDICT_JSON + '\n```';
    expect(() => parseCombinedAnalyzeAndJudge(fenced)).not.toThrow();
  });

  it('strips bare ``` fences', () => {
    const fenced = '```\n' + SAMPLE_VERDICT_JSON + '\n```';
    expect(() => parseCombinedAnalyzeAndJudge(fenced)).not.toThrow();
  });

  it('throws DebateParseError on malformed JSON', () => {
    expect(() => parseCombinedAnalyzeAndJudge('not json {{{')).toThrow(DebateParseError);
  });

  it('throws on invalid winner enum', () => {
    const bad = JSON.stringify({ ...JSON.parse(SAMPLE_VERDICT_JSON), winner: 'C' });
    expect(() => parseCombinedAnalyzeAndJudge(bad)).toThrow(/Invalid winner/);
  });

  it('throws on missing reasoning', () => {
    const obj = JSON.parse(SAMPLE_VERDICT_JSON);
    delete obj.reasoning;
    expect(() => parseCombinedAnalyzeAndJudge(JSON.stringify(obj))).toThrow(/reasoning/);
  });

  it('throws on empty array field', () => {
    const obj = JSON.parse(SAMPLE_VERDICT_JSON);
    obj.prosA = [];
    expect(() => parseCombinedAnalyzeAndJudge(JSON.stringify(obj))).toThrow(/prosA.*zero non-empty/);
  });

  it('trims entries and drops empties', () => {
    const obj = JSON.parse(SAMPLE_VERDICT_JSON);
    obj.prosA = ['  trimmed  ', '', 'valid'];
    const v = parseCombinedAnalyzeAndJudge(JSON.stringify(obj));
    expect(v.prosA).toEqual(['trimmed', 'valid']);
  });

  it('rejects array-typed root', () => {
    expect(() => parseCombinedAnalyzeAndJudge('[1,2,3]')).toThrow(/Expected JSON object/);
  });

  it('rejects empty response after fence stripping', () => {
    expect(() => parseCombinedAnalyzeAndJudge('```\n```')).toThrow(/Empty response/);
  });

  // Run b0ebc971 staging observation: gemini-2.5-flash-lite emits invalid `\'`
  // escapes inside JSON strings — `"Fed\'s operations"`. JSON spec only allows
  // \", \\, \/, \b, \f, \n, \r, \t, \uXXXX. The parser retries with sanitization
  // when the first parse fails so a single non-conformant escape doesn't kill
  // the whole iteration.
  it("recovers from invalid backslash-apostrophe escape sequences (gemini over-escape)", () => {
    const obj = JSON.parse(SAMPLE_VERDICT_JSON);
    obj.consA = ["Some sentences are wordy (cite: 'Fed\\'s operations')"];
    obj.reasoning = "Both have strengths but A is more detailed about the Fed\\'s mandate.";
    // Build raw JSON manually so the `\'` lands in the byte stream as 2 chars:
    // backslash + apostrophe — exactly what JSON.parse rejects.
    const rawWithInvalidEscape = JSON.stringify(obj).replace(/Fed's/g, "Fed\\'s").replace(/Fed\\\\'s/g, "Fed\\'s");
    // Sanity check: vanilla JSON.parse should reject this.
    expect(() => JSON.parse(rawWithInvalidEscape)).toThrow();
    // Parser sanitizes and recovers.
    const v = parseCombinedAnalyzeAndJudge(rawWithInvalidEscape);
    expect(v.consA[0]).toContain("Fed's operations");
  });

  it("does NOT corrupt valid escaped-backslash + literal apostrophe sequences", () => {
    // Build the raw JSON byte stream directly. The reasoning field's value, byte
    // by byte, is: `Path: \\'foo'` — i.e. backslash, backslash, apostrophe, then
    // foo'. In JSON that decodes to `Path: \'foo'` (one literal backslash + apostrophe).
    // The sanitizer's (?<!\\) lookbehind must skip the `\\'` here because the
    // `\'` is preceded by another `\` — `\\` is the escaped-backslash, the trailing
    // `'` is just a literal apostrophe and the whole sequence is valid JSON.
    const rawValid = `{
      "winner": "A",
      "reasoning": "Path: \\\\'foo'",
      "prosA": ["x"], "consA": ["x"], "prosB": ["x"], "consB": ["x"],
      "strengthsFromA": ["x"], "strengthsFromB": ["x"], "improvements": ["x"]
    }`;
    const v = parseCombinedAnalyzeAndJudge(rawValid);
    // After JSON.parse, the reasoning string contains: literal backslash + apostrophe + foo + apostrophe.
    expect(v.reasoning).toBe("Path: \\'foo'");
  });

  it('still throws DebateParseError when sanitization cannot recover (truly malformed)', () => {
    expect(() => parseCombinedAnalyzeAndJudge('{ "winner": "A", "reasoning": "broken')).toThrow(DebateParseError);
  });
});

// ─── Agent ────────────────────────────────────────────────────

describe('DebateThenGenerateFromPreviousArticleAgent', () => {
  const agent = new DebateThenGenerateFromPreviousArticleAgent();

  it('has correct name', () => {
    expect(agent.name).toBe('debate_then_generate_from_previous_article');
  });

  it('getAttributionDimension returns the static marker tactic', () => {
    expect(agent.getAttributionDimension({ debate: { combined: { winner: 'A' } } } as never))
      .toBe('debate_synthesis');
  });

  it('throws when input.llm is missing', async () => {
    const input = { ...baseInput(makeMockLlm({})), llm: undefined };
    await expect(agent.execute(input, makeCtx())).rejects.toThrow(/input\.llm is required/);
  });

  it('happy path: produces a synthesized variant via inner GFPA', async () => {
    const result = await agent.execute(baseInput(makeMockLlm({})), makeCtx());
    expect(result.result.variant).not.toBeNull();
    expect(result.result.variant?.tactic).toBe('debate_synthesis');
    expect(result.detail.tactic).toBe('debate_synthesis');
    expect(result.detail.surfaced).toBe(true);
  });

  it('judge-call failure preserves partial detail and re-throws as DebateLLMError', async () => {
    const llm = makeMockLlm({ judge: () => { throw new Error('LLM down'); } });
    await expect(agent.execute(baseInput(llm), makeCtx())).rejects.toThrow(DebateLLMError);
  });

  it('parse failure re-throws as DebateParseError with rawResponse captured', async () => {
    const llm = makeMockLlm({ judge: 'this is not JSON at all' });
    let caughtErr: unknown;
    await agent.execute(baseInput(llm), makeCtx()).catch((e) => { caughtErr = e; });
    expect(caughtErr).toBeInstanceOf(DebateParseError);
    expect((caughtErr as DebateParseError).rawResponse).toContain('this is not JSON');
  });

  it('judge winner=tie marks synthesis surfaced=false', async () => {
    const tieJson = JSON.stringify({ ...JSON.parse(SAMPLE_VERDICT_JSON), winner: 'tie' });
    const result = await agent.execute(baseInput(makeMockLlm({ judge: tieJson })), makeCtx());
    expect(result.result.surfaced).toBe(false);
  });

  it('multi-parent emission: parentIds = [winner.id, loser.id] when winner=A', async () => {
    const result = await agent.execute(baseInput(makeMockLlm({})), makeCtx());
    expect(result.result.variant?.parentIds).toHaveLength(2);
    expect(result.result.variant?.parentIds[0]).toBe(VARIANT_A); // winner
    expect(result.result.variant?.parentIds[1]).toBe(VARIANT_B); // loser
    expect(result.parentVariantIds).toEqual([VARIANT_A, VARIANT_B]);
  });

  it('multi-parent emission: parentIds = [winner.id, loser.id] when winner=B', async () => {
    const verdictBWins = JSON.stringify({ ...JSON.parse(SAMPLE_VERDICT_JSON), winner: 'B' });
    const result = await agent.execute(baseInput(makeMockLlm({ judge: verdictBWins })), makeCtx());
    expect(result.result.variant?.parentIds).toHaveLength(2);
    expect(result.result.variant?.parentIds[0]).toBe(VARIANT_B); // winner
    expect(result.result.variant?.parentIds[1]).toBe(VARIANT_A); // loser
    expect(result.parentVariantIds).toEqual([VARIANT_B, VARIANT_A]);
  });

  it('I4 invariant: synthesis LLM proxy rewrites generation → debate_synthesis', async () => {
    const llm = makeMockLlm({});
    await agent.execute(baseInput(llm), makeCtx());
    // Find the calls. The wrapper's combined call uses 'debate_judge'. The inner GFPA's
    // generation call is intercepted by the I4 proxy and rewritten to 'debate_synthesis'
    // before reaching the underlying llm. Inner GFPA's ranking calls pass through unchanged.
    const completeCalls = (llm.complete as jest.Mock).mock.calls;
    const agentNamesUsed = completeCalls.map((c) => c[1]);
    expect(agentNamesUsed).toContain('debate_judge');
    expect(agentNamesUsed).toContain('debate_synthesis');
    // The proxy MUST NOT leak 'generation' through to the underlying llm.
    expect(agentNamesUsed).not.toContain('generation');
  });

  it('I1 invariant: inner GFPA is invoked via .execute() not .run()', async () => {
    // We can't directly observe .execute() vs .run() from outside, but the contract is:
    // .run() would create a nested Agent.run() scope; .execute() does not. The cost
    // would split if .run() were used. We assert costTracker.recordSpend is not double-
    // attributed by checking that no call to costTracker.reserve() has agentName === 'generation'.
    const llm = makeMockLlm({});
    const ctx = makeCtx();
    await agent.execute(baseInput(llm), ctx);
    const reserveCalls = (ctx.costTracker.reserve as jest.Mock).mock.calls;
    // Inner GFPA's reserve() calls should land on 'debate_synthesis' (via I4 proxy) and 'ranking',
    // never on 'generation' — the latter would mean the proxy wasn't injected.
    const reserveAgentNames = reserveCalls.map((c) => c[0]);
    expect(reserveAgentNames).not.toContain('generation');
  });

  it('synthesis identical-to-parent gates surfaced=false (Jaccard ≥ 0.95)', async () => {
    // Same text as parent A → Jaccard = 1.
    const llm = makeMockLlm({
      generation: 'Variant A — original article text. Clear and concise.',
    });
    const result = await agent.execute(baseInput(llm), makeCtx());
    expect(result.result.surfaced).toBe(false);
  });

  it('budget gate fires before synthesis when combined call exceeds 0.9 × cap', async () => {
    const ctx = makeCtx();
    // Force getOwnSpent to return >= 0.36 (0.9 × 0.40) AFTER the combined call.
    let callCount = 0;
    (ctx.costTracker.getOwnSpent as jest.Mock).mockImplementation(() => {
      callCount += 1;
      // First call (pre-judge): 0.0005. Subsequent calls (post-judge): 0.40.
      return callCount === 1 ? 0.0005 : 0.40;
    });
    await expect(agent.execute(baseInput(makeMockLlm({})), ctx)).rejects.toThrow(/budget gate fired before synthesis/);
  });

  it('cost attribution: synthesis cost flows under debate_synthesis AgentName (not generation)', async () => {
    // I4 proxy rewrite contract — synthesis cost must be recorded under 'debate_synthesis'.
    // (For a real cost-attribution integration test exercising createEvolutionLLMClient,
    // see Phase 3.6 integration test.)
    const llm = makeMockLlm({});
    await agent.execute(baseInput(llm), makeCtx());
    const completeCalls = (llm.complete as jest.Mock).mock.calls;
    const debateSynthesisCalls = completeCalls.filter((c) => c[1] === 'debate_synthesis');
    expect(debateSynthesisCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('top-2 selection is left to the runtime (agent receives variantA + variantB)', async () => {
    // Sanity check: the agent does NOT do top-2 selection internally (per Decision §16,
    // resolveDebateDispatchRuntime is the dispatch helper). The agent trusts variantA + variantB.
    const customA = mkVariant('00000000-0000-4000-8000-000000000aaa', 'custom A text content here');
    const customB = mkVariant('00000000-0000-4000-8000-000000000bbb', 'custom B text content here');
    const result = await agent.execute(baseInput(makeMockLlm({}), {
      variantA: customA,
      variantB: customB,
      initialPool: [customA, customB],
      initialRatings: new Map<string, Rating>([
        [customA.id, { ...createRating(), elo: 1500 }],
        [customB.id, { ...createRating(), elo: 1450 }],
      ]),
    }), makeCtx());
    expect(result.detail.variantA.id).toBe(customA.id);
    expect(result.detail.variantB.id).toBe(customB.id);
  });

  it('reasoningEffortResolved is captured in execution_detail when judgeModel supports reasoning', async () => {
    const result = await agent.execute(baseInput(makeMockLlm({}), {
      judgeModel: 'qwen/qwen3-8b',
      iterDebateJudgeReasoningEffort: 'medium',
    }), makeCtx());
    expect(result.detail.debate?.combined?.reasoningEffortResolved).toBe('medium');
  });

  it('reasoningEffortResolved undefined when judgeModel does NOT support reasoning (defensive guard)', async () => {
    // Phase 1.14 cross-field refinement would normally reject this at insert time,
    // but the cascade resolver's defensive guard catches direct-write paths bypassing Zod.
    const result = await agent.execute(baseInput(makeMockLlm({}), {
      judgeModel: 'gpt-4.1-nano',  // supportsReasoning=false
      iterDebateJudgeReasoningEffort: 'medium',
    }), makeCtx());
    // Defensive guard drops the effort + logs warn; resolver returns undefined.
    expect(result.detail.debate?.combined?.reasoningEffortResolved).toBeUndefined();
  });

  it('combined call uses the strategy judgeModel passed in (not a hardcoded default)', async () => {
    const llm = makeMockLlm({});
    await agent.execute(baseInput(llm, { judgeModel: 'qwen/qwen3-8b' }), makeCtx());
    const judgeCall = (llm.complete as jest.Mock).mock.calls.find((c) => c[1] === 'debate_judge');
    expect(judgeCall![2].model).toBe('qwen/qwen3-8b');
  });

  it('totalCost = combined call cost + inner GFPA totalCost', async () => {
    const llm = makeMockLlm({});
    let spent = 0;
    const ctx = makeCtx();
    (ctx.costTracker.getOwnSpent as jest.Mock).mockImplementation(() => spent);
    (llm.complete as jest.Mock).mockImplementation(async (_p: string, agentName: string) => {
      if (agentName === 'debate_judge') {
        spent += 0.002;
        return SAMPLE_VERDICT_JSON;
      }
      if (agentName === 'debate_synthesis' || agentName === 'generation') {
        spent += 0.01;
        return '# Synthesis\n## Section\nFresh synthesized prose body that is sufficiently distinct from either parent variant to clear the Jaccard 0.95 no-op gate so the variant surfaces and ranking proceeds normally as expected.';
      }
      return 'A';
    });
    const result = await agent.execute(baseInput(llm), ctx);
    expect(result.detail.totalCost).toBeGreaterThan(0.002);
  });
});
