// Unit tests for the Agreement Sweep reducer: the three TIE buckets [O2], per-pair-modal vs
// per-repeat agreement [O1], per-criterion agreement + abstain [O2], and ground-truth accuracy on
// large-gap pairs only [O5], plus degenerate inputs (empty / zero-criteria / all-TIE).

import {
  computeAgreementMetrics,
  DECISIVE_THRESHOLD,
  type AgreementCallMetricsInput,
  type AgreementCriterionMetricsInput,
} from './agreementMetrics';

function call(o: Partial<AgreementCallMetricsInput>): AgreementCallMetricsInput {
  return {
    pair_label: 'art#1',
    repeat_index: 0,
    holistic_winner: 'A',
    holistic_confidence: 1.0,
    rubric_winner: 'A',
    rubric_confidence: 1.0,
    gap_kind: null,
    expected_winner: null,
    ...o,
  };
}

function crit(o: Partial<AgreementCriterionMetricsInput>): AgreementCriterionMetricsInput {
  return {
    criteria_name: 'Clarity',
    weight: 0.5,
    agrees_with_holistic: true,
    matches_ground_truth: null,
    ...o,
  };
}

describe('computeAgreementMetrics', () => {
  it('threshold parity with the live decisive metric', () => {
    expect(DECISIVE_THRESHOLD).toBe(0.6);
  });

  it('empty input → zero/null, no throw', () => {
    const m = computeAgreementMetrics([], []);
    expect(m.n).toBe(0);
    expect(m.nPairs).toBe(0);
    expect(m.perRepeatAgreeRate).toBe(0);
    expect(m.perPairModalAgreeRate).toBeNull();
    expect(m.bothDecisiveAgreeRate).toBeNull();
    expect(m.holisticAccuracy).toBeNull();
    expect(m.perCriterion).toEqual([]);
  });

  it('all agree → strict + per-repeat 1.0', () => {
    const calls = [call({}), call({ pair_label: 'art#2' })];
    const m = computeAgreementMetrics(calls, []);
    expect(m.perRepeatAgreeRate).toBe(1);
    expect(m.perPairModalAgreeRate).toBe(1);
    expect(m.bothDecisiveAgreeRate).toBe(1);
  });

  it('both-decisive bucket excludes TIE/low-confidence rows', () => {
    const calls = [
      // both decisive, agree
      call({ holistic_winner: 'A', rubric_winner: 'A', holistic_confidence: 1.0, rubric_confidence: 1.0 }),
      // both decisive, opposite
      call({ pair_label: 'p2', holistic_winner: 'A', rubric_winner: 'B', holistic_confidence: 1.0, rubric_confidence: 0.7 }),
      // holistic TIE (0.5) — not both-decisive
      call({ pair_label: 'p3', holistic_winner: 'TIE', rubric_winner: 'B', holistic_confidence: 0.5, rubric_confidence: 0.7 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    // both-decisive set = first two → 1 of 2 agree
    expect(m.bothDecisiveAgreeRate).toBeCloseTo(0.5);
    expect(m.bothDecisiveOppositeRate).toBeCloseTo(0.5);
    // strict over all 3 calls = 1 agree / 3
    expect(m.perRepeatAgreeRate).toBeCloseTo(1 / 3);
  });

  it('abstain/divergence = exactly one decisive', () => {
    const calls = [
      // both decisive
      call({ holistic_confidence: 1.0, rubric_confidence: 1.0 }),
      // holistic decisive, rubric TIE (0.5) → exactly one decisive
      call({ pair_label: 'p2', holistic_confidence: 1.0, rubric_winner: 'TIE', rubric_confidence: 0.5 }),
      // neither decisive
      call({ pair_label: 'p3', holistic_winner: 'TIE', holistic_confidence: 0.5, rubric_winner: 'TIE', rubric_confidence: 0.5 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.abstainDivergenceRate).toBeCloseTo(1 / 3);
  });

  it('per-pair-modal collapses repeats before comparing [O1]', () => {
    // One pair, 3 repeats: holistic modal A (A,A,B), rubric modal B (B,B,A). Modal differs → 0 agree.
    const calls = [
      call({ pair_label: 'p', repeat_index: 0, holistic_winner: 'A', rubric_winner: 'B' }),
      call({ pair_label: 'p', repeat_index: 1, holistic_winner: 'A', rubric_winner: 'B' }),
      call({ pair_label: 'p', repeat_index: 2, holistic_winner: 'B', rubric_winner: 'A' }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.nPairs).toBe(1);
    expect(m.perPairModalAgreeRate).toBe(0);
    // per-repeat: agree only when labels equal → 0 of 3
    expect(m.perRepeatAgreeRate).toBe(0);
  });

  it('disagreement direction split', () => {
    const calls = [
      call({ rubric_winner: 'A', holistic_winner: 'B' }),
      call({ pair_label: 'p2', rubric_winner: 'B', holistic_winner: 'A' }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.rubricAHolisticBRate).toBeCloseTo(0.5);
    expect(m.rubricBHolisticARate).toBeCloseTo(0.5);
  });

  it('ground-truth accuracy counts large-gap decisive rows only [O5]', () => {
    const calls = [
      // large gap, both decisive, holistic right (A=expected), rubric wrong (B)
      call({ gap_kind: 'large', expected_winner: 'A', holistic_winner: 'A', rubric_winner: 'B', holistic_confidence: 1.0, rubric_confidence: 1.0 }),
      // close pair — excluded from accuracy entirely
      call({ pair_label: 'p2', gap_kind: 'close', expected_winner: null, holistic_winner: 'A', rubric_winner: 'A' }),
      // large gap but holistic indecisive (TIE) → excluded from holistic accuracy denom
      call({ pair_label: 'p3', gap_kind: 'large', expected_winner: 'B', holistic_winner: 'TIE', holistic_confidence: 0.5, rubric_winner: 'B', rubric_confidence: 1.0 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.nLargeGap).toBe(2);
    expect(m.holisticAccuracy).toBe(1); // 1 decisive large-gap holistic row, correct
    expect(m.rubricAccuracy).toBeCloseTo(0.5); // 2 decisive large-gap rubric rows, 1 correct (the B)
    expect(m.accuracyDelta).toBeCloseTo(-0.5);
  });

  it('per-criterion: TIE abstains are excluded from the agree denominator [O2]', () => {
    const criteria = [
      crit({ criteria_name: 'Clarity', agrees_with_holistic: true }),
      crit({ criteria_name: 'Clarity', agrees_with_holistic: false }),
      crit({ criteria_name: 'Clarity', agrees_with_holistic: null }), // abstain (TIE)
    ];
    const m = computeAgreementMetrics([call({})], criteria);
    const clarity = m.perCriterion.find((c) => c.name === 'Clarity')!;
    expect(clarity.n).toBe(3);
    expect(clarity.agreeRate).toBeCloseTo(0.5); // 1 agree / 2 decided (abstain excluded)
    expect(clarity.disagreeRate).toBeCloseTo(0.5);
    expect(clarity.abstainRate).toBeCloseTo(1 / 3);
  });

  it('all-TIE pair: strict agree counts (TIE==TIE) but neither is decisive', () => {
    const calls = [
      call({ pair_label: 'p1', holistic_winner: 'TIE', holistic_confidence: 0.5, rubric_winner: 'TIE', rubric_confidence: 0.5 }),
      call({ pair_label: 'p2', holistic_winner: 'TIE', holistic_confidence: 0.5, rubric_winner: 'TIE', rubric_confidence: 0.5 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.perRepeatAgreeRate).toBe(1); // TIE === TIE
    expect(m.perPairModalAgreeRate).toBe(1);
    expect(m.bothDecisiveAgreeRate).toBeNull(); // nothing decisive
    expect(m.abstainDivergenceRate).toBe(0); // neither decisive → not "exactly one"
  });

  it('zero criterion rows → empty perCriterion but aggregate still computes', () => {
    const m = computeAgreementMetrics([call({}), call({ pair_label: 'p2' })], []);
    expect(m.perCriterion).toEqual([]);
    expect(m.perRepeatAgreeRate).toBe(1);
  });

  it('a 0-confidence row (e.g. an errored→TIE call that slipped through) is not counted decisive', () => {
    const calls = [
      call({ holistic_winner: 'TIE', holistic_confidence: 0, rubric_winner: 'TIE', rubric_confidence: 0 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.bothDecisiveAgreeRate).toBeNull();
    expect(m.abstainDivergenceRate).toBe(0);
  });

  it('per-criterion ground-truth accuracy + all-abstain criterion', () => {
    const criteria = [
      crit({ criteria_name: 'Depth', agrees_with_holistic: null, matches_ground_truth: null }),
      crit({ criteria_name: 'Depth', agrees_with_holistic: null, matches_ground_truth: null }),
      crit({ criteria_name: 'Grammar', agrees_with_holistic: true, matches_ground_truth: true }),
      crit({ criteria_name: 'Grammar', agrees_with_holistic: false, matches_ground_truth: false }),
    ];
    const m = computeAgreementMetrics([call({})], criteria);
    const depth = m.perCriterion.find((c) => c.name === 'Depth')!;
    expect(depth.agreeRate).toBeNull(); // all abstained
    expect(depth.abstainRate).toBe(1);
    expect(depth.groundTruthAccuracy).toBeNull();
    const grammar = m.perCriterion.find((c) => c.name === 'Grammar')!;
    expect(grammar.groundTruthAccuracy).toBeCloseTo(0.5);
  });
});
