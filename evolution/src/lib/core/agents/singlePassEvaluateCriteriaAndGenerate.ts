// SinglePassEvaluateCriteriaAndGenerateAgent: a near-clone of
// EvaluateCriteriaThenGenerateFromPreviousArticleAgent (legacy criteria wrapper) with three
// new guardrail directives in the customPrompt + observational lengthCapHit telemetry +
// the new marker tactic 'criteria_driven_single_pass'.
//
// This is the "guardrails-only" hypothesis from the prior project's analysis: same
// architecture as legacy, only the prompt and marker differ. Used to A/B against legacy
// criteria_and_generate on the tactic leaderboard.
//
// LOAD-BEARING INVARIANTS (mirrored from legacy wrapper):
//   1. Inner GFPA via .execute() not .run() — preserves AgentCostScope.
//   2. effectiveWeakestK = min(weakestK, criteria.length) — clamp at runtime.
//   3. Partial detail before re-throw on any helper failure.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { ExecutionDetailBase, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema } from '../../schemas';
import { METRIC_CATALOG } from '../metricCatalog';
import { DETAIL_VIEW_CONFIGS } from '../detailViewConfigs';
import { computeFormatRejectionRate } from '../../metrics/computations/finalizationInvocation';
import { updateInvocation } from '../../pipeline/infra/trackInvocations';
import { registerAttributionExtractor } from '../../metrics/attributionExtractors';
import {
  GenerateFromPreviousArticleAgent,
  type GenerateFromPreviousInput,
  type GenerateFromPreviousOutput,
  type GenerateFromPreviousExecutionDetail,
} from './generateFromPreviousArticle';
import {
  buildEvaluateAndSuggestPrompt,
  parseEvaluateAndSuggest,
  extractScores,
  type EvaluateCriteriaInput,
  type EvaluateCriteriaOutput,
  type ParsedScore,
  type ParsedEvaluateAndSuggest,
  type ParsedSuggestion,
  EvaluateAndSuggestLLMError,
  EvaluateAndSuggestParseError,
} from './evaluateCriteriaThenGenerateFromPreviousArticle';
import type { z } from 'zod';

export type SinglePassExecutionDetail =
  z.infer<typeof singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema>
  & ExecutionDetailBase;

/** Parent Elo cutoff above which the agent receives extra "surgical edits only"
 *  guidance. Empirically chosen from Phase 7 staging: parents <Elo 1300 show ~43%
 *  improvement rate; parents >Elo 1300 collapse to 20-22% with mean Δ −50 to −90
 *  driven by aggressive restructuring (retitled, demoted headings, stripped bold).
 *  See evolution/docs/criteria_agents.md "High-Elo guidance" section for the data. */
export const SINGLE_PASS_HIGH_ELO_THRESHOLD = 1300;

/** Single-pass customPrompt builder — emits the legacy 1-directive prompt extended
 *  with redundancy + flow + length directives. When `opts.highEloParent` is true
 *  (parent Elo > SINGLE_PASS_HIGH_ELO_THRESHOLD), appends a surgical-edits block
 *  that tells the LLM to preserve title/headings/emphasis and prefer additive,
 *  targeted edits over restructuring. Verbatim text matters; tests assert presence. */
