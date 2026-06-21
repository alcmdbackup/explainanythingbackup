// Pure metric reducers for the Judge Lab Agreement Sweep. Given the per-(pair × repeat) holistic↔rubric
// call rows + their per-criterion verdicts (already filtered to a pair_kind + error-free by the caller,
// mirroring metrics.ts), compute: the three TIE buckets (strict / both-decisive / abstain-divergence)
// [O2], per-pair-modal vs per-repeat agreement [O1], per-criterion agreement + abstain [O2], and
// holistic/rubric/per-criterion accuracy vs the Elo-gap ground truth on large-gap pairs [O5]. No I/O.
//
// 95% Wilson score CIs are computed PARALLEL to each rate (additive fields, non-breaking) — every rate
// gets `<rate>Ci: { low, high } | null`. Null when n=0 for that rate's denominator.
//
// Position-bias rates (holistic / rubric: fraction of calls where forward-pass and reverse-pass
// disagreed) are computed from a separate pre-aggregated input (the action that fetches raws does the
// parseWinner / parseRubricVerdict server-side and ships counts). They are OPTIONAL on the reducer
// input; null when omitted (legacy / no raws available).

import { wilsonScoreCI, type WilsonInterval } from '../shared/wilsonCI';
import type { Winner } from './schemas';

// confidence > 0.6 (matches DECISIVE_THRESHOLD in metrics.ts / finalization.ts).
export const DECISIVE_THRESHOLD = 0.6;

/** Minimal per-call shape the reducer reads (a Pick so DB Core rows + engine results both fit). */
export interface AgreementCallMetricsInput {
  pair_label: string;
  repeat_index: number;
  holistic_winner: Winner;
  holistic_confidence: number;
  rubric_winner: Winner;
  rubric_confidence: number;
  gap_kind: 'large' | 'close' | null;
  expected_winner: 'A' | 'B' | null;
}

/** Minimal per-criterion shape (one row per criterion per call, already joined to an error-free call). */
export interface AgreementCriterionMetricsInput {
  criteria_name: string;
  weight: number;
  agrees_with_holistic: boolean | null;
  matches_ground_truth: boolean | null;
}

/** Pre-aggregated position-bias counts. The action that fetches the *_raw columns parses each pass
 *  via parseWinner / parseRubricVerdict and tallies these. Null policy:
 *  - both passes parse to a winner: counted in `parsed`; mismatch ⇒ `mismatch` incremented.
 *  - one parses + one null: EXCLUDED from `parsed` (under-determined).
 *  - both null: EXCLUDED from `parsed` (no signal). */
export interface PositionBiasAggregates {
  holisticMismatch: number;
  holisticParsed: number;
  rubricMismatch: number;
  rubricParsed: number;
}

export interface AgreementCriterionMetrics {
  name: string;
  /** Representative (mean) normalized weight across this criterion's rows. */
  weight: number;
  /** Rows judged for this criterion. */
  n: number;
  /** Among non-abstaining rows, fraction that agreed with the holistic winner. null if all abstained. */
  agreeRate: number | null;
  agreeRateCi: WilsonInterval | null;
  disagreeRate: number | null;
  disagreeRateCi: WilsonInterval | null;
  /** Fraction of rows where the criterion abstained (TIE / unparsed). */
  abstainRate: number;
  abstainRateCi: WilsonInterval | null;
  /** Among large-gap decisive rows, fraction matching the Elo ground truth. null if none. */
  groundTruthAccuracy: number | null;
  groundTruthAccuracyCi: WilsonInterval | null;
}

