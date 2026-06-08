// Unit tests for the judge-eval engine. Uses a plain fake JudgeFn (mirroring how
// computeRatings.comparison.test.ts injects a jest.fn callLLM) — NOT createV2MockLlm, since
// the engine drives the 2-pass directly over the injected fn, not via EvolutionLLMClient.

import {
  evaluatePair,
  runJudgeEval,
  createCallLLMJudge,
  MAX_JUDGE_RETRIES,
  type JudgeFn,
  type JudgeCallOutput,
} from './runJudgeEval';
import type { JudgeEvalPair } from './schemas';
import { callLLM } from '@/lib/services/llms';

// Mock only the LLM transport so the retry loop's real isTransientError classifier still runs.
jest.mock('@/lib/services/llms', () => ({ callLLM: jest.fn() }));
const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

function pair(overrides: Partial<JudgeEvalPair> = {}): JudgeEvalPair {
  return {
    label: 'art#0001',
    pair_kind: 'article',
    variant_a_id: '00000000-0000-4000-8000-000000000001',
    variant_b_id: '00000000-0000-4000-8000-000000000002',
    text_a: 'AAA distinctive alpha text',
    text_b: 'BBB distinctive beta text',
    mu_a: 40,
    mu_b: 20,
    sigma_a: 5,
    sigma_b: 5,
    expected_winner: 'A',
    gap_kind: 'large',
    baseline_confidence: 1.0,
    ...overrides,
  };
}

/** Fake judge that always prefers text_a: returns the slot label where text_a sits. */
function textAPreferringJudge(text_a: string): JudgeFn {
  return async (prompt: string): Promise<JudgeCallOutput> => {
    const aFirst = prompt.indexOf(text_a) < prompt.indexOf('## Text B');
    // forward prompt: text_a in slot A → 'A'; reverse prompt: text_a in slot B → 'B'.
    return {
      text: `Your answer: ${aFirst ? 'A' : 'B'}`,
      costUsd: 0.0001,
      promptTokens: 500,
      outputTokens: 3,
      reasoningTokens: 0,
    };
  };
}

describe('evaluatePair', () => {
  it('captures per-pass raw responses and aggregates a consistent winner at confidence 1.0', async () => {
    const p = pair();
    const rows = await evaluatePair(p, { judgeModel: 'm' }, 3, textAPreferringJudge(p.text_a));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.forward_raw).toContain('Your answer: A');
      expect(r.reverse_raw).toContain('Your answer: B');
      expect(r.forward_winner).toBe('A');
      expect(r.reverse_winner).toBe('B');
      expect(r.winner).toBe('A'); // forward A + reverse B(=A after flip) → A
      expect(r.confidence).toBe(1.0);
      expect(r.cost_usd).toBeCloseTo(0.0002, 6); // two passes
      expect(r.output_tokens).toBe(6);
      expect(r.comparison_mode).toBe('article');
    }
  });

  it('uses the paragraph rubric for paragraph pairs', async () => {
    const seen: string[] = [];
    const judge: JudgeFn = async (prompt) => {
      seen.push(prompt);
      return { text: 'Your answer: TIE', costUsd: 0, promptTokens: 1, outputTokens: 1, reasoningTokens: 0 };
    };
    const rows = await evaluatePair(pair({ pair_kind: 'paragraph' }), { judgeModel: 'm' }, 1, judge);
    expect(rows[0]!.comparison_mode).toBe('paragraph');
    // paragraph rubric is TIE-discouraging — assert its distinctive instruction appears
    expect(seen[0]).toMatch(/slim margin|better one/i);
  });

  it('selects the reasoning-tolerant parser when explainReasoning is on', async () => {
    // A multi-line reasoning response that parseWinner would mis-handle but the freeform
    // parser extracts from the trailing verdict line.
    const judge: JudgeFn = async (prompt) => {
      const aFirst = prompt.indexOf('AAA distinctive') < prompt.indexOf('## Text B');
      return {
        text: `They are nearly equal and it's almost a draw, but on balance...\nYour answer: ${aFirst ? 'A' : 'B'}`,
        costUsd: 0,
        promptTokens: 1,
        outputTokens: 50,
        reasoningTokens: 40,
      };
    };
    const rows = await evaluatePair(pair(), { judgeModel: 'm', explainReasoning: true }, 1, judge);
    expect(rows[0]!.winner).toBe('A');
    expect(rows[0]!.confidence).toBe(1.0);
  });
});

