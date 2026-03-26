// Compute functions for invocation-level metrics at run finalization.
// Uses currentInvocationId on the FinalizationContext to scope metrics to a single invocation.

import type { FinalizationContext } from '../types';
import { toEloScale } from '@evolution/lib/shared/computeRatings';
import type { GenerationExecutionDetail } from '@evolution/lib/types';

/**
 * Extract variant IDs produced by a given invocation from its execution_detail.
 * Only generation invocations produce variants (via strategies[].variantId).
 */
function getInvocationVariantIds(
  detail: GenerationExecutionDetail | undefined,
): string[] {
  if (!detail?.strategies) return [];
  return detail.strategies
    .filter(s => s.status === 'success' && s.variantId)
    .map(s => s.variantId!);
}

export function computeBestVariantElo(
  ctx: FinalizationContext,
  invocationId: string | undefined | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId);
  const variantIds = getInvocationVariantIds(detail as GenerationExecutionDetail | undefined);
  if (variantIds.length === 0) return null;

  const elos = variantIds
    .map(id => ctx.ratings.get(id)?.mu)
    .filter((mu): mu is number => mu != null)
    .map(mu => toEloScale(mu));

  return elos.length > 0 ? Math.max(...elos) : null;
}

export function computeAvgVariantElo(
  ctx: FinalizationContext,
  invocationId: string | undefined | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId);
  const variantIds = getInvocationVariantIds(detail as GenerationExecutionDetail | undefined);
  if (variantIds.length === 0) return null;

  const elos = variantIds
    .map(id => ctx.ratings.get(id)?.mu)
    .filter((mu): mu is number => mu != null)
    .map(mu => toEloScale(mu));

  return elos.length > 0 ? elos.reduce((s, e) => s + e, 0) / elos.length : null;
}

export function computeInvocationVariantCount(
  ctx: FinalizationContext,
  invocationId: string | undefined | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId);
  const variantIds = getInvocationVariantIds(detail as GenerationExecutionDetail | undefined);
  return variantIds.length;
}
