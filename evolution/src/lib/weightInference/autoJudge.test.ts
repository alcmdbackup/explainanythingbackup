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
