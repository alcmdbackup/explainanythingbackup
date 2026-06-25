// Auto mode (LLM-as-judge): per-pair holistic OVERALL verdict + per-criterion verdicts,
// reusing the existing 2-pass comparison primitives (display-only, zero ratings/arena
// writes). The LLM call is an injected `JudgeText` closure (temperature/model/cost live in
// the closure) so this is unit-testable. auto_repeats folds K runs into one canonical
// verdict + cross-repeat-agreement confidence.

import {
  aggregateWinners,
  buildComparisonPrompt,
  compareWithBiasMitigation,
  parseWinner,
  run2PassReversal,
  type ComparisonMode,
  type ComparisonResult,
} from '@evolution/lib/shared/computeRatings';
import { reconcilePasses, type ResolvedJudgeRubric, type Verdict } from '@evolution/lib/shared/rubricJudge';

export type AutoVerdict = 'a' | 'b' | 'tie';
export type JudgeText = (prompt: string) => Promise<string>;

function lc(v: string | null): AutoVerdict | null {
  switch (v) {
    case 'A':
      return 'a';
    case 'B':
      return 'b';
    case 'TIE':
      return 'tie';
    default:
      return null;
  }
}
function lcReq(v: Verdict): AutoVerdict {
  switch (v) {
    case 'A':
      return 'a';
    case 'B':
      return 'b';
    default:
      return 'tie';
  }
}
function flipUpper(v: string | null): string | null {
  switch (v) {
    case 'A':
      return 'B';
    case 'B':
      return 'A';
    default:
      return v; // TIE/null unchanged
  }
}

export interface SinglePairResult {
  overall: AutoVerdict;
  overallConfidence: number;
  forwardWinner: AutoVerdict | null;
  reverseWinner: AutoVerdict | null;
  dims: Array<{ criteriaId: string; verdict: AutoVerdict; confidence: number }>;
  costUsd: number;
}

/**
 * Judge one pair once: holistic overall (2-pass reversal, capturing forward/reverse for
 * the position-bias audit) + per-criterion (rubric 2-pass via compareWithBiasMitigation;
 * per-dimension verdicts are weight-independent). textA/textB are the canonical A/B — the
 * 2-pass reversal yields real-frame verdicts, so NO shown_swapped flip is needed.
 *
 * `holisticOverride` (evalute_implied_rubric_results_and_experimentally_validate_20260623
 * Phase 1): when non-empty, replaces the hardcoded checklist in the holistic prompt. Passed
 * through `buildComparisonPrompt(customPromptOverride=..., strictVerdictTail=true)` so the
 * strict A/B/TIE verdict tail is emitted (compatible with `parseWinner` — start-anchored).
 * The per-criterion path (`compareWithBiasMitigation` → `buildRubricComparisonPrompt`) is
 * unaffected — it has no override, by design. The Zod schema layer enforces a deny-list
 * (`## Text A`, `## Text B`, `Your answer:`, `<|`, `|>`) so the operator-supplied override
 * cannot pre-position fake body markers.
 */
export async function judgePairOnce(
  judge: JudgeText,
  textA: string,
  textB: string,
  rubric: ResolvedJudgeRubric,
  costAcc: { usd: number },
  mode: ComparisonMode = 'article',
  holisticOverride?: string,
): Promise<SinglePairResult> {
  const start = costAcc.usd;
  const passes: { fwd: string | null; revShown: string | null } = { fwd: null, revShown: null };

  const override = holisticOverride && holisticOverride.length > 0 ? holisticOverride : undefined;
  const overallRes = await run2PassReversal<string | null, ComparisonResult>({
    buildPrompts: () => ({
      // Override is forwarded to BOTH forward and reverse passes — symmetric framing is
      // essential for 2-pass reversal to be meaningful.
      forward: buildComparisonPrompt(textA, textB, mode, override, false, undefined, undefined, undefined, true),
      reverse: buildComparisonPrompt(textB, textA, mode, override, false, undefined, undefined, undefined, true),
    }),
    callLLM: judge,
    parseResponse: (r) => parseWinner(r),
    aggregate: (f, r) => {
      passes.fwd = f;
      passes.revShown = r;
      return aggregateWinners(f, r);
    },
  });

  const rubricRes = await compareWithBiasMitigation(textA, textB, judge, undefined, mode, rubric);
  const dims = (rubricRes.rubricBreakdown?.dimensions ?? []).map((d) => {
    const rec = reconcilePasses(d.forwardVerdict, d.reverseVerdict);
    return { criteriaId: d.criteriaId, verdict: lcReq(rec.winner), confidence: rec.confidence };
  });

  return {
    overall: lcReq(overallRes.winner),
    overallConfidence: overallRes.confidence,
    forwardWinner: lc(passes.fwd),
    reverseWinner: lc(flipUpper(passes.revShown)),
    dims,
    costUsd: costAcc.usd - start,
  };
}

function majority(values: AutoVerdict[]): { winner: AutoVerdict; agreement: number } {
  if (values.length === 0) return { winner: 'tie', agreement: 0 };
  const counts: Record<AutoVerdict, number> = { a: 0, b: 0, tie: 0 };
  for (const v of values) counts[v]++;
  let winner: AutoVerdict = 'tie';
  let best = -1;
  for (const v of ['a', 'b', 'tie'] as AutoVerdict[]) {
    if (counts[v] > best) {
      best = counts[v];
      winner = v;
    }
  }
  return { winner, agreement: best / values.length };
}

/**
 * Fold K repeats of the same pair into one canonical result: majority verdict per channel
 * (overall + each criterion), confidence = cross-repeat agreement fraction, cost summed.
 * forward/reverse winners are taken from the first repeat (for the position-bias audit).
 */
export function foldRepeats(results: SinglePairResult[]): SinglePairResult {
  if (results.length === 0) {
    return { overall: 'tie', overallConfidence: 0, forwardWinner: null, reverseWinner: null, dims: [], costUsd: 0 };
  }
  if (results.length === 1) return results[0]!;

  const overall = majority(results.map((r) => r.overall));
  const first = results[0]!;
  const criteriaIds = first.dims.map((d) => d.criteriaId);
  const dims = criteriaIds.map((criteriaId) => {
    const verdicts = results
      .map((r) => r.dims.find((d) => d.criteriaId === criteriaId)?.verdict)
      .filter((v): v is AutoVerdict => v !== undefined);
    const m = majority(verdicts);
    return { criteriaId, verdict: m.winner, confidence: m.agreement };
  });

  return {
    overall: overall.winner,
    overallConfidence: overall.agreement,
    forwardWinner: first.forwardWinner,
    reverseWinner: first.reverseWinner,
    dims,
    costUsd: results.reduce((s, r) => s + r.costUsd, 0),
  };
}
