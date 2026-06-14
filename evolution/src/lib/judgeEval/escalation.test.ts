// Unit tests for the escalation evaluator: stop-on-resolve, escalate-on-abstain, cap, per-submatch
// audit capture, transient-failure-as-abstention, and fatal-error propagation. Uses a fake
// makeJudge (no LLM/DB). The fake distinguishes forward vs reverse passes by which text appears first.

import { GlobalBudgetExceededError } from '@/lib/errors/serviceError';
import { firstDecisive, unanimousAmongDecisive } from '../shared/judgeEnsemble/aggregation';
import { evaluatePairWithEscalation, type EscalationConfig } from './escalation';
import type { JudgeFn, JudgeCallOutput } from './runJudgeEval';
import type { JudgeEvalPair } from './schemas';

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
