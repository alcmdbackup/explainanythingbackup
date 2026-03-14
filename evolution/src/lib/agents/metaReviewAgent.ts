// Meta-review agent synthesizing feedback from pool history to guide evolution.
// Pure analysis — no LLM calls, cost is always 0.

import { AgentBase } from './base';
import type {
  AgentResult,
  ExecutionContext,
  ReadonlyPipelineState,
  AgentPayload,
  MetaFeedback,
  MetaReviewExecutionDetail,
  TextVariation,
} from '../types';

export class MetaReviewAgent extends AgentBase {
  readonly name = 'metaReview';

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    if (state.pool.length === 0 || state.ratings.size === 0) {
      return { agentType: 'metaReview', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: 'No pool data to analyze', actions: [] };
    }

    const successfulStrategies = this._analyzeStrategies(state);
    const recurringWeaknesses = this._findWeaknesses(state);
    const patternsToAvoid = this._findFailures(state);
    const priorityImprovements = this._prioritize(state);

    const metaFeedback: MetaFeedback = {
      recurringWeaknesses,
      priorityImprovements,
      successfulStrategies,
      patternsToAvoid,
    };

    logger.info('Meta-review complete', {
      strategies: successfulStrategies.length,
      weaknesses: recurringWeaknesses.length,
      failures: patternsToAvoid.length,
      priorities: priorityImprovements.length,
    });

    // Build analysis snapshot for execution detail
    const strategyMus: Record<string, number> = {};
    const strategyScores = this._getStrategyScores(state);
    for (const [strat, scores] of strategyScores) {
      strategyMus[strat] = avg(scores);
    }

    const mus = [...state.ratings.values()].map(r => r.mu);
    const muRange = mus.length > 0 ? Math.max(...mus) - Math.min(...mus) : 0;
    const sortedIds = [...state.ratings.entries()]
      .sort((a, b) => a[1].mu - b[1].mu)
      .map(([id]) => id);
    const bottomQuartileCount = Math.max(1, Math.floor(sortedIds.length / 4));
    const top3 = state.getTopByRating(3);
    const topVariantAge = top3.length > 0
      ? state.iteration - Math.max(...top3.map(v => v.iterationBorn))
      : 0;

    const detail: MetaReviewExecutionDetail = {
      detailType: 'metaReview',
      successfulStrategies,
      recurringWeaknesses,
      patternsToAvoid,
      priorityImprovements,
      analysis: {
        strategyMus,
        bottomQuartileCount,
        poolDiversity: state.diversityScore ?? 1.0,
        muRange,
        activeStrategies: strategyScores.size,
        topVariantAge,
      },
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };

    return {
      agentType: 'metaReview', success: true, costUsd: ctx.costTracker.getAgentCost(this.name), executionDetail: detail,
      actions: [{ type: 'SET_META_FEEDBACK' as const, feedback: metaFeedback }],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_payload: AgentPayload): number {
    return 0;
  }

  canExecute(state: ReadonlyPipelineState): boolean {
    return state.pool.length >= 1 && state.ratings.size >= 1;
  }

  /** Compute per-strategy mu scores from the pool. Shared by _analyzeStrategies and execute. */
  _getStrategyScores(state: ReadonlyPipelineState): Map<string, number[]> {
    const strategyScores = new Map<string, number[]>();
    for (const v of state.pool) {
      const r = state.ratings.get(v.id);
      const mu = r ? r.mu : 0;
      const arr = strategyScores.get(v.strategy) ?? [];
      arr.push(mu);
      strategyScores.set(v.strategy, arr);
    }
    return strategyScores;
  }

  /** Find strategies that produce above-average mu variants, sorted descending. */
  _analyzeStrategies(state: ReadonlyPipelineState): string[] {
    if (state.ratings.size === 0) return [];

    const strategyScores = this._getStrategyScores(state);
    if (strategyScores.size === 0) return [];

    const allMus = [...state.ratings.values()].map(r => r.mu);
    const avgMu = avg(allMus);

    return [...strategyScores.entries()]
      .filter(([, scores]) => avg(scores) > avgMu)
      .sort((a, b) => avg(b[1]) - avg(a[1]))
      .map(([strategy]) => strategy);
  }

