// Compute functions for invocation-level metrics at run finalization.
// Uses currentInvocationId on the FinalizationContext to scope metrics to a single invocation.

import type { FinalizationContext } from '../types';
import { toEloScale } from '@evolution/lib/shared/computeRatings';
import type { GenerationExecutionDetail } from '@evolution/lib/types';

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
