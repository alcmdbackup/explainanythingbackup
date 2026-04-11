// Shared ranking helper: adds a variant to the local pool, runs binary search, and applies
// surface/discard logic. Used by GenerateFromSeedArticleAgent and CreateSeedArticleAgent.

import type { Variant, EvolutionLLMClient } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';
import type { EvolutionConfig, V2Match } from '../infra/types';
import type { V2CostTracker } from '../infra/trackBudget';
import type { EntityLogger } from '../infra/createEntityLogger';
import {
  rankSingleVariant,
  computeTop15Cutoff,
  type RankSingleVariantStatus,
  type RankSingleVariantDetail,
} from './rankSingleVariant';

export interface RankNewVariantInput {
  variant: Variant;
  /** Mutated in place: variant is pushed and its rating initialised. */
  localPool: Variant[];
  localRatings: Map<string, Rating>;
  localMatchCounts: Map<string, number>;
  completedPairs: Set<string>;
  cache: Map<string, ComparisonResult>;
  llm: EvolutionLLMClient;
  config: EvolutionConfig;
  invocationId: string;
  logger: EntityLogger;
  costTracker: V2CostTracker;
}

export interface RankNewVariantResult {
  rankingCost: number;
  rankResult: {
    status: RankSingleVariantStatus;
    matches: V2Match[];
    comparisonsRun: number;
    detail: RankSingleVariantDetail;
  };
  surfaced: boolean;
  discardReason?: { localMu: number; localTop15Cutoff: number };
}

/**
 * Adds a variant to the local pool, ranks it via binary search, and applies
 * surface/discard logic. Mutates localPool and localRatings.
 */
export async function rankNewVariant({
  variant,
  localPool,
  localRatings,
  localMatchCounts,
  completedPairs,
  cache,
  llm,
  config,
  invocationId,
  logger,
  costTracker,
}: RankNewVariantInput): Promise<RankNewVariantResult> {
  localPool.push(variant);
  localRatings.set(variant.id, createRating());

  const costBeforeRank = costTracker.getTotalSpent();

  const rankResult = await rankSingleVariant({
    variant,
    pool: localPool,
    ratings: localRatings,
    matchCounts: localMatchCounts,
    completedPairs,
    cache,
    llm,
    config,
    invocationId,
    logger,
  });

  const rankingCost = costTracker.getTotalSpent() - costBeforeRank;

  const localCutoff = computeTop15Cutoff(localRatings);
  const localVariantMu = localRatings.get(variant.id)!.mu;

  // Discard only when budget-stopped AND below the top-15% cutoff.
  const discard = rankResult.status === 'budget' && localVariantMu < localCutoff;
  const surfaced = !discard;
  const discardReason = discard ? { localMu: localVariantMu, localTop15Cutoff: localCutoff } : undefined;

  return { rankingCost, rankResult, surfaced, discardReason };
}