export interface AgreementMetrics {
  /** Error-free (pair × repeat) calls summarized. */
  n: number;
  /** Distinct pairs covered. */
  nPairs: number;
  // ── Aggregate rubric ↔ holistic agreement (O1 + O2) ──
  /** Per-pair-modal strict agreement: modal holistic vs modal rubric, compared once per pair. */
  perPairModalAgreeRate: number | null;
  perPairModalAgreeRateCi: WilsonInterval | null;
  /** Per-repeat strict agreement: rubric_winner === holistic_winner over all calls. */
  perRepeatAgreeRate: number;
  perRepeatAgreeRateCi: WilsonInterval | null;
  /** Agreement among calls where BOTH judges are decisive (conf > 0.6). null if none. */
  bothDecisiveAgreeRate: number | null;
  bothDecisiveAgreeRateCi: WilsonInterval | null;
  /** Both decisive but opposite winner (= 1 - bothDecisiveAgreeRate). null if none. */
  bothDecisiveOppositeRate: number | null;
  bothDecisiveOppositeRateCi: WilsonInterval | null;
  /** Exactly one judge decisive (one commits, the other abstains/TIEs). */
  abstainDivergenceRate: number;
  abstainDivergenceRateCi: WilsonInterval | null;
  /** rubric A / holistic B share (over all calls). */
  rubricAHolisticBRate: number;
  /** rubric B / holistic A share (over all calls). */
  rubricBHolisticARate: number;
  // ── Ground-truth accuracy (large-gap pairs only, O5) ──
  nLargeGap: number;
  holisticAccuracy: number | null;
  holisticAccuracyCi: WilsonInterval | null;
  rubricAccuracy: number | null;
  rubricAccuracyCi: WilsonInterval | null;
  accuracyDelta: number | null;
  // ── Position bias (forward-pass winner !== reverse-pass winner) ──
  /** Holistic position-bias rate: fraction of (both-passes-parsed) calls where forward ≠ reverse. */
  holisticPositionBiasRate: number | null;
  holisticPositionBiasRateCi: WilsonInterval | null;
  rubricPositionBiasRate: number | null;
  rubricPositionBiasRateCi: WilsonInterval | null;
  // ── Per-criterion (O2 + O5) ──
  perCriterion: AgreementCriterionMetrics[];
}

