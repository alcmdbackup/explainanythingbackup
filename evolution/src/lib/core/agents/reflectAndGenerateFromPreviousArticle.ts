// reflectAndGenerateFromPreviousArticle: a wrapper agent that runs ONE reflection
// LLM call to pick the best tactic given parent text + recent ELO performance, then
// delegates to GenerateFromPreviousArticleAgent's execute() with the chosen tactic.
//
// Phase 6 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
//
// LOAD-BEARING INVARIANTS:
//   1. Inner GFPA must be invoked via `.execute()` directly, NOT `.run()`. Calling `.run()`
//      would create a NESTED Agent.run() scope (separate AgentCostScope), splitting
//      cost attribution between the wrapper and the inner GFPA invocation. See plan
//      Phase 6 for the full proof chain.
//   2. costBeforeReflection MUST be captured BEFORE the reflection LLM call so we can
//      compute the incremental reflection cost separately from the inner GFPA spend.
//   3. The wrapper writes partial detail to the invocation row BEFORE re-throwing on
//      any failure (reflection LLM throws, parser throws, inner GFPA throws). The
//      Phase 2 trackInvocations partial-update fix ensures Agent.run()'s catch handler
//      doesn't overwrite our partial detail with null.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { ExecutionDetailBase, Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { reflectAndGenerateFromPreviousArticleExecutionDetailSchema } from '../../schemas';
import { METRIC_CATALOG } from '../metricCatalog';
import { computeFormatRejectionRate } from '../../metrics/computations/finalizationInvocation';
import { isValidTactic } from '../tactics';
import { updateInvocation } from '../../pipeline/infra/trackInvocations';
import {
  GenerateFromPreviousArticleAgent,
  type GenerateFromPreviousInput,
  type GenerateFromPreviousOutput,
  type GenerateFromPreviousExecutionDetail,
} from './generateFromPreviousArticle';
import type { z } from 'zod';

// ─── Custom error types ─────────────────────────────────────────

export class ReflectionLLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReflectionLLMError';
  }
}

export class ReflectionParseError extends Error {
  constructor(message: string, readonly rawResponse: string) {
    super(message);
    this.name = 'ReflectionParseError';
  }
}

// ─── Public types ───────────────────────────────────────────────

export interface TacticCandidate {
  name: string;
  label: string;
  /** Compressed 1-2 sentence summary from getTacticSummary(). */
  summary: string;
}

export interface ReflectAndGenerateInput {
  /** Parent article text — passed verbatim to both the reflection prompt and (after
   *  tactic selection) the inner GFPA generation prompt. */
  parentText: string;
  /** ID of the parent variant. Forwarded to inner GFPA so the produced variant's
   *  parent_variant_id is set correctly. */
  parentVariantId: string;
  /** All N tactic candidates (typically all 24 system tactics) in randomized order
   *  to prevent positional bias in the reflection LLM's output. */
  tacticCandidates: ReadonlyArray<TacticCandidate>;
  /** Map of tactic name → recent mean ELO delta. Null entries are presented as "—"
   *  in the reflection prompt to signal no signal. Populated by getTacticEloBoostsForReflection. */
  tacticEloBoosts: ReadonlyMap<string, number | null>;
  /** How many top tactics the LLM should rank. Today only ranking[0] is consumed;
   *  the tail is preserved for future multi-tactic generation. Range 1-10, default 3. */
  reflectionTopN: number;
  /** Optional pre-built LLM client. When ctx.rawProvider is set, Agent.run() injects a
   *  per-invocation EvolutionLLMClient bound to this agent's AgentCostScope. */
  llm?: EvolutionLLMClient;
  /** Forwarded to inner GFPA. */
  initialPool: ReadonlyArray<Variant>;
  initialRatings: ReadonlyMap<string, Rating>;
  initialMatchCounts: ReadonlyMap<string, number>;
  cache: Map<string, ComparisonResult>;
}

/** Output mirrors GFPA's so the orchestrator can consume both agents uniformly. */
export type ReflectAndGenerateOutput = GenerateFromPreviousOutput;

