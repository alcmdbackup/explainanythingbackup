// Meta-review agent synthesizing feedback from pool history to guide evolution.
// Pure analysis — no LLM calls, cost is always 0.

import { AgentBase } from './base';
import type {
  AgentResult,
  ExecutionContext,
  PipelineState,
  AgentPayload,
  MetaFeedback,
  TextVariation,
} from '../types';

export class MetaReviewAgent extends AgentBase {
  readonly name = 'meta_review';

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    if (state.pool.length === 0 || state.eloRatings.size === 0) {
      return { agentType: 'meta_review', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: 'No pool data to analyze' };
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

    state.metaFeedback = metaFeedback;

    logger.info('Meta-review complete', {
      strategies: successfulStrategies.length,
      weaknesses: recurringWeaknesses.length,
      failures: patternsToAvoid.length,
      priorities: priorityImprovements.length,
    });

    return { agentType: 'meta_review', success: true, costUsd: ctx.costTracker.getAgentCost(this.name) };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_payload: AgentPayload): number {
    return 0;
  }

  canExecute(state: PipelineState): boolean {
    return state.pool.length >= 1 && state.eloRatings.size >= 1;
  }

  /** Find strategies that produce above-average Elo variants, sorted descending. */
  _analyzeStrategies(state: PipelineState): string[] {
    if (state.eloRatings.size === 0) return [];

    const strategyScores = new Map<string, number[]>();
    for (const v of state.pool) {
      const elo = state.eloRatings.get(v.id) ?? 1200;
      const arr = strategyScores.get(v.strategy) ?? [];
      arr.push(elo);
      strategyScores.set(v.strategy, arr);
    }

    if (strategyScores.size === 0) return [];

    const allElos = [...state.eloRatings.values()];
    const avgElo = allElos.reduce((a, b) => a + b, 0) / allElos.length;

    const successful: string[] = [];
    for (const [strategy, scores] of strategyScores) {
      const stratAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (stratAvg > avgElo) successful.push(strategy);
    }

    // Sort by average Elo descending
    successful.sort((a, b) => {
      const avgA = avg(strategyScores.get(a)!);
      const avgB = avg(strategyScores.get(b)!);
      return avgB - avgA;
    });

    return successful;
  }

  /** Find patterns in bottom-quartile variants. */
  _findWeaknesses(state: PipelineState): string[] {
    const weaknesses: string[] = [];
    if (state.eloRatings.size === 0) return weaknesses;

    const sortedIds = [...state.eloRatings.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);

    const bottom25pct = Math.max(1, Math.floor(sortedIds.length / 4));
    const lowEloIds = new Set(sortedIds.slice(0, bottom25pct));

    const idToVar = new Map<string, TextVariation>(state.pool.map((v) => [v.id, v]));
    const lowStrategies = new Map<string, number>();

    for (const vid of lowEloIds) {
      const v = idToVar.get(vid);
      if (v) {
        lowStrategies.set(v.strategy, (lowStrategies.get(v.strategy) ?? 0) + 1);
      }
    }

    // Identify overrepresented strategies in low performers
    for (const [strategy, count] of lowStrategies) {
      if (count >= bottom25pct * 0.5) {
        weaknesses.push(`Strategy '${strategy}' often produces low-quality variants`);
      }
    }

    // Check generated vs evolved patterns
    let generated = 0;
    let evolved = 0;
    for (const vid of lowEloIds) {
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

  /** Find strategies with consistently negative parent-to-child Elo delta. */
  _findFailures(state: PipelineState): string[] {
    const failures: string[] = [];
    if (state.eloRatings.size === 0) return failures;

    const idToVar = new Map<string, TextVariation>(state.pool.map((v) => [v.id, v]));
    const strategyDeltas = new Map<string, number[]>();

    for (const v of state.pool) {
      if (v.parentIds.length === 0) continue;

      const childElo = state.eloRatings.get(v.id) ?? 1200;
      const parentElos = v.parentIds
        .filter((pid) => idToVar.has(pid))
        .map((pid) => state.eloRatings.get(pid) ?? 1200);

      if (parentElos.length === 0) continue;

      const bestParentElo = Math.max(...parentElos);
      const delta = childElo - bestParentElo;

      const arr = strategyDeltas.get(v.strategy) ?? [];
      arr.push(delta);
      strategyDeltas.set(v.strategy, arr);
    }

    for (const [strategy, deltas] of strategyDeltas) {
      if (deltas.length >= 2) {
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        if (avgDelta < -50) {
          failures.push(`Avoid '${strategy}' - degrades quality (avg delta: ${Math.round(avgDelta)})`);
        }
      }
    }

    return failures;
  }

  /** Identify priority improvements based on pool gaps. */
  _prioritize(state: PipelineState): string[] {
    const priorities: string[] = [];
    if (state.pool.length === 0) return priorities;

    // Check pool diversity
    if (state.diversityScore !== null && state.diversityScore < 0.3) {
      priorities.push('Increase diversity - pool is homogenizing');
    }

    // Check Elo distribution
    if (state.eloRatings.size > 0) {
      const elos = [...state.eloRatings.values()];
      const eloRange = Math.max(...elos) - Math.min(...elos);
      if (eloRange < 100) {
        priorities.push('Variants too similar - try bolder transformations');
      } else if (eloRange > 500) {
        priorities.push('High variance - refine top performers');
      }
    }

    // Check for stagnation
    if (state.iteration > 3) {
      const top3 = state.getTopByElo(3);
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
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
