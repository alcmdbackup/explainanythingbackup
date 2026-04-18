// generateFromSeedArticle: one parallel agent per generated variant.
// Generates ONE variant via a single strategy, then ranks it via binary search against
// a deep-cloned local snapshot of the iteration-start pool/ratings/matchCounts.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { ExecutionDetailBase, Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { METRIC_CATALOG } from '../metricCatalog';
import { computeFormatRejectionRate } from '../../metrics/computations/finalizationInvocation';
import { createVariant } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { type RankSingleVariantStatus } from '../../pipeline/loop/rankSingleVariant';
import { rankNewVariant } from '../../pipeline/loop/rankNewVariant';
import { generateFromSeedExecutionDetailSchema } from '../../schemas';
import { validateFormat } from '../../shared/enforceVariantFormat';
import { buildEvolutionPrompt } from '../../pipeline/loop/buildPrompts';
import { BudgetExceededError } from '../../types';
import { estimateGenerationCost, estimateRankingCost } from '../../pipeline/infra/estimateCosts';
import type { z } from 'zod';

// ─── Tactic registry ────────────────────────────────────────────

import { getTacticDef } from '../tactics';

function buildPromptForTactic(text: string, tactic: string): string | null {
  const def = getTacticDef(tactic);
  if (!def) return null;
  return buildEvolutionPrompt(def.preamble, 'Original Text', text, def.instructions);
}

// ─── Public types ─────────────────────────────────────────────────

export interface GenerateFromSeedInput {
  originalText: string;
  /** One tactic name per agent invocation. */
  tactic: string;
  llm: EvolutionLLMClient;
  /** Iteration-start snapshot of the pool. Will be deep-cloned for local mutation. */
  initialPool: ReadonlyArray<Variant>;
  /** Iteration-start snapshot of ratings. Will be deep-cloned (deep, not shallow — Critical Fix N). */
  initialRatings: ReadonlyMap<string, Rating>;
  initialMatchCounts: ReadonlyMap<string, number>;
  /** Shared comparison cache (order-invariant key — safe across parallel agents). */
  cache: Map<string, ComparisonResult>;
  /** ID of the seed variant that this generation is derived from. */
  seedVariantId: string;
}

export type GenerateFromSeedOutput = {
  variant: Variant | null;
  status: RankSingleVariantStatus | 'generation_failed';
  surfaced: boolean;
  matches: V2Match[];
  /** Populated when surfaced=false: the local elo and top-15% cutoff at the time of discard.
   *  Used by the orchestrator to populate iterationSnapshots.discardReasons for the SnapshotsTab. */
  discardReason?: { elo: number; top15Cutoff: number };
};

export type GenerateFromSeedExecutionDetail = z.infer<typeof generateFromSeedExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Helpers ──────────────────────────────────────────────────────

/** Deep-clone a ratings map. Each Rating object is duplicated to prevent shared-state mutations. */
export function deepCloneRatings(src: ReadonlyMap<string, Rating>): Map<string, Rating> {
  const out = new Map<string, Rating>();
  for (const [id, r] of src.entries()) {
    out.set(id, { ...r });
  }
  return out;
}

// ─── Agent class ──────────────────────────────────────────────────

export class GenerateFromSeedArticleAgent extends Agent<
  GenerateFromSeedInput,
  GenerateFromSeedOutput,
  GenerateFromSeedExecutionDetail