describe('runJudgeEval', () => {
  it('runs every pair × repeat under bounded concurrency', async () => {
    const pairs = [pair({ label: 'art#1' }), pair({ label: 'art#2' }), pair({ label: 'para#1', pair_kind: 'paragraph' })];
    let inFlight = 0;
    let maxInFlight = 0;
    const judge: JudgeFn = async (prompt) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const aFirst = prompt.indexOf('AAA distinctive') < prompt.indexOf('## Text B');
      return { text: `Your answer: ${aFirst ? 'A' : 'B'}`, costUsd: 0, promptTokens: 1, outputTokens: 1, reasoningTokens: 0 };
    };
    const rows = await runJudgeEval(pairs, { judgeModel: 'm' }, 2, judge, 2);
    expect(rows).toHaveLength(3 * 2); // 3 pairs × 2 repeats
    expect(maxInFlight).toBeGreaterThan(0);
  });
});

describe('createCallLLMJudge (E2E stub)', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('returns a deterministic canned verdict under E2E_TEST_MODE without a provider call', async () => {
    const env = process.env as Record<string, string | undefined>;
    env.E2E_TEST_MODE = 'true';
    delete env.NODE_ENV;
    const judge = createCallLLMJudge({ judgeModel: 'qwen-2.5-7b-instruct' });
    const out = await judge('## Text A\nx\n## Text B\ny\nYour answer:');
    expect(out.text).toContain('Your answer: A');
    expect(out.costUsd).toBe(0);
  });

  it('throws when E2E_TEST_MODE is set in production without CI', () => {
    const env = process.env as Record<string, string | undefined>;
    env.E2E_TEST_MODE = 'true';
    env.NODE_ENV = 'production';
    delete env.CI;
    expect(() => createCallLLMJudge({ judgeModel: 'qwen-2.5-7b-instruct' })).toThrow(
      /must not be enabled in production/,
    );
  });
});

describe('createCallLLMJudge (retry)', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => mockCallLLM.mockReset());
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  // Build a judge that actually reaches callLLM (E2E stub disabled) with zero backoff delay.
  function judgeOutsideE2E(): JudgeFn {
    const env = process.env as Record<string, string | undefined>;
    delete env.E2E_TEST_MODE;
    delete env.NODE_ENV;
    return createCallLLMJudge({ judgeModel: 'deepseek-v4-flash', retryBaseDelayMs: 0 });
  }
  const PROMPT = '## Text A\nx\n## Text B\ny\nYour answer:';

  it('retries a transient failure then succeeds', async () => {
    mockCallLLM
      .mockRejectedValueOnce(new Error('503 service unavailable'))
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce('Your answer: A');
    const out = await judgeOutsideE2E()(PROMPT);
    expect(out.text).toBe('Your answer: A');
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-transient failure', async () => {
    mockCallLLM.mockRejectedValue(new Error('invalid judgeModel: nonsense'));
    await expect(judgeOutsideE2E()(PROMPT)).rejects.toThrow(/invalid judgeModel/);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });

  it('gives up after MAX_JUDGE_RETRIES transient failures', async () => {
    mockCallLLM.mockRejectedValue(new Error('gateway timeout 504'));
    await expect(judgeOutsideE2E()(PROMPT)).rejects.toThrow(/504/);
    expect(mockCallLLM).toHaveBeenCalledTimes(MAX_JUDGE_RETRIES + 1);
  });
});
