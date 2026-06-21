// Judge-evaluation engine: runs the 2-pass A/B reversal for each (pair × repeat) of a sweep,
// mirroring rejudgeComparisonAction (arenaActions.ts) — inlined Promise.all 2-pass (NOT
// run2PassReversal, which discards per-pass raw responses; NOT compareWithBiasMitigation,
// which has no temperature/customPrompt/reasoning + a text-only cache). The LLM call is
// injected (JudgeFn) so the engine is unit-testable with a plain fake; createCallLLMJudge()
// builds the production path over plain callLLM with the E2E stub, prod guard, budget catch,
// and onUsage cost/token capture. Writes nothing — persistence lives in persist.ts.

import {
  buildComparisonPrompt,
  parseWinner,
  parseVerdictFromReasoning,
  aggregateWinners,
} from '../shared/computeRatings';
import { callLLM, type CallLLMOptions, type LLMUsageMetadata } from '@/lib/services/llms';
import { CALL_SOURCES } from '@/lib/services/llmCallSource';
import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import { isTransientError } from '../shared/classifyErrors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type {
  JudgeEvalPair,
  JudgeEvalCallResult,
  JudgeReasoningEffort,
  JudgeReasoningTraceFormat,
  Winner,
  PairKind,
} from './schemas';
import { readPartialResults } from './schemas';

export const JUDGE_EVAL_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_JUDGE_EVAL_CONCURRENCY = 8;
/** Bounded retry for transient judge-call failures (the provider clients use maxRetries:0). */
export const MAX_JUDGE_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

/** Result of one judge LLM call (one pass). */
export interface JudgeCallOutput {
  text: string;
  costUsd: number;
  promptTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Verbatim/summary reasoning trace text when the provider surfaces it (via onUsage). */
  reasoningTrace?: string | null;
  /** 'verbatim' | 'summary' | 'unavailable'; undefined/null = thinking not requested. */
  reasoningTraceFormat?: JudgeReasoningTraceFormat | null;
}
export type JudgeFn = (prompt: string) => Promise<JudgeCallOutput>;

export interface JudgeSettings {
  judgeModel: string;
  /** Omit to use provider default; honored only for models that support it. */
  temperature?: number;
  reasoningEffort?: JudgeReasoningEffort;
  /** Rubric/instruction override (texts are never baked in). null = built-in rubric. */
  customPromptOverride?: string | null;
  /** Whether the judge prompt asks for free-form reasoning before the verdict. */
  explainReasoning?: boolean;
}

function norm(s: string | null): Winner | null {
  return s === 'A' || s === 'B' || s === 'TIE' ? s : null;
}

/** Ground-truth pair characteristics, frozen onto every call row (success OR errored) so the
 *  match history is analyzable later without re-joining the mutable pair-bank. */
function pairSnapshot(pair: JudgeEvalPair): Pick<
  JudgeEvalCallResult,
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

function validatePrompt(p: string): void {
  if (!p.includes('## Text A') || !p.includes('## Text B') || !/your answer/i.test(p)) {
    throw new Error('Invalid judge prompt (missing Text A/Text B/verdict instruction)');
  }
}

/**
 * Evaluate ONE pair across `repeats` repeats. Each repeat = 2 LLM calls (forward + reverse).
 * Pure orchestration over the injected JudgeFn — no DB, no provider coupling.
 */
