// Shared ranking helper: adds a variant to the local pool, runs binary search, and applies
// surface/discard logic. Used by GenerateFromPreviousArticleAgent and CreateSeedArticleAgent.

import type { Variant, EvolutionLLMClient } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import { createRating } from '../../shared/computeRatings';
import type { EvolutionConfig, V2Match } from '../infra/types';
import type { V2CostTracker, AgentCostScope } from '../infra/trackBudget';
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
  // B012: real-runtime callers pass an AgentCostScope (Agent.run() wraps ctx.costTracker
  // before calling execute()). The type stays permissive (matching AgentContext) so that
  // existing mock-based tests compile without churn; the implementation below asserts
  // `getOwnSpent` exists at call time. The net effect: `getTotalSpent()` is no longer
  // used as a fallback — a missing getOwnSpent fails loudly with a dev-time error.
  costTracker: V2CostTracker & { getOwnSpent?: () => number };
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
  discardReason?: { localElo: number; localTop15Cutoff: number };
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

  // B012: no more getTotalSpent fallback. The real pipeline always wraps in an
  // AgentCostScope; failing here exposes any missed wrap in dev/test.
  if (typeof costTracker.getOwnSpent !== 'function') {
    throw new Error('rankNewVariant: costTracker must be an AgentCostScope (missing getOwnSpent)');
  }
  const getOwn = costTracker.getOwnSpent as () => number;
  const costBeforeRank = getOwn();

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

  const rankingCost = getOwn() - costBeforeRank;

  // B119: when `localPool` contains foreign (arena) entries, their ratings
  // inflate the top-15% cutoff and cause in-run variants to be incorrectly
  // discarded. Recompute the cutoff over in-run ratings only; arena entries
  // remain available as comparators but don't set the bar.
  const inRunIds = new Set(localPool.filter((v) => !v.fromArena).map((v) => v.id));
  const inRunRatings = new Map<string, Rating>();
  for (const [id, r] of localRatings) {
    if (inRunIds.has(id)) inRunRatings.set(id, r);
  }
  const localCutoff = computeTop15Cutoff(inRunRatings);
  const localVariantElo = localRatings.get(variant.id)!.elo;

  // Discard only when budget-stopped AND below the top-15% cutoff.
  const discard = rankResult.status === 'budget' && localVariantElo < localCutoff;
  const surfaced = !discard;
  const discardReason = discard ? { localElo: localVariantElo, localTop15Cutoff: localCutoff } : undefined;

  return { rankingCost, rankResult, surfaced, discardReason };
}
