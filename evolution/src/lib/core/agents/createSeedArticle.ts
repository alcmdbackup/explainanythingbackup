// CreateSeedArticleAgent: generates a seed article from a prompt text (2 LLM calls: title + article),
// ranks it against the initial arena pool, and returns a surfaced or discarded variant.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../types';
import type { ExecutionDetailBase, Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { createVariant } from '../../types';
import { BudgetExceededError } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import type { RankSingleVariantStatus } from '../../pipeline/loop/rankSingleVariant';
import { rankNewVariant } from '../../pipeline/loop/rankNewVariant';
import { deepCloneRatings } from './generateFromSeedArticle';
import { generateTitle, buildArticlePrompt } from '../../pipeline/setup/generateSeedArticle';
import { validateFormat } from '../../shared/enforceVariantFormat';
import { createSeedArticleExecutionDetailSchema } from '../../schemas';
import type { z } from 'zod';

// ─── Public types ─────────────────────────────────────────────────

export interface CreateSeedArticleInput {
  promptText: string;
  llm: EvolutionLLMClient;
  initialPool: ReadonlyArray<Variant>;
  initialRatings: ReadonlyMap<string, Rating>;
  initialMatchCounts: ReadonlyMap<string, number>;
  cache: Map<string, ComparisonResult>;
}

export type CreateSeedArticleOutput = {
  variant: Variant | null;
  status: RankSingleVariantStatus | 'generation_failed';
  surfaced: boolean;
  matches: V2Match[];
  discardReason?: { elo: number; top15Cutoff: number };
};

export type CreateSeedArticleExecutionDetail = z.infer<typeof createSeedArticleExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Agent class ──────────────────────────────────────────────────

export class CreateSeedArticleAgent extends Agent<
  CreateSeedArticleInput,
  CreateSeedArticleOutput,
  CreateSeedArticleExecutionDetail
> {
  readonly name = 'create_seed_article';
  readonly executionDetailSchema = createSeedArticleExecutionDetailSchema;
  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    {
      key: 'generation', label: 'Generation', type: 'object',
      children: [
        { key: 'cost', label: 'Cost', type: 'number', formatter: 'cost' },
        { key: 'promptLength', label: 'Prompt Length', type: 'number' },
        { key: 'titleLength', label: 'Title Length', type: 'number' },
        { key: 'contentLength', label: 'Content Length', type: 'number' },
        { key: 'formatValid', label: 'Format Valid', type: 'boolean' },
      ],
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'localPoolSize', label: 'Local Pool Size', type: 'number' },
        { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'finalLocalUncertainty', label: 'Final Local Uncertainty', type: 'number' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: CreateSeedArticleInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<CreateSeedArticleOutput, CreateSeedArticleExecutionDetail>> {
    const { promptText, llm, initialPool, initialRatings, initialMatchCounts, cache } = input;

    const localPool: Variant[] = [...initialPool];
    const localRatings = deepCloneRatings(initialRatings);
    const localMatchCounts = new Map(initialMatchCounts);
    const completedPairs = new Set<string>();
    const model = ctx.config.generationModel as LLMCompletionOptions['model'];
    const costBeforeGen = ctx.costTracker.getTotalSpent();

    const makeGenerationErrorDetail = (
      err: unknown,
      generationCost: number,
      extraFields?: Partial<CreateSeedArticleExecutionDetail['generation']>,
    ): CreateSeedArticleExecutionDetail => ({
      detailType: 'create_seed_article',
      totalCost: generationCost,
      generation: {
        cost: generationCost,
        promptLength: promptText.length,
        formatValid: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        ...extraFields,
      },
      ranking: null,
      surfaced: false,
    });

    // Step 1a: generate title
    let title: string;
    try {
      title = await generateTitle(
        promptText,
        (p) => llm.complete(p, 'seed_title', { model, invocationId: ctx.invocationId }),
      );
      if (!title) title = promptText.slice(0, 100);
    } catch (err) {
      const generationCost = ctx.costTracker.getTotalSpent() - costBeforeGen;
      const detail = makeGenerationErrorDetail(err, generationCost);
      const status = err instanceof BudgetExceededError ? 'budget' : 'generation_failed';
      return { result: { variant: null, status, surfaced: false, matches: [] }, detail };
    }

    // Step 1b: generate article body
    let articleContent: string;
    try {
      articleContent = await llm.complete(
        buildArticlePrompt(title),
        'seed_article',
        { model, invocationId: ctx.invocationId },
      );
    } catch (err) {
      const generationCost = ctx.costTracker.getTotalSpent() - costBeforeGen;
      const detail = makeGenerationErrorDetail(err, generationCost, { titleLength: title.length });
      const status = err instanceof BudgetExceededError ? 'budget' : 'generation_failed';
      return { result: { variant: null, status, surfaced: false, matches: [] }, detail };
    }

    const content = `# ${title}\n\n${articleContent}`;
    const generationCost = ctx.costTracker.getTotalSpent() - costBeforeGen;

    const fmt = validateFormat(content);
    if (!fmt.valid) {
      ctx.logger.warn('createSeedArticle: format validation issues (continuing)', {
        phaseName: 'seed_generation', issues: fmt.issues,
      });
    }

    const variant = createVariant({
      text: content.trim(),
      strategy: 'seed_variant',
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

    const detail: CreateSeedArticleExecutionDetail = {
      detailType: 'create_seed_article',
      totalCost: generationCost + rankingCost,
      generation: {
        cost: generationCost,
        promptLength: promptText.length,
        titleLength: title.length,
        contentLength: content.length,
        formatValid: fmt.valid,
      },
      ranking: {
        cost: rankingCost,
        ...rankResult.detail,
      },
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
