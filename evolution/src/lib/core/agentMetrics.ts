// Agent-specific metric compute functions for finalization-phase metrics.
// These are referenced by concrete Agent subclasses in their invocationMetrics arrays.

import type { FinalizationContext } from '../metrics/types';
import type { GenerationExecutionDetail, RankingExecutionDetail } from '../types';

export function computeFormatRejectionRate(
  ctx: FinalizationContext,
  invocationId: string | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as GenerationExecutionDetail | undefined;
  if (!detail?.strategies?.length) return null;
  return detail.strategies.filter(s => s.status === 'format_rejected').length / detail.strategies.length;
}

export function computeTotalComparisons(
  ctx: FinalizationContext,
  invocationId: string | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as RankingExecutionDetail | undefined;
  return detail?.totalComparisons ?? null;
}
