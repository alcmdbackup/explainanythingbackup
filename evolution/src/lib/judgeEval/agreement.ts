// Agreement engine (Judge Lab): for ONE pair, run a HOLISTIC (no-rubric) 2-pass judge AND a RUBRIC
// (all-criteria, one 2-pass call) judge with the SAME injected JudgeFn, then record how often the
// aggregated rubric verdict + each individual criterion agree with the holistic winner, plus each
// side's match against the Elo-gap ground truth. Mirrors escalation.ts / runJudgeEval.ts (inlined
// Promise.all 2-pass over JudgeFn — NOT compareWithBiasMitigation, which drops per-pass cost/raw and
// ignores temperature). Pure over the injected JudgeFn; writes nothing (persistence in agreementPersist.ts).

import {
  buildComparisonPrompt,
  parseWinner,
  aggregateWinners,
} from '../shared/computeRatings';
import {
  buildRubricComparisonPrompt,
  parseRubricVerdict,
  aggregateRubric,
  reconcilePasses,
  type RubricBreakdown,
  type ResolvedJudgeRubric,
  type Verdict,
} from '../shared/rubricJudge';
import type { JudgeFn } from './runJudgeEval';
import { readPartialResults } from './schemas';
import type { JudgeEvalPair, PairKind, Winner } from './schemas';

export const DEFAULT_AGREEMENT_CONCURRENCY = 6;

function norm(s: string | null): Winner | null {
  return s === 'A' || s === 'B' || s === 'TIE' ? s : null;
}

/** One criterion's agreement record for a single (pair × repeat). Pre-persist shape (no id/FK). */
export interface AgreementCriterionVerdict {
  criteria_id: string | null;
  criteria_name: string;
  weight: number;
  forward_verdict: string | null;
  reverse_verdict: string | null;
  dimension_winner: string | null;
  /** Did this criterion's winner equal the HOLISTIC winner. NULL when the criterion abstains (TIE/null). */
  agrees_with_holistic: boolean | null;
  /** Did this criterion's winner match the Elo-gap ground truth. NULL unless a large-gap decisive criterion. */
  matches_ground_truth: boolean | null;
  position: number;
}

/** One (pair × repeat) result pairing the holistic + rubric verdicts. Pre-persist (no id/run id);
 *  `criterionVerdicts` ride along and are split into the child table at persist time. */
export interface AgreementCallResult {
  pair_label: string;
  pair_kind: PairKind;
  repeat_index: number;
  holistic_winner: Winner;
  holistic_confidence: number;
  rubric_winner: Winner;
  rubric_confidence: number;
  /** Raw label equality (holistic_winner === rubric_winner). NULL on errored rows. */
  rubric_matches_holistic: boolean | null;
  holistic_cost_usd: number | null;
  rubric_cost_usd: number | null;
  cost_usd: number | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  wall_ms: number | null;
  holistic_forward_raw: string | null;
  holistic_reverse_raw: string | null;
  rubric_forward_raw: string | null;
  rubric_reverse_raw: string | null;
  error: string | null;
  // Frozen ground-truth snapshot (durable vs pair-bank re-seeding).
  mu_a: number | null;
  mu_b: number | null;
  sigma_a: number | null;
  sigma_b: number | null;
  baseline_confidence: number | null;
  gap_kind: 'large' | 'close' | null;
  expected_winner: 'A' | 'B' | null;
  variant_a_id: string | null;
  variant_b_id: string | null;
  /** Per-criterion agreement rows (persisted to judge_eval_agreement_criterion_verdicts). */
  criterionVerdicts: AgreementCriterionVerdict[];
}

/** PURE: derive aggregate + per-criterion agreement from a holistic winner and the rubric breakdown.
 *  `agrees_with_holistic` is NULL whenever the criterion abstains — a TIE OR both passes unparsed
 *  (reconcilePasses(null,null) → 'TIE', so abstention collapses into the TIE branch). Ground-truth
 *  match is only defined for a decisive (A/B) criterion on a large-gap pair. */
export function computePairAgreement(
  holisticWinner: Winner,
  breakdown: RubricBreakdown,
  expectedWinner: 'A' | 'B' | null,
  gapKind: 'large' | 'close' | null,
): { matches: boolean; criterionVerdicts: AgreementCriterionVerdict[] } {
  const criterionVerdicts = breakdown.dimensions.map((d, i): AgreementCriterionVerdict => {
    const dimWinner: Verdict = reconcilePasses(d.forwardVerdict, d.reverseVerdict).winner;
    const decisive = dimWinner === 'A' || dimWinner === 'B';
    const agrees = decisive ? dimWinner === holisticWinner : null;
    const matchesGt =
      decisive && gapKind === 'large' && (expectedWinner === 'A' || expectedWinner === 'B')
        ? dimWinner === expectedWinner
        : null;
    return {
      criteria_id: d.criteriaId,
      criteria_name: d.name,
      weight: d.weight,
      forward_verdict: d.forwardVerdict,
      reverse_verdict: d.reverseVerdict,
      dimension_winner: dimWinner,
      agrees_with_holistic: agrees,
      matches_ground_truth: matchesGt,
      position: i,
    };
  });
  return { matches: holisticWinner === breakdown.overall.winner, criterionVerdicts };
}

function pairSnapshot(pair: JudgeEvalPair): Pick<
  AgreementCallResult,
  'mu_a' | 'mu_b' | 'sigma_a' | 'sigma_b' | 'baseline_confidence' | 'gap_kind' | 'expected_winner' | 'variant_a_id' | 'variant_b_id'