export async function evaluatePair(
  pair: JudgeEvalPair,
  settings: JudgeSettings,
  repeats: number,
  judge: JudgeFn,
): Promise<JudgeEvalCallResult[]> {
  const mode: PairKind = pair.pair_kind; // 'article' | 'paragraph' → comparison rubric
  const wantsFreeform =
    (settings.explainReasoning ?? false) || settings.customPromptOverride != null;
  const parser = wantsFreeform ? parseVerdictFromReasoning : parseWinner;

  const forwardPrompt = buildComparisonPrompt(
    pair.text_a,
    pair.text_b,
    mode,
    settings.customPromptOverride ?? undefined,
    settings.explainReasoning ?? false,
  );
  const reversePrompt = buildComparisonPrompt(
    pair.text_b,
    pair.text_a,
    mode,
    settings.customPromptOverride ?? undefined,
    settings.explainReasoning ?? false,
  );
  validatePrompt(forwardPrompt);
  validatePrompt(reversePrompt);

  const results: JudgeEvalCallResult[] = [];
  for (let i = 0; i < repeats; i++) {
    const started = Date.now();
    let fwd: JudgeCallOutput;
    let rev: JudgeCallOutput;
    let error: string | null = null;
    try {
      [fwd, rev] = await Promise.all([judge(forwardPrompt), judge(reversePrompt)]);
    } catch (e) {
      // Surface budget/kill cleanly; record an errored repeat and stop this pair. The prompts are
      // known even on failure (built above), and the snapshot is always available → only the LLM
      // output (reasoning/raw) is null on an errored row.
      error = e instanceof Error ? e.message : String(e);
      results.push(erroredRepeat(pair, mode, i, error, forwardPrompt, reversePrompt));
      throw Object.assign(new Error(error), { partialResults: results });
    }
    const wallMs = Date.now() - started;

    const fParsed = norm(parser(fwd.text));
    const rParsed = norm(parser(rev.text));
    const agg = aggregateWinners(fParsed, rParsed);

    results.push({
      pair_label: pair.label,
      pair_kind: pair.pair_kind,
      comparison_mode: mode,
      repeat_index: i,
      forward_winner: fParsed,
      reverse_winner: rParsed,
      winner: agg.winner,
      confidence: agg.confidence,
      wall_ms: wallMs,
      fwd_ms: null,
      rev_ms: null,
      prompt_tokens: fwd.promptTokens + rev.promptTokens,
      output_tokens: fwd.outputTokens + rev.outputTokens,
      reasoning_tokens: fwd.reasoningTokens + rev.reasoningTokens,
      cost_usd: fwd.costUsd + rev.costUsd,
      forward_raw: fwd.text,
      reverse_raw: rev.text,
      error: null,
      // Audit: exact rendered inputs + per-pass reasoning trace. fwd/rev are distinct calls, so their
      // reasoning is kept separate (mirrors forward_raw/reverse_raw); format is a single per-call value.
      forward_prompt: forwardPrompt,
      reverse_prompt: reversePrompt,
      forward_reasoning: fwd.reasoningTrace ?? null,
      reverse_reasoning: rev.reasoningTrace ?? null,
      reasoning_trace_format: fwd.reasoningTraceFormat ?? rev.reasoningTraceFormat ?? null,
      ...pairSnapshot(pair),
    });
  }
  return results;
}

function erroredRepeat(
  pair: JudgeEvalPair,
  mode: PairKind,
  i: number,
  error: string,
  forwardPrompt: string,
  reversePrompt: string,
): JudgeEvalCallResult {
  return {
    pair_label: pair.label,
    pair_kind: pair.pair_kind,
    comparison_mode: mode,
    repeat_index: i,
    forward_winner: null,
    reverse_winner: null,
    winner: 'TIE',
    confidence: 0,
    wall_ms: null,
    fwd_ms: null,
    rev_ms: null,
    prompt_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    cost_usd: null,
    forward_raw: null,
    reverse_raw: null,
    error,
    // Inputs are known on failure; the LLM never produced output → reasoning/format null.
    forward_prompt: forwardPrompt,
    reverse_prompt: reversePrompt,
    forward_reasoning: null,
    reverse_reasoning: null,
    reasoning_trace_format: null,
    ...pairSnapshot(pair),
  };
}

/** Run every pair (bounded concurrency) and return all per-repeat call results. */
export async function runJudgeEval(
  pairs: JudgeEvalPair[],
  settings: JudgeSettings,
  repeats: number,
  judge: JudgeFn,
  concurrency: number = DEFAULT_JUDGE_EVAL_CONCURRENCY,
): Promise<JudgeEvalCallResult[]> {
  const limit = Math.max(1, concurrency);
  const out: JudgeEvalCallResult[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < pairs.length) {
      const pair = pairs[idx++]!;
      const rows = await evaluatePair(pair, settings, repeats, judge);
      out.push(...rows);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(limit, pairs.length) }, () => worker()));
  } catch (e) {
    // On failure, attach everything completed so far (other pairs in `out`) plus the failing
    // pair's rows (carried on the thrown error by evaluatePair) so the caller can persist a
    // real errored run instead of leaving a 0-call orphan. See executeSweep.
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), {
      partialResults: [...out, ...readPartialResults(e)],
    });
  }
  return out;
}

