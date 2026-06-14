// Unit tests for judge-eval metric reducers: decisive_rate (live-metric parity),
// self-consistency, position-bias, accuracy vs ground truth, cost-per-decisive, and the
// implied-beta back-solve. Pure functions, no DB.

import { DECISIVE_CONFIDENCE_THRESHOLD } from '../shared/computeRatings';
import { computeMetrics, computeImpliedBeta, DECISIVE_THRESHOLD } from './metrics';
import type { JudgeEvalCallResult, JudgeEvalPair, Winner } from './schemas';

function call(overrides: Partial<JudgeEvalCallResult>): JudgeEvalCallResult {
  return {
    pair_label: 'art#1',
    pair_kind: 'article',
    comparison_mode: 'article',
    repeat_index: 0,
    forward_winner: 'A',
    reverse_winner: 'A',
    winner: 'A',
    confidence: 1.0,
    wall_ms: 100,
    fwd_ms: 60,
    rev_ms: 55,
    prompt_tokens: 1000,
    output_tokens: 3,
    reasoning_tokens: 0,
    cost_usd: 0.0002,
    forward_raw: 'A',
    reverse_raw: 'A',
    error: null,
    forward_prompt: null,
    reverse_prompt: null,
    forward_reasoning: null,
    reverse_reasoning: null,
    reasoning_trace_format: null,
    mu_a: null,
    mu_b: null,
    sigma_a: null,
    sigma_b: null,
    baseline_confidence: null,
    gap_kind: null,
    expected_winner: null,
    variant_a_id: null,
    variant_b_id: null,
    ...overrides,
  };
}

describe('DECISIVE_THRESHOLD parity', () => {
  it('matches the live DECISIVE_CONFIDENCE_THRESHOLD from computeRatings', () => {
    expect(DECISIVE_THRESHOLD).toBe(DECISIVE_CONFIDENCE_THRESHOLD);
  });
});

describe('computeMetrics', () => {
  it('decisiveRate counts confidence > 0.6 (0.7 and 1.0 only)', () => {
    const calls = [
      call({ confidence: 1.0 }),
      call({ confidence: 0.7 }),
      call({ confidence: 0.5, winner: 'TIE' }),
      call({ confidence: 0.3, winner: 'TIE' }),
    ];
    const m = computeMetrics(calls);
    expect(m.n).toBe(4);
    expect(m.decisiveRate).toBeCloseTo(0.5, 6);
  });

  it('self-consistency = modal-winner fraction; modalWinner is the plurality', () => {
    const calls = [
      call({ winner: 'A' }),
      call({ winner: 'A' }),
      call({ winner: 'A' }),
      call({ winner: 'TIE', confidence: 0.5 }),
    ];
    const m = computeMetrics(calls);
    expect(m.modalWinner).toBe<Winner>('A');
    expect(m.selfConsistency).toBeCloseTo(0.75, 6);
    expect(m.winnerHistogram).toEqual({ A: 3, B: 0, TIE: 1 });
  });

  it('positionBiasRate = fraction where both passes pick the same slot label', () => {
    const calls = [
      // both picked slot B (position bias) -> forced tie
      call({ forward_winner: 'B', reverse_winner: 'B', winner: 'TIE', confidence: 0.5 }),
      // agree after reversal (fwd A, rev B = same text) -> decisive, NOT position bias
      call({ forward_winner: 'A', reverse_winner: 'B', winner: 'A', confidence: 1.0 }),
    ];
    const m = computeMetrics(calls);
    expect(m.positionBiasRate).toBeCloseTo(0.5, 6);
  });

  it('accuracy is null without ground truth, computed over decisive repeats with it', () => {
    const calls = [
      call({ winner: 'A', confidence: 1.0 }),
      call({ winner: 'B', confidence: 0.7 }),
      call({ winner: 'TIE', confidence: 0.5 }), // not decisive, excluded
    ];
    expect(computeMetrics(calls).accuracy).toBeNull();
    const m = computeMetrics(calls, { expectedWinner: 'A' });
    expect(m.accuracy).toBeCloseTo(0.5, 6); // 1 of 2 decisive matched 'A'
  });

  it('costPerDecisive = total cost / decisive count, null when 0 decisive', () => {
    const decisive = computeMetrics([
      call({ confidence: 1.0, cost_usd: 0.001 }),
      call({ confidence: 0.5, winner: 'TIE', cost_usd: 0.001 }),
    ]);
    expect(decisive.costPerDecisiveUsd).toBeCloseTo(0.002, 6); // total 0.002 / 1 decisive
    const none = computeMetrics([call({ confidence: 0.5, winner: 'TIE', cost_usd: 0.001 })]);
    expect(none.costPerDecisiveUsd).toBeNull();
  });

  it('handles empty input', () => {
    const m = computeMetrics([]);
    expect(m.n).toBe(0);
    expect(m.decisiveRate).toBe(0);
    expect(m.modalWinner).toBeNull();
  });
});

describe('computeImpliedBeta', () => {
  const largePair: Pick<JudgeEvalPair, 'expected_winner' | 'mu_a' | 'mu_b' | 'sigma_a' | 'sigma_b'> = {
    expected_winner: 'A',
    mu_a: 43.9,
    mu_b: 18.66,
    sigma_a: 4.434,
    sigma_b: 6.183,
  };

  it('returns a finite beta when the forward pass is mostly correct on a known gap', () => {
    // 9/10 forward passes pick the true winner A
    const calls = Array.from({ length: 10 }, (_, i) =>
      call({ forward_winner: i < 9 ? 'A' : 'B' }),
    );
    const beta = computeImpliedBeta(calls, largePair);
    expect(beta).not.toBeNull();
    expect(Number.isFinite(beta!)).toBe(true);
    expect(beta!).toBeGreaterThan(0);
  });

  it('returns null for tie-acceptable pairs (no ground truth)', () => {
    const calls = [call({ forward_winner: 'A' })];
    expect(
      computeImpliedBeta(calls, { ...largePair, expected_winner: null }),
    ).toBeNull();
  });

  it('returns null when the judge is at/below chance on a known gap', () => {
    const calls = Array.from({ length: 10 }, () => call({ forward_winner: 'B' }));
    expect(computeImpliedBeta(calls, largePair)).toBeNull();
  });
});
