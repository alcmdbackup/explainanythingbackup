// Compute functions for metrics written during execution and at run completion.

import type { ExecutionContext, FinalizationContext } from '../types';
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
  if (elos.length === 0) return null;
  // True median: for odd length use middle, for even length average the two middle values
  const mid = Math.floor(elos.length / 2);
  return elos.length % 2 === 1 ? elos[mid]! : (elos[mid - 1]! + elos[mid]!) / 2;
}

export function computeP90Elo(ctx: FinalizationContext): number | null {
  const elos = ctx.pool
    .map(v => toEloScale(ctx.ratings.get(v.id)?.mu ?? DEFAULT_MU))
    .sort((a, b) => a - b);
  if (elos.length === 0) return null;
  // Nearest-rank P90: index = ceil(0.9 * n) - 1, clamped to valid range
  const idx = Math.min(Math.ceil(elos.length * 0.9) - 1, elos.length - 1);
  return elos[idx] ?? null;
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

// ─── Execution-phase metrics (cost tracking) ─────────────────────

export function computeRunCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getTotalSpent();
}

export function computeAgentCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getPhaseCosts()[ctx.phaseName] ?? 0;
}