  /** Find patterns in bottom-quartile variants. */
  _findWeaknesses(state: ReadonlyPipelineState): string[] {
    if (state.ratings.size === 0) return [];

    const sortedIds = [...state.ratings.entries()]
      .sort((a, b) => a[1].mu - b[1].mu)
      .map(([id]) => id);

    const bottomCount = Math.max(1, Math.floor(sortedIds.length / 4));
    const lowRatingIds = new Set(sortedIds.slice(0, bottomCount));
    const idToVar = new Map<string, TextVariation>(state.pool.map((v) => [v.id, v]));

    // Count strategies in low-performing variants
    const lowStrategies = new Map<string, number>();
    for (const vid of lowRatingIds) {
      const v = idToVar.get(vid);
      if (v) {
        lowStrategies.set(v.strategy, (lowStrategies.get(v.strategy) ?? 0) + 1);
      }
    }

    // Identify overrepresented strategies in low performers
    const weaknesses: string[] = [];
    for (const [strategy, count] of lowStrategies) {
      if (count >= bottomCount * 0.5) {
        weaknesses.push(`Strategy '${strategy}' often produces low-quality variants`);
      }
    }

    // Check generated vs evolved performance pattern
    let generated = 0;
    let evolved = 0;
    for (const vid of lowRatingIds) {
      const v = idToVar.get(vid);
      if (v) {
        if (v.parentIds.length === 0) generated++;
        else evolved++;
      }
    }

    if (generated > evolved * 2) {
      weaknesses.push('Generated variants underperforming evolved variants');
    } else if (evolved > generated * 2) {
      weaknesses.push('Evolved variants degrading compared to generated');
    }

    return weaknesses;
  }

  /** Find strategies with consistently negative parent-to-child mu delta. */
  _findFailures(state: ReadonlyPipelineState): string[] {
    if (state.ratings.size === 0) return [];

    const idToVar = new Map<string, TextVariation>(state.pool.map((v) => [v.id, v]));
    const strategyDeltas = new Map<string, number[]>();

    for (const v of state.pool) {
      if (v.parentIds.length === 0) continue;

      const childMu = (state.ratings.get(v.id) ?? { mu: 0, sigma: 0 }).mu;
      const parentMus = v.parentIds
        .filter((pid) => idToVar.has(pid))
        .map((pid) => (state.ratings.get(pid) ?? { mu: 0, sigma: 0 }).mu);

      if (parentMus.length === 0) continue;

      const bestParentMu = Math.max(...parentMus);
      const delta = childMu - bestParentMu;

      if (!strategyDeltas.has(v.strategy)) {
        strategyDeltas.set(v.strategy, []);
      }
      strategyDeltas.get(v.strategy)!.push(delta);
    }

    // Identify consistently degrading strategies
    const failures: string[] = [];
    for (const [strategy, deltas] of strategyDeltas) {
      if (deltas.length >= 2) {
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        if (avgDelta < -3) {
          failures.push(`Avoid '${strategy}' - degrades quality (avg delta: ${Math.round(avgDelta)})`);
        }
      }
    }

    return failures;
  }

  /** Identify priority improvements based on pool gaps. */
  _prioritize(state: ReadonlyPipelineState): string[] {
    const priorities: string[] = [];
    if (state.pool.length === 0) return priorities;

    // Check pool diversity
    if (state.diversityScore !== null && state.diversityScore < 0.3) {
      priorities.push('Increase diversity - pool is homogenizing');
    }

    // Check mu distribution
    if (state.ratings.size > 0) {
      const mus = [...state.ratings.values()].map(r => r.mu);
      const muRange = Math.max(...mus) - Math.min(...mus);
      if (muRange < 6) {
        priorities.push('Variants too similar - try bolder transformations');
      } else if (muRange > 30) {
        priorities.push('High variance - refine top performers');
      }
    }

    // Check for stagnation
    if (state.iteration > 3) {
      const top3 = state.getTopByRating(3);
      if (top3.length > 0) {
        const maxBorn = Math.max(...top3.map((v) => v.iterationBorn));
        if (maxBorn < state.iteration - 2) {
          priorities.push('Top performers are stale - need fresh approaches');
        }
      }
    }

    // Strategy coverage
    const strategiesUsed = new Set(state.pool.map((v) => v.strategy));
    if (strategiesUsed.size < 3) {
      priorities.push('Try more diverse generation strategies');
    }

    return priorities;
  }
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}
