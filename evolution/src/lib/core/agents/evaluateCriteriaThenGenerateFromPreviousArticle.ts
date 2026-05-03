// EvaluateCriteriaThenGenerateFromPreviousArticleAgent: a wrapper agent that runs ONE
// combined LLM call (evaluate parent against criteria + suggest fixes for the K weakest
// in a single response), then delegates to GenerateFromPreviousArticleAgent.execute()
// with a customPrompt built from the suggestions.
//
// LOAD-BEARING INVARIANTS:
//   1. Inner GFPA must be invoked via `.execute()` directly, NOT `.run()`.
//      `.run()` would create a NESTED Agent.run() scope (separate AgentCostScope),
//      splitting cost attribution between this wrapper and the inner GFPA invocation.
//   2. The partial-detail-preserving updateInvocation() calls in our error paths rely
//      on trackInvocations.ts:81's conditional-spread for execution_detail (Phase 2 fix).
//      Agent.run()'s catch handler (Agent.ts) subsequently writes cost_usd + success: false
//      + error_message WITHOUT execution_detail, and the conditional spread preserves
//      whatever we wrote pre-throw.
//   3. effectiveWeakestK is computed at execute() entry as min(input.weakestK,
//      input.criteria.length). The clamp handles configuration drift (criteria archived
//      between configure and run). The clamped value MUST be passed to
//      buildEvaluateAndSuggestPrompt so the LLM is asked for the same number of suggestion
//      blocks the wrapper will keep — avoids spuriously populating droppedSuggestions.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { ExecutionDetailBase, Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema } from '../../schemas';
import { METRIC_CATALOG } from '../metricCatalog';
import { computeFormatRejectionRate } from '../../metrics/computations/finalizationInvocation';
import { updateInvocation } from '../../pipeline/infra/trackInvocations';
import { registerAttributionExtractor } from '../../metrics/attributionExtractors';
import {
  GenerateFromPreviousArticleAgent,
  type GenerateFromPreviousInput,
  type GenerateFromPreviousOutput,
  type GenerateFromPreviousExecutionDetail,
} from './generateFromPreviousArticle';
import type { z } from 'zod';

// ─── Custom error types ─────────────────────────────────────────

export class EvaluateAndSuggestLLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluateAndSuggestLLMError';
  }
}

export class EvaluateAndSuggestParseError extends Error {
  constructor(message: string, readonly rawResponse: string) {
    super(message);
    this.name = 'EvaluateAndSuggestParseError';
  }
}

// ─── Public types ───────────────────────────────────────────────

export interface CriterionRow {
  id: string;
  name: string;
  description: string | null;
  min_rating: number;
  max_rating: number;
  evaluation_guidance: ReadonlyArray<{ score: number; description: string }> | null;
}

export interface EvaluateCriteriaInput {
  parentText: string;
  parentVariantId: string;
  /** Active criteria rows fetched at iteration start (Phase 4). */
  criteria: ReadonlyArray<CriterionRow>;
  /** Canonical UUIDs from iterCfg.criteriaIds — persisted on the variant for lineage. */
  criteriaIds: ReadonlyArray<string>;
  /** Configured K (1-5). Wrapper computes effectiveWeakestK = min(weakestK, criteria.length) at runtime. */
  weakestK: number;
  llm?: EvolutionLLMClient;
  initialPool: ReadonlyArray<Variant>;
  initialRatings: ReadonlyMap<string, Rating>;
  initialMatchCounts: ReadonlyMap<string, number>;
  cache: Map<string, ComparisonResult>;
}

export type EvaluateCriteriaOutput = GenerateFromPreviousOutput;

export type EvaluateCriteriaExecutionDetail =
  z.infer<typeof evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Prompt building ────────────────────────────────────────────

/** Build the combined evaluate+suggest prompt. Single LLM call asks for both score lines
 *  and structured suggestion blocks for the K lowest-scoring criteria. */
