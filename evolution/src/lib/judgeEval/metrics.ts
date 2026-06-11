// Pure metric reducers for the judge-evaluation tool. Computes decisiveness, agreement,
// position-bias, accuracy, latency/token/cost, and implied-beta from a set of per-repeat
// 2-pass call results. No DB / no I/O — fully unit-testable. Formulas replicate the
// historical judge-analysis scripts (judge-agreement-test.ts, beta-analysis.ts) and the
// live decisive_rate metric (finalization.ts: confidence > 0.6).

import type { JudgeEvalCall, JudgeEvalCallResult, JudgeEvalPair, Winner } from './schemas';

/** Minimal per-call shape computeMetrics reads. A Pick (not JudgeEvalCallResult) so BOTH the
 *  light list rows (JudgeEvalCallCore, no audit payload) and full result rows can be passed. */
export type JudgeMetricsInput = Pick<
  JudgeEvalCall,
  | 'winner'
  | 'confidence'
  | 'forward_winner'
  | 'reverse_winner'
  | 'cost_usd'
  | 'wall_ms'
  | 'fwd_ms'
  | 'output_tokens'
  | 'reasoning_tokens'
>;

// DECISIVE_CONFIDENCE_THRESHOLD lives in evolution/src/lib/shared/computeRatings.ts (=0.6).
// Re-declared here as a local const to keep this module dependency-free and pure; the value
// is asserted equal to the source in metrics.test.ts.
export const DECISIVE_THRESHOLD = 0.6;

export interface JudgeMetrics {
  /** Number of repeat comparisons summarized. */
  n: number;
  /** Fraction with confidence > 0.6 (live-metric parity). */
  decisiveRate: number;
  /** Fraction whose aggregated winner equals the modal winner (self-consistency). */
  selfConsistency: number;
  /** Mean aggregated confidence in [0,1]. */
  avgConfidence: number;
  /** Fraction of (both-pass-non-null) repeats where forward & reverse picked the same
   *  slot label (= position bias; maps to the confidence-0.5 forced-tie bucket). */
  positionBiasRate: number;
  /** Among decisive repeats, fraction whose winner matches ground truth. null when no
   *  ground truth (close pairs) or no decisive repeats. */
  accuracy: number | null;
  /** Median wall-clock ms across repeats (null if unrecorded). */
  medWallMs: number | null;
  medFwdMs: number | null;
  avgOutputTokens: number | null;
  avgReasoningTokens: number | null;
  avgCostUsd: number | null;
  /** Total cost / number of decisive repeats. null when 0 decisive. */
  costPerDecisiveUsd: number | null;
  /** Modal aggregated winner. */
  modalWinner: Winner | null;
  /** {A,B,TIE} counts. */
  winnerHistogram: Record<Winner, number>;
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

function mean(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Per-cell metrics over one pair's repeats (or any homogeneous call set). */
export function computeMetrics(
  calls: JudgeMetricsInput[],
  opts: { expectedWinner?: Winner | 'A' | 'B' | null } = {},
): JudgeMetrics {
  const n = calls.length;
  const hist: Record<Winner, number> = { A: 0, B: 0, TIE: 0 };
  for (const c of calls) hist[c.winner] += 1;

  const sortedHist = Object.entries(hist).sort((a, b) => b[1] - a[1]);
  const modalWinner = n === 0 ? null : (sortedHist[0]![0] as Winner);

  const decisiveCount = calls.filter((c) => c.confidence > DECISIVE_THRESHOLD).length;
  const decisiveRate = n === 0 ? 0 : decisiveCount / n;
  const selfConsistency =
    n === 0 || modalWinner === null ? 0 : hist[modalWinner] / n;
  const avgConfidence = mean(calls.map((c) => c.confidence)) ?? 0;

  // Position bias: both passes name the same slot label (both A or both B) → divergence
  // after reversal. Only meaningful when both passes parsed to a non-null A/B.
  const bothNonNull = calls.filter(
    (c) =>
      c.forward_winner != null &&
      c.reverse_winner != null &&
      c.forward_winner !== 'TIE' &&
      c.reverse_winner !== 'TIE',
  );
  const sameSlot = bothNonNull.filter((c) => c.forward_winner === c.reverse_winner);
  const positionBiasRate =
    bothNonNull.length === 0 ? 0 : sameSlot.length / bothNonNull.length;

  // Accuracy vs ground truth (decisive repeats only).
  const expected = opts.expectedWinner ?? null;
  let accuracy: number | null = null;
  if (expected === 'A' || expected === 'B') {
    const decisive = calls.filter((c) => c.confidence > DECISIVE_THRESHOLD);
    accuracy =
      decisive.length === 0
        ? null
        : decisive.filter((c) => c.winner === expected).length / decisive.length;
  }

  const totalCost = calls.reduce((s, c) => s + (c.cost_usd ?? 0), 0);
  const avgCostUsd = mean(calls.map((c) => c.cost_usd));
  const costPerDecisiveUsd = decisiveCount === 0 ? null : totalCost / decisiveCount;

  return {
    n,
    decisiveRate,
    selfConsistency,
    avgConfidence,
    positionBiasRate,
    accuracy,
    medWallMs: median(calls.map((c) => c.wall_ms ?? NaN)),
    medFwdMs: median(calls.map((c) => c.fwd_ms ?? NaN)),
    avgOutputTokens: mean(calls.map((c) => c.output_tokens)),
    avgReasoningTokens: mean(calls.map((c) => c.reasoning_tokens)),
    avgCostUsd,
    costPerDecisiveUsd,
    modalWinner,
    winnerHistogram: hist,
  };
}

/** Default OpenSkill beta (sigma/2 at sigma=25/3) for over/under-confidence comparison. */
export const DEFAULT_OPENSKILL_BETA = 25 / 3 / 2;

/**
 * Back-solve the implied OpenSkill beta from the forward-pass correct rate on a known-gap
 * pair (beta-analysis.ts methodology). Requires ground truth (expected_winner + mu gap +
 * sigmas). Returns null for close/tie pairs or degenerate inputs.
 *   p  = fraction the forward pass picks the stronger variant
 *   c  = gap / (-ln(1/p - 1))           [invert Bradley-Terry P(win)=1/(1+exp(-gap/c))]
 *   β  = sqrt(max(0, (c² - σ_a² - σ_b²) / 2))
 */
export function computeImpliedBeta(
  calls: JudgeEvalCallResult[],
  pair: Pick<JudgeEvalPair, 'expected_winner' | 'mu_a' | 'mu_b' | 'sigma_a' | 'sigma_b'>,
): number | null {
  if (pair.expected_winner !== 'A' && pair.expected_winner !== 'B') return null;
  if (pair.mu_a == null || pair.mu_b == null) return null;
  const gap = Math.abs(pair.mu_a - pair.mu_b);
  if (!(gap > 0)) return null;

  const fwd = calls.filter((c) => c.forward_winner === 'A' || c.forward_winner === 'B');
  if (fwd.length === 0) return null;
  const correct = fwd.filter((c) => c.forward_winner === pair.expected_winner).length;
  let p = correct / fwd.length;
  // Bound the degenerate ends so the logit is finite (binomial-style clamp).
  if (p >= 1) p = 0.95;
  if (p <= 0.5) return null; // judge no better than chance on a known gap → beta unbounded

  const c = gap / -Math.log(1 / p - 1);
  const sigmaA = pair.sigma_a ?? 0;
  const sigmaB = pair.sigma_b ?? 0;
  const inner = (c * c - sigmaA * sigmaA - sigmaB * sigmaB) / 2;
  return Math.sqrt(Math.max(0, inner));
}