export function buildSinglePassCustomPromptFromSuggestions(
  suggestions: ReadonlyArray<ParsedSuggestion>,
  opts?: { highEloParent?: boolean },
): { preamble: string; instructions: string } {
  const preamble = 'You are an expert article reviser focusing on these specific issues identified during evaluation.';
  const instructionLines: string[] = [];
  instructionLines.push('Apply these specific fixes to the article:');
  suggestions.forEach((s, i) => {
    instructionLines.push('');
    instructionLines.push(`Issue ${i + 1} (${s.criteriaName}):`);
    instructionLines.push(`  Example passage: "${s.examplePassage}"`);
    instructionLines.push(`  What's wrong: ${s.whatNeedsAddressing}`);
    instructionLines.push(`  Fix: ${s.suggestedFix}`);
  });
  instructionLines.push('');
  instructionLines.push(
    '**Length** — Preserve the original word count within ±10%. Refactor or deepen existing passages rather than adding new sections or examples.',
  );
  instructionLines.push('');
  instructionLines.push(
    "**Redundancy** — Avoid introducing ideas, phrasing, or examples that already appear elsewhere in the article. Each fix should add or strengthen distinct content, not duplicate what's already there.",
  );
  instructionLines.push('');
  instructionLines.push(
    "**Flow** — Preserve transitions between paragraphs. Do not delete or replace transition phrases at paragraph starts (e.g., 'However,' 'Therefore,' 'In contrast,'). Maintain local sentence rhythm and section-to-section connective tissue.",
  );

  // High-Elo parents (>1300) historically regress when the agent restructures
  // aggressively (retitle, heading-level changes, stripped emphasis). The 4 high-Elo
  // wins from Phase 7 staging all preserved title/structure and made small additive
  // edits — 8-16 atomic changes, +4-13% length growth. This block pushes that pattern.
  if (opts?.highEloParent) {
    instructionLines.push('');
    instructionLines.push(
      '**High-quality parent — SURGICAL EDITS ONLY** — The current article is already strong (parent Elo > '
      + `${SINGLE_PASS_HIGH_ELO_THRESHOLD}). Aggressive rewrites here historically regress the article. Make targeted, additive edits and PRESERVE what is working:`,
    );
    instructionLines.push('  - **Preserve the title (H1) exactly.** Do not rename, reword, or restyle the top heading.');
    instructionLines.push('  - **Preserve heading levels and section order.** Do not promote/demote headings (e.g., `###` → `##`) or reorder sections.');
    instructionLines.push('  - **Preserve bold/italic emphasis on key terms** (e.g., `**Federal Reserve Act**`). Do not strip formatting.');
    instructionLines.push('  - **Prefer ADDITIVE edits** — insert clarifying analogies, worked examples, or bridging sentences inside existing paragraphs. Avoid wholesale paragraph rewrites.');
    instructionLines.push('  - **Aim for 5-15 atomic edits, not 16+.** Each issue should resolve in 1-3 sentence additions, not a section overhaul.');
  }

  instructionLines.push('');
  instructionLines.push('Do not introduce meta-commentary about the article itself.');
  return { preamble, instructions: instructionLines.join('\n') };
}

export class SinglePassEvaluateCriteriaAndGenerateAgent extends Agent<
  EvaluateCriteriaInput,
  EvaluateCriteriaOutput,
  SinglePassExecutionDetail
