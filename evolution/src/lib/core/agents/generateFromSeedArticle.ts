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
import type { z } from 'zod';

// ─── Strategy registry ────────────────────────────────────────────
// Mirrors the legacy generateVariants.ts STRATEGIES but exposed as a per-strategy function
// so we can dispatch one strategy per agent invocation.

interface StrategyDef {
  preamble: string;
  instructions: string;
}

const STRATEGY_DEFS: Record<string, StrategyDef> = {
  structural_transform: {
    preamble: 'You are an expert writing editor. AGGRESSIVELY restructure this text with full creative freedom.',
    instructions: 'Reorder sections, paragraphs, and ideas. Merge, split, or eliminate sections. Invert the structure (conclusion-first, bottom-up, problem-solution, narrative arc). Change heading hierarchy. Reorganize by chronological, thematic, comparative, or other principle. MUST preserve original intention, meaning, and all key points exactly. Do not add, remove, or alter the substance.\n\nOutput a radically restructured version. Same core message, completely different organization. Do NOT make timid, incremental changes — reimagine the organization from scratch.',
  },
  lexical_simplify: {
    preamble: 'You are an expert writing editor. Simplify the language of this text.',
    instructions: 'Replace complex words with simpler alternatives. Shorten overly long sentences. Remove unnecessary jargon. Improve accessibility. Maintain the meaning.\n\nOutput a lexically simplified version.',
  },
  grounding_enhance: {
    preamble: 'You are an expert writing editor. Make this text more concrete and grounded.',
    instructions: 'Add specific examples and details. Make abstract concepts concrete. Include sensory details. Strengthen connection to real-world experience. Maintaining the core message.\n\nOutput a more grounded and concrete version.',
  },
};

function buildPromptForStrategy(text: string, strategy: string): string | null {
  const def = STRATEGY_DEFS[strategy];
  if (!def) return null;
  return buildEvolutionPrompt(def.preamble, 'Original Text', text, def.instructions);
}

// ─── Public types ─────────────────────────────────────────────────

export interface GenerateFromSeedInput {
  originalText: string;
  /** One strategy name per agent invocation. */
  strategy: string;
  llm: EvolutionLLMClient;
  /** Iteration-start snapshot of the pool. Will be deep-cloned for local mutation. */
  initialPool: ReadonlyArray<Variant>;
  /** Iteration-start snapshot of ratings. Will be deep-cloned (deep, not shallow — Critical Fix N). */
  initialRatings: ReadonlyMap<string, Rating>;
  initialMatchCounts: ReadonlyMap<string, number>;
  /** Shared comparison cache (order-invariant key — safe across parallel agents). */
  cache: Map<string, ComparisonResult>;
}

export type GenerateFromSeedOutput = {
  variant: Variant | null;
  status: RankSingleVariantStatus | 'generation_failed';
  surfaced: boolean;
  matches: V2Match[];
  /** Populated when surfaced=false: the local mu and top-15% cutoff at the time of discard.
   *  Used by the orchestrator to populate iterationSnapshots.discardReasons for the SnapshotsTab. */
  discardReason?: { mu: number; top15Cutoff: number };
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
    { key: 'strategy', label: 'Strategy', type: 'badge' },
    { key: 'variantId', label: 'Variant ID', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'generation', label: 'Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'textLength', label: 'Text Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
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
        { key: 'finalLocalMu', label: 'Final Local μ', type: 'number' },
        { key: 'finalLocalSigma', label: 'Final Local σ', type: 'number' },
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
        { key: 'variantMuAfter', label: 'μ after' },
        { key: 'variantSigmaAfter', label: 'σ after' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: GenerateFromSeedInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<GenerateFromSeedOutput, GenerateFromSeedExecutionDetail>> {
    const { originalText, strategy, llm, initialPool, initialRatings, initialMatchCounts, cache } = input;

    // Deep-clone the iteration-start snapshot; Rating values must be deep-cloned to prevent
    // cross-agent mutation under parallel execution.
    const localPool: Variant[] = [...initialPool];
    const localRatings = deepCloneRatings(initialRatings);
    const localMatchCounts = new Map(initialMatchCounts);
    const completedPairs = new Set<string>();
    const costBeforeGen = ctx.costTracker.getTotalSpent();

    const makeEarlyExitDetail = (
      generationCost: number,
      genFields: GenerateFromSeedExecutionDetail['generation'],
    ): GenerateFromSeedExecutionDetail => ({
      detailType: 'generate_from_seed_article',
      totalCost: generationCost,
      variantId: null,
      strategy,
      generation: genFields,
      ranking: null,
      surfaced: false,
    });

    const prompt = buildPromptForStrategy(originalText, strategy);
    if (prompt === null) {
      return {
        result: { variant: null, status: 'generation_failed', surfaced: false, matches: [] },
        detail: makeEarlyExitDetail(0, { cost: 0, promptLength: 0, formatValid: false, error: `Unknown strategy: ${strategy}` }),
      };
    }

    let generated: string;
    try {
      generated = await llm.complete(prompt, 'generation', {
        model: ctx.config.generationModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      const generationCost = ctx.costTracker.getTotalSpent() - costBeforeGen;
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
    const generationCost = ctx.costTracker.getTotalSpent() - costBeforeGen;

    if (!fmt.valid) {
      ctx.logger.warn('generateFromSeedArticle: format validation failed', {
        phaseName: 'generation', strategy, issues: fmt.issues,
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
      strategy,
      iterationBorn: ctx.iteration,
      parentIds: [],
      version: 0,
    });

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

    const detail: GenerateFromSeedExecutionDetail = {
      detailType: 'generate_from_seed_article',
      totalCost: generationCost + rankingCost,
      variantId: variant.id,
      strategy,
      generation: {
        cost: generationCost,
        promptLength: prompt.length,
        textLength: variant.text.length,
        formatValid: true,
      },
      ranking: { cost: rankingCost, ...rankResult.detail },
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
          discardReason: { mu: discardReason.localMu, top15Cutoff: discardReason.localTop15Cutoff },
        }),
      },
      detail,
      childVariantIds: surfaced ? [variant.id] : [],
    };
  }
}

