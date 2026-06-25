// Unit tests for auto-mode judging: judgePairOnce with an injected deterministic judge
// (content-aware, no real LLM) and the repeats-fold logic.

import { foldRepeats, judgePairOnce, type SinglePairResult } from './autoJudge';
import type { ResolvedJudgeRubric } from '@evolution/lib/shared/rubricJudge';

const RUBRIC: ResolvedJudgeRubric = {
  rubricId: 'r1',
  dimensions: [
    { criteriaId: 'id1', name: 'c1', description: null, minRating: 1, maxRating: 10, evaluationGuidance: null, weight: 0.5 },
    { criteriaId: 'id2', name: 'c2', description: null, minRating: 1, maxRating: 10, evaluationGuidance: null, weight: 0.5 },
  ],
};

describe('judgePairOnce', () => {
  it('judges a pair with an injected judge that consistently prefers canonical A', async () => {
    const costAcc = { usd: 0 };
    // Content-aware mock: prefer whichever text contains "AAA" (canonical A). Returns per-
    // dimension lines for the rubric prompt (detected by the dim names), a token otherwise.
    const judge = async (prompt: string): Promise<string> => {
      costAcc.usd += 0.001;
      const pick = prompt.indexOf('AAA') < prompt.indexOf('BBB') ? 'A' : 'B';
      if (prompt.includes('c1') || prompt.includes('c2')) {
        return ['c1', 'c2'].map((n) => `${n}: ${pick}`).join('\n');
      }
      return pick;
    };

    const res = await judgePairOnce(judge, 'AAA article', 'BBB article', RUBRIC, costAcc);
    expect(res.overall).toBe('a');
    expect(res.dims).toHaveLength(2);
    expect(res.dims.every((d) => d.verdict === 'a')).toBe(true);
    expect(res.costUsd).toBeGreaterThan(0);
    expect(res.forwardWinner).toBe('a');
  });
});

// ─── Phase 1 (evalute_implied_rubric_results_and_experimentally_validate_20260623) ────────
// holistic prompt override: tests that the override flows to BOTH forward and reverse passes
// of the holistic prompt, that the strict A/B/TIE verdict tail is emitted (not the rejudge
// sandbox's reasoning-tolerant "Your answer:" tail), and that the default (no override)
// behavior is byte-identical to pre-Phase-1.

describe('judgePairOnce — holistic_prompt_override (Phase 1)', () => {
  const OVERRIDE = '## Custom Eval\nDecide which version is better overall. Be terse.';

  it('omitting holistic override leaves the default hardcoded checklist intact', async () => {
    const captured: string[] = [];
    const judge = async (prompt: string): Promise<string> => {
      captured.push(prompt);
      return prompt.indexOf('AAA') < prompt.indexOf('BBB') ? 'A' : 'B';
    };
    await judgePairOnce(judge, 'AAA article', 'BBB article', RUBRIC, { usd: 0 });
    // Expect the default hardcoded checklist in both holistic prompts (forward + reverse).
    const holisticPrompts = captured.filter((p) => p.includes('Clarity and readability'));
    expect(holisticPrompts).toHaveLength(2);
    // No override marker, no reasoning-tolerant tail.
    expect(holisticPrompts.some((p) => p.includes('## Custom Eval'))).toBe(false);
    expect(holisticPrompts.some((p) => p.includes('You may include reasoning'))).toBe(false);
  });

  it('forwards the override into BOTH forward and reverse holistic prompts', async () => {
    const captured: string[] = [];
    const judge = async (prompt: string): Promise<string> => {
      captured.push(prompt);
      // Detect rubric prompt via dim names so we don't return per-dim verdicts on the holistic call.
      if (prompt.includes('c1') || prompt.includes('c2')) {
        return ['c1', 'c2'].map((n) => `${n}: A`).join('\n');
      }
      return 'A';
    };
    await judgePairOnce(judge, 'AAA article', 'BBB article', RUBRIC, { usd: 0 }, 'article', OVERRIDE);
    // Two holistic prompts both contain the override — and neither contains the default
    // hardcoded "Clarity and readability" checklist line.
    const holisticPrompts = captured.filter((p) => p.includes('## Custom Eval'));
    expect(holisticPrompts).toHaveLength(2);
    expect(holisticPrompts.every((p) => !p.includes('Clarity and readability'))).toBe(true);
  });

  it('emits the STRICT A/B/TIE verdict tail (not the reasoning-tolerant "Your answer:" tail)', async () => {
    const captured: string[] = [];
    const judge = async (prompt: string): Promise<string> => {
      captured.push(prompt);
      if (prompt.includes('c1') || prompt.includes('c2')) {
        return ['c1', 'c2'].map((n) => `${n}: A`).join('\n');
      }
      return 'A';
    };
    await judgePairOnce(judge, 'AAA', 'BBB', RUBRIC, { usd: 0 }, 'article', OVERRIDE);
    const holisticPrompts = captured.filter((p) => p.includes('## Custom Eval'));
    // Strict tail: "Respond with ONLY one of these exact answers".
    expect(holisticPrompts.every((p) => p.includes('Respond with ONLY one of these exact answers'))).toBe(true);
    // Must NOT contain the reasoning-tolerant phrasing that the rejudge sandbox uses.
    expect(holisticPrompts.some((p) => p.includes('You may include reasoning'))).toBe(false);
  });

  it('empty-string override is treated identically to undefined override (no preset replacement)', async () => {
    const captured: string[] = [];
    const judge = async (prompt: string): Promise<string> => {
      captured.push(prompt);
      return 'A';
    };
    await judgePairOnce(judge, 'AAA', 'BBB', RUBRIC, { usd: 0 }, 'article', '');
    // Default hardcoded checklist is still used on both passes.
    const defaultPrompts = captured.filter((p) => p.includes('Clarity and readability'));
    expect(defaultPrompts).toHaveLength(2);
  });
});

function r(overall: 'a' | 'b' | 'tie', dimV: 'a' | 'b' | 'tie', cost = 0.01): SinglePairResult {
  return {
    overall,
    overallConfidence: 1,
    forwardWinner: overall,
    reverseWinner: overall,
    dims: [{ criteriaId: 'id1', verdict: dimV, confidence: 1 }],
    costUsd: cost,
  };
}

describe('foldRepeats', () => {
  it('passes a single repeat through unchanged', () => {
    const one = r('a', 'b', 0.02);
    expect(foldRepeats([one])).toBe(one);
  });

  it('majority-votes the overall + per-criterion and sums cost', () => {
    const folded = foldRepeats([r('a', 'a'), r('a', 'a'), r('b', 'b')]);
    expect(folded.overall).toBe('a');
    expect(folded.overallConfidence).toBeCloseTo(2 / 3, 5);
    expect(folded.dims[0]!.verdict).toBe('a');
    expect(folded.dims[0]!.confidence).toBeCloseTo(2 / 3, 5);
    expect(folded.costUsd).toBeCloseTo(0.03, 5);
  });

  it('returns a safe empty result for no repeats', () => {
    const folded = foldRepeats([]);
    expect(folded.overall).toBe('tie');
    expect(folded.dims).toHaveLength(0);
    expect(folded.costUsd).toBe(0);
  });
});
