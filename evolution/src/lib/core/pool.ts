// Pool management with stratified sampling for calibration matches.
// Provides opponent selection across rating quartiles and pool health reporting.

import type { PipelineState, TextVariation } from '../types';
import { BASELINE_STRATEGY } from '../types';
import { createRating } from './rating';

export class PoolManager {
  constructor(private state: PipelineState) {}

  /** Add multiple variants to pool. Returns count actually added (excludes duplicates). */
  addVariants(variants: TextVariation[]): number {
    let added = 0;
    for (const v of variants) {
      if (!this.state.poolIds.has(v.id)) {
        this.state.addToPool(v);
        added += 1;
      }
    }
    return added;
  }

  /**
   * Select stratified opponents for calibration matches.
   * Strategy: 2 top quartile, 2 mid, 1 bottom/new — for n=5.
   */
  getCalibrationOpponents(newEntrantId: string, n: number = 5): string[] {
    const otherNew = this.state.newEntrantsThisIteration.filter((id) => id !== newEntrantId);
    const existing = this.state.pool
      .filter(
        (v) =>
          v.id !== newEntrantId &&
          !this.state.newEntrantsThisIteration.includes(v.id),
      )
      .map((v) => v.id);

    // First iteration: only other new entrants available
    if (existing.length === 0) return otherNew;

    // Not enough existing? Include other new entrants
    if (existing.length < n - 1) {
      return [...existing, ...otherNew.slice(0, n - existing.length)];
    }

    // No ratings yet? Return sample + new entrant
    if (this.state.ratings.size === 0) {
      return [...existing.slice(0, n - 1), ...otherNew.slice(0, 1)];
    }

    // Stratified sampling based on rating mu
    const defaultRating = createRating();
    const sortedExisting = [...existing].sort(
      (a, b) =>
        (this.state.ratings.get(b) ?? defaultRating).mu - (this.state.ratings.get(a) ?? defaultRating).mu,
    );

    const poolSize = sortedExisting.length;
    const q1 = Math.floor(poolSize / 4);
    const q2 = Math.floor(poolSize / 2);
    const q3 = Math.floor((3 * poolSize) / 4);

    const opponents: string[] = [];

    if (n >= 5) {
      const topSection = sortedExisting.slice(0, Math.max(q1, 1));
      opponents.push(...topSection.slice(0, 2));
      const midStart = Math.max(0, q2 - 1);
      const midSection = sortedExisting.slice(midStart, midStart + 2);
      opponents.push(...midSection.slice(0, 2));
      if (otherNew.length > 0) {
        opponents.push(otherNew[0]);
      } else if (q3 < poolSize) {
        opponents.push(sortedExisting[q3]);
      }
    } else if (n >= 3) {
      const topSection = sortedExisting.slice(0, Math.max(q1, 1));
      opponents.push(topSection[0]);
      const midStart = Math.max(0, q2 - 1);
      const midSection = sortedExisting.slice(midStart, midStart + 2);
      opponents.push(midSection[0]);
      if (otherNew.length > 0) {
        opponents.push(otherNew[0]);
      } else if (q3 < poolSize) {
        opponents.push(sortedExisting[q3]);
      }
    } else {
      const topSection = sortedExisting.slice(0, Math.max(q1, 1));
      opponents.push(...topSection.slice(0, n));
    }

    // Deduplicate preserving order
    const deduped = [...new Map(opponents.map((id) => [id, id])).values()].slice(0, n);

    // CORE-3: Pad from all available variants if fewer than n opponents after dedup
    if (deduped.length < n) {
      const used = new Set(deduped);
      const allAvailable = [...sortedExisting, ...otherNew].filter((id) => !used.has(id));
      for (const id of allAvailable) {
        if (deduped.length >= n) break;
        deduped.push(id);
      }
    }

    return deduped;
  }

  /** Get top N parents by rating for evolution, excluding baseline variant. */
  getEvolutionParents(n: number = 2): TextVariation[] {
    const allByRating = this.state.getTopByRating(this.state.getPoolSize());
    const eligible = allByRating.filter((v) => v.strategy !== BASELINE_STRATEGY);
    return eligible.slice(0, n);
  }

  /** Report pool health statistics using mu for ranking. */
  poolStatistics(): {
    size: number;
    muMin: number;
    muMax: number;
    muRange: number;
    strategies: Record<string, number>;
    iterationsRepresented: number;
  } {
    if (this.state.pool.length === 0) {
      return { size: 0, muMin: 0, muMax: 0, muRange: 0, strategies: {}, iterationsRepresented: 0 };
    }

    const mus =
      this.state.ratings.size > 0
        ? [...this.state.ratings.values()].map(r => r.mu)
        : [0];

    const strategies: Record<string, number> = {};
    for (const v of this.state.pool) {
      strategies[v.strategy] = (strategies[v.strategy] ?? 0) + 1;
    }

    return {
      size: this.state.pool.length,
      muMin: Math.min(...mus),
      muMax: Math.max(...mus),
      muRange: Math.max(...mus) - Math.min(...mus),
      strategies,
      iterationsRepresented: new Set(this.state.pool.map((v) => v.iterationBorn)).size,
    };
  }
}
