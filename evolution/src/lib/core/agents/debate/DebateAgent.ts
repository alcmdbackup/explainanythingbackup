// DebateThenGenerateFromPreviousArticleAgent: a wrapper agent that runs ONE
// combined "analyze + judge" LLM call comparing the top-2 pool variants, then
// delegates synthesis to GenerateFromPreviousArticleAgent.execute() with a
// customPrompt built from the judge's verdict. (bring_back_debate_agent_20260506.)
//
// LOAD-BEARING INVARIANTS:
//   I1. Inner GFPA must be invoked via `.execute()` directly, NOT `.run()`.
//       `.run()` would create a NESTED Agent.run() scope (separate AgentCostScope),
//       splitting cost attribution between this wrapper and the inner GFPA invocation.
//   I2. Cost snapshots taken before EACH helper LLM call (combined judge call,
//       inner GFPA call) so per-purpose cost split is accurate even on partial failures.
//   I3. Partial-detail-on-throw at every failure point. Captures the verdict (when
//       parsed) onto execution_detail.debate.combined before re-throwing so the
//       invocation row preserves forensic context. Same conditional-spread pattern
//       as EvaluateCriteria — Agent.run()'s catch handler subsequently writes
//       cost_usd + success: false WITHOUT execution_detail.
//   I4. Synthesis-LLM-proxy MUST be injected via `innerInput.llm` (NOT `ctx`).
//       The proxy wraps BOTH `complete` and `completeStructured` of EvolutionLLMClient
//       and rewrites `'generation' → 'debate_synthesis'` while passing through all other
//       AgentNames (especially 'ranking' so Swiss-style pairwise comparisons inside
//       GFPA still tag `ranking_cost`). Without I4 the synthesis cost flows to
//       `generation_cost` and `EstPerAgentValue.gen` instead of `EstPerAgentValue.debate`,
//       silently breaking the cost-attribution contract.
//
// Multi-parent emission (Decision §20): the synthesized variant's parentIds = [winner.id,
// loser.id]. Order is load-bearing — parentIds[0] is the canonical primary parent
// (judge's winner), parentIds[1] is the loser. Persistence (Phase 3.8) writes both
// columns during the 1.15a→1.15b dual-write window.