> {
  readonly name = 'generate_from_seed_article';
  readonly executionDetailSchema = generateFromSeedExecutionDetailSchema;

  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.format_rejection_rate,
      compute: (ctx) => computeFormatRejectionRate(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'tactic', label: 'Tactic', type: 'badge' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
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
        { key: 'localPoolSize', label: 'Local Pool Size', type: 'number' },
        { key: 'initialTop15Cutoff', label: 'Initial Top-15% Cutoff', type: 'number' },
        { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'finalLocalUncertainty', label: 'Final Local Uncertainty', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking.comparisons', label: 'Comparisons', type: 'table',
      columns: [
        { key: 'round', label: '#' },
        { key: 'opponentId', label: 'Opponent' },
        { key: 'selectionScore', label: 'Score' },
        { key: 'pWin', label: 'pWin' },
        { key: 'outcome', label: 'Out' },
        { key: 'variantEloAfter', label: 'Elo after' },
        { key: 'variantUncertaintyAfter', label: 'Uncertainty after' },
        { key: 'durationMs', label: 'ms' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: GenerateFromSeedInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<GenerateFromSeedOutput, GenerateFromSeedExecutionDetail>> {
    const { originalText, tactic, llm, initialPool, initialRatings, initialMatchCounts, cache } = input;

    // Deep-clone the iteration-start snapshot; Rating values must be deep-cloned to prevent
    // cross-agent mutation under parallel execution.
    const localPool: Variant[] = [...initialPool];
    const localRatings = deepCloneRatings(initialRatings);
    const localMatchCounts = new Map(initialMatchCounts);
    const completedPairs = new Set<string>();
    const costBeforeGen = ctx.costTracker.getOwnSpent?.() ?? ctx.costTracker.getTotalSpent();
    const generationStartTime = Date.now();

    const makeEarlyExitDetail = (
      generationCost: number,
      genFields: GenerateFromSeedExecutionDetail['generation'],
    ): GenerateFromSeedExecutionDetail => ({
      detailType: 'generate_from_seed_article',
      totalCost: generationCost,
      variantId: null,
      tactic,
      generation: genFields,
      ranking: null,
      surfaced: false,
    });

    const prompt = buildPromptForTactic(originalText, tactic);
    if (prompt === null) {
      return {
        result: { variant: null, status: 'generation_failed', surfaced: false, matches: [] },
        detail: makeEarlyExitDetail(0, { cost: 0, promptLength: 0, formatValid: false, error: `Unknown tactic: ${tactic}` }),
      };
    }

    let generated: string;
    try {
      generated = await llm.complete(prompt, 'generation', {
        model: ctx.config.generationModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      const generationCost = (ctx.costTracker.getOwnSpent?.() ?? ctx.costTracker.getTotalSpent()) - costBeforeGen;
      const status = err instanceof BudgetExceededError ? 'budget' : 'generation_failed';
      return {
        result: { variant: null, status, surfaced: false, matches: [] },
        detail: makeEarlyExitDetail(generationCost, {
          cost: generationCost,
          promptLength: prompt.length,
          formatValid: false,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        }),
      };
    }

    const fmt = validateFormat(generated);
    const generationCost = (ctx.costTracker.getOwnSpent?.() ?? ctx.costTracker.getTotalSpent()) - costBeforeGen;
    const generationDurationMs = Date.now() - generationStartTime;

    if (!fmt.valid) {
      ctx.logger.warn('generateFromSeedArticle: format validation failed', {
        phaseName: 'generation', tactic, issues: fmt.issues,
      });
      return {
        result: { variant: null, status: 'generation_failed', surfaced: false, matches: [] },
        detail: makeEarlyExitDetail(generationCost, {
          cost: generationCost,
          promptLength: prompt.length,
          textLength: generated.length,
          formatValid: false,
          formatIssues: fmt.issues,
        }),
      };
    }

    const variant = createVariant({
      text: generated.trim(),
      tactic,
      iterationBorn: ctx.iteration,
      parentIds: [input.seedVariantId],
      version: 0,
    });

    const rankingStartTime = Date.now();
    const { rankingCost, rankResult, surfaced, discardReason } = await rankNewVariant({
      variant,
      localPool,
      localRatings,
      localMatchCounts,
      completedPairs,
      cache,
      llm,
      config: ctx.config,
      invocationId: ctx.invocationId,
      logger: ctx.logger,
      costTracker: ctx.costTracker,
    });
    const rankingDurationMs = Date.now() - rankingStartTime;

    // Compute estimated costs for the feedback loop
    const estGenCost = estimateGenerationCost(
      originalText.length, tactic, ctx.config.generationModel,
    );
    const estRankCost = estimateRankingCost(
      variant.text.length, ctx.config.judgeModel,
      localPool.length, ctx.config.maxComparisonsPerVariant ?? 15,
    );
    const estTotalCost = estGenCost + estRankCost;
    const actualTotalCost = generationCost + rankingCost;
    const estimationErrorPct = estTotalCost > 0
      ? ((actualTotalCost - estTotalCost) / estTotalCost) * 100
      : 0;

    const detail: GenerateFromSeedExecutionDetail = {
      detailType: 'generate_from_seed_article',
      totalCost: actualTotalCost,
      variantId: variant.id,
      tactic,
      generation: {
        cost: generationCost,
        estimatedCost: estGenCost,
        promptLength: prompt.length,
        textLength: variant.text.length,
        formatValid: true,
        durationMs: generationDurationMs,
      },
      ranking: {
        cost: rankingCost,
        estimatedCost: estRankCost,
        durationMs: rankingDurationMs,
        ...rankResult.detail,
      },
      estimatedTotalCost: estTotalCost,
      estimationErrorPct: Math.round(estimationErrorPct * 100) / 100,
      surfaced,
      ...(discardReason !== undefined && { discardReason }),
    };

    return {
      result: {
        variant,
        status: rankResult.status,
        surfaced,
        matches: surfaced ? rankResult.matches : [],
        ...(discardReason !== undefined && {
          discardReason: { elo: discardReason.localElo, top15Cutoff: discardReason.localTop15Cutoff },
        }),
      },
      detail,
      childVariantIds: surfaced ? [variant.id] : [],
    };
  }
}

