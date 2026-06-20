// Unit tests for the escalation evaluator: stop-on-resolve, escalate-on-abstain, cap, per-submatch
// audit capture, transient-failure-as-abstention, and fatal-error propagation. Uses a fake
// makeJudge (no LLM/DB). The fake distinguishes forward vs reverse passes by which text appears first.

import { GlobalBudgetExceededError } from '@/lib/errors/serviceError';
import { firstDecisive, unanimousAmongDecisive, criteriaWeighted } from '../shared/judgeEnsemble/aggregation';
import { evaluatePairWithEscalation, type EscalationConfig } from './escalation';
import type { JudgeFn, JudgeCallOutput } from './runJudgeEval';
import type { JudgeEvalPair } from './schemas';
import type { ResolvedJudgeRubric } from '../shared/rubricJudge';

function mkPair(kind: 'article' | 'paragraph' = 'article'): JudgeEvalPair {
  return {
    label: 'p1',
    pair_kind: kind,
    variant_a_id: '00000000-0000-4000-8000-000000000001',
    variant_b_id: '00000000-0000-4000-8000-000000000002',
    text_a: 'AAA',
    text_b: 'BBB',
    mu_a: null,
    mu_b: null,
    sigma_a: null,
    sigma_b: null,
    expected_winner: null,
    gap_kind: 'close',
    baseline_confidence: null,
  };
}

interface Behavior {
  forward: string;
  reverse: string;
  cost?: number;
  throwErr?: Error;
}

function fakeMakeJudge(behavior: Record<string, Behavior>): (model: string) => JudgeFn {
  return (model: string): JudgeFn => async (prompt: string): Promise<JudgeCallOutput> => {
    const b = behavior[model];
    if (!b) throw new Error(`no behavior for model ${model}`);
    if (b.throwErr) throw b.throwErr;
    const isForward = prompt.indexOf('AAA') < prompt.indexOf('BBB');
    return {
      text: isForward ? b.forward : b.reverse,
      costUsd: b.cost ?? 0.001,
      promptTokens: 10,
      outputTokens: 1,
      reasoningTokens: 0,
    };
  };
}

// A judge that picks the genuinely-better text A: forward='A' (A in slot A), reverse='B' (A in slot B).
const DECISIVE_A: Behavior = { forward: 'A', reverse: 'B' };
// A position-first-biased judge: always picks slot A -> forward='A', reverse='A' -> forced TIE @ 0.5.
const ABSTAIN: Behavior = { forward: 'A', reverse: 'A' };

const cfg = (chainModels: string[], rule = firstDecisive): EscalationConfig => ({ chainModels, rule });

describe('evaluatePairWithEscalation (first_decisive)', () => {
  it('stops at the first decisive judge (chain-of-1)', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      cfg(['m1', 'm2', 'm3']),
      fakeMakeJudge({ m1: DECISIVE_A, m2: DECISIVE_A, m3: DECISIVE_A }),
    );
    expect(out.consolidated.winner).toBe('A');
    expect(out.submatches).toHaveLength(1);
    expect(out.submatches[0]?.triggeredEscalation).toBe(false);
  });

  it('escalates past an abstaining first judge then resolves', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      cfg(['m1', 'm2', 'm3']),
      fakeMakeJudge({ m1: ABSTAIN, m2: DECISIVE_A, m3: DECISIVE_A }),
    );
    expect(out.consolidated.winner).toBe('A');
    expect(out.submatches).toHaveLength(2);
    expect(out.submatches.map((s) => s.triggeredEscalation)).toEqual([true, false]);
    expect(out.submatches[0]?.confidence).toBe(0.5); // forced TIE
    expect(out.submatches[1]?.confidence).toBe(1.0); // both passes agree A
  });

  it('all judges abstain through the cap -> TIE', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      cfg(['m1', 'm2', 'm3']),
      fakeMakeJudge({ m1: ABSTAIN, m2: ABSTAIN, m3: ABSTAIN }),
    );
    expect(out.consolidated.winner).toBe('TIE');
    expect(out.submatches).toHaveLength(3);
  });

  it('captures per-submatch audit (cost summed over both passes, raw text)', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      cfg(['m1']),
      fakeMakeJudge({ m1: { ...DECISIVE_A, cost: 0.002 } }),
    );
    const s = out.submatches[0]!;
    expect(s.costUsd).toBeCloseTo(0.004, 6); // 0.002 forward + 0.002 reverse
    expect(s.forwardRaw).toBe('A');
    expect(s.reverseRaw).toBe('B');
    expect(s.promptTokens).toBe(20);
  });
});