export function buildEvaluateAndSuggestPrompt(
  parentText: string,
  criteria: ReadonlyArray<CriterionRow>,
  effectiveWeakestK: number,
): string {
  const criteriaBlock = criteria.map((c, i) => {
    const lines: string[] = [];
    lines.push(`${i + 1}. ${c.name} (${c.min_rating}-${c.max_rating}): ${c.description ?? ''}`);
    if (c.evaluation_guidance && c.evaluation_guidance.length > 0) {
      lines.push('   Rubric:');
      const sorted = [...c.evaluation_guidance].sort((a, b) => a.score - b.score);
      for (const anchor of sorted) {
        lines.push(`     ${anchor.score} = ${anchor.description}`);
      }
    }
    return lines.join('\n');
  }).join('\n\n');

  return `You are an expert article evaluator and writing coach. First, score the article against each criterion. Then identify the ${effectiveWeakestK} lowest-scoring criteria and provide 2-3 suggestions for each.

## Article
${parentText}

## Criteria
${criteriaBlock}

## Output Format
First, score each criterion using <name>: <score> per line. Use each criterion's stated range; rubric anchors (when provided) define key scores you can interpolate between.

Then a blank line, then provide 2-3 suggestions for each of the ${effectiveWeakestK} lowest-scoring criteria in this exact format:

### Suggestion <number>
Criterion: <criterion name from above>
Example: <verbatim passage from the article>
Issue: <one sentence on why this passage is weak for this criterion>
Fix: <one sentence on how to address it>

Output the score lines first, then a blank line, then the suggestion blocks. No other text.`;
}

// ─── Parser ─────────────────────────────────────────────────────

export interface ParsedScore {
  criteriaId: string;
  criteriaName: string;
  score: number;
  minRating: number;
  maxRating: number;
}

export interface ParsedSuggestion {
  examplePassage: string;
  whatNeedsAddressing: string;
  suggestedFix: string;
  criteriaName: string;
}

export interface ParsedDroppedSuggestion {
  criteriaName: string;
  reason: string;
}

export interface ParsedEvaluateAndSuggest {
  criteriaScored: ParsedScore[];
  suggestions: ParsedSuggestion[];
  droppedSuggestions: ParsedDroppedSuggestion[];
}

/** Parse the combined LLM response into scores + suggestions. Suggestions are filtered
 *  to those whose Criterion: matches the wrapper-determined weakest set; mismatches go
 *  into droppedSuggestions for forensic display. Throws EvaluateAndSuggestParseError on
 *  zero valid scores OR zero valid suggestions after filtering. */
