// Unit tests for the Agreement engine: the pure computePairAgreement helper (aggregate + per-criterion
// vs holistic, abstain on TIE, ground-truth only on large-gap) and the per-pair engine over a fake
// JudgeFn (4 calls/pair·repeat, holistic + rubric paired, errored-pair partialResults protocol).

import { computePairAgreement, evaluatePairAgreement, runAgreementOverPairs } from './agreement';
import type { JudgeCallOutput, JudgeFn } from './runJudgeEval';
import type { RubricBreakdown, ResolvedJudgeRubric, Verdict } from '../shared/rubricJudge';
import type { JudgeEvalPair } from './schemas';

function dim(name: string, fwd: Verdict | null, rev: Verdict | null, weight = 0.5) {
  return { criteriaId: `c-${name}`, name, weight, forwardVerdict: fwd, reverseVerdict: rev };
}

function breakdown(dims: ReturnType<typeof dim>[], overall: Verdict): RubricBreakdown {
  return {
    rubricId: 'r1',
    dimensions: dims,
    forwardPass: { scoreA: 0, scoreB: 0, winner: overall },
    reversePass: { scoreA: 0, scoreB: 0, winner: overall },
    overall: { winner: overall, confidence: 1 },
  };
}

describe('computePairAgreement (pure)', () => {
  it('aggregate match = holistic winner equals rubric overall', () => {
    const b = breakdown([dim('Clarity', 'A', 'A')], 'A');
    expect(computePairAgreement('A', b, null, null).matches).toBe(true);
    expect(computePairAgreement('B', b, null, null).matches).toBe(false);
  });

  it('per-criterion agrees vs holistic; TIE criterion abstains (null)', () => {
    const b = breakdown(
      [
        dim('Clarity', 'A', 'A'), // reconciles A → agrees with holistic A
        dim('Structure', 'B', 'B'), // reconciles B → disagrees with holistic A
        dim('Depth', 'A', 'B'), // A vs B → TIE → abstain (null)
        dim('Grammar', null, null), // both null → TIE → abstain (null)
      ],
      'A',
    );
    const { criterionVerdicts } = computePairAgreement('A', b, null, null);
    const by = Object.fromEntries(criterionVerdicts.map((c) => [c.criteria_name, c]));
    expect(by.Clarity!.agrees_with_holistic).toBe(true);
    expect(by.Structure!.agrees_with_holistic).toBe(false);
    expect(by.Depth!.agrees_with_holistic).toBeNull();
    expect(by.Grammar!.agrees_with_holistic).toBeNull();
  });

  it('ground-truth match only for decisive criteria on large-gap pairs', () => {
    const b = breakdown([dim('Clarity', 'A', 'A'), dim('Depth', 'A', 'B')], 'A');
    const large = computePairAgreement('A', b, 'A', 'large').criterionVerdicts;
    expect(large.find((c) => c.criteria_name === 'Clarity')!.matches_ground_truth).toBe(true);
    expect(large.find((c) => c.criteria_name === 'Depth')!.matches_ground_truth).toBeNull(); // TIE
    // close pair → never scored against ground truth
    const close = computePairAgreement('A', b, 'A', 'close').criterionVerdicts;
    expect(close.find((c) => c.criteria_name === 'Clarity')!.matches_ground_truth).toBeNull();
  });
});

// ── Engine over a fake JudgeFn ──
function out(text: string): JudgeCallOutput {
  return {
    text,
    costUsd: 0.001,
    promptTokens: 10,
    outputTokens: 2,
    reasoningTokens: 0,
    reasoningTrace: null,
    reasoningTraceFormat: null,
  };
}

/** Fake judge that always prefers whichever of Text A / Text B contains `winningText`. Holistic
 *  prompts → a bare verdict token; rubric prompts → every verdict-template line filled with the pick. */
function fakeJudge(winningText: string): JudgeFn {
  return async (prompt: string): Promise<JudgeCallOutput> => {
    const aBlock = prompt.split('## Text A')[1]?.split('## Text B')[0] ?? '';
    const pick = aBlock.includes(winningText) ? 'A' : 'B';
    if (prompt.includes('For EACH dimension')) {
      const lines = prompt
        .split('\n')
        .filter((l) => /<A\|B\|TIE>/.test(l))
        .map((l) => l.replace(/<A\|B\|TIE>/, pick));
      return out(lines.join('\n'));
    }
    return out(pick);
  };
}

const rubric: ResolvedJudgeRubric = {
  rubricId: 'r1',
  dimensions: [
    { criteriaId: 'c1', name: 'Clarity', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 0.5 },
    { criteriaId: 'c2', name: 'Depth', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 0.5 },
  ],
};

function pair(o: Partial<JudgeEvalPair> = {}): JudgeEvalPair {
  return {
    label: 'art#1',
    pair_kind: 'article',
    variant_a_id: '00000000-0000-4000-8000-000000000001',
    variant_b_id: '00000000-0000-4000-8000-000000000002',
    text_a: 'WINNER text',
    text_b: 'loser text',
    mu_a: 30,
    mu_b: 20,
    sigma_a: 1,
    sigma_b: 1,
    expected_winner: 'A',
    gap_kind: 'large',
    baseline_confidence: 0.9,
    ...o,
  };
}

describe('evaluatePairAgreement (engine over fake judge)', () => {
  it('pairs holistic + rubric and agrees when both pick the same text', async () => {
    const rows = await evaluatePairAgreement(pair(), rubric, 2, fakeJudge('WINNER'));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.holistic_winner).toBe('A');
      expect(r.rubric_winner).toBe('A');
      expect(r.rubric_matches_holistic).toBe(true);
      expect(r.error).toBeNull();
      expect(r.cost_usd).toBeCloseTo(0.004); // 4 calls × 0.001
      expect(r.criterionVerdicts).toHaveLength(2);
      for (const cv of r.criterionVerdicts) {
        expect(cv.agrees_with_holistic).toBe(true);
        expect(cv.matches_ground_truth).toBe(true); // large gap, A correct
      }
    }
  });

  it('errored pair surfaces partialResults and stops the pair', async () => {
    const boom: JudgeFn = async () => {
      throw new Error('provider exploded');
    };
    await expect(evaluatePairAgreement(pair(), rubric, 3, boom)).rejects.toMatchObject({
      message: 'provider exploded',
    });
  });

  it('runAgreementOverPairs returns one row per pair·repeat', async () => {
    const rows = await runAgreementOverPairs(
      [pair({ label: 'a#1' }), pair({ label: 'a#2' })],
      rubric,
      2,
      fakeJudge('WINNER'),
    );
    expect(rows).toHaveLength(4);
  });
});