describe('evaluatePairWithEscalation (failure handling)', () => {
  it('treats a transient (post-retry) failure as an abstention and escalates', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      cfg(['m1', 'm2']),
      fakeMakeJudge({ m1: { ...ABSTAIN, throwErr: new Error('timeout') }, m2: DECISIVE_A }),
    );
    expect(out.consolidated.winner).toBe('A');
    expect(out.submatches).toHaveLength(2);
    expect(out.submatches[0]?.error).toBe('timeout');
    expect(out.submatches[0]?.winner).toBe('TIE');
  });

  it('propagates a fatal budget error (never silently abstains/keeps spending)', async () => {
    await expect(
      evaluatePairWithEscalation(
        mkPair(),
        cfg(['m1', 'm2']),
        fakeMakeJudge({ m1: { ...DECISIVE_A, throwErr: new GlobalBudgetExceededError('budget') }, m2: DECISIVE_A }),
      ),
    ).rejects.toThrow(/budget/);
  });
});

describe('evaluatePairWithEscalation (unanimous_among_decisive)', () => {
  it('escalates until two judges agree', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      cfg(['m1', 'm2', 'm3'], unanimousAmongDecisive),
      fakeMakeJudge({ m1: DECISIVE_A, m2: ABSTAIN, m3: DECISIVE_A }),
    );
    expect(out.consolidated.winner).toBe('A');
    expect(out.submatches).toHaveLength(3);
    expect(out.consolidated.breakdown.votesA).toBe(2);
  });
});

describe('evaluatePairWithEscalation (rubric mode)', () => {
  const RUBRIC: ResolvedJudgeRubric = {
    rubricId: 'rub-1',
    dimensions: [
      { criteriaId: 'c1', name: 'clarity', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 0.5 },
      { criteriaId: 'c2', name: 'depth', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 0.5 },
    ],
  };

  // Per-dimension verdict text; the fake picks forward vs reverse by which text appears first.
  function fakeRubricJudge(behavior: Record<string, { forward: string; reverse: string }>): (m: string) => JudgeFn {
    return (model: string): JudgeFn => async (prompt: string): Promise<JudgeCallOutput> => {
      const b = behavior[model];
      if (!b) throw new Error(`no behavior for ${model}`);
      const isForward = prompt.indexOf('AAA') < prompt.indexOf('BBB');
      return { text: isForward ? b.forward : b.reverse, costUsd: 0.001, promptTokens: 30, outputTokens: 5, reasoningTokens: 0 };
    };
  }

  it('produces a per-dimension breakdown + resolves the match', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      { chainModels: ['m1'], rule: firstDecisive, rubric: RUBRIC },
      fakeRubricJudge({ m1: { forward: 'clarity: A\ndepth: A', reverse: 'clarity: B\ndepth: B' } }),
    );
    expect(out.consolidated.winner).toBe('A');
    const s = out.submatches[0]!;
    expect(s.judgeRubricId).toBe('rub-1');
    expect(s.rubricBreakdown?.dimensions.map((d) => d.name)).toEqual(['clarity', 'depth']);
    expect(s.winner).toBe('A');
    expect(s.confidence).toBe(1.0);
  });

  it('escalates past an abstaining rubric submatch (position-biased -> TIE 0.5)', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      { chainModels: ['m1', 'm2'], rule: firstDecisive, rubric: RUBRIC },
      fakeRubricJudge({
        m1: { forward: 'clarity: A\ndepth: A', reverse: 'clarity: A\ndepth: A' }, // both passes pick slot A -> TIE
        m2: { forward: 'clarity: A\ndepth: A', reverse: 'clarity: B\ndepth: B' }, // decisive A
      }),
    );
    expect(out.consolidated.winner).toBe('A');
    expect(out.submatches).toHaveLength(2);
    expect(out.submatches[0]?.confidence).toBe(0.5);
    expect(out.submatches[1]?.rubricBreakdown?.dimensions).toHaveLength(2);
  });
});