export function parseEvaluateAndSuggest(
  response: string,
  criteria: ReadonlyArray<CriterionRow>,
  weakestCriteriaIds: ReadonlyArray<string>,
): ParsedEvaluateAndSuggest {
  // Split on first `### Suggestion` to get score section and suggestion section.
  const splitIdx = response.search(/^###\s+Suggestion/m);
  const scoreSection = splitIdx >= 0 ? response.slice(0, splitIdx) : response;
  const suggestionSection = splitIdx >= 0 ? response.slice(splitIdx) : '';

  // ─── Score parse ─────────────────────────────────
  const criteriaByLowerName = new Map<string, CriterionRow>();
  for (const c of criteria) {
    criteriaByLowerName.set(c.name.toLowerCase(), c);
  }

  const criteriaScored: ParsedScore[] = [];
  const scoreLineRegex = /^([A-Za-z][\w_-]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = scoreLineRegex.exec(scoreSection)) !== null) {
    const rawName = match[1] ?? '';
    const score = Number(match[2]);
    const criterion = criteriaByLowerName.get(rawName.toLowerCase());
    if (!criterion) continue; // unknown name — silently drop
    if (!Number.isFinite(score)) continue;
    if (score < criterion.min_rating || score > criterion.max_rating) continue;
    criteriaScored.push({
      criteriaId: criterion.id,
      criteriaName: criterion.name,
      score,
      minRating: criterion.min_rating,
      maxRating: criterion.max_rating,
    });
  }
  if (criteriaScored.length === 0) {
    throw new EvaluateAndSuggestParseError(
      'parseEvaluateAndSuggest: zero valid score lines extracted',
      response.slice(0, 8000),
    );
  }

  // ─── Suggestion parse ────────────────────────────
  const weakestIdSet = new Set(weakestCriteriaIds);
  const idByLowerName = new Map<string, string>();
  for (const c of criteria) idByLowerName.set(c.name.toLowerCase(), c.id);

  const suggestions: ParsedSuggestion[] = [];
  const droppedSuggestions: ParsedDroppedSuggestion[] = [];
  // Split on `### Suggestion N` headers; bodies are the segments between them.
  // (JS regex lacks \Z; lookahead-based capture-until-next-or-end is brittle.)
  const blockSegments = suggestionSection.split(/^###\s+Suggestion\s+\d+\s*\n/m).slice(1);
  for (const body of blockSegments) {
    const criterionLine = body.match(/^Criterion:\s*(.+?)\s*$/m);
    const exampleLine = body.match(/^Example:\s*(.+?)\s*$/m);
    const issueLine = body.match(/^Issue:\s*(.+?)\s*$/m);
    const fixLine = body.match(/^Fix:\s*(.+?)\s*$/m);
    if (!criterionLine || !exampleLine || !issueLine || !fixLine) continue;

    const criterionName = criterionLine[1] ?? '';
    const criterionId = idByLowerName.get(criterionName.toLowerCase());
    if (!criterionId) {
      droppedSuggestions.push({ criteriaName: criterionName, reason: 'unknown criterion' });
      continue;
    }
    if (!weakestIdSet.has(criterionId)) {
      droppedSuggestions.push({ criteriaName: criterionName, reason: 'not in wrapper-determined weakest set' });
      continue;
    }

    suggestions.push({
      examplePassage: (exampleLine[1] ?? '').trim(),
      whatNeedsAddressing: (issueLine[1] ?? '').trim(),
      suggestedFix: (fixLine[1] ?? '').trim(),
      criteriaName: criterionName,
    });
  }

  if (suggestions.length === 0) {
    throw new EvaluateAndSuggestParseError(
      `parseEvaluateAndSuggest: zero valid suggestions remained after filtering to weakest set (${droppedSuggestions.length} dropped)`,
      response.slice(0, 8000),
    );
  }

  return { criteriaScored, suggestions, droppedSuggestions };
}

// ─── Helper: build customPrompt for inner GFPA ────────────────────

function buildCustomPromptFromSuggestions(
  suggestions: ReadonlyArray<ParsedSuggestion>,
): { preamble: string; instructions: string } {
  const preamble = 'You are an expert article reviser focusing on these specific issues identified during evaluation.';
  const instructionLines: string[] = ['Apply these specific fixes to the article:'];
  suggestions.forEach((s, i) => {
    instructionLines.push('');
    instructionLines.push(`Issue ${i + 1} (${s.criteriaName}):`);
    instructionLines.push(`  Example passage: "${s.examplePassage}"`);
    instructionLines.push(`  What's wrong: ${s.whatNeedsAddressing}`);
    instructionLines.push(`  Fix: ${s.suggestedFix}`);
  });
  instructionLines.push('');
  instructionLines.push('Rewrite the article addressing each issue while preserving its overall intent and structure.');
  return { preamble, instructions: instructionLines.join('\n') };
}

// ─── Agent class ────────────────────────────────────────────────

export class EvaluateCriteriaThenGenerateFromPreviousArticleAgent extends Agent<
  EvaluateCriteriaInput,
  EvaluateCriteriaOutput,
  EvaluateCriteriaExecutionDetail
> {
  readonly name = 'evaluate_criteria_then_generate_from_previous_article';
  readonly executionDetailSchema = evaluateCriteriaThenGenerateFromPreviousArticleExecutionDetailSchema;

  /** Attribution dimension = primary weakest criteria name. Produces
   *  `eloAttrDelta:evaluate_criteria_then_generate_from_previous_article:<criteria_name>` rows. */
  getAttributionDimension(detail: EvaluateCriteriaExecutionDetail): string | null {
    const weakest = detail?.weakestCriteriaNames;
    if (!Array.isArray(weakest) || weakest.length === 0) return null;
    const primary = weakest[0];
    return typeof primary === 'string' && primary.length > 0 && !primary.includes(':') ? primary : null;
  }

  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.format_rejection_rate,
      compute: (ctx) => computeFormatRejectionRate(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'weakestCriteriaNames', label: 'Weakest Criteria', type: 'list' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'evaluateAndSuggest', label: 'Eval & Suggest', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'evaluateAndSuggest.criteriaScored', label: 'Criteria Scored', type: 'table',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'score', label: 'Score' },
        { key: 'minRating', label: 'Min' },
        { key: 'maxRating', label: 'Max' },
      ],
    },
    {
      key: 'evaluateAndSuggest.suggestions', label: 'Suggestions', type: 'table',
      columns: [
        { key: 'criteriaName', label: 'Criterion' },
        { key: 'examplePassage', label: 'Example' },
        { key: 'whatNeedsAddressing', label: 'Issue' },
        { key: 'suggestedFix', label: 'Fix' },
      ],
    },
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
    input: EvaluateCriteriaInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<EvaluateCriteriaOutput, EvaluateCriteriaExecutionDetail>> {
    const llm = input.llm!;

    // (a) Validate input + compute effectiveWeakestK
    if (input.criteria.length === 0) {
      const partial: EvaluateCriteriaExecutionDetail = {
        detailType: 'evaluate_criteria_then_generate_from_previous_article',
        tactic: 'criteria_driven',
        weakestCriteriaIds: [],
        weakestCriteriaNames: [],
        totalCost: 0,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw new Error('No active criteria resolved for iteration');
    }

    const effectiveWeakestK = Math.min(input.weakestK, input.criteria.length);
    if (effectiveWeakestK !== input.weakestK) {
      ctx.logger.warn('weakestK > fetched criteria count; clamping', {
        phaseName: 'criteria_validation',
        requested: input.weakestK,
        fetched: input.criteria.length,
        effective: effectiveWeakestK,
      });
    }

    // (b) Build the combined prompt with effectiveWeakestK
    const prompt = buildEvaluateAndSuggestPrompt(input.parentText, input.criteria, effectiveWeakestK);

    // (c) Capture cost + start time
    const costBeforeCombined = ctx.costTracker.getOwnSpent?.() ?? 0;
    const combinedStart = Date.now();

    // (d) Try 1: combined LLM call
    let response: string;
    try {
      response = await llm.complete(prompt, 'evaluate_and_suggest', {
        model: ctx.config.generationModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      const cost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeCombined;
      const partial: EvaluateCriteriaExecutionDetail = {
        detailType: 'evaluate_criteria_then_generate_from_previous_article',
        tactic: 'criteria_driven',
        weakestCriteriaIds: [],
        weakestCriteriaNames: [],
        evaluateAndSuggest: {
          criteriaScored: [],
          suggestions: [],
          durationMs: Date.now() - combinedStart,
          cost,
        },
        totalCost: cost,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw new EvaluateAndSuggestLLMError(
        `Evaluate+suggest LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const combinedCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeCombined;
    const combinedDurationMs = Date.now() - combinedStart;

    // (f) First-pass parse: scores only (we need them to pick weakest).
    let scoresParsed: ParsedScore[];
    {
      const splitIdx = response.search(/^###\s+Suggestion/m);
      const scoreSection = splitIdx >= 0 ? response.slice(0, splitIdx) : response;
      const criteriaByLowerName = new Map<string, CriterionRow>();
      for (const c of input.criteria) criteriaByLowerName.set(c.name.toLowerCase(), c);
      const tempScored: ParsedScore[] = [];
      const scoreLineRegex = /^([A-Za-z][\w_-]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/gm;
      let match: RegExpExecArray | null;
      while ((match = scoreLineRegex.exec(scoreSection)) !== null) {
        const criterion = criteriaByLowerName.get((match[1] ?? '').toLowerCase());
        if (!criterion) continue;
        const score = Number(match[2]);
        if (!Number.isFinite(score)) continue;
        if (score < criterion.min_rating || score > criterion.max_rating) continue;
        tempScored.push({
          criteriaId: criterion.id,
          criteriaName: criterion.name,
          score,
          minRating: criterion.min_rating,
          maxRating: criterion.max_rating,
        });
      }
      if (tempScored.length === 0) {
        const partial: EvaluateCriteriaExecutionDetail = {
          detailType: 'evaluate_criteria_then_generate_from_previous_article',
          tactic: 'criteria_driven',
          weakestCriteriaIds: [],
          weakestCriteriaNames: [],
          evaluateAndSuggest: {
            criteriaScored: [],
            suggestions: [],
            rawResponse: response.slice(0, 8000),
            parseError: 'zero valid score lines extracted',
            durationMs: combinedDurationMs,
            cost: combinedCost,
          },
          totalCost: combinedCost,
          surfaced: false,
        };
        if (ctx.invocationId) {
          await updateInvocation(ctx.db, ctx.invocationId, {
            cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
            success: false,
            execution_detail: partial as unknown as Record<string, unknown>,
          });
        }
        throw new EvaluateAndSuggestParseError(
          'Evaluate+suggest parser: zero valid score lines',
          response.slice(0, 8000),
        );
      }
      scoresParsed = tempScored;
    }

    // (g) Identify weakestKEntries by normalized score asc; resolve weakest IDs + names.
    const sortedByNormalizedScore = [...scoresParsed].sort((a, b) => {
      const aNorm = (a.score - a.minRating) / (a.maxRating - a.minRating);
      const bNorm = (b.score - b.minRating) / (b.maxRating - b.minRating);
      return aNorm - bNorm;
    });
    const weakestKEntries = sortedByNormalizedScore.slice(0, effectiveWeakestK);
    const weakestCriteriaIds = weakestKEntries.map((e) => e.criteriaId);
    const weakestCriteriaNames = weakestKEntries.map((e) => e.criteriaName);

    // (h) Second-pass parse: suggestions filtered by weakestCriteriaIds.
    let parsed: ParsedEvaluateAndSuggest;
    try {
      parsed = parseEvaluateAndSuggest(response, input.criteria, weakestCriteriaIds);
    } catch (err) {
      const partial: EvaluateCriteriaExecutionDetail = {
        detailType: 'evaluate_criteria_then_generate_from_previous_article',
        tactic: 'criteria_driven',
        weakestCriteriaIds,
        weakestCriteriaNames,
        evaluateAndSuggest: {
          criteriaScored: scoresParsed,
          suggestions: [],
          rawResponse: response.slice(0, 8000),
          parseError: err instanceof Error ? err.message : String(err),
          durationMs: combinedDurationMs,
          cost: combinedCost,
        },
        totalCost: combinedCost,
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

    // ─── Inner GFPA dispatch ─────────────────────────────────
    // LOAD-BEARING INVARIANT: call .execute() directly, NOT .run().
    const customPrompt = buildCustomPromptFromSuggestions(parsed.suggestions);
    const innerInput: GenerateFromPreviousInput = {
      parentText: input.parentText,
      tactic: 'criteria_driven',
      llm,
      initialPool: input.initialPool,
      initialRatings: input.initialRatings,
      initialMatchCounts: input.initialMatchCounts,
      cache: input.cache,
      parentVariantId: input.parentVariantId,
      customPrompt,
      criteriaSetUsed: input.criteriaIds,
      weakestCriteriaIds,
    };

    let gfpaOutput: AgentOutput<GenerateFromPreviousOutput, GenerateFromPreviousExecutionDetail>;
    try {
      gfpaOutput = await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx);
    } catch (err) {
      const partial: EvaluateCriteriaExecutionDetail = {
        detailType: 'evaluate_criteria_then_generate_from_previous_article',
        tactic: 'criteria_driven',
        weakestCriteriaIds,
        weakestCriteriaNames,
        evaluateAndSuggest: {
          criteriaScored: parsed.criteriaScored,
          suggestions: parsed.suggestions,
          ...(parsed.droppedSuggestions.length > 0 && { droppedSuggestions: parsed.droppedSuggestions }),
          durationMs: combinedDurationMs,
          cost: combinedCost,
        },
        totalCost: combinedCost,
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

    // ─── Merge detail ───────────────────────────────────────
    const merged: EvaluateCriteriaExecutionDetail = {
      detailType: 'evaluate_criteria_then_generate_from_previous_article',
      variantId: gfpaDetail.variantId,
      tactic: 'criteria_driven',
      weakestCriteriaIds,
      weakestCriteriaNames,
      evaluateAndSuggest: {
        criteriaScored: parsed.criteriaScored,
        suggestions: parsed.suggestions,
        ...(parsed.droppedSuggestions.length > 0 && { droppedSuggestions: parsed.droppedSuggestions }),
        durationMs: combinedDurationMs,
        cost: combinedCost,
      },
      generation: gfpaDetail.generation,
      ranking: gfpaDetail.ranking,
      totalCost: combinedCost + (gfpaDetail.totalCost ?? 0),
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

// ─── Attribution extractor registration ──────────────────
registerAttributionExtractor('evaluate_criteria_then_generate_from_previous_article', (detail: unknown) => {
  const weakest = (detail as { weakestCriteriaNames?: unknown })?.weakestCriteriaNames;
  if (!Array.isArray(weakest) || weakest.length === 0) return null;
  const primary = weakest[0];
  return typeof primary === 'string' && primary.length > 0 && !primary.includes(':') ? primary : null;
});
