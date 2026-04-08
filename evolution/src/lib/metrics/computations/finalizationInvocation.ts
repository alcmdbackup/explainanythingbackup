// Compute functions for invocation-level metrics at run finalization.
// Uses currentInvocationId on the FinalizationContext to scope metrics to a single invocation.
// Agent-contributed metrics live here to avoid import cycles between registry.ts and Agent classes.
//
// Supports both LEGACY agent_name='generation'/'ranking' (with strategies[]/triage[] details)
// and NEW agent_name='generate_from_seed_article'/'swiss_ranking' (with single-variant detail).

import type { FinalizationContext } from '../types';
import { toEloScale } from '@evolution/lib/shared/computeRatings';
import type { GenerationExecutionDetail, RankingExecutionDetail } from '@evolution/lib/types';

interface NewGenerateFromSeedDetail {
  detailType?: 'generate_from_seed_article';
  variantId?: string | null;
  surfaced?: boolean;
  ranking?: { totalComparisons?: number } | null;
  generation?: { formatValid?: boolean };
}

interface NewSwissRankingDetail {
  detailType?: 'swiss_ranking';
  pairsSucceeded?: number;
}

function getInvocationVariantIds(ctx: FinalizationContext, invocationId: string | undefined | null): string[] {
  if (!invocationId || !ctx.invocationDetails) return [];
  const detail = ctx.invocationDetails.get(invocationId) as
    | (GenerationExecutionDetail | NewGenerateFromSeedDetail)
    | undefined;
  if (!detail) return [];
  // New parallel pipeline: each generate_from_seed_article invocation owns 1 variant.
  if ((detail as NewGenerateFromSeedDetail).detailType === 'generate_from_seed_article') {
    const d = detail as NewGenerateFromSeedDetail;
    return d.variantId && d.surfaced ? [d.variantId] : [];
  }
  // Legacy generation: strategies[] with one variantId per strategy
  const legacy = detail as GenerationExecutionDetail;
  if (!legacy.strategies) return [];
  return legacy.strategies.filter(s => s.status === 'success' && s.variantId).map(s => s.variantId!);
}

function getInvocationElos(ctx: FinalizationContext, invocationId: string | undefined | null): number[] {
  return getInvocationVariantIds(ctx, invocationId)
    .map(id => ctx.ratings.get(id)?.mu)
    .filter((mu): mu is number => mu != null)
    .map(mu => toEloScale(mu));
}

export function computeBestVariantElo(ctx: FinalizationContext, invocationId: string | undefined | null): number | null {
  const elos = getInvocationElos(ctx, invocationId);
  return elos.length > 0 ? Math.max(...elos) : null;
}

export function computeAvgVariantElo(ctx: FinalizationContext, invocationId: string | undefined | null): number | null {
  const elos = getInvocationElos(ctx, invocationId);
  return elos.length > 0 ? elos.reduce((s, e) => s + e, 0) / elos.length : null;
}

export function computeInvocationVariantCount(ctx: FinalizationContext, invocationId: string | undefined | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  return getInvocationVariantIds(ctx, invocationId).length;
}

// --- Agent-contributed metrics ---
// These functions handle BOTH legacy (generation/ranking) and new
// (generate_from_seed_article/swiss_ranking) execution_detail shapes.

export function computeFormatRejectionRate(ctx: FinalizationContext, invocationId: string | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as
    | (GenerationExecutionDetail | NewGenerateFromSeedDetail)
    | undefined;
  if (!detail) return null;
  if ((detail as NewGenerateFromSeedDetail).detailType === 'generate_from_seed_article') {
    // New: 1 variant per invocation. Either valid or not.
    return (detail as NewGenerateFromSeedDetail).generation?.formatValid === false ? 1 : 0;
  }
  const legacy = detail as GenerationExecutionDetail;
  if (!legacy.strategies?.length) return null;
  return legacy.strategies.filter(s => s.status === 'format_rejected').length / legacy.strategies.length;
}

export function computeTotalComparisons(ctx: FinalizationContext, invocationId: string | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as
    | (RankingExecutionDetail | NewGenerateFromSeedDetail | NewSwissRankingDetail)
    | undefined;
  if (!detail) return null;
  const dt = (detail as { detailType?: string }).detailType;
  // New swiss_ranking: pairsSucceeded
  if (dt === 'swiss_ranking') return (detail as NewSwissRankingDetail).pairsSucceeded ?? null;
  // New generate_from_seed_article: ranking.totalComparisons
  if (dt === 'generate_from_seed_article') {
    return (detail as NewGenerateFromSeedDetail).ranking?.totalComparisons ?? null;
  }
  // Legacy ranking
  return (detail as RankingExecutionDetail).totalComparisons ?? null;
}
