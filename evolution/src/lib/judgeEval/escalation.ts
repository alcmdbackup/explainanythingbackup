// Escalation evaluator (Judge Lab): runs the sequential judge chain for ONE pair. For each chain
// model it does a single-judge 2-pass (forward+reverse via makeJudge(model)), folds it into a
// SubVerdict, and after each step the aggregation rule decides stop (resolved) vs escalate (cap N).
// Produces the consolidated match verdict + per-submatch audit (cost/raw/tokens) at parity with
// judge_eval_calls. The JudgeFn factory is injected, so this is unit-testable with a plain fake.

import {
  buildComparisonPrompt,
  parseWinner,
  parseVerdictFromReasoning,
  aggregateWinners,
} from '../shared/computeRatings';
import {
  buildRubricComparisonPrompt,
  parseRubricVerdict,
  aggregateRubric,
  type RubricBreakdown,
  type ResolvedJudgeRubric,
} from '../shared/rubricJudge';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import type { JudgeFn, JudgeSettings } from './runJudgeEval';
import type { JudgeEvalPair, Winner } from './schemas';
import type {
  AggregationRule,
  ConsolidatedVerdict,
  SubVerdict,
  Verdict,
} from '../shared/judgeEnsemble/types';
import { DEFAULT_ESCALATION_CAP } from '../shared/judgeEnsemble/planner';

/** One submatch's full record (one judge's 2-pass), ready to persist as a judge_eval_calls row. */
export interface SubmatchRecord {
  model: string;
  escalationStep: number;
  triggeredEscalation: boolean;
  forwardWinner: Winner | null;
  reverseWinner: Winner | null;
  winner: Winner;
  confidence: number;
  costUsd: number;
  promptTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  forwardRaw: string | null;
  reverseRaw: string | null;
  forwardPrompt: string;
  reversePrompt: string;
  forwardReasoning: string | null;
  reverseReasoning: string | null;
  error: string | null;
  /** Rubric-mode only: the per-dimension breakdown (persisted as dimension-verdict rows). */
  rubricBreakdown?: RubricBreakdown;
  /** Rubric-mode only: the rubric id this submatch judged with (undefined for holistic). */
  judgeRubricId?: string;
  /** criteria_split only: 'criterion' (one dimension) vs the default whole-text 'judge'. */
  sourceKind?: 'judge' | 'criterion';
  /** criteria_split only: the criteria_id this submatch judged, + its parent-rubric weight. */
  criteriaId?: string;
  weight?: number;
}

export interface EscalationOutcome {
  consolidated: ConsolidatedVerdict;
  submatches: SubmatchRecord[];
}

export interface EscalationConfig {
  chainModels: string[];
  rule: AggregationRule;
  cap?: number;
  /** Prompt-level settings shared across the chain (per-model temp/reasoning is baked into makeJudge). */
  settings?: Pick<JudgeSettings, 'customPromptOverride' | 'explainReasoning'>;
  /** When set, every submatch judges via this rubric (per-dimension), producing a rubricBreakdown. */
  rubric?: ResolvedJudgeRubric;
  /** Dispatch strategy. 'escalation' (default) = sequential whole-rubric ladder, stop-on-decisive.
   *  'criteria_split' = one submatch PER rubric dimension (each a 1-criterion judge), folded by
   *  the criteria_weighted rule. Requires `rubric`. */
  planner?: 'escalation' | 'criteria_split';
  /** criteria_split only: criteria_id -> model. Unmapped criteria round-robin over chainModels. */
  criteriaModelMap?: Record<string, string>;
}

function norm(s: string | null): Winner | null {
  return s === 'A' || s === 'B' || s === 'TIE' ? s : null;
}

function toSubVerdict(rec: SubmatchRecord): SubVerdict {
  const sourceKind = rec.sourceKind ?? 'judge';
  return {
    sourceKind,
    // criterion submatches fold by criteria_id; judge submatches by model.
    sourceId: sourceKind === 'criterion' ? (rec.criteriaId ?? rec.model) : rec.model,
    winner: rec.winner as Verdict,
    confidence: rec.confidence,
    weight: rec.weight ?? 1,
    escalationStep: rec.escalationStep,
    triggeredEscalation: rec.triggeredEscalation,
  };
}

/** Budget / kill-switch errors must propagate (never become an abstention that keeps spending). */
function isFatalJudgeError(e: unknown): boolean {
  return e instanceof GlobalBudgetExceededError || e instanceof LLMKillSwitchError;
}