import type { SupabaseClient } from '@supabase/supabase-js';
import { Agent } from '../../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../../types';
import type { ExecutionDetailBase, Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../../types';
import type { Rating, ComparisonResult } from '../../../shared/computeRatings';
import type { AgentName as LlmCallAgentName } from '../../agentNames';
import { debateExecutionDetailSchema } from '../../../schemas';
import { METRIC_CATALOG } from '../../metricCatalog';
import { computeFormatRejectionRate } from '../../../metrics/computations/finalizationInvocation';
import { updateInvocation } from '../../../pipeline/infra/trackInvocations';
import { registerAttributionExtractor } from '../../../metrics/attributionExtractors';
import { resolveDebateJudgeReasoningEffort } from '../../../pipeline/loop/debateDispatch';
import {
  GenerateFromPreviousArticleAgent,
  type GenerateFromPreviousInput,
  type GenerateFromPreviousOutput,
  type GenerateFromPreviousExecutionDetail,
} from '../generateFromPreviousArticle';
import {
  buildCombinedAnalyzeAndJudgePrompt,
  buildSynthesisCustomPrompt,
  type DebateVerdict,
} from './promptBuilders';
import { parseCombinedAnalyzeAndJudge } from './parser';
import { buildCritiqueContext } from './critiqueContext';
import { DebateLLMError, DebateParseError } from './errors';
import type { z } from 'zod';

// ─── Public types ───────────────────────────────────────────────

export interface DebateInput {
  /** Strategy's judge model — used for the combined analyze+judge call.
   *  Threaded through from runIterationLoop dispatch site. */
  judgeModel: string;
  /** Strategy-level debateJudgeReasoningEffort (cascade fallback for iteration override). */
  strategyDebateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /** Per-iteration debateJudgeReasoningEffort (highest-priority cascade input). */
  iterDebateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /** Top-2 pool variants pre-selected by resolveDebateDispatchRuntime. The runtime
   *  caller selects per Decision §16 + §12 (top-Elo with deterministic id-tiebreak). */
  variantA: Variant;
  variantB: Variant;
  /** LLM client. Optional when ctx.rawProvider is set — Agent.run() injects a scoped client. */
  llm?: EvolutionLLMClient;
  /** Iteration-start snapshots (forwarded into inner GFPA). */
  initialPool: ReadonlyArray<Variant>;
  initialRatings: ReadonlyMap<string, Rating>;
  initialMatchCounts: ReadonlyMap<string, number>;
  cache: Map<string, ComparisonResult>;
  /** Supabase admin client — needed for critique-context fetch. Optional: when absent,
   *  the agent skips critique context (prompt has no past-match block). */
  db?: SupabaseClient;
}

export type DebateOutput = GenerateFromPreviousOutput;

export type DebateExecutionDetail =
  z.infer<typeof debateExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Constants ──────────────────────────────────────────────────

/** Per-invocation budget cap (Decision §8). */
const COST_CAP_USD = 0.40;
/** Pre-synthesis budget gate threshold: 0.9 × COST_CAP. */
const PRE_SYNTHESIS_BUDGET_THRESHOLD = 0.9 * COST_CAP_USD;
/** Jaccard similarity threshold for the synthesis-no-op gate (Decision §14). */
const JACCARD_NO_OP_THRESHOLD = 0.85;
/** Max chars of raw response captured in execution_detail on parse failure. */
const RAW_RESPONSE_CAPTURE_LIMIT = 8000;

// ─── Agent class ────────────────────────────────────────────────

export class DebateThenGenerateFromPreviousArticleAgent extends Agent<
  DebateInput,
  DebateOutput,
  DebateExecutionDetail
> {
  readonly name = 'debate_then_generate_from_previous_article';
  readonly executionDetailSchema = debateExecutionDetailSchema;

  /** Attribution dimension is the static marker tactic name. Produces
   *  `eloAttrDelta:debate_then_generate_from_previous_article:debate_synthesis` rows. */
  getAttributionDimension(_detail: DebateExecutionDetail): string | null {
    return 'debate_synthesis';
  }

  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.format_rejection_rate,
      compute: (ctx) => computeFormatRejectionRate(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  // Mirror of DETAIL_VIEW_CONFIGS['debate_then_generate_from_previous_article'] —
  // the entities.test.ts parity test asserts these match exactly.
  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'variantA', label: "Parent A (Top-Elo)", type: 'object',
      children: [
        { key: 'id', label: 'Variant ID', type: 'text' },
        { key: 'elo', label: 'Elo', type: 'number' },
      ],
    },
    {
      key: 'variantB', label: 'Parent B', type: 'object',
      children: [
        { key: 'id', label: 'Variant ID', type: 'text' },
        { key: 'elo', label: 'Elo', type: 'number' },
      ],
    },
    {
      key: 'debate.combined', label: 'Analyze + Judge', type: 'object',
      children: [
        { key: 'winner', label: 'Winner', type: 'badge' },
        { key: 'reasoning', label: 'Reasoning', type: 'text' },
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
        { key: 'reasoningEffortResolved', label: 'Reasoning Effort', type: 'badge' },
        { key: 'reasoningTokens', label: 'Reasoning Tokens', type: 'number' },
        { key: 'reasoningTraceFormat', label: 'Trace Format', type: 'badge' },
      ],
    },
    { key: 'debate.combined.prosA', label: 'Pros — Variant A', type: 'list' },
    { key: 'debate.combined.consA', label: 'Cons — Variant A', type: 'list' },
    { key: 'debate.combined.prosB', label: 'Pros — Variant B', type: 'list' },
    { key: 'debate.combined.consB', label: 'Cons — Variant B', type: 'list' },
    { key: 'debate.combined.strengthsFromA', label: 'Strengths Preserved from A', type: 'list' },
    { key: 'debate.combined.strengthsFromB', label: 'Strengths Preserved from B', type: 'list' },
    { key: 'debate.combined.improvements', label: 'Improvements for Synthesis', type: 'list' },
    { key: 'debate.combined.reasoningTrace', label: 'Reasoning Trace', type: 'text' },
    { key: 'debate.failurePoint', label: 'Failure Point', type: 'badge' },
    {
      key: 'generation', label: 'Synthesis Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking', label: 'Synthesis Ranking', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
    {
      key: 'discardReason', label: 'Discard Reason', type: 'object',
      children: [
        { key: 'localElo', label: 'Local Elo', type: 'number' },
        { key: 'localTop15Cutoff', label: 'Top-15 Cutoff', type: 'number' },
      ],
    },
  ];

  async execute(
    input: DebateInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<DebateOutput, DebateExecutionDetail>> {
    // (a) Resolve LLM client. Use input.llm — Agent.run() injects via input.llm,
    //     NOT ctx.llm (verified against GFPA:162, IterativeEditing:133, EvaluateCriteria:379).
    const llm = input.llm;
    if (!llm) {
      throw new Error(
        'DebateAgent: input.llm is required (set usesLLM=true and provide ctx.rawProvider)',
      );
    }

    // (b) Cascade-resolve reasoning effort (Phase 1.14). Defensive guard inside the
    //     resolver drops effort + logs warn when judgeModel doesn't support reasoning.
    const reasoningEffort = resolveDebateJudgeReasoningEffort(
      { debateJudgeReasoningEffort: input.iterDebateJudgeReasoningEffort },
      { judgeModel: input.judgeModel, debateJudgeReasoningEffort: input.strategyDebateJudgeReasoningEffort },
      ctx.logger,
    );

    // (c) Build critique-context blocks for both parents (best-effort; null if no db).
    let critiqueA: ReturnType<typeof emptyCritiqueContext> = emptyCritiqueContext();
    let critiqueB: ReturnType<typeof emptyCritiqueContext> = emptyCritiqueContext();
    if (input.db) {
      try {
        critiqueA = await buildCritiqueContext(input.variantA.id, input.db);
        critiqueB = await buildCritiqueContext(input.variantB.id, input.db);
      } catch (err) {
        ctx.logger.warn('Critique-context fetch failed; continuing without history', {
          phaseName: 'critique_context',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // (d) Build the combined prompt + cost snapshot (I2).
    const prompt = buildCombinedAnalyzeAndJudgePrompt(
      { id: input.variantA.id, text: input.variantA.text },
      { id: input.variantB.id, text: input.variantB.text },
      critiqueA,
      critiqueB,
    );
    const costBeforeCombined = ctx.costTracker.getOwnSpent?.() ?? 0;
    const combinedStart = Date.now();

    // (e) Combined analyze+judge LLM call. AgentName 'debate_judge' so cost flows to debate_cost.
    let rawResponse: string;
    try {
      rawResponse = await llm.complete(prompt, 'debate_judge', {
        model: input.judgeModel as LLMCompletionOptions['model'],
        reasoningEffort,
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      const cost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeCombined;
      await this.persistPartialDetail(ctx, {
        variantA: input.variantA,
        variantB: input.variantB,
        failurePoint: 'combined_call',
        combined: {
          cost,
          durationMs: Date.now() - combinedStart,
          reasoningEffortResolved: reasoningEffort,
        },
        totalCost: cost,
      });
      throw new DebateLLMError(
        `Combined analyze+judge LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    const combinedCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeCombined;
    const combinedDurationMs = Date.now() - combinedStart;

    // (f) Parse the structured JSON response.
    let verdict: DebateVerdict;
    try {
      verdict = parseCombinedAnalyzeAndJudge(rawResponse);
    } catch (err) {
      const parseError = err instanceof DebateParseError ? err.message : String(err);
      await this.persistPartialDetail(ctx, {
        variantA: input.variantA,
        variantB: input.variantB,
        failurePoint: 'parse',
        combined: {
          cost: combinedCost,
          durationMs: combinedDurationMs,
          rawResponse: rawResponse.slice(0, RAW_RESPONSE_CAPTURE_LIMIT),
          parseError,
          reasoningEffortResolved: reasoningEffort,
        },
        totalCost: combinedCost,
      });
      throw err;
    }

    // (g) Pre-synthesis budget gate (Decision §8). Throws BEFORE invoking inner GFPA so we
    //     don't burn the synthesis call when the judge call alone exceeds the cap.
    const spentAfterCombined = ctx.costTracker.getOwnSpent?.() ?? 0;
    if (spentAfterCombined >= PRE_SYNTHESIS_BUDGET_THRESHOLD) {
      await this.persistPartialDetail(ctx, {
        variantA: input.variantA,
        variantB: input.variantB,
        failurePoint: 'budget',
        combined: {
          ...verdictToCombined(verdict),
          cost: combinedCost,
          durationMs: combinedDurationMs,
          reasoningEffortResolved: reasoningEffort,
        },
        totalCost: combinedCost,
      });
      throw new Error(
        `Debate budget gate fired before synthesis: spent=${spentAfterCombined.toFixed(4)}, ` +
        `threshold=${PRE_SYNTHESIS_BUDGET_THRESHOLD.toFixed(4)} (0.9 × COST_CAP $${COST_CAP_USD})`,
      );
    }

    // (h) Determine winner + loser. Tie → run synthesis but mark not-surfaced (Decision §13).
    const winner = verdict.winner === 'B' ? input.variantB : input.variantA;
    const loser = verdict.winner === 'B' ? input.variantA : input.variantB;
    const isTie = verdict.winner === 'tie';

    // (i) Build synthesis customPrompt + LLM-client proxy (load-bearing invariant I4).
    const customPrompt = buildSynthesisCustomPrompt(verdict);
    const synthesisLlmProxy: EvolutionLLMClient = {
      complete: (p, agentName, opts) => {
        const rewritten: LlmCallAgentName = agentName === 'generation' ? 'debate_synthesis' : agentName;
        return llm.complete(p, rewritten, opts);
      },
      completeStructured: (p, schema, schemaName, agentName, opts) => {
        const rewritten: LlmCallAgentName = agentName === 'generation' ? 'debate_synthesis' : agentName;
        return llm.completeStructured(p, schema, schemaName, rewritten, opts);
      },
    };

    // (j) Delegate synthesis to inner GFPA via .execute() (NOT .run() — invariant I1).
    //     parentText = winner.text (Decision §20: revise winner using loser's strengths).
    const innerInput: GenerateFromPreviousInput = {
      parentText: winner.text,
      tactic: 'debate_synthesis',
      llm: synthesisLlmProxy,
      initialPool: input.initialPool,
      initialRatings: input.initialRatings,
      initialMatchCounts: input.initialMatchCounts,
      cache: input.cache,
      parentVariantId: winner.id,
      customPrompt,
    };

    let gfpaOutput: AgentOutput<GenerateFromPreviousOutput, GenerateFromPreviousExecutionDetail>;
    try {
      gfpaOutput = await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx);
    } catch (err) {
      await this.persistPartialDetail(ctx, {
        variantA: input.variantA,
        variantB: input.variantB,
        failurePoint: 'synthesis',
        combined: {
          ...verdictToCombined(verdict),
          cost: combinedCost,
          durationMs: combinedDurationMs,
          reasoningEffortResolved: reasoningEffort,
        },
        totalCost: combinedCost,
      });
      throw err;
    }

    const gfpaDetail = gfpaOutput.detail;

    // (k) Synthesis-no-op gate (Decision §14): Jaccard ≥ 0.85 vs EITHER parent → discard.
    let surfaced = gfpaOutput.result.surfaced;
    let synthesisFailurePoint: 'synthesis_empty' | 'synthesis_no_op' | undefined = undefined;
    if (gfpaOutput.result.variant) {
      const synthesisText = gfpaOutput.result.variant.text;
      const jaccardA = jaccardSimilarity(synthesisText, input.variantA.text);
      const jaccardB = jaccardSimilarity(synthesisText, input.variantB.text);
      if (jaccardA >= JACCARD_NO_OP_THRESHOLD || jaccardB >= JACCARD_NO_OP_THRESHOLD) {
        surfaced = false;
        synthesisFailurePoint = 'synthesis_no_op';
      }
    } else {
      // GFPA returned no variant — empty synthesis.
      surfaced = false;
      synthesisFailurePoint = 'synthesis_empty';
    }

    // (l) Tie verdict: synthesis ran but result does not enter pool (Decision §13).
    if (isTie) surfaced = false;

    // (m) Multi-parent emission: parentIds = [winner.id, loser.id] (Decision §20).
    //     Order load-bearing — parentIds[0] = canonical primary; parentIds[1] = additional.
    const synthesisVariantWithLineage: Variant | null = gfpaOutput.result.variant
      ? {
          ...gfpaOutput.result.variant,
          parentIds: [winner.id, loser.id],
        }
      : null;

    // (n) Merge detail.
    const merged: DebateExecutionDetail = {
      detailType: 'debate_then_generate_from_previous_article',
      tactic: 'debate_synthesis',
      variantA: { id: input.variantA.id, elo: input.initialRatings.get(input.variantA.id)?.elo ?? 0 },
      variantB: { id: input.variantB.id, elo: input.initialRatings.get(input.variantB.id)?.elo ?? 0 },
      debate: {
        combined: {
          ...verdictToCombined(verdict),
          cost: combinedCost,
          durationMs: combinedDurationMs,
          reasoningEffortResolved: reasoningEffort,
        },
        ...(isTie && { failurePoint: 'judge_tie' as const }),
        ...(synthesisFailurePoint && { failurePoint: synthesisFailurePoint as 'synthesis_empty' | 'synthesis_no_op' }),
      },
      generation: gfpaDetail.generation,
      ranking: gfpaDetail.ranking,
      totalCost: combinedCost + (gfpaDetail.totalCost ?? 0),
      estimatedTotalCost: gfpaDetail.estimatedTotalCost,
      estimationErrorPct: gfpaDetail.estimationErrorPct,
      surfaced,
      ...(gfpaDetail.discardReason !== undefined && { discardReason: gfpaDetail.discardReason }),
    };

    return {
      result: {
        ...gfpaOutput.result,
        variant: synthesisVariantWithLineage,
        surfaced,
      },
      detail: merged,
      childVariantIds: gfpaOutput.childVariantIds,
      parentVariantIds: [winner.id, loser.id],
    };
  }

  /** Persist a partial-detail row + re-throw (called from each catch block). */
  private async persistPartialDetail(
    ctx: AgentContext,
    partial: {
      variantA: Variant;
      variantB: Variant;
      failurePoint: NonNullable<DebateExecutionDetail['debate']>['failurePoint'];
      combined?: NonNullable<DebateExecutionDetail['debate']>['combined'];
      totalCost: number;
    },
  ): Promise<void> {
    if (!ctx.invocationId) return;
    const detail: DebateExecutionDetail = {
      detailType: 'debate_then_generate_from_previous_article',
      tactic: 'debate_synthesis',
      variantA: { id: partial.variantA.id, elo: 0 },
      variantB: { id: partial.variantB.id, elo: 0 },
      debate: {
        ...(partial.combined !== undefined && { combined: partial.combined }),
        failurePoint: partial.failurePoint,
      },
      totalCost: partial.totalCost,
      surfaced: false,
    };
    await updateInvocation(ctx.db, ctx.invocationId, {
      cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
      success: false,
      execution_detail: detail as unknown as Record<string, unknown>,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function emptyCritiqueContext(): { pastWins: ReadonlyArray<{ summary: string }>; pastLosses: ReadonlyArray<{ summary: string }> } {
  return { pastWins: [], pastLosses: [] };
}

function verdictToCombined(verdict: DebateVerdict): NonNullable<NonNullable<DebateExecutionDetail['debate']>['combined']> {
  return {
    prosA: [...verdict.prosA],
    consA: [...verdict.consA],
    prosB: [...verdict.prosB],
    consB: [...verdict.consB],
    winner: verdict.winner,
    reasoning: verdict.reasoning,
    strengthsFromA: [...verdict.strengthsFromA],
    strengthsFromB: [...verdict.strengthsFromB],
    improvements: [...verdict.improvements],
  };
}

/** Word-level Jaccard similarity. Cheap normalization: lowercase, split on whitespace.
 *  (Decision §14: prevents debate from emitting near-paraphrases of either parent.) */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection += 1;
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Attribution extractor registration ──────────────────
registerAttributionExtractor('debate_then_generate_from_previous_article', () => 'debate_synthesis');
