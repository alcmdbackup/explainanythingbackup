// Ranking agent: wraps rankPool() with invocation/cost/budget ceremony.

import { Agent } from '../Agent';
import type { AgentContext } from '../types';
import type { Variant } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { rankPool } from '../../pipeline/loop/rankVariants';
import { rankingExecutionDetailSchema } from '../../schemas';
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

export class RankingAgent extends Agent<RankingInput, RankResult> {
  readonly name = 'ranking';
  readonly executionDetailSchema = rankingExecutionDetailSchema;

  async execute(input: RankingInput, ctx: AgentContext): Promise<RankResult> {
    return rankPool(
      input.pool, input.ratings, input.matchCounts, input.newEntrantIds,
      input.llm, ctx.config, input.budgetFraction, input.cache, ctx.logger,
    );
  }
}