export type ReflectAndGenerateExecutionDetail =
  z.infer<typeof reflectAndGenerateFromPreviousArticleExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Prompt building ────────────────────────────────────────────

function formatEloBoost(boost: number | null | undefined): string {
  if (boost == null) return '—';
  const sign = boost > 0 ? '+' : '';
  return `${sign}${boost.toFixed(0)}`;
}

export function buildReflectionPrompt(
  parentText: string,
  candidates: ReadonlyArray<TacticCandidate>,
  eloBoosts: ReadonlyMap<string, number | null>,
  topN: number,
): string {
  const tacticList = candidates.map((c, i) => {
    const boost = formatEloBoost(eloBoosts.get(c.name));
    return `${i + 1}. ${c.summary} (recent ELO boost: ${boost})`;
  }).join('\n');

  return `You are an expert writing strategist. Below is an article to be improved. Your job is to analyze the article and rank the top ${topN} writing-improvement tactics that would be most effective for THIS specific article, given its current strengths and weaknesses.

## Article
${parentText}

## Available Tactics (${candidates.length}, in randomized order; "recent ELO boost" shows mean rating gain from past variants — '—' means insufficient data)
${tacticList}

## Task
Rank your top ${topN} tactics from most-effective to least-effective FOR THIS ARTICLE. Use the following format EXACTLY (preserve the structure so a parser can extract):

1. Tactic: <exact tactic name from the list above (lowercase_with_underscores)>
   Reasoning: <one sentence explaining why this tactic best fits this article>

2. Tactic: <exact tactic name>
   Reasoning: <one sentence>

${topN > 2 ? '... and so on through rank ' + topN : ''}

Respond with ONLY the ranked list. No preamble, no closing remarks.`;
}

// ─── Parser ─────────────────────────────────────────────────────

interface ParsedRanking {
  tactic: string;
  reasoning: string;
}

/**
 * Extract the ranked tactic list from the LLM's response. Tolerant of:
 *   - Mixed casing in tactic names ("Lexical_Simplify" → "lexical_simplify")
 *   - Trailing whitespace / punctuation
 *   - Reasoning lines that span multiple lines
 *   - Unknown tactic names (drops them with logger.warn)
 *
 * Throws ReflectionParseError if zero valid entries are extracted (no fallback
 * — per plan, parser failures surface as invocation failures rather than silently
 * picking a default tactic).
 */
export function parseReflectionRanking(
  response: string,
  validateName: (name: string) => boolean = isValidTactic,
): ParsedRanking[] {
  const result: ParsedRanking[] = [];
  const lines = response.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    // Match patterns like "1. Tactic: X" — capture tactic to end-of-line.
    const tacticMatch = line.match(/^\s*\d+\.\s*Tactic:\s*(.+?)\s*$/);
    if (tacticMatch) {
      // Normalize: lowercase, replace whitespace runs with underscores.
      const rawName = tacticMatch[1] ?? '';
      const normalized = rawName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[*_]+$/, '').replace(/^[*_]+/, '');
      // Look ahead for "Reasoning:" line(s) until next numbered entry or end.
      let reasoning = '';
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        if (next.match(/^\s*\d+\.\s*Tactic:/)) break;
        const reasoningMatch = next.match(/^\s*Reasoning:\s*(.*)$/);
        if (reasoningMatch) {
          reasoning = reasoningMatch[1] ?? '';
        } else if (reasoning && next.trim().length > 0 && !next.match(/^\s*\d+\./)) {
          // Continuation of reasoning across multiple lines.
          reasoning += ' ' + next.trim();
        }
        j += 1;
      }
      // Validate against registry. Drop unknowns.
      if (validateName(normalized)) {
        result.push({ tactic: normalized, reasoning: reasoning.trim() });
      }
      i = j;
    } else {
      i += 1;
    }
  }

  if (result.length === 0) {
    throw new ReflectionParseError(
      'parseReflectionRanking: zero valid tactic entries extracted from LLM response',
      response.slice(0, 8000),
    );
  }
  return result;
}