/** Run the escalation chain for ONE pair. `makeJudge(model)` yields a per-model 2-pass JudgeFn.
 *  Stops as soon as the rule resolves (winner !== 'TIE') or the cap is reached. A transient
 *  (post-retry) submatch failure is recorded as an abstention and the chain escalates; a fatal
 *  budget/kill error propagates with the partial submatches attached. */
export async function evaluatePairWithEscalation(
  pair: JudgeEvalPair,
  config: EscalationConfig,
  makeJudge: (model: string) => JudgeFn,
): Promise<EscalationOutcome> {
  if (config.planner === 'criteria_split') {
    return evaluatePairWithCriteriaSplit(pair, config, makeJudge);
  }
  const cap = config.cap ?? DEFAULT_ESCALATION_CAP;
  const mode = pair.pair_kind;
  const rubric = config.rubric;
  const customPrompt = config.settings?.customPromptOverride ?? undefined;
  const explain = config.settings?.explainReasoning ?? false;
  const parser = explain || customPrompt != null ? parseVerdictFromReasoning : parseWinner;
  const dimNames = rubric ? rubric.dimensions.map((d) => d.name) : [];
  const forwardPrompt = rubric
    ? buildRubricComparisonPrompt(pair.text_a, pair.text_b, rubric, mode)
    : buildComparisonPrompt(pair.text_a, pair.text_b, mode, customPrompt, explain);
  const reversePrompt = rubric
    ? buildRubricComparisonPrompt(pair.text_b, pair.text_a, rubric, mode)
    : buildComparisonPrompt(pair.text_b, pair.text_a, mode, customPrompt, explain);

  const submatches: SubmatchRecord[] = [];
  for (const model of config.chainModels.slice(0, cap)) {
    const judge = makeJudge(model);
    let rec: SubmatchRecord;
    try {
      const [fwd, rev] = await Promise.all([judge(forwardPrompt), judge(reversePrompt)]);
      let forwardWinner: Winner | null;
      let reverseWinner: Winner | null;
      let winner: Winner;
      let confidence: number;
      let rubricBreakdown: RubricBreakdown | undefined;
      if (rubric) {
        // Rubric mode: per-dimension verdicts → weighted per-pass scores → reconciled match verdict.
        const rr = aggregateRubric(
          parseRubricVerdict(fwd.text, dimNames),
          parseRubricVerdict(rev.text, dimNames),
          rubric,
        );
        winner = rr.winner;
        confidence = rr.confidence;
        rubricBreakdown = rr.rubricBreakdown;
        // Per-pass winners for the call-row audit (real-frame, from the rubric breakdown).
        forwardWinner = rr.rubricBreakdown.forwardPass.winner;
        reverseWinner = rr.rubricBreakdown.reversePass.winner;
      } else {
        forwardWinner = norm(parser(fwd.text));
        reverseWinner = norm(parser(rev.text));
        const agg = aggregateWinners(forwardWinner, reverseWinner);
        winner = agg.winner;
        confidence = agg.confidence;
      }
      rec = {
        model,
        escalationStep: submatches.length,
        triggeredEscalation: false,
        forwardWinner,
        reverseWinner,
        winner,
        confidence,
        costUsd: fwd.costUsd + rev.costUsd,
        promptTokens: fwd.promptTokens + rev.promptTokens,
        outputTokens: fwd.outputTokens + rev.outputTokens,
        reasoningTokens: fwd.reasoningTokens + rev.reasoningTokens,
        forwardRaw: fwd.text,
        reverseRaw: rev.text,
        forwardPrompt,
        reversePrompt,
        forwardReasoning: fwd.reasoningTrace ?? null,
        reverseReasoning: rev.reasoningTrace ?? null,
        error: null,
        rubricBreakdown,
        judgeRubricId: rubric?.rubricId,
      };
    } catch (e) {
      if (isFatalJudgeError(e)) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
          partialSubmatches: submatches,
        });
      }
      // Transient failure (already retried by the JudgeFn): record an abstention and escalate.
      rec = {
        model,
        escalationStep: submatches.length,
        triggeredEscalation: false,
        forwardWinner: null,
        reverseWinner: null,
        winner: 'TIE',
        confidence: 0,
        costUsd: 0,
        promptTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        forwardRaw: null,
        reverseRaw: null,
        forwardPrompt,
        reversePrompt,
        forwardReasoning: null,
        reverseReasoning: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    submatches.push(rec);
    if (config.rule.aggregate(submatches.map(toSubVerdict)).winner !== 'TIE') break;
  }

  // Every submatch except the last triggered the next escalation.
  for (let i = 0; i < submatches.length - 1; i += 1) {
    const s = submatches[i];
    if (s) s.triggeredEscalation = true;
  }
  const consolidated = config.rule.aggregate(submatches.map(toSubVerdict));
  return { consolidated, submatches };
}