describe('evaluatePairWithEscalation (criteria_split planner)', () => {
  const RUBRIC = (wClarity: number, wDepth: number): ResolvedJudgeRubric => ({
    rubricId: 'rub-cs',
    dimensions: [
      { criteriaId: 'c1', name: 'clarity', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: wClarity },
      { criteriaId: 'c2', name: 'depth', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: wDepth },
    ],
  });

  // model -> (criterionName -> {f,r}) as-shown verdicts. Each criteria_split prompt names exactly
  // one dimension (single-criterion sub-rubric), so the fake answers about whichever it sees.
  function fakeCriteriaJudge(
    behavior: Record<string, Record<string, { f: string; r: string }>>,
  ): (m: string) => JudgeFn {
    return (model: string): JudgeFn => async (prompt: string): Promise<JudgeCallOutput> => {
      const b = behavior[model];
      if (!b) throw new Error(`no behavior for ${model}`);
      const name = Object.keys(b).find((n) => prompt.includes(n));
      if (!name) throw new Error(`no criterion named in prompt for ${model}`);
      const isForward = prompt.indexOf('AAA') < prompt.indexOf('BBB');
      const v = isForward ? b[name]!.f : b[name]!.r;
      return { text: `${name}: ${v}`, costUsd: 0.001, promptTokens: 30, outputTokens: 5, reasoningTokens: 0 };
    };
  }

  it('runs ONE submatch per criterion (no early stop), round-robins models, folds by weight', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      { chainModels: ['m1', 'm2'], rule: criteriaWeighted, rubric: RUBRIC(0.7, 0.3), planner: 'criteria_split' },
      fakeCriteriaJudge({
        m1: { clarity: { f: 'A', r: 'B' } }, // clarity decisive A (round-robin: c1 -> m1)
        m2: { depth: { f: 'B', r: 'A' } }, // depth decisive B   (round-robin: c2 -> m2)
      }),
    );
    // every criterion runs even though clarity alone is decisive
    expect(out.submatches).toHaveLength(2);
    expect(out.submatches.map((s) => s.sourceKind)).toEqual(['criterion', 'criterion']);
    expect(out.submatches.map((s) => s.criteriaId)).toEqual(['c1', 'c2']);
    expect(out.submatches.map((s) => s.model)).toEqual(['m1', 'm2']); // round-robin assignment
    expect(out.submatches.map((s) => s.weight)).toEqual([0.7, 0.3]);
    expect(out.submatches.every((s) => s.rubricBreakdown?.dimensions.length === 1)).toBe(true);
    // weighted fold: clarity(0.7)=A vs depth(0.3)=B -> A, confidence = 0.7/1.0
    expect(out.consolidated.winner).toBe('A');
    expect(out.consolidated.confidence).toBeCloseTo(0.7, 6);
  });

  it('an even weighted split across criteria is a TIE', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      { chainModels: ['m1'], rule: criteriaWeighted, rubric: RUBRIC(0.5, 0.5), planner: 'criteria_split' },
      fakeCriteriaJudge({
        m1: { clarity: { f: 'A', r: 'B' }, depth: { f: 'B', r: 'A' } }, // clarity A, depth B, equal weight
      }),
    );
    expect(out.submatches).toHaveLength(2);
    expect(out.consolidated.winner).toBe('TIE');
  });

  it('routes a criterion to an explicit model; an abstaining criterion drops out of the fold', async () => {
    const out = await evaluatePairWithEscalation(
      mkPair(),
      {
        chainModels: ['m1'],
        rule: criteriaWeighted,
        rubric: RUBRIC(0.5, 0.5),
        planner: 'criteria_split',
        criteriaModelMap: { c2: 'specialist' },
      },
      fakeCriteriaJudge({
        m1: { clarity: { f: 'A', r: 'B' } }, // clarity decisive A (default model)
        specialist: { depth: { f: 'A', r: 'A' } }, // depth position-biased -> TIE, abstains
      }),
    );
    expect(out.submatches[0]?.model).toBe('m1');
    expect(out.submatches[1]?.model).toBe('specialist'); // explicit map honored
    expect(out.submatches[1]?.confidence).toBe(0.5); // abstained
    // only clarity decides -> winner A at full share of the decided weight
    expect(out.consolidated.winner).toBe('A');
    expect(out.consolidated.confidence).toBeCloseTo(1.0, 6);
  });

  it('throws if criteria_split is selected without a rubric', async () => {
    await expect(
      evaluatePairWithEscalation(
        mkPair(),
        { chainModels: ['m1'], rule: criteriaWeighted, planner: 'criteria_split' },
        fakeCriteriaJudge({}),
      ),
    ).rejects.toThrow(/criteria_split requires a rubric/);
  });
});
