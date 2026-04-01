// Compute functions for metrics written during execution and at run completion.

import type { ExecutionContext, FinalizationContext } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { toEloScale, DEFAULT_MU, ELO_SIGMA_SCALE } from '@evolution/lib/shared/computeRatings';

/** Convert variant sigma to Elo-scale sigma and build a MetricValue with 95% CI. */
function eloMetricValue(elo: number, sigma: number | undefined): MetricValue {
  const eloSigma = sigma != null ? sigma * ELO_SIGMA_SCALE : null;
  return {
    value: elo,
    sigma: eloSigma,
    ci: eloSigma != null ? [elo - 1.96 * eloSigma, elo + 1.96 * eloSigma] : null,
    n: 1,
  };
}

export function computeWinnerElo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  const winner = ctx.pool.reduce((best, v) =>
    (ctx.ratings.get(v.id)?.mu ?? -Infinity) > (ctx.ratings.get(best.id)?.mu ?? -Infinity) ? v : best);
  const rating = ctx.ratings.get(winner.id);
  if (rating?.mu == null) return null;
  return eloMetricValue(toEloScale(rating.mu), rating.sigma);
}

export function computeMedianElo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  // Sort variants by elo to find the median position
  const sorted = ctx.pool
    .map(v => {
      const r = ctx.ratings.get(v.id);
      return { elo: toEloScale(r?.mu ?? DEFAULT_MU), sigma: r?.sigma };
    })
    .sort((a, b) => a.elo - b.elo);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return eloMetricValue(sorted[mid]!.elo, sorted[mid]!.sigma);
  }
  // Even length: average the two middle values and their sigmas
  const elo = (sorted[mid - 1]!.elo + sorted[mid]!.elo) / 2;
  const s1 = sorted[mid - 1]!.sigma;
  const s2 = sorted[mid]!.sigma;
  const avgSigma = s1 != null && s2 != null ? (s1 + s2) / 2 : (s1 ?? s2);
  return eloMetricValue(elo, avgSigma);
}

export function computeP90Elo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  const sorted = ctx.pool
    .map(v => {
      const r = ctx.ratings.get(v.id);
      return { elo: toEloScale(r?.mu ?? DEFAULT_MU), sigma: r?.sigma };
    })
    .sort((a, b) => a.elo - b.elo);
  const idx = Math.min(Math.ceil(sorted.length * 0.9) - 1, sorted.length - 1);
  return eloMetricValue(sorted[idx]!.elo, sorted[idx]!.sigma);
}

export function computeMaxElo(ctx: FinalizationContext): MetricValue | null {
  if (ctx.pool.length === 0) return null;
  let maxElo = -Infinity;
  let maxSigma: number | undefined;
  for (const v of ctx.pool) {
    const r = ctx.ratings.get(v.id);
    const elo = toEloScale(r?.mu ?? DEFAULT_MU);
    if (elo > maxElo) {
      maxElo = elo;
      maxSigma = r?.sigma;
    }
  }
  return eloMetricValue(maxElo, maxSigma);
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

// ─── Execution-phase metrics (cost tracking) ─────────────────────

export function computeRunCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getTotalSpent();
}

export function computeAgentCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getPhaseCosts()[ctx.phaseName] ?? 0;
}