/** Pick the model for a criterion: explicit map first, else round-robin over the chain models. */
function modelForCriterion(
  criteriaId: string,
  index: number,
  chainModels: string[],
  map?: Record<string, string>,
): string {
  const mapped = map?.[criteriaId];
  if (mapped) return mapped;
  if (chainModels.length === 0) throw new Error('criteria_split needs at least one chain model');
  return chainModels[index % chainModels.length] as string;
}

/** criteria_split dispatch: run ONE 2-pass judge per rubric dimension (each judging a single-criterion
 *  rubric, possibly on a different model), then fold the per-criterion winners by weight via the
 *  criteria_weighted rule. Each criterion becomes a SubmatchRecord with a 1-dimension breakdown, so
 *  the existing dimension-verdict persistence + leaderboard work unchanged. No stop-on-decisive: a
 *  rubric split is a partition, so every criterion always runs. */
async function evaluatePairWithCriteriaSplit(
  pair: JudgeEvalPair,
  config: EscalationConfig,
  makeJudge: (model: string) => JudgeFn,
): Promise<EscalationOutcome> {
  const rubric = config.rubric;
  if (!rubric || rubric.dimensions.length === 0) {
    throw new Error('criteria_split requires a rubric with at least one dimension');
  }
  const mode = pair.pair_kind;
  const submatches: SubmatchRecord[] = [];

  for (let i = 0; i < rubric.dimensions.length; i += 1) {
    const dim = rubric.dimensions[i]!;
    // A single-criterion rubric: scoring it reduces to this dimension's own verdict, but it keeps
    // the criterion's real (parent-normalized) weight so the breakdown + fold reflect true weights.
    const subRubric: ResolvedJudgeRubric = { rubricId: rubric.rubricId, dimensions: [dim] };
    const model = modelForCriterion(dim.criteriaId, i, config.chainModels, config.criteriaModelMap);
    const forwardPrompt = buildRubricComparisonPrompt(pair.text_a, pair.text_b, subRubric, mode);
    const reversePrompt = buildRubricComparisonPrompt(pair.text_b, pair.text_a, subRubric, mode);
    const judge = makeJudge(model);
    let rec: SubmatchRecord;
    try {
      const [fwd, rev] = await Promise.all([judge(forwardPrompt), judge(reversePrompt)]);
      const rr = aggregateRubric(
        parseRubricVerdict(fwd.text, [dim.name]),
        parseRubricVerdict(rev.text, [dim.name]),
        subRubric,
      );
      rec = {
        model,
        escalationStep: i,
        triggeredEscalation: false,
        forwardWinner: rr.rubricBreakdown.forwardPass.winner,
        reverseWinner: rr.rubricBreakdown.reversePass.winner,
        winner: rr.winner,
        confidence: rr.confidence,
        costUsd: fwd.costUsd + rev.costUsd,
        promptTokens: fwd.promptTokens + rev.promptTokens,
        outputTokens: fwd.outputTokens + rev.outputTokens,
        reasoningTokens: fwd.reasoningTokens + rev.reasoningTokens,
        forwardRaw: fwd.text,
        reverseRaw: rev.text,
        forwardPrompt,
        reversePrompt,
        forwardReasoning: fwd.reasoningTrace ?? null,
        reverseReasoning: rev.reasoningTrace ?? null,
        error: null,
        rubricBreakdown: rr.rubricBreakdown,
        judgeRubricId: rubric.rubricId,
        sourceKind: 'criterion',
        criteriaId: dim.criteriaId,
        weight: dim.weight,
      };
    } catch (e) {
      if (isFatalJudgeError(e)) {
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
          partialSubmatches: submatches,
        });
      }
      rec = {
        model,
        escalationStep: i,
        triggeredEscalation: false,
        forwardWinner: null,
        reverseWinner: null,
        winner: 'TIE',
        confidence: 0,
        costUsd: 0,
        promptTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        forwardRaw: null,
        reverseRaw: null,
        forwardPrompt,
        reversePrompt,
        forwardReasoning: null,
        reverseReasoning: null,
        error: e instanceof Error ? e.message : String(e),
        sourceKind: 'criterion',
        criteriaId: dim.criteriaId,
        weight: dim.weight,
      };
    }
    submatches.push(rec);
  }

  const consolidated = config.rule.aggregate(submatches.map(toSubVerdict));
  return { consolidated, submatches };
}
