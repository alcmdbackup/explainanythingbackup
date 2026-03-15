// Pool diversity tracker for monitoring health and providing actionable recommendations.
// Pure analysis utility — no state mutations, no LLM calls.

import type { ReadonlyPipelineState, TextVariation } from '../types';

export const DIVERSITY_THRESHOLDS = {
  HEALTHY: 0.4,
  LOW: 0.2,
  CRITICAL: 0.1,
} as const;

export type DiversityStatus = 'HEALTHY' | 'LOW' | 'CRITICAL' | 'COLLAPSED';

export class PoolDiversityTracker {
  /** Get status label based on diversity score. */
  status(diversityScore: number): DiversityStatus {
    if (diversityScore >= DIVERSITY_THRESHOLDS.HEALTHY) return 'HEALTHY';
    if (diversityScore >= DIVERSITY_THRESHOLDS.LOW) return 'LOW';
    if (diversityScore >= DIVERSITY_THRESHOLDS.CRITICAL) return 'CRITICAL';
    return 'COLLAPSED';
  }

  /** Recommend actions based on pool health. */
  getRecommendations(state: ReadonlyPipelineState): string[] {
    const currentDiversity = state.diversityScore || 1.0;
    const st = this.status(currentDiversity);
    const recommendations: string[] = [];

    if (st === 'CRITICAL' || st === 'COLLAPSED') {
      recommendations.push('Force exploration mode in generation');
      recommendations.push('Skip evolution, focus on fresh variants');
    }

    if (st === 'LOW') {
      recommendations.push('Increase exploration rate');
      recommendations.push('Consider mutation operators');
    }

    // Check for dominant lineages
    const lineageCounts = this._countLineages(state);
    const poolSize = state.pool.length;
    for (const [lineage, count] of Object.entries(lineageCounts)) {
      if (poolSize > 0 && count > poolSize * 0.5) {
        recommendations.push(`Lineage ${lineage.slice(0, 8)} dominates - promote alternatives`);
      }
    }

    // Check strategy diversity
    const strategyCounts = this._countStrategies(state);
    if (Object.keys(strategyCounts).length <= 2 && poolSize > 5) {
      recommendations.push('Low strategy diversity - try different approaches');
    }

    return recommendations;
  }

  /** Count variants by root ancestor. */
  _countLineages(state: ReadonlyPipelineState): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const v of state.pool) {
      const root = this._findRoot(v, state);
      counts[root] = (counts[root] ?? 0) + 1;
    }
    return counts;
  }

  /** Trace variant back to its root ancestor, handling cycles. */
  _findRoot(variant: TextVariation, state: ReadonlyPipelineState): string {
    if (variant.parentIds.length === 0) return variant.id;

    const idToVar = new Map(state.pool.map((v) => [v.id, v]));
    let current = variant;
    const visited = new Set<string>();

    while (current.parentIds.length > 0) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      const parentId = current.parentIds[0];
      if (!idToVar.has(parentId)) break;
      if (visited.has(parentId)) break;
      current = idToVar.get(parentId)!;
    }

    return current.id;
  }

  /** Count variants by strategy. */
  _countStrategies(state: ReadonlyPipelineState): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const v of state.pool) {
      counts[v.strategy] = (counts[v.strategy] ?? 0) + 1;
    }
    return counts;
  }

  /** Compute diversity trend from score history. */
  computeTrend(history: number[]): 'improving' | 'stable' | 'declining' {
    if (history.length < 2) return 'stable';

    const mid = Math.floor(history.length / 2);
    const oldAvg = mid > 0 ? history.slice(0, mid).reduce((a, b) => a + b, 0) / mid : 0;
    const newSlice = history.slice(mid);
    const newAvg = newSlice.reduce((a, b) => a + b, 0) / newSlice.length;

    const diff = newAvg - oldAvg;
    if (diff > 0.05) return 'improving';
    if (diff < -0.05) return 'declining';
    return 'stable';
  }
}