function rate(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

/** Modal winner across a set of verdicts (ties broken by A > B > TIE order for determinism). */
function modal(winners: Winner[]): Winner | null {
  if (winners.length === 0) return null;
  const counts: Record<Winner, number> = { A: 0, B: 0, TIE: 0 };
  for (const w of winners) counts[w] += 1;
  const order: Winner[] = ['A', 'B', 'TIE'];
  return order.reduce((best, w) => (counts[w] > counts[best] ? w : best), order[0]!);
}

export function computeAgreementMetrics(
  calls: AgreementCallMetricsInput[],
  criteria: AgreementCriterionMetricsInput[],
  positionBias?: PositionBiasAggregates,
): AgreementMetrics {
  const n = calls.length;

  // Per-repeat strict agreement.
  const agreeCount = calls.filter((c) => c.holistic_winner === c.rubric_winner).length;
  const perRepeatAgreeRate = n === 0 ? 0 : agreeCount / n;
  const perRepeatAgreeRateCi = wilsonScoreCI(agreeCount, n);

  // Per-pair-modal: reduce each judge to its modal winner per pair, then compare once per pair.
  const byPair = new Map<string, AgreementCallMetricsInput[]>();
  for (const c of calls) {
    const arr = byPair.get(c.pair_label) ?? [];
    arr.push(c);
    byPair.set(c.pair_label, arr);
  }
  let modalAgree = 0;
  for (const rows of byPair.values()) {
    const mh = modal(rows.map((r) => r.holistic_winner));
    const mr = modal(rows.map((r) => r.rubric_winner));
    if (mh !== null && mh === mr) modalAgree += 1;
  }
  const nPairs = byPair.size;
  const perPairModalAgreeRate = nPairs === 0 ? null : modalAgree / nPairs;
  const perPairModalAgreeRateCi = wilsonScoreCI(modalAgree, nPairs);

  // TIE buckets.
  const bothDecisive = calls.filter(
    (c) => c.holistic_confidence > DECISIVE_THRESHOLD && c.rubric_confidence > DECISIVE_THRESHOLD,
  );
  const bothDecisiveAgree = bothDecisive.filter((c) => c.holistic_winner === c.rubric_winner).length;
  const bothDecisiveAgreeRate = rate(bothDecisiveAgree, bothDecisive.length);
  const bothDecisiveAgreeRateCi = wilsonScoreCI(bothDecisiveAgree, bothDecisive.length);
  const bothDecisiveOppositeRate =
    bothDecisiveAgreeRate === null ? null : 1 - bothDecisiveAgreeRate;
  // Opposite-winner CI: complement of agree (Wilson on the "oppose" successes count).
  const bothDecisiveOppose = bothDecisive.length - bothDecisiveAgree;
  const bothDecisiveOppositeRateCi = wilsonScoreCI(bothDecisiveOppose, bothDecisive.length);

  const exactlyOneDecisive = calls.filter(
    (c) =>
      (c.holistic_confidence > DECISIVE_THRESHOLD) !==
      (c.rubric_confidence > DECISIVE_THRESHOLD),
  ).length;
  const abstainDivergenceRate = n === 0 ? 0 : exactlyOneDecisive / n;
  const abstainDivergenceRateCi = wilsonScoreCI(exactlyOneDecisive, n);

  const rubricAHolisticB = calls.filter(
    (c) => c.rubric_winner === 'A' && c.holistic_winner === 'B',
  ).length;
  const rubricBHolisticA = calls.filter(
    (c) => c.rubric_winner === 'B' && c.holistic_winner === 'A',
  ).length;

  // Ground-truth accuracy (large-gap pairs only).
  const largeGap = calls.filter(
    (c) => c.gap_kind === 'large' && (c.expected_winner === 'A' || c.expected_winner === 'B'),
  );
  const hDecisive = largeGap.filter((c) => c.holistic_confidence > DECISIVE_THRESHOLD);
  const rDecisive = largeGap.filter((c) => c.rubric_confidence > DECISIVE_THRESHOLD);
  const holisticAccurateCount = hDecisive.filter((c) => c.holistic_winner === c.expected_winner).length;
  const rubricAccurateCount = rDecisive.filter((c) => c.rubric_winner === c.expected_winner).length;
  const holisticAccuracy = rate(holisticAccurateCount, hDecisive.length);
  const holisticAccuracyCi = wilsonScoreCI(holisticAccurateCount, hDecisive.length);
  const rubricAccuracy = rate(rubricAccurateCount, rDecisive.length);
  const rubricAccuracyCi = wilsonScoreCI(rubricAccurateCount, rDecisive.length);
  const accuracyDelta =
    holisticAccuracy === null || rubricAccuracy === null ? null : rubricAccuracy - holisticAccuracy;

  // Position bias (caller pre-aggregates from raws + parseWinner / parseRubricVerdict).
  const holisticPositionBiasRate =
    positionBias === undefined || positionBias.holisticParsed === 0
      ? null
      : positionBias.holisticMismatch / positionBias.holisticParsed;
  const holisticPositionBiasRateCi = positionBias
    ? wilsonScoreCI(positionBias.holisticMismatch, positionBias.holisticParsed)
    : null;
  const rubricPositionBiasRate =
    positionBias === undefined || positionBias.rubricParsed === 0
      ? null
      : positionBias.rubricMismatch / positionBias.rubricParsed;
  const rubricPositionBiasRateCi = positionBias
    ? wilsonScoreCI(positionBias.rubricMismatch, positionBias.rubricParsed)
    : null;

  // Per-criterion rollup.
  const critGroups = new Map<string, AgreementCriterionMetricsInput[]>();
  for (const r of criteria) {
    const arr = critGroups.get(r.criteria_name) ?? [];
    arr.push(r);
    critGroups.set(r.criteria_name, arr);
  }
  const perCriterion: AgreementCriterionMetrics[] = [...critGroups.entries()].map(([name, rows]) => {
    const decided = rows.filter((r) => r.agrees_with_holistic !== null);
    const agree = decided.filter((r) => r.agrees_with_holistic === true).length;
    const disagree = decided.filter((r) => r.agrees_with_holistic === false).length;
    const abstainCount = rows.length - decided.length;
    const gtRows = rows.filter((r) => r.matches_ground_truth !== null);
    const gtHits = gtRows.filter((r) => r.matches_ground_truth === true).length;
    const weight = rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.weight, 0) / rows.length;
    const agreeRate = rate(agree, decided.length);
    return {
      name,
      weight,
      n: rows.length,
      agreeRate,
      agreeRateCi: wilsonScoreCI(agree, decided.length),
      disagreeRate: agreeRate === null ? null : 1 - agreeRate,
      disagreeRateCi: wilsonScoreCI(disagree, decided.length),
      abstainRate: rows.length === 0 ? 0 : abstainCount / rows.length,
      abstainRateCi: wilsonScoreCI(abstainCount, rows.length),
      groundTruthAccuracy: rate(gtHits, gtRows.length),
      groundTruthAccuracyCi: wilsonScoreCI(gtHits, gtRows.length),
    };
  });

  return {
    n,
    nPairs,
    perPairModalAgreeRate,
    perPairModalAgreeRateCi,
    perRepeatAgreeRate,
    perRepeatAgreeRateCi,
    bothDecisiveAgreeRate,
    bothDecisiveAgreeRateCi,
    bothDecisiveOppositeRate,
    bothDecisiveOppositeRateCi,
    abstainDivergenceRate,
    abstainDivergenceRateCi,
    rubricAHolisticBRate: n === 0 ? 0 : rubricAHolisticB / n,
    rubricBHolisticARate: n === 0 ? 0 : rubricBHolisticA / n,
    nLargeGap: largeGap.length,
    holisticAccuracy,
    holisticAccuracyCi,
    rubricAccuracy,
    rubricAccuracyCi,
    accuracyDelta,
    holisticPositionBiasRate,
    holisticPositionBiasRateCi,
    rubricPositionBiasRate,
    rubricPositionBiasRateCi,
    perCriterion,
  };
}