> {
  return {
    mu_a: pair.mu_a,
    mu_b: pair.mu_b,
    sigma_a: pair.sigma_a,
    sigma_b: pair.sigma_b,
    baseline_confidence: pair.baseline_confidence,
    gap_kind: pair.gap_kind,
    expected_winner: pair.expected_winner,
    variant_a_id: pair.variant_a_id,
    variant_b_id: pair.variant_b_id,
  };
}

function erroredAgreementRow(
  pair: JudgeEvalPair,
  repeatIndex: number,
  error: string,
): AgreementCallResult {
  return {
    pair_label: pair.label,
    pair_kind: pair.pair_kind,
    repeat_index: repeatIndex,
    holistic_winner: 'TIE',
    holistic_confidence: 0,
    rubric_winner: 'TIE',
    rubric_confidence: 0,
    rubric_matches_holistic: null,
    holistic_cost_usd: null,
    rubric_cost_usd: null,
    cost_usd: null,
    prompt_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    wall_ms: null,
    holistic_forward_raw: null,
    holistic_reverse_raw: null,
    rubric_forward_raw: null,
    rubric_reverse_raw: null,
    error,
    ...pairSnapshot(pair),
    criterionVerdicts: [],
  };
}

/** Evaluate ONE pair across `repeats` repeats. Each repeat = 4 LLM calls (2 holistic + 2 rubric),
 *  dispatched together via Promise.all and judged with the same `judge` (one model). */
export async function evaluatePairAgreement(
  pair: JudgeEvalPair,
  rubric: ResolvedJudgeRubric,
  repeats: number,
  judge: JudgeFn,
): Promise<AgreementCallResult[]> {
  const mode: PairKind = pair.pair_kind;
  const dimNames = rubric.dimensions.map((d) => d.name);

  const holisticFwdPrompt = buildComparisonPrompt(pair.text_a, pair.text_b, mode);
  const holisticRevPrompt = buildComparisonPrompt(pair.text_b, pair.text_a, mode);
  const rubricFwdPrompt = buildRubricComparisonPrompt(pair.text_a, pair.text_b, rubric, mode);
  const rubricRevPrompt = buildRubricComparisonPrompt(pair.text_b, pair.text_a, rubric, mode);

  const results: AgreementCallResult[] = [];
  for (let i = 0; i < repeats; i++) {
    const started = Date.now();
    try {
      const [hFwd, hRev, rFwd, rRev] = await Promise.all([
        judge(holisticFwdPrompt),
        judge(holisticRevPrompt),
        judge(rubricFwdPrompt),
        judge(rubricRevPrompt),
      ]);
      const wallMs = Date.now() - started;

      const holistic = aggregateWinners(norm(parseWinner(hFwd.text)), norm(parseWinner(hRev.text)));
      const rubricResult = aggregateRubric(
        parseRubricVerdict(rFwd.text, dimNames),
        parseRubricVerdict(rRev.text, dimNames),
        rubric,
      );
      const { matches, criterionVerdicts } = computePairAgreement(
        holistic.winner,
        rubricResult.rubricBreakdown,
        pair.expected_winner,
        pair.gap_kind,
      );

      const holisticCost = hFwd.costUsd + hRev.costUsd;
      const rubricCost = rFwd.costUsd + rRev.costUsd;
      results.push({
        pair_label: pair.label,
        pair_kind: pair.pair_kind,
        repeat_index: i,
        holistic_winner: holistic.winner,
        holistic_confidence: holistic.confidence,
        rubric_winner: rubricResult.winner,
        rubric_confidence: rubricResult.confidence,
        rubric_matches_holistic: matches,
        holistic_cost_usd: holisticCost,
        rubric_cost_usd: rubricCost,
        cost_usd: holisticCost + rubricCost,
        prompt_tokens: hFwd.promptTokens + hRev.promptTokens + rFwd.promptTokens + rRev.promptTokens,
        output_tokens: hFwd.outputTokens + hRev.outputTokens + rFwd.outputTokens + rRev.outputTokens,
        reasoning_tokens:
          hFwd.reasoningTokens + hRev.reasoningTokens + rFwd.reasoningTokens + rRev.reasoningTokens,
        wall_ms: wallMs,
        holistic_forward_raw: hFwd.text,
        holistic_reverse_raw: hRev.text,
        rubric_forward_raw: rFwd.text,
        rubric_reverse_raw: rRev.text,
        error: null,
        ...pairSnapshot(pair),
        criterionVerdicts,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push(erroredAgreementRow(pair, i, error));
      throw Object.assign(new Error(error), { partialResults: results });
    }
  }
  return results;
}

/** Run every pair (bounded concurrency) and return all per-repeat agreement results. On failure,
 *  attach everything completed so far so the caller can persist a real errored run. */
export async function runAgreementOverPairs(
  pairs: JudgeEvalPair[],
  rubric: ResolvedJudgeRubric,
  repeats: number,
  judge: JudgeFn,
  concurrency: number = DEFAULT_AGREEMENT_CONCURRENCY,
): Promise<AgreementCallResult[]> {
  const limit = Math.max(1, concurrency);
  const out: AgreementCallResult[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < pairs.length) {
      const pair = pairs[idx++]!;
      const rows = await evaluatePairAgreement(pair, rubric, repeats, judge);
      out.push(...rows);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(limit, pairs.length) }, () => worker()));
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
      partialResults: [...out, ...(readPartialResults(e) as unknown as AgreementCallResult[])],
    });
  }
  return out;
}