// ─── Agent class ────────────────────────────────────────────────

export class ReflectAndGenerateFromPreviousArticleAgent extends Agent<
  ReflectAndGenerateInput,
  ReflectAndGenerateOutput,
  ReflectAndGenerateExecutionDetail
> {
  readonly name = 'reflect_and_generate_from_previous_article';
  readonly executionDetailSchema = reflectAndGenerateFromPreviousArticleExecutionDetailSchema;

  // Mirror GFPA's attribution: variants carry the chosen tactic as the dimension.
  // The aggregator uses `agent_name` (= this class's name) + `detail.tactic` to produce
  // `eloAttrDelta:reflect_and_generate_from_previous_article:<tactic>` rows, naturally
  // separated from GFPA's bars in StrategyEffectivenessChart.
  getAttributionDimension(detail: ReflectAndGenerateExecutionDetail): string | null {
    return detail?.tactic ?? null;
  }

  // Reuse GFPA's invocation metric — variants produced by this agent participate in
  // the same format-rejection-rate aggregate.
  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.format_rejection_rate,
      compute: (ctx) => computeFormatRejectionRate(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'tactic', label: 'Tactic Chosen', type: 'badge' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'reflection', label: 'Reflection', type: 'object',
      children: [
        { key: 'tacticChosen', label: 'Picked', type: 'badge' },
        { key: 'cost', label: 'Reflection Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'reflection.tacticRanking', label: 'Ranked Tactics', type: 'table',
      columns: [
        { key: 'tactic', label: 'Tactic' },
        { key: 'reasoning', label: 'Reasoning' },
      ],
    },
    { key: 'reflection.candidatesPresented', label: 'Candidates Presented', type: 'list' },
    {
      key: 'generation', label: 'Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: ReflectAndGenerateInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<ReflectAndGenerateOutput, ReflectAndGenerateExecutionDetail>> {
    const llm = input.llm!;
    const candidatesPresented = input.tacticCandidates.map((c) => c.name);

    // INVARIANT: capture before the reflection LLM call so we can compute incremental cost.
    const costBeforeReflection = ctx.costTracker.getOwnSpent?.() ?? 0;
    const reflStartMs = Date.now();

    // Validate input shape — the type system says non-empty but runtime guards against bugs.
    if (input.tacticCandidates.length === 0) {
      throw new Error('ReflectAndGenerateFromPreviousArticleAgent: tacticCandidates is empty');
    }

    // ─── Reflection LLM call ──────────────────────────────────
    const prompt = buildReflectionPrompt(
      input.parentText,
      input.tacticCandidates,
      input.tacticEloBoosts,
      input.reflectionTopN,
    );

    let reflectionResponse: string;
    try {
      reflectionResponse = await llm.complete(prompt, 'reflection', {
        model: ctx.config.generationModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      // Persist what we have (candidates + duration + cost so far) so the failed-invocation
      // detail page is debuggable. Phase 2 partial-update fix means execution_detail survives.
      const reflectionCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeReflection;
      const partial: ReflectAndGenerateExecutionDetail = {
        detailType: 'reflect_and_generate_from_previous_article',
        tactic: '',
        reflection: {
          candidatesPresented,
          tacticRanking: [],
          tacticChosen: '',
          durationMs: Date.now() - reflStartMs,
          cost: reflectionCost,
          parseError: undefined,
          rawResponse: undefined,
        },
        totalCost: reflectionCost,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw new ReflectionLLMError(
        `Reflection LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const reflectionCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeReflection;
    const reflectionDurationMs = Date.now() - reflStartMs;

    // ─── Parse ranked output ─────────────────────────────────
    let ranking: ParsedRanking[];
    try {
      ranking = parseReflectionRanking(reflectionResponse);
    } catch (err) {
      const partial: ReflectAndGenerateExecutionDetail = {
        detailType: 'reflect_and_generate_from_previous_article',
        tactic: '',
        reflection: {
          candidatesPresented,
          tacticRanking: [],
          tacticChosen: '',
          rawResponse: reflectionResponse.slice(0, 8000),
          parseError: err instanceof Error ? err.message : String(err),
          durationMs: reflectionDurationMs,
          cost: reflectionCost,
        },
        totalCost: reflectionCost,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw err;
    }

    const tacticChosen = ranking[0]?.tactic ?? '';
    if (!tacticChosen || !isValidTactic(tacticChosen)) {
      const partial: ReflectAndGenerateExecutionDetail = {
        detailType: 'reflect_and_generate_from_previous_article',
        tactic: tacticChosen,
        reflection: {
          candidatesPresented,
          tacticRanking: ranking,
          tacticChosen,
          rawResponse: reflectionResponse.slice(0, 8000),
          parseError: `Top-ranked tactic "${tacticChosen}" failed isValidTactic check`,
          durationMs: reflectionDurationMs,
          cost: reflectionCost,
        },
        totalCost: reflectionCost,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw new ReflectionParseError(
        `Top-ranked tactic "${tacticChosen}" is not a valid system tactic`,
        reflectionResponse.slice(0, 8000),
      );
    }

    // ─── Inner GFPA dispatch ─────────────────────────────────
    // LOAD-BEARING INVARIANT: call .execute() directly, NOT .run().
    // .run() would create a NESTED Agent.run() scope, splitting cost attribution.
    // See plan Phase 6 for the full invariant proof.
    const innerInput: GenerateFromPreviousInput = {
      parentText: input.parentText,
      tactic: tacticChosen,
      llm,
      initialPool: input.initialPool,
      initialRatings: input.initialRatings,
      initialMatchCounts: input.initialMatchCounts,
      cache: input.cache,
      parentVariantId: input.parentVariantId,
    };

    let gfpaOutput: AgentOutput<GenerateFromPreviousOutput, GenerateFromPreviousExecutionDetail>;
    try {
      gfpaOutput = await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx);
    } catch (err) {
      // Inner GFPA threw (most likely BudgetExceededError mid-generation/ranking).
      // Persist reflection detail so the failed-invocation page shows what happened.
      const partial: ReflectAndGenerateExecutionDetail = {
        detailType: 'reflect_and_generate_from_previous_article',
        tactic: tacticChosen,
        reflection: {
          candidatesPresented,
          tacticRanking: ranking,
          tacticChosen,
          durationMs: reflectionDurationMs,
          cost: reflectionCost,
        },
        totalCost: reflectionCost,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw err;
    }

    const gfpaDetail = gfpaOutput.detail;

    // ─── Merge detail ────────────────────────────────────────
    // CRITICAL: GFPA's totalCost is generation+ranking only. Recompute totalCost to
    // include reflection so it matches cost_usd written by Agent.run() via getOwnSpent().
    const merged: ReflectAndGenerateExecutionDetail = {
      detailType: 'reflect_and_generate_from_previous_article',
      variantId: gfpaDetail.variantId,
      tactic: tacticChosen,
      reflection: {
        candidatesPresented,
        tacticRanking: ranking,
        tacticChosen,
        durationMs: reflectionDurationMs,
        cost: reflectionCost,
      },
      generation: gfpaDetail.generation,
      ranking: gfpaDetail.ranking,
      totalCost: reflectionCost + (gfpaDetail.totalCost ?? 0),
      estimatedTotalCost: gfpaDetail.estimatedTotalCost,
      estimationErrorPct: gfpaDetail.estimationErrorPct,
      surfaced: gfpaOutput.result.surfaced,
      ...(gfpaDetail.discardReason !== undefined && { discardReason: gfpaDetail.discardReason }),
    };

    return {
      result: gfpaOutput.result,
      detail: merged,
      childVariantIds: gfpaOutput.childVariantIds,
    };
  }
}

/**
 * Side-effect import: register this agent's attribution-dimension extractor with the
 * metrics-layer ATTRIBUTION_EXTRACTORS registry so computeEloAttributionMetrics
 * can dispatch via getAttributionDimension without circular imports. Phase 8.
 *
 * Wired in Phase 8 after attributionExtractors.ts is created.
 */

// Phase 8 will register here.
