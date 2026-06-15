// Unit tests for the Phase 4 ensembleRunner seam on compareWithBiasMitigation: byte-identical to the
// single-judge path when unset; multi-model escalation chain (stop-on-decisive) + submatches when set;
// cache key separation + clone-on-hit. Fake makeJudge (no real LLM).

import {
  compareWithBiasMitigation,
  type ComparisonResult,
  type EnsembleRunner,
} from './computeRatings';
import { firstDecisive } from './judgeEnsemble/aggregation';
import type { EscalationChain } from './judgeEnsemble/planner';

// model -> {f,r} verdict; the fake distinguishes forward vs reverse by which text appears first.
function makeJudge(behaviors: Record<string, { f: string; r: string }>): (m: string) => (p: string) => Promise<string> {
  return (model: string) => async (prompt: string): Promise<string> => {
    const b = behaviors[model];
    if (!b) throw new Error(`no behavior for ${model}`);
    return prompt.indexOf('AAA') < prompt.indexOf('BBB') ? b.f : b.r;
  };
}

const CHAIN: EscalationChain = { id: 'chain-1', cap: 3, models: { article: ['m1', 'm2', 'm3'], paragraph: [] } };

function runner(behaviors: Record<string, { f: string; r: string }>, chain: EscalationChain = CHAIN): EnsembleRunner {
  return { makeJudge: makeJudge(behaviors), chain, rule: firstDecisive };
}

// A single-judge callLLM (used as the fallback path / byte-identical baseline).
function single(responses: string[]): (p: string) => Promise<string> {
  let i = 0;
  return async () => responses[i++ % responses.length]!;
}

describe('compareWithBiasMitigation — ensembleRunner UNSET (byte-identical)', () => {
  it('produces the legacy result with NO submatches field', async () => {
    const result = await compareWithBiasMitigation('AAA', 'BBB', single(['A', 'B']));
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
    expect(result.turns).toBe(2);
    expect(result.submatches).toBeUndefined();
  });

  it('a cache hit returns the identical object reference (no cloning) when not an ensemble', async () => {
    const cache = new Map<string, ComparisonResult>();
    const first = await compareWithBiasMitigation('AAA', 'BBB', single(['A', 'B']), cache);
    const second = await compareWithBiasMitigation('AAA', 'BBB', single(['A', 'B']), cache);
    expect(second).toBe(first); // same reference — byte-identical cache behavior preserved
  });
});

describe('compareWithBiasMitigation — ensembleRunner SET', () => {
  it('stops at the first decisive judge (chain-of-1) and attaches submatches', async () => {
    const result = await compareWithBiasMitigation(
      'AAA', 'BBB', single(['x']), undefined, 'article', undefined,
      runner({ m1: { f: 'A', r: 'B' } }), // m1 decisive A
    );
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
    expect(result.submatches?.members).toHaveLength(1);
    expect(result.submatches?.members[0]?.model).toBe('m1');
    expect(result.submatches?.chainConfigId).toBe('chain-1');
    expect(result.submatches?.ruleId).toBe('first_decisive');
    expect(result.submatches?.members[0]?.triggeredEscalation).toBe(false);
  });

  it('escalates past an abstaining judge; flags triggeredEscalation on all but the last', async () => {
    const result = await compareWithBiasMitigation(
      'AAA', 'BBB', single(['x']), undefined, 'article', undefined,
      runner({
        m1: { f: 'A', r: 'A' }, // position-biased -> TIE 0.5 -> abstain
        m2: { f: 'B', r: 'A' }, // decisive B
      }),
    );
    expect(result.winner).toBe('B');
    expect(result.submatches?.members).toHaveLength(2);
    expect(result.submatches?.members.map((m) => m.model)).toEqual(['m1', 'm2']);
    expect(result.submatches?.members[0]?.triggeredEscalation).toBe(true);
    expect(result.submatches?.members[1]?.triggeredEscalation).toBe(false);
    expect(result.turns).toBe(4); // 2 judges x 2 passes
  });

  it('falls back to the single callLLM (no submatches) when the chain has no models for the mode', async () => {
    // paragraph chain is empty -> fall back to the caller's single judge
    const result = await compareWithBiasMitigation(
      'AAA', 'BBB', single(['A', 'B']), undefined, 'paragraph', undefined,
      runner({ m1: { f: 'A', r: 'B' } }),
    );
    expect(result.winner).toBe('A');
    expect(result.submatches).toBeUndefined();
  });

  it('clones submatch members on a cache hit so each match keeps its own rows', async () => {
    const cache = new Map<string, ComparisonResult>();
    const r = runner({ m1: { f: 'A', r: 'B' } });
    const first = await compareWithBiasMitigation('AAA', 'BBB', single(['x']), cache, 'article', undefined, r);
    const second = await compareWithBiasMitigation('AAA', 'BBB', single(['x']), cache, 'article', undefined, r);
    expect(second).not.toBe(first); // cloned, not the same reference
    expect(second.submatches?.members).not.toBe(first.submatches?.members);
    expect(second.submatches?.members[0]).toEqual(first.submatches?.members[0]); // same data
  });

  it('ensemble and single-judge verdicts do NOT collide in a shared cache (distinct keys)', async () => {
    const cache = new Map<string, ComparisonResult>();
    // single-judge first writes a TIE-ish result; ensemble must NOT read it back.
    await compareWithBiasMitigation('AAA', 'BBB', single(['A', 'A']), cache); // single -> TIE 0.5
    const ens = await compareWithBiasMitigation(
      'AAA', 'BBB', single(['x']), cache, 'article', undefined,
      runner({ m1: { f: 'A', r: 'B' } }),
    );
    expect(ens.submatches).toBeDefined(); // computed fresh, not the cached single-judge TIE
    expect(ens.winner).toBe('A');
  });
});
