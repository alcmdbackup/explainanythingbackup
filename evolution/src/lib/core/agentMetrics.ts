// Agent-specific metric compute functions for finalization-phase metrics.
// These are referenced by concrete Agent subclasses in their invocationMetrics arrays.

import type { FinalizationContext } from '../metrics/types';
import type { GenerationExecutionDetail, RankingExecutionDetail } from '../types';

/**
 * Compute format rejection rate for a generation invocation.
 * Returns the fraction of strategies that were format_rejected (0-1), or null if no detail.
 */
export function computeFormatRejectionRate(
  ctx: FinalizationContext,
  invocationId: string | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as GenerationExecutionDetail | undefined;
  if (!detail?.strategies || detail.strategies.length === 0) return null;

  const rejected = detail.strategies.filter(s => s.status === 'format_rejected').length;
  return rejected / detail.strategies.length;
}

/**
 * Compute total comparisons for a ranking invocation.
 * Returns the totalComparisons from execution detail, or null if no detail.
 */
export function computeTotalComparisons(
  ctx: FinalizationContext,
  invocationId: string | null,
): number | null {
  if (!invocationId || !ctx.invocationDetails) return null;
  const detail = ctx.invocationDetails.get(invocationId) as RankingExecutionDetail | undefined;
  if (!detail) return null;

  return detail.totalComparisons ?? null;
}
