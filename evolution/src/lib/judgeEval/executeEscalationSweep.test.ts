// Unit tests for runEscalationOverPairs (the pure per-pair escalation orchestration): one row per
// submatch, group keys per (pair, repeat), mode-aware model selection. Fake makeJudge (no LLM/DB).

import { runEscalationOverPairs, type EscalationChainSpec } from './executeEscalationSweep';
import type { JudgeFn, JudgeCallOutput } from './runJudgeEval';
import type { JudgeEvalPair } from './schemas';
import type { ResolvedJudgeRubric } from '../shared/rubricJudge';

function mkPair(label: string, kind: 'article' | 'paragraph'): JudgeEvalPair {
  return {
    label,
    pair_kind: kind,
    variant_a_id: '00000000-0000-4000-8000-0000000000a1',
    variant_b_id: '00000000-0000-4000-8000-0000000000b2',
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

// model -> {forward, reverse} verdict text; fake distinguishes pass by which text appears first.
function fakeMakeJudge(behavior: Record<string, { forward: string; reverse: string }>): (m: string) => JudgeFn {
  return (model: string): JudgeFn => async (prompt: string): Promise<JudgeCallOutput> => {
    const b = behavior[model];
    if (!b) throw new Error(`no behavior for ${model}`);
    const isForward = prompt.indexOf('AAA') < prompt.indexOf('BBB');
    return { text: isForward ? b.forward : b.reverse, costUsd: 0.001, promptTokens: 10, outputTokens: 1, reasoningTokens: 0 };
  };
}

const chain: EscalationChainSpec = {
  name: 'test-chain',
  article: ['art1', 'art2'],
  paragraph: ['para1', 'para2'],
  rule: 'first_decisive',
  ruleVersion: 1,
  cap: 3,
};

describe('runEscalationOverPairs', () => {
  it('emits one row per submatch and picks the mode-appropriate chain', async () => {
    const { callRows: rows } = await runEscalationOverPairs(
      [mkPair('art#1', 'article'), mkPair('para#1', 'paragraph')],
      chain,
      1,
      fakeMakeJudge({
        art1: { forward: 'A', reverse: 'B' }, // decisive at step 0 -> 1 article submatch
        para1: { forward: 'A', reverse: 'A' }, // abstain -> escalate
        para2: { forward: 'B', reverse: 'A' }, // decisive B at step 1 -> 2 paragraph submatches
      }),
    );
    // article pair: 1 submatch (art1 decisive); paragraph pair: 2 submatches (para1 abstain -> para2)
    expect(rows).toHaveLength(3);
    const article = rows.filter((r) => r.pair_kind === 'article');
    const paragraph = rows.filter((r) => r.pair_kind === 'paragraph');
    expect(article.map((r) => r.judge_model)).toEqual(['art1']);
    expect(paragraph.map((r) => r.judge_model)).toEqual(['para1', 'para2']);
    expect(paragraph[0]?.triggered_escalation).toBe(true);
    expect(paragraph[1]?.triggered_escalation).toBe(false);
  });

  it('groups submatches of a match by (pair, repeat) and separates repeats', async () => {
    const { callRows: rows } = await runEscalationOverPairs(
      [mkPair('art#1', 'article')],
      chain,
      2,
      fakeMakeJudge({ art1: { forward: 'A', reverse: 'A' }, art2: { forward: 'A', reverse: 'A' } }), // all abstain
    );
    // 1 pair x 2 repeats x 2 judges (both abstain -> chain runs to cap-of-available=2) = 4 rows
    expect(rows).toHaveLength(4);
    const groups = new Set(rows.map((r) => r.submatch_group_key));
    expect(groups).toEqual(new Set(['art#1#0', 'art#1#1']));
  });

  it('criteria_split: emits one call row + one dimension row per criterion, folded by weight', async () => {
    const rubric: ResolvedJudgeRubric = {
      rubricId: 'r-cs',
      dimensions: [
        { criteriaId: 'c1', name: 'clarity', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 0.5 },
        { criteriaId: 'c2', name: 'depth', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 0.5 },
      ],
    };
    // Single-criterion prompts name exactly one dimension; both criteria decide A (forward A / reverse B).
    const judge = (): JudgeFn => async (prompt: string): Promise<JudgeCallOutput> => {
      const name = prompt.includes('clarity') ? 'clarity' : 'depth';
      const v = prompt.indexOf('AAA') < prompt.indexOf('BBB') ? 'A' : 'B';
      return { text: `${name}: ${v}`, costUsd: 0.001, promptTokens: 10, outputTokens: 1, reasoningTokens: 0 };
    };
    const csChain: EscalationChainSpec = {
      name: 'cs', article: ['m1'], paragraph: [], rule: 'criteria_weighted', ruleVersion: 1, cap: 3, planner: 'criteria_split',
    };
    const { callRows, dimensionRows } = await runEscalationOverPairs(
      [mkPair('art#1', 'article')],
      csChain,
      1,
      judge,
      undefined,
      rubric,
    );
    expect(callRows).toHaveLength(2); // one submatch per criterion (not a ladder)
    expect(callRows.map((r) => r.judge_model)).toEqual(['m1', 'm1']);
    expect(callRows.every((r) => r.escalation_step >= 0)).toBe(true);
    expect(dimensionRows).toHaveLength(2); // one dimension row per criterion submatch
    expect(dimensionRows.map((d) => d.criteria_name)).toEqual(['clarity', 'depth']);
    expect(dimensionRows.map((d) => d.weight)).toEqual([0.5, 0.5]);
    // both criteria favored A (the consolidated winner) -> favored_match_winner true
    expect(dimensionRows.every((d) => d.favored_match_winner === true)).toBe(true);
  });

  it('skips a pair whose mode has no chain models', async () => {
    const noPara: EscalationChainSpec = { ...chain, paragraph: [] };
    const { callRows: rows } = await runEscalationOverPairs(
      [mkPair('para#1', 'paragraph')],
      noPara,
      1,
      fakeMakeJudge({}),
    );
    expect(rows).toHaveLength(0);
  });
});
