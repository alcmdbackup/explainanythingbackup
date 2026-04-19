// Compute functions for invocation-level metrics at run finalization.
// Uses currentInvocationId on the FinalizationContext to scope metrics to a single invocation.
// Agent-contributed metrics live here to avoid import cycles between registry.ts and Agent classes.
//
// Supports both LEGACY agent_name='generation'/'ranking' (with strategies[]/triage[] details)
// and NEW agent_name='generate_from_previous_article'/'swiss_ranking' (with single-variant detail).

import type { FinalizationContext } from '../types';
import type { GenerationExecutionDetail, RankingExecutionDetail } from '@evolution/lib/types';

interface NewGenerateFromPreviousDetail {
  detailType?: 'generate_from_previous_article';
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
    | (GenerationExecutionDetail | NewGenerateFromPreviousDetail)
    | undefined;
  if (!detail) return [];
  // New parallel pipeline: each generate_from_previous_article invocation owns 1 variant.
  if ((detail as NewGenerateFromPreviousDetail).detailType === 'generate_from_previous_article') {
    const d = detail as NewGenerateFromPreviousDetail;
    return d.variantId && d.surfaced ? [d.variantId] : [];
  }
  // Legacy generation: strategies[] with one variantId per strategy
  const legacy = detail as GenerationExecutionDetail;
  if (!legacy.strategies) return [];
  return legacy.strategies.filter(s => s.status === 'success' && s.variantId).map(s => s.variantId!);
}

function getInvocationElos(ctx: FinalizationContext, invocationId: string | undefined | null): number[] {
  return getInvocationVariantIds(ctx, invocationId)
    .map(id => ctx.ratings.get(id)?.elo)
    .filter((elo): elo is number => elo != null);
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
// (generate_from_previous_article/swiss_ranking) execution_detail shapes.

export function computeFormatRejectionRate(ctx: FinalizationContext, invocationId: string | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as
    | (GenerationExecutionDetail | NewGenerateFromPreviousDetail)
    | undefined;
  if (!detail) return null;
  if ((detail as NewGenerateFromPreviousDetail).detailType === 'generate_from_previous_article') {
    // New: 1 variant per invocation. Either valid or not.
    return (detail as NewGenerateFromPreviousDetail).generation?.formatValid === false ? 1 : 0;
  }
  const legacy = detail as GenerationExecutionDetail;
  if (!legacy.strategies?.length) return null;
  return legacy.strategies.filter(s => s.status === 'format_rejected').length / legacy.strategies.length;
}

/**
 * Phase 5: per-invocation ELO delta (child - parent) for invocations that produced a variant.
 * Returns the mean delta across produced variants, or null when no variant was produced
 * or the variant has no parent (seed variants).
 *
 * Runs at finalization; reads ratings + variant parentIds from ctx. The stale-flag trigger
 * keeps this fresh as parent ratings drift post-completion.
 */
export function computeInvocationEloDeltaVsParent(
  ctx: FinalizationContext,
  invocationId: string | null,
): number | null {
  const variantIds = getInvocationVariantIds(ctx, invocationId);
  if (variantIds.length === 0) return null;

  // Build a quick lookup from variantId -> parentVariantId[0] via the pool snapshot.
  const poolById = new Map(ctx.pool.map(v => [v.id, v]));

  const deltas: number[] = [];
  for (const vid of variantIds) {
    const v = poolById.get(vid);
    if (!v) continue;
    const parentId = v.parentIds?.[0];
    if (!parentId) continue; // seed variant — no delta
    const childElo = ctx.ratings.get(vid)?.elo;
    const parentElo = ctx.ratings.get(parentId)?.elo;
    if (childElo == null || parentElo == null) continue;
    deltas.push(childElo - parentElo);
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((s, d) => s + d, 0) / deltas.length;
}

export function computeTotalComparisons(ctx: FinalizationContext, invocationId: string | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as
    | (RankingExecutionDetail | NewGenerateFromPreviousDetail | NewSwissRankingDetail)
    | undefined;
  if (!detail) return null;
  const dt = (detail as { detailType?: string }).detailType;
  // New swiss_ranking: pairsSucceeded
  if (dt === 'swiss_ranking') return (detail as NewSwissRankingDetail).pairsSucceeded ?? null;
  // New generate_from_previous_article: ranking.totalComparisons
  if (dt === 'generate_from_previous_article') {
    return (detail as NewGenerateFromPreviousDetail).ranking?.totalComparisons ?? null;
  }
  // Legacy ranking
  return (detail as RankingExecutionDetail).totalComparisons ?? null;
}
