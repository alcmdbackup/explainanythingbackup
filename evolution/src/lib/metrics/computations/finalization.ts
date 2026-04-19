// Compute functions for metrics written during execution and at run completion.

import type { ExecutionContext, FinalizationContext } from '../types';
import type { MetricValue } from '../experimentMetrics';
import { DEFAULT_ELO } from '@evolution/lib/shared/computeRatings';

/** Build a MetricValue with 95% CI from Elo-space rating values. */
function eloMetricValue(elo: number, uncertainty: number | undefined): MetricValue {
  const eloUncertainty = uncertainty ?? null;
  return {
    value: elo,
    uncertainty: eloUncertainty,
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

// ─── Cost Estimate Accuracy (cost_estimate_accuracy_analysis_20260414) ─────────

/** Safe (actual - est) / est * 100, guarded against non-finite estimates. */
function pctError(actual: number, estimate: number): number | null {
  if (!Number.isFinite(estimate) || estimate <= 0) return null;
  if (!Number.isFinite(actual)) return null;
  return ((actual - estimate) / estimate) * 100;
}

/** Sum of `estimatedTotalCost` across GFSA invocations that recorded an estimate. */
export function computeEstimatedCost(ctx: FinalizationContext): number | null {
  if (!ctx.invocationDetails) return null;
  let total = 0;
  let found = false;
  for (const detail of ctx.invocationDetails.values()) {
    const d = detail as unknown as Record<string, unknown>;
    const est = d.estimatedTotalCost;
    if (typeof est === 'number' && Number.isFinite(est) && est >= 0) {
      total += est;
      found = true;
    }
  }
  return found ? total : null;
}

/** Mean |actual - estimated| USD across GFSA invocations with paired data. */
export function computeEstimationAbsErrorUsd(ctx: FinalizationContext): number | null {
  if (!ctx.invocationDetails) return null;
  const diffs: number[] = [];
  for (const detail of ctx.invocationDetails.values()) {
    const d = detail as unknown as Record<string, unknown>;
    const est = d.estimatedTotalCost;
    const act = d.totalCost;
    if (
      typeof est === 'number' && Number.isFinite(est) &&
      typeof act === 'number' && Number.isFinite(act)
    ) {
      diffs.push(Math.abs(act - est));
    }
  }
  if (diffs.length === 0) return null;
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

/** Mean per-invocation generation-phase error % across GFSA invocations. */
export function computeGenerationEstimationErrorPct(ctx: FinalizationContext): number | null {
  if (!ctx.invocationDetails) return null;
  const errors: number[] = [];
  for (const detail of ctx.invocationDetails.values()) {
    const d = detail as unknown as Record<string, unknown>;
    const gen = d.generation as Record<string, unknown> | undefined;
    if (!gen) continue;
    const est = gen.estimatedCost;
    const act = gen.cost;
    if (typeof est === 'number' && typeof act === 'number') {
      const e = pctError(act, est);
      if (e !== null) errors.push(e);
    }
  }
  if (errors.length === 0) return null;
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

/** Mean per-invocation ranking-phase error % across GFSA invocations. */
export function computeRankingEstimationErrorPct(ctx: FinalizationContext): number | null {
  if (!ctx.invocationDetails) return null;
  const errors: number[] = [];
  for (const detail of ctx.invocationDetails.values()) {
    const d = detail as unknown as Record<string, unknown>;
    const rank = d.ranking as Record<string, unknown> | undefined;
    if (!rank) continue;
    const est = rank.estimatedCost;
    const act = rank.cost;
    if (typeof est === 'number' && typeof act === 'number') {
      const e = pctError(act, est);
      if (e !== null) errors.push(e);
    }
  }
  if (errors.length === 0) return null;
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

// ─── Budget-floor observables (passed through FinalizationContext) ─────────────

export function computeAgentCostProjected(ctx: FinalizationContext): number | null {
  const v = ctx.budgetFloorObservables?.initialAgentCostEstimate;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeAgentCostActual(ctx: FinalizationContext): number | null {
  const v = ctx.budgetFloorObservables?.actualAvgCostPerAgent;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeParallelDispatched(ctx: FinalizationContext): number | null {
  const v = ctx.budgetFloorObservables?.parallelDispatched;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeSequentialDispatched(ctx: FinalizationContext): number | null {
  const v = ctx.budgetFloorObservables?.sequentialDispatched;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeMedianSequentialGfsaDurationMs(ctx: FinalizationContext): number | null {
  const v = ctx.budgetFloorObservables?.medianSequentialGfsaDurationMs;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function computeAvgSequentialGfsaDurationMs(ctx: FinalizationContext): number | null {
  const v = ctx.budgetFloorObservables?.avgSequentialGfsaDurationMs;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ─── Execution-phase metrics (cost tracking) ─────────────────────

export function computeRunCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getTotalSpent();
}

export function computeAgentCost(ctx: ExecutionContext): number {
  return ctx.costTracker.getPhaseCosts()[ctx.phaseName] ?? 0;
}
