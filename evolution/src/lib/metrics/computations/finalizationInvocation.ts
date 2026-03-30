// Compute functions for invocation-level metrics at run finalization.
// Uses currentInvocationId on the FinalizationContext to scope metrics to a single invocation.
// Agent-contributed metrics (format_rejection_rate, total_comparisons) live here to avoid
// import cycles between registry.ts and Agent classes.

import type { FinalizationContext } from '../types';
import { toEloScale } from '@evolution/lib/shared/computeRatings';
import type { GenerationExecutionDetail, RankingExecutionDetail } from '@evolution/lib/types';

function getInvocationVariantIds(ctx: FinalizationContext, invocationId: string | undefined | null): string[] {
  if (!invocationId || !ctx.invocationDetails) return [];
  const detail = ctx.invocationDetails.get(invocationId) as GenerationExecutionDetail | undefined;
  if (!detail?.strategies) return [];
  return detail.strategies.filter(s => s.status === 'success' && s.variantId).map(s => s.variantId!);
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

// --- Agent-contributed metrics (extracted from GenerationAgent/RankingAgent to avoid import cycles) ---

export function computeFormatRejectionRate(ctx: FinalizationContext, invocationId: string | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as GenerationExecutionDetail | undefined;
  if (!detail?.strategies?.length) return null;
  return detail.strategies.filter(s => s.status === 'format_rejected').length / detail.strategies.length;
}

export function computeTotalComparisons(ctx: FinalizationContext, invocationId: string | null): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as RankingExecutionDetail | undefined;
  return detail?.totalComparisons ?? null;
}