> {
  readonly name = 'single_pass_evaluate_criteria_and_generate';
  readonly executionDetailSchema = singlePassEvaluateCriteriaAndGenerateExecutionDetailSchema;

  /** Same attribution dimension extractor as legacy wrapper. */
  getAttributionDimension(detail: SinglePassExecutionDetail): string | null {
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

  readonly detailViewConfig: DetailFieldDef[] =
    DETAIL_VIEW_CONFIGS.single_pass_evaluate_criteria_and_generate!;

  async execute(
    input: EvaluateCriteriaInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<EvaluateCriteriaOutput, SinglePassExecutionDetail>> {
    const llm = input.llm!;

    if (input.criteria.length === 0) {
      const partial: SinglePassExecutionDetail = {
        detailType: 'single_pass_evaluate_criteria_and_generate',
        tactic: 'criteria_driven_single_pass',
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

    const prompt = buildEvaluateAndSuggestPrompt(input.parentText, input.criteria, effectiveWeakestK);

    const costBeforeCombined = ctx.costTracker.getOwnSpent?.() ?? 0;
    const combinedStart = Date.now();

    let response: string;
    try {
      response = await llm.complete(prompt, 'evaluate_and_suggest', {
        model: ctx.config.generationModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      const cost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeCombined;
      const partial: SinglePassExecutionDetail = {
        detailType: 'single_pass_evaluate_criteria_and_generate',
        tactic: 'criteria_driven_single_pass',
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

    // First-pass parse: scores only
    let scoresParsed: ParsedScore[];
    {
      const splitIdx = response.search(/^###\s+Suggestion/m);
      const scoreSection = splitIdx >= 0 ? response.slice(0, splitIdx) : response;
      const tempScored = extractScores(scoreSection, input.criteria);
      if (tempScored.length === 0) {
        const partial: SinglePassExecutionDetail = {
          detailType: 'single_pass_evaluate_criteria_and_generate',
          tactic: 'criteria_driven_single_pass',
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

    // Identify weakest set
    const sortedByNormalizedScore = [...scoresParsed].sort((a, b) => {
      const aNorm = (a.score - a.minRating) / (a.maxRating - a.minRating);
      const bNorm = (b.score - b.minRating) / (b.maxRating - b.minRating);
      return aNorm - bNorm;
    });
    const weakestKEntries = sortedByNormalizedScore.slice(0, effectiveWeakestK);
    const weakestCriteriaIds = weakestKEntries.map((e) => e.criteriaId);
    const weakestCriteriaNames = weakestKEntries.map((e) => e.criteriaName);

    // Second-pass parse: suggestions filtered by weakest
    let parsed: ParsedEvaluateAndSuggest;
    try {
      parsed = parseEvaluateAndSuggest(response, input.criteria, weakestCriteriaIds);
    } catch (err) {
      const partial: SinglePassExecutionDetail = {
        detailType: 'single_pass_evaluate_criteria_and_generate',
        tactic: 'criteria_driven_single_pass',
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

    // Inner GFPA dispatch with NEW customPrompt + NEW marker tactic.
    // High-Elo parents (>1300) get extra surgical-edits guidance — aggressive
    // restructuring regresses these articles per Phase 7 staging analysis.
    const parentElo = input.parentVariantId
      ? input.initialRatings.get(input.parentVariantId)?.elo
      : undefined;
    const highEloParent = parentElo != null && parentElo > SINGLE_PASS_HIGH_ELO_THRESHOLD;
    const customPrompt = buildSinglePassCustomPromptFromSuggestions(parsed.suggestions, { highEloParent });
    const innerInput: GenerateFromPreviousInput = {
      parentText: input.parentText,
      tactic: 'criteria_driven_single_pass',
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
      const partial: SinglePassExecutionDetail = {
        detailType: 'single_pass_evaluate_criteria_and_generate',
        tactic: 'criteria_driven_single_pass',
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

    // Compute lengthCapHit telemetry (observational only — variant emits regardless).
    const generatedTextLength = gfpaDetail.generation?.textLength ?? 0;
    const lengthCapHit = input.parentText.length > 0
      && generatedTextLength / input.parentText.length > 1.10;

    const merged: SinglePassExecutionDetail = {
      detailType: 'single_pass_evaluate_criteria_and_generate',
      variantId: gfpaDetail.variantId,
      tactic: 'criteria_driven_single_pass',
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
      guardrails: {
        redundancyDropCount: 0,  // single-pass has no edit groups; placeholder
        flowDropCount: 0,         // ditto
        lengthCapHit,
      },
    };

    return {
      result: gfpaOutput.result,
      detail: merged,
      childVariantIds: gfpaOutput.childVariantIds,
    };
  }
}

// Attribution extractor registration
registerAttributionExtractor('single_pass_evaluate_criteria_and_generate', (detail: unknown) => {
  const weakest = (detail as { weakestCriteriaNames?: unknown })?.weakestCriteriaNames;
  if (!Array.isArray(weakest) || weakest.length === 0) return null;
  const primary = weakest[0];
  return typeof primary === 'string' && primary.length > 0 && !primary.includes(':') ? primary : null;
});
