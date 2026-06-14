// Unit tests for the judge-ensemble aggregation rules + registry. Covers the locked
// first_decisive semantics (lone decisive resolves; confident TIE abstains; all-abstain -> TIE),
// the >=2-agree rule, confidence_weighted, and ruleId@version lookup / unknown-version handling.

import type { SubVerdict, Verdict } from './types';
import { isDecisiveVote, tally } from './types';
import {
  firstDecisive,
  unanimousAmongDecisive,
  confidenceWeighted,
  getAggregationRule,
  listAggregationRules,
  DEFAULT_AGGREGATION_RULE,
} from './aggregation';

function sub(
  winner: Verdict | null,
  confidence: number,
  step = 0,
  overrides: Partial<SubVerdict> = {},
): SubVerdict {
  return {
    sourceKind: 'judge',
    sourceId: `m${step}`,
    winner,
    confidence,
    weight: 1,
    escalationStep: step,
    triggeredEscalation: false,
    ...overrides,
  };
}

describe('isDecisiveVote / tally', () => {
  it('counts A/B above the 0.6 threshold as votes; TIE/null/<=0.6 abstain', () => {
    expect(isDecisiveVote(sub('A', 1.0))).toBe(true);
    expect(isDecisiveVote(sub('B', 0.7))).toBe(true);
    expect(isDecisiveVote(sub('A', 0.6))).toBe(false); // strictly greater than 0.6
    expect(isDecisiveVote(sub('A', 0.5))).toBe(false);
    expect(isDecisiveVote(sub('TIE', 1.0))).toBe(false); // confident TIE abstains
    expect(isDecisiveVote(sub(null, 0.3))).toBe(false);
  });

  it('tallies votes and abstentions', () => {
    expect(tally([sub('A', 1.0), sub('B', 0.7), sub('TIE', 1.0), sub(null, 0)])).toEqual({
      votesA: 1,
      votesB: 1,
      abstains: 2,
    });
  });
});

describe('first_decisive (live default)', () => {
  it('is the exported default', () => {
    expect(DEFAULT_AGGREGATION_RULE.id).toBe('first_decisive');
  });

  it('a lone decisive vote among abstentions resolves the match (TIE, TIE, A -> A)', () => {
    const r = firstDecisive.aggregate([sub('TIE', 0.5, 0), sub('TIE', 0.5, 1), sub('A', 1.0, 2)]);
    expect(r.winner).toBe('A');
    expect(r.confidence).toBe(1.0);
    expect(r.breakdown).toMatchObject({ votesA: 1, votesB: 0, abstains: 2, dissenters: 0 });
  });

  it('takes the FIRST decisive vote by escalation step', () => {
    const r = firstDecisive.aggregate([sub('B', 0.7, 1), sub('A', 1.0, 2)]);
    expect(r.winner).toBe('B');
    expect(r.confidence).toBe(0.7);
  });

  it('all judges abstain -> TIE at confidence 0 (a draw)', () => {
    const r = firstDecisive.aggregate([sub('TIE', 0.5, 0), sub(null, 0, 1), sub('TIE', 1.0, 2)]);
    expect(r.winner).toBe('TIE');
    expect(r.confidence).toBe(0);
  });

  it('a confident TIE does not resolve the match (it abstains)', () => {
    const r = firstDecisive.aggregate([sub('TIE', 1.0, 0)]);
    expect(r.winner).toBe('TIE');
    expect(r.confidence).toBe(0);
  });
});

describe('unanimous_among_decisive (>=2 agree)', () => {
  it('resolves when >=2 decisive judges agree and none dissent', () => {
    const r = unanimousAmongDecisive.aggregate([sub('A', 1.0, 0), sub('A', 0.7, 1)]);
    expect(r.winner).toBe('A');
    expect(r.confidence).toBe(1.0);
  });

  it('a lone decisive vote is NOT enough -> TIE', () => {
    const r = unanimousAmongDecisive.aggregate([sub('TIE', 0.5, 0), sub('A', 1.0, 1)]);
    expect(r.winner).toBe('TIE');
  });

  it('conflicting decisive votes -> TIE at confidence 0.5', () => {
    const r = unanimousAmongDecisive.aggregate([sub('A', 1.0, 0), sub('B', 1.0, 1)]);
    expect(r.winner).toBe('TIE');
    expect(r.confidence).toBe(0.5);
    expect(r.breakdown.dissenters).toBe(0); // winner is TIE, so neither side "dissents"
  });
});

describe('confidence_weighted', () => {
  it('resolves to the heavier side when the margin clears the threshold', () => {
    const r = confidenceWeighted.aggregate([sub('A', 1.0, 0), sub('A', 1.0, 1), sub('B', 0.7, 2)]);
    expect(r.winner).toBe('A'); // 2.0 vs 0.7, margin 1.3 >= 0.7
  });

  it('a thin margin stays TIE', () => {
    const r = confidenceWeighted.aggregate([sub('A', 0.7, 0), sub('B', 0.7, 1)]);
    expect(r.winner).toBe('TIE');
  });
});

describe('registry', () => {
  it('resolves a known rule by id@version', () => {
    expect(getAggregationRule('first_decisive', 1)).toBe(firstDecisive);
    expect(getAggregationRule('unanimous_among_decisive', 1)).toBe(unanimousAmongDecisive);
  });

  it('throws (fails closed) on an unknown rule or version', () => {
    expect(() => getAggregationRule('first_decisive', 99)).toThrow(/Unknown aggregation rule/);
    expect(() => getAggregationRule('does_not_exist', 1)).toThrow(/Unknown aggregation rule/);
  });

  it('lists all registered rules', () => {
    const ids = listAggregationRules().map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(['first_decisive', 'unanimous_among_decisive', 'confidence_weighted']),
    );
  });
});
