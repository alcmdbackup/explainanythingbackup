// Ranking agent: wraps rankPool() with invocation/cost/budget ceremony.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef, FinalizationMetricDef } from '../types';
import type { Variant, RankingExecutionDetail } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { rankPool } from '../../pipeline/loop/rankVariants';
import { rankingExecutionDetailSchema } from '../../schemas';
import type { FinalizationContext } from '../../metrics/types';
import { METRIC_CATALOG } from '../metricCatalog';
import { computeTotalComparisons } from '../../metrics/computations/finalizationInvocation';
import type { EvolutionLLMClient } from '../../types';

export interface RankingInput {
  pool: Variant[];
  ratings: Map<string, Rating>;
  matchCounts: Map<string, number>;
  newEntrantIds: string[];
  llm: EvolutionLLMClient;
  budgetFraction: number;
  cache: Map<string, ComparisonResult>;
}

export interface RankResult {
  matches: V2Match[];
  ratingUpdates: Record<string, Rating>;
  matchCountIncrements: Record<string, number>;
  converged: boolean;
}

export class RankingAgent extends Agent<RankingInput, RankResult, RankingExecutionDetail> {
  readonly name = 'ranking';
  readonly executionDetailSchema = rankingExecutionDetailSchema;

  readonly invocationMetrics: FinalizationMetricDef[] = [
    {
      ...METRIC_CATALOG.total_comparisons,
      compute: (ctx) => computeTotalComparisons(ctx, ctx.currentInvocationId ?? null),
    },
  ];

  readonly detailViewConfig: DetailFieldDef[] = [
    {
      key: 'triage', label: 'Triage Results', type: 'table',
      columns: [
        { key: 'variantId', label: 'Variant' },
        { key: 'eliminated', label: 'Eliminated' },
        { key: 'ratingBefore', label: 'Rating Before' },
        { key: 'ratingAfter', label: 'Rating After' },
      ],
    },
    {
      key: 'fineRanking', label: 'Fine Ranking', type: 'object',
      children: [
        { key: 'rounds', label: 'Rounds', type: 'number' },
        { key: 'exitReason', label: 'Exit Reason', type: 'badge' },
        { key: 'convergenceStreak', label: 'Convergence Streak', type: 'number' },
      ],
    },
    { key: 'budgetTier', label: 'Budget Tier', type: 'badge' },
    { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
    { key: 'eligibleContenders', label: 'Eligible Contenders', type: 'number' },
    { key: 'flowEnabled', label: 'Flow Enabled', type: 'boolean' },
    { key: 'low_sigma_opponents_count', label: 'Low-σ Opponents', type: 'number' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(input: RankingInput, ctx: AgentContext): Promise<AgentOutput<RankResult, RankingExecutionDetail>> {
    const poolResult = await rankPool(
      input.pool, input.ratings, input.matchCounts, input.newEntrantIds,
      input.llm, ctx.config, input.budgetFraction, input.cache, ctx.logger,
    );

    const { matches, ratingUpdates, matchCountIncrements, converged, meta } = poolResult;

    const detail: RankingExecutionDetail = {
      detailType: 'ranking',
      totalCost: 0, // Patched by Agent.run()
      triage: [], // Triage detail is internal to rankPool; populated in future iteration
      fineRanking: {
        rounds: meta.fineRankingRounds,
        exitReason: meta.fineRankingExitReason as RankingExecutionDetail['fineRanking']['exitReason'],
        convergenceStreak: meta.convergenceStreak,
      },
      budgetPressure: meta.budgetPressure,
      budgetTier: meta.budgetTier,
      top20Cutoff: meta.top20Cutoff,
      eligibleContenders: meta.eligibleContenders,
      totalComparisons: meta.totalComparisons,
      flowEnabled: false,
      low_sigma_opponents_count: meta.lowSigmaOpponentsCount,
    };

    return {
      result: { matches, ratingUpdates, matchCountIncrements, converged },
      detail,
      parentVariantIds: input.pool.map(v => v.id),
    };
  }
}
