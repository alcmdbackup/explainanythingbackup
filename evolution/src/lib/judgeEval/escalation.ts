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
}

function norm(s: string | null): Winner | null {
  return s === 'A' || s === 'B' || s === 'TIE' ? s : null;
}

function toSubVerdict(rec: SubmatchRecord): SubVerdict {
  return {
    sourceKind: 'judge',
    sourceId: rec.model,
    winner: rec.winner as Verdict,
    confidence: rec.confidence,
    weight: 1,
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
  const cap = config.cap ?? DEFAULT_ESCALATION_CAP;
  const mode = pair.pair_kind;
  const customPrompt = config.settings?.customPromptOverride ?? undefined;
  const explain = config.settings?.explainReasoning ?? false;
  const parser = explain || customPrompt != null ? parseVerdictFromReasoning : parseWinner;
  const forwardPrompt = buildComparisonPrompt(pair.text_a, pair.text_b, mode, customPrompt, explain);
  const reversePrompt = buildComparisonPrompt(pair.text_b, pair.text_a, mode, customPrompt, explain);

  const submatches: SubmatchRecord[] = [];
  for (const model of config.chainModels.slice(0, cap)) {
    const judge = makeJudge(model);
    let rec: SubmatchRecord;
    try {
      const [fwd, rev] = await Promise.all([judge(forwardPrompt), judge(reversePrompt)]);
      const fParsed = norm(parser(fwd.text));
      const rParsed = norm(parser(rev.text));
      const agg = aggregateWinners(fParsed, rParsed);
      rec = {
        model,
        escalationStep: submatches.length,
        triggeredEscalation: false,
        forwardWinner: fParsed,
        reverseWinner: rParsed,
        winner: agg.winner,
        confidence: agg.confidence,
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
