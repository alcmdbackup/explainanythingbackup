// Compute functions for metrics written during execution and at run completion.

import type { ExecutionContext, FinalizationContext } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { DEFAULT_ELO } from '@evolution/lib/shared/computeRatings';

/** Build a MetricValue with 95% CI from Elo-space rating values. */
function eloMetricValue(elo: number, uncertainty: number | undefined): MetricValue {
  const eloUncertainty = uncertainty ?? null;
  return {
    value: elo,
    sigma: eloUncertainty,
    ci: eloUncertainty != null ? [elo - 1.96 * eloUncertainty, elo + 1.96 * eloUncertainty] : null,
    n: 1,
  };
}

export function computeWinnerElo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  const winner = ctx.pool.reduce((best, v) =>
    (ctx.ratings.get(v.id)?.elo ?? -Infinity) > (ctx.ratings.get(best.id)?.elo ?? -Infinity) ? v : best);
  const rating = ctx.ratings.get(winner.id);
  if (rating?.elo == null) return null;
  return eloMetricValue(rating.elo, rating.uncertainty);
}

export function computeMedianElo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  // Sort variants by elo to find the median position
  const sorted = ctx.pool
    .map(v => {
      const r = ctx.ratings.get(v.id);
      return { elo: r?.elo ?? DEFAULT_ELO, uncertainty: r?.uncertainty };
    })
    .sort((a, b) => a.elo - b.elo);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return eloMetricValue(sorted[mid]!.elo, sorted[mid]!.uncertainty);
  }
  // Even length: average the two middle values and their uncertainties
  const elo = (sorted[mid - 1]!.elo + sorted[mid]!.elo) / 2;
  const u1 = sorted[mid - 1]!.uncertainty;
  const u2 = sorted[mid]!.uncertainty;
  const avgUncertainty = u1 != null && u2 != null ? (u1 + u2) / 2 : (u1 ?? u2);
  return eloMetricValue(elo, avgUncertainty);
}

export function computeP90Elo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  const sorted = ctx.pool
    .map(v => {
      const r = ctx.ratings.get(v.id);
      return { elo: r?.elo ?? DEFAULT_ELO, uncertainty: r?.uncertainty };
    })
    .sort((a, b) => a.elo - b.elo);
  const idx = Math.min(Math.ceil(sorted.length * 0.9) - 1, sorted.length - 1);
  return eloMetricValue(sorted[idx]!.elo, sorted[idx]!.uncertainty);
}

export function computeMaxElo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  let maxElo = -Infinity;
  let maxUncertainty: number | undefined;
  for (const v of ctx.pool) {
    const r = ctx.ratings.get(v.id);
    const elo = r?.elo ?? DEFAULT_ELO;
    if (elo > maxElo) {
      maxElo = elo;
      maxUncertainty = r?.uncertainty;
    }
  }
  return eloMetricValue(maxElo, maxUncertainty);
}

export function computeTotalMatches(ctx: FinalizationContext): number {
  return ctx.matchHistory.length;
}

export function computeDecisiveRate(ctx: FinalizationContext): number | null {
  if (ctx.matchHistory.length === 0) return null;
  const decisive = ctx.matchHistory.filter(m => m.confidence > 0.6).length;
  return decisive / ctx.matchHistory.length;
}

export function computeVariantCount(ctx: FinalizationContext): number {
  return ctx.pool.length;
}

/** Average estimation error % across all GFSA invocations with feedback data. */
export function computeCostEstimationErrorPct(ctx: FinalizationContext): number | null {
  if (!ctx.invocationDetails) return null;
  const errors: number[] = [];
  for (const detail of ctx.invocationDetails.values()) {
    const d = detail as unknown as Record<string, unknown>;
    if (typeof d.estimationErrorPct === 'number' && Number.isFinite(d.estimationErrorPct)) {
      errors.push(d.estimationErrorPct);
    }
  }
  if (errors.length === 0) return null;
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

// ─── Execution-phase metrics (cost tracking) ─────────────────────

export function computeRunCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getTotalSpent();
}

export function computeAgentCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getPhaseCosts()[ctx.phaseName] ?? 0;
}