/**
 * Build the production JudgeFn over plain callLLM (NOT createEvolutionLLMClient, which pins
 * ranking temp=0 and writes evolution_metrics). E2E stub + prod guard mirror rejudge.
 */
export function createCallLLMJudge(params: {
  judgeModel: string;
  temperature?: number;
  reasoningEffort?: JudgeReasoningEffort;
  userId?: string;
  trackingDb?: SupabaseClient<Database>;
  /** Base backoff in ms (delay = base * 2^attempt). 0 disables sleeping (tests). */
  retryBaseDelayMs?: number;
}): JudgeFn {
  const isE2E = process.env.E2E_TEST_MODE === 'true';
  if (isE2E && process.env.NODE_ENV === 'production' && !process.env.CI) {
    throw new Error('E2E_TEST_MODE must not be enabled in production');
  }
  const userId = params.userId ?? JUDGE_EVAL_SYSTEM_USERID;
  const baseDelayMs = params.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  return async (prompt: string): Promise<JudgeCallOutput> => {
    if (isE2E) {
      return {
        text: 'Stubbed reasoning for E2E.\nYour answer: A',
        costUsd: 0, promptTokens: 0, outputTokens: 0, reasoningTokens: 0,
        reasoningTrace: null, reasoningTraceFormat: null,
      };
    }
    // The provider clients are built with maxRetries:0, so a single transient 429/5xx/timeout
    // would otherwise abort the whole sweep cell. Retry transient failures with bounded backoff.
    // Each retry re-enters callLLM and so re-checks the global spending gate. Budget/kill-switch
    // errors are NOT retried. Accumulators are scoped per-attempt so a failed attempt can't
    // double-count cost/tokens.
    for (let attempt = 0; ; attempt++) {
      let costUsd = 0;
      let promptTokens = 0;
      let outputTokens = 0;
      let reasoningTokens = 0;
      // Reasoning trace + format ride on the usage callback (NOT callLLM's return value).
      // Last-write-wins within this attempt; reset per-attempt with the token accumulators.
      let reasoningTrace: string | null = null;
      let reasoningTraceFormat: JudgeReasoningTraceFormat | null = null;
      const opts: CallLLMOptions = {
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.reasoningEffort != null ? { reasoningEffort: params.reasoningEffort } : {}),
        ...(params.trackingDb != null ? { trackingDb: params.trackingDb } : {}),
        onUsage: (u: LLMUsageMetadata) => {
          costUsd += u.estimatedCostUsd;
          promptTokens += u.promptTokens;
          outputTokens += u.completionTokens;
          reasoningTokens += u.reasoningTokens;
          if (u.reasoningTrace != null) reasoningTrace = u.reasoningTrace;
          if (u.reasoningTraceFormat != null) reasoningTraceFormat = u.reasoningTraceFormat;
        },
      };
      try {
        // call_source 'evolution_judge_eval' → inherits the shared LLM semaphore + global gate.
        const text = await callLLM(prompt, CALL_SOURCES.evolutionJudgeEval, userId, params.judgeModel, false, null, null, null, false, opts);
        return { text, costUsd, promptTokens, outputTokens, reasoningTokens, reasoningTrace, reasoningTraceFormat };
      } catch (e) {
        if (e instanceof GlobalBudgetExceededError || e instanceof LLMKillSwitchError) {
          throw new Error(`Judge eval unavailable: ${e.message}`);
        }
        if (attempt < MAX_JUDGE_RETRIES && isTransientError(e)) {
          if (baseDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
          }
          continue;
        }
        throw e;
      }
    }
  };
}
