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

  // ── Wilson CI integration ──────────────────────────────────────────────────────────
  it('Wilson CI: rates carry parallel *Ci bounds matching their denominators', () => {
    const calls = [
      call({}),  // agree
      call({ pair_label: 'p2' }),  // agree
      call({ pair_label: 'p3', rubric_winner: 'B' }),  // disagree
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.perRepeatAgreeRate).toBeCloseTo(2 / 3);
    expect(m.perRepeatAgreeRateCi).not.toBeNull();
    expect(m.perRepeatAgreeRateCi!.low).toBeGreaterThanOrEqual(0);
    expect(m.perRepeatAgreeRateCi!.high).toBeLessThanOrEqual(1);
    expect(m.perRepeatAgreeRateCi!.low).toBeLessThan(m.perRepeatAgreeRate);
    expect(m.perRepeatAgreeRateCi!.high).toBeGreaterThan(m.perRepeatAgreeRate);
  });

  it('Wilson CI: null when denominator is 0', () => {
    const m = computeAgreementMetrics([], []);
    expect(m.perRepeatAgreeRateCi).toBeNull();
    expect(m.bothDecisiveAgreeRateCi).toBeNull();
    expect(m.holisticAccuracyCi).toBeNull();
  });

  it('Wilson CI: per-rate denominators differ — both-decisive CI uses its OWN n, not total n', () => {
    // 10 calls: 2 both-decisive (both agree), 8 with holistic TIE.
    // strict_agree denom = 10, both_decisive denom = 2 — CIs should differ in width.
    const calls = [
      ...Array.from({ length: 2 }, (_, i) =>
        call({ pair_label: `p${i}`, holistic_confidence: 1.0, rubric_confidence: 1.0 }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        call({ pair_label: `p${i + 2}`, holistic_winner: 'TIE', holistic_confidence: 0.5, rubric_winner: 'A', rubric_confidence: 1.0 }),
      ),
    ];
    const m = computeAgreementMetrics(calls, []);
    const strictWidth = m.perRepeatAgreeRateCi!.high - m.perRepeatAgreeRateCi!.low;
    const bothDecWidth = m.bothDecisiveAgreeRateCi!.high - m.bothDecisiveAgreeRateCi!.low;
    expect(bothDecWidth).toBeGreaterThan(strictWidth); // smaller n → wider CI
  });

  it('per-criterion CIs populate alongside rates', () => {
    const criteria = [
      crit({ criteria_name: 'X', agrees_with_holistic: true }),
      crit({ criteria_name: 'X', agrees_with_holistic: true }),
      crit({ criteria_name: 'X', agrees_with_holistic: false }),
    ];
    const m = computeAgreementMetrics([call({})], criteria);
    const x = m.perCriterion[0]!;
    expect(x.agreeRate).toBeCloseTo(2 / 3);
    expect(x.agreeRateCi).not.toBeNull();
    expect(x.disagreeRateCi).not.toBeNull();
    expect(x.abstainRateCi).not.toBeNull();
  });

  // ── Position bias ─────────────────────────────────────────────────────────────────
  it('position bias: null when not provided (legacy/no raws)', () => {
    const m = computeAgreementMetrics([call({})], []);
    expect(m.holisticPositionBiasRate).toBeNull();
    expect(m.holisticPositionBiasRateCi).toBeNull();
    expect(m.rubricPositionBiasRate).toBeNull();
    expect(m.rubricPositionBiasRateCi).toBeNull();
  });

  it('position bias: rate = mismatch / parsed; CI populates', () => {
    const m = computeAgreementMetrics([call({})], [], {
      holisticMismatch: 3,
      holisticParsed: 10,
      rubricMismatch: 1,
      rubricParsed: 8,
    });
    expect(m.holisticPositionBiasRate).toBeCloseTo(0.3);
    expect(m.rubricPositionBiasRate).toBeCloseTo(0.125);
    expect(m.holisticPositionBiasRateCi).not.toBeNull();
    expect(m.rubricPositionBiasRateCi).not.toBeNull();
  });

  it('position bias: parsed=0 → rate null but input was provided', () => {
    const m = computeAgreementMetrics([call({})], [], {
      holisticMismatch: 0,
      holisticParsed: 0,
      rubricMismatch: 0,
      rubricParsed: 0,
    });
    expect(m.holisticPositionBiasRate).toBeNull();
    expect(m.rubricPositionBiasRate).toBeNull();
    // CI is also null when n=0.
    expect(m.holisticPositionBiasRateCi).toBeNull();
    expect(m.rubricPositionBiasRateCi).toBeNull();
  });

  // ── Ground-truth accuracy: TIE@high-confidence is an abstention, NOT a wrong guess ──
  it('rubric accuracy excludes high-confidence TIE verdicts (observed in run 6a6549b7)', () => {
    // 3 calls on the same large-gap pair, expected_winner=A:
    //   - rubric A @ 1.0 (correct)
    //   - rubric B @ 1.0 (wrong)
    //   - rubric TIE @ 1.0 (high-confidence abstention — must be EXCLUDED from accuracy)
    // If TIE counts in the denominator, rubric_accuracy = 1/3 ≈ 33%.
    // With the fix, rubric_accuracy = 1/2 = 50% (TIE@1.0 dropped from denom).
    const calls = [
      call({ pair_label: 'p1', gap_kind: 'large', expected_winner: 'A', rubric_winner: 'A', rubric_confidence: 1.0 }),
      call({ pair_label: 'p2', gap_kind: 'large', expected_winner: 'A', rubric_winner: 'B', rubric_confidence: 1.0 }),
      call({ pair_label: 'p3', gap_kind: 'large', expected_winner: 'A', rubric_winner: 'TIE', rubric_confidence: 1.0 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.nLargeGap).toBe(3);
    // 2 A/B-decisive rubric verdicts, 1 correct.
    expect(m.rubricAccuracy).toBeCloseTo(0.5);
  });

  it('holistic accuracy: same fix — TIE@high-conf excluded', () => {
    const calls = [
      call({ pair_label: 'p1', gap_kind: 'large', expected_winner: 'B', holistic_winner: 'B', holistic_confidence: 1.0 }),
      call({ pair_label: 'p2', gap_kind: 'large', expected_winner: 'B', holistic_winner: 'TIE', holistic_confidence: 1.0 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    // Only 1 A/B-decisive holistic; correct → 100% (not 50%).
    expect(m.holisticAccuracy).toBeCloseTo(1.0);
  });

  it('TIE@LOW-conf is also excluded (was already excluded by the conf > 0.6 filter, regression-pinned)', () => {
    const calls = [
      call({ pair_label: 'p1', gap_kind: 'large', expected_winner: 'A', rubric_winner: 'A', rubric_confidence: 1.0 }),
      // TIE @ 0.5 (low confidence) — was already excluded; included here as a regression guard.
      call({ pair_label: 'p2', gap_kind: 'large', expected_winner: 'A', rubric_winner: 'TIE', rubric_confidence: 0.5 }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.rubricAccuracy).toBeCloseTo(1.0);
  });

  // ── abstain_divergence uses committed semantics, not just confidence ─────────────
  it('abstain_divergence: TIE@high-conf is an abstention, not a commit (run 6a6549b7 pattern)', () => {
    // Both judges are abstaining, just at different confidence levels.
    // Under the old confidence-only filter this would have scored as divergence (1/1).
    // Under the committed semantics neither judge committed, so divergence = 0.
    const calls = [
      call({
        pair_label: 'p1',
        holistic_winner: 'TIE',
        holistic_confidence: 0.5,
        rubric_winner: 'TIE',
        rubric_confidence: 1.0,
      }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.abstainDivergenceRate).toBe(0);
  });

  it('abstain_divergence: exactly one judge committed to A/B → divergence = 1', () => {
    const calls = [
      // Holistic committed to A, rubric was confidently TIE → divergence.
      call({
        pair_label: 'p1',
        holistic_winner: 'A',
        holistic_confidence: 1.0,
        rubric_winner: 'TIE',
        rubric_confidence: 1.0,
      }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.abstainDivergenceRate).toBe(1);
  });

  it('abstain_divergence: both committed to A/B → no divergence (even when they disagree)', () => {
    const calls = [
      // Both committed, opposite winners → "both-decisive opposite", NOT abstain divergence.
      call({
        pair_label: 'p1',
        holistic_winner: 'A',
        holistic_confidence: 1.0,
        rubric_winner: 'B',
        rubric_confidence: 1.0,
      }),
    ];
    const m = computeAgreementMetrics(calls, []);
    expect(m.abstainDivergenceRate).toBe(0);
  });
});
