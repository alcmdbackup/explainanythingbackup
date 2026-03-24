// Compute functions for metrics written at run completion (elo, match stats, variant counts).

import type { FinalizationContext } from '../types';
import { toEloScale, DEFAULT_MU } from '@evolution/lib/shared/computeRatings';

export function computeWinnerElo(ctx: FinalizationContext): number | null {
  if (ctx.pool.length === 0) return null;
  const winner = ctx.pool.reduce((best, v) =>
    (ctx.ratings.get(v.id)?.mu ?? 0) > (ctx.ratings.get(best.id)?.mu ?? 0) ? v : best);
  const mu = ctx.ratings.get(winner.id)?.mu;
  return mu != null ? toEloScale(mu) : null;
}

export function computeMedianElo(ctx: FinalizationContext): number | null {
  const elos = ctx.pool
    .map(v => toEloScale(ctx.ratings.get(v.id)?.mu ?? DEFAULT_MU))
    .sort((a, b) => a - b);
  return elos.length > 0 ? elos[Math.floor(elos.length * 0.5)] : null;
}

export function computeP90Elo(ctx: FinalizationContext): number | null {
  const elos = ctx.pool
    .map(v => toEloScale(ctx.ratings.get(v.id)?.mu ?? DEFAULT_MU))
    .sort((a, b) => a - b);
  return elos.length > 0 ? elos[Math.floor(elos.length * 0.9)] : null;
}

export function computeMaxElo(ctx: FinalizationContext): number | null {
  if (ctx.pool.length === 0) return null;
  const elos = ctx.pool.map(v => toEloScale(ctx.ratings.get(v.id)?.mu ?? DEFAULT_MU));
  return Math.max(...elos);
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
