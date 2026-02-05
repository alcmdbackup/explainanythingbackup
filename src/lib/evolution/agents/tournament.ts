// Swiss-style tournament ranking agent with OpenSkill Bayesian ratings.
// Wraps PairwiseRanker for efficient ranking via Swiss pairing, budget-adaptive depth, and sigma-based convergence.

import { AgentBase } from './base';
import { PairwiseRanker } from './pairwiseRanker';
import { updateRating, updateDraw, getOrdinal, isConverged, createRating, type Rating } from '../core/rating';
import { RATING_CONSTANTS } from '../config';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Match, TextVariation } from '../types';

// ─── Budget pressure configuration ─────────────────────────────

export interface BudgetPressureConfig {
  multiTurnThreshold: number;
  maxMultiTurnDebates: number;
  maxComparisons: number;
}

/** 3-tier budget pressure: low (<0.5), medium (0.5–0.8), high (≥0.8). */
export function budgetPressureConfig(pressure: number): BudgetPressureConfig {
  if (pressure < 0.5) {
    return { multiTurnThreshold: 100, maxMultiTurnDebates: 3, maxComparisons: 40 };
  }
  if (pressure < 0.8) {
    return { multiTurnThreshold: 75, maxMultiTurnDebates: 1, maxComparisons: 25 };
  }
  return { multiTurnThreshold: 30, maxMultiTurnDebates: 0, maxComparisons: 15 };
}

// ─── Tournament config ──────────────────────────────────────────

export interface TournamentConfig {
  maxRounds: number;
  convergenceChecks: number;
  maxComparisons: number;
  maxStaleRounds: number;
  convergenceSigmaThreshold: number;
}

const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  maxRounds: 50,
  convergenceChecks: 5,
  maxComparisons: 40,
  maxStaleRounds: 3,
  convergenceSigmaThreshold: RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD,
};

// ─── Swiss pairing ──────────────────────────────────────────────

function normalizePair(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/** Info-theoretic Swiss pairing using OpenSkill ordinal and real sigma. */
export function swissPairing(
  variants: TextVariation[],
  ratings: Map<string, Rating>,
  completedPairs: Set<string>,
): Array<[TextVariation, TextVariation]> {
  if (variants.length < 2) return [];

  const defaultRating = createRating();

  // Determine top-K threshold (K = max(1, floor(pool/3)))
  const k = Math.max(1, Math.floor(variants.length / 3));
  const sortedOrdinals = [...variants]
    .map((v) => getOrdinal(ratings.get(v.id) ?? defaultRating))
    .sort((a, b) => b - a);
  const topKThreshold = sortedOrdinals[Math.min(k, sortedOrdinals.length) - 1];

  // Score all candidate pairs
  const candidatePairs: Array<{ a: TextVariation; b: TextVariation; score: number }> = [];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i];
      const b = variants[j];
      if (completedPairs.has(normalizePair(a.id, b.id))) continue;

      const rA = ratings.get(a.id) ?? defaultRating;
      const rB = ratings.get(b.id) ?? defaultRating;
      const ordA = getOrdinal(rA);
      const ordB = getOrdinal(rB);

      // Outcome uncertainty: use ordinal gap scaled to [0, 1]
      // Smaller gap = higher uncertainty = more information from this match
      const ordGap = Math.abs(ordA - ordB);
      const outcomeUncertainty = 1 / (1 + ordGap / 10);

      // Real sigma: preference for high-uncertainty variants
      const sigmaWeight = (rA.sigma + rB.sigma) / 2;

      // Top-K boost: 1.5x if both in top K
      const bothTopK = ordA >= topKThreshold && ordB >= topKThreshold;
      const topKBoost = bothTopK ? 1.5 : 1.0;

      candidatePairs.push({ a, b, score: outcomeUncertainty * sigmaWeight * topKBoost });
    }
  }

  // Greedy selection by descending score
  candidatePairs.sort((x, y) => y.score - x.score);
  const used = new Set<string>();
  const pairs: Array<[TextVariation, TextVariation]> = [];

  for (const { a, b } of candidatePairs) {
    if (used.has(a.id) || used.has(b.id)) continue;
    pairs.push([a, b]);
    used.add(a.id);
    used.add(b.id);
  }

  return pairs;
}

// ─── Tournament agent ───────────────────────────────────────────

export class Tournament extends AgentBase {
  readonly name = 'tournament';
  private readonly pairwise = new PairwiseRanker();
  private readonly cfg: TournamentConfig;

  constructor(config: Partial<TournamentConfig> = {}) {
    super();
    this.cfg = { ...DEFAULT_TOURNAMENT_CONFIG, ...config };
  }

  /** Get top quartile ordinal threshold. */
  private getTopQuartileOrdinal(ratings: Map<string, Rating>): number {
    if (ratings.size < 4) {
      return ratings.size > 0 ? Math.max(...[...ratings.values()].map(getOrdinal)) : 0;
    }
    const sorted = [...ratings.values()].map(getOrdinal).sort((a, b) => b - a);
    return sorted[Math.floor(sorted.length / 4)];
  }

  /** Check if a match needs a multi-turn tiebreaker (top-quartile close match). */
  private needsMultiTurn(
    idA: string,
    idB: string,
    ratings: Map<string, Rating>,
    budgetCfg: BudgetPressureConfig,
    multiTurnCount: number,
  ): boolean {
    if (multiTurnCount >= budgetCfg.maxMultiTurnDebates) return false;

    const defaultRating = createRating();
    const rA = ratings.get(idA) ?? defaultRating;
    const rB = ratings.get(idB) ?? defaultRating;
    const muDiff = Math.abs(rA.mu - rB.mu);

    const topThreshold = this.getTopQuartileOrdinal(ratings);
    const bothTopQuartile = getOrdinal(rA) >= topThreshold && getOrdinal(rB) >= topThreshold;
    // Scale multiTurnThreshold from Elo scale to mu scale (divide by ~16)
    const closeMatch = muDiff < budgetCfg.multiTurnThreshold / 16;

    return bothTopQuartile && closeMatch;
  }

  /** Run a single comparison, optionally with multi-turn tiebreaker. */
  private async runComparison(
    ctx: ExecutionContext,
    varA: TextVariation,
    varB: TextVariation,
    useMultiTurn: boolean,
    structured: boolean,
  ): Promise<Match> {
    const match = await this.pairwise.compareWithBiasMitigation(
      ctx, varA.id, varA.text, varB.id, varB.text, structured,
    );

    if (useMultiTurn && match.confidence < 1.0) {
      // Third-call tiebreaker
      const tiebreaker = await this.pairwise.comparePair(ctx, varA.text, varB.text, structured);
      const mergedDims = { ...match.dimensionScores, ...tiebreaker.dimensionScores };

      if (tiebreaker.winner === 'A') {
        return { ...match, winner: varA.id, confidence: 0.8, turns: 3, dimensionScores: mergedDims };
      }
      if (tiebreaker.winner === 'B') {
        return { ...match, winner: varB.id, confidence: 0.8, turns: 3, dimensionScores: mergedDims };
      }
      if (tiebreaker.winner === null) {
        return { ...match, confidence: 0.4, turns: 3, dimensionScores: mergedDims };
      }
      // TIE tiebreaker → higher-rated variant wins
      const defaultRating = createRating();
      const ordA = getOrdinal(ctx.state.ratings.get(varA.id) ?? defaultRating);
      const ordB = getOrdinal(ctx.state.ratings.get(varB.id) ?? defaultRating);
      const tieWinner = ordA >= ordB ? varA.id : varB.id;
      return { ...match, winner: tieWinner, confidence: 0.6, turns: 3, dimensionScores: mergedDims };
    }

    return match;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;
    if (!this.canExecute(state)) {
      return { agentType: 'tournament', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: 'Need at least 2 variations' };
    }

    const pool = state.pool;
    const budgetPressure = 1 - (ctx.costTracker.getAvailableBudget() / ctx.payload.config.budgetCapUsd);
    const budgetCfg = budgetPressureConfig(Math.max(0, budgetPressure));
    const structured = ctx.payload.config.calibration.opponents > 3;
    const maxComparisons = Math.min(budgetCfg.maxComparisons, this.cfg.maxComparisons);

    logger.info('Tournament start', { poolSize: pool.length, budgetPressure: budgetPressure.toFixed(2), maxComparisons });

    // Initialize rating for any variants not yet rated
    for (const v of pool) {
      if (!state.ratings.has(v.id)) {
        state.ratings.set(v.id, createRating());
      }
    }

    const completedPairs = new Set<string>();
    let multiTurnCount = 0;
    const matches: Match[] = [];
    let totalComparisons = 0;
    let convergenceStreak = 0;
    let staleRounds = 0;

    for (let round = 0; round < this.cfg.maxRounds; round++) {
      if (totalComparisons >= maxComparisons) {
        logger.debug('Tournament max comparisons reached', { total: totalComparisons });
        break;
      }

      const pairs = swissPairing(pool, state.ratings, completedPairs);

      if (pairs.length === 0) {
        staleRounds++;
        if (staleRounds >= this.cfg.maxStaleRounds) {
          logger.debug('Tournament no new pairings');
          break;
        }
        continue;
      }
      staleRounds = 0;

      // Cap pairs to remaining comparison budget
      const remainingBudget = maxComparisons - totalComparisons;
      const cappedPairs = pairs.slice(0, remainingBudget);

      // Pre-compute multi-turn flags before parallel execution
      const pairConfigs = cappedPairs.map(([varA, varB]) => {
        const useMultiTurn = this.needsMultiTurn(
          varA.id, varB.id, state.ratings, budgetCfg, multiTurnCount,
        );
        if (useMultiTurn) multiTurnCount++;
        return { varA, varB, useMultiTurn };
      });

      // Run all pairs in this round in parallel
      const roundResults = await Promise.allSettled(
        pairConfigs.map(async ({ varA, varB, useMultiTurn }) =>
          this.runComparison(ctx, varA, varB, useMultiTurn, structured),
        ),
      );

      // Apply rating updates sequentially after all round promises resolve
      for (let pi = 0; pi < roundResults.length; pi++) {
        const result = roundResults[pi];
        if (result.status !== 'fulfilled') continue;

        const match = result.value;
        const { varA, varB } = pairConfigs[pi];
        matches.push(match);
        state.matchHistory.push(match);

        const winnerId = match.winner;
        const loserId = winnerId === varA.id ? varB.id : varA.id;
        const winnerRating = state.ratings.get(winnerId) ?? createRating();
        const loserRating = state.ratings.get(loserId) ?? createRating();

        // Use draw update for low-confidence results, decisive update otherwise
        if (match.confidence < 0.3) {
          const [newA, newB] = updateDraw(winnerRating, loserRating);
          state.ratings.set(winnerId, newA);
          state.ratings.set(loserId, newB);
        } else {
          const [newW, newL] = updateRating(winnerRating, loserRating);
          state.ratings.set(winnerId, newW);
          state.ratings.set(loserId, newL);
        }

        state.matchCounts.set(winnerId, (state.matchCounts.get(winnerId) ?? 0) + 1);
        state.matchCounts.set(loserId, (state.matchCounts.get(loserId) ?? 0) + 1);

        completedPairs.add(normalizePair(varA.id, varB.id));
        totalComparisons++;
      }

      // Sigma-based convergence: all ratings converged for N consecutive checks
      const allConverged = [...state.ratings.values()].every(
        (r) => isConverged(r, this.cfg.convergenceSigmaThreshold),
      );
      if (allConverged) {
        convergenceStreak++;
        if (convergenceStreak >= this.cfg.convergenceChecks) {
          logger.info('Tournament converged (sigma-based)', { round, comparisons: totalComparisons });
          break;
        }
      } else {
        convergenceStreak = 0;
      }
    }

    // Convergence metric: average sigma normalized (lower = more converged)
    let convergenceMetric = 1.0;
    if (state.ratings.size > 1) {
      const sigmas = [...state.ratings.values()].map((r) => r.sigma);
      const avgSigma = sigmas.reduce((s, v) => s + v, 0) / sigmas.length;
      // Default sigma ≈ 8.333, threshold ≈ 3.0. Normalize so 0 sigma → 1.0, default → 0
      convergenceMetric = Math.max(0, Math.min(1, 1 - avgSigma / (25 / 3)));
    }

    logger.info('Tournament complete', { matchesPlayed: matches.length, convergenceMetric: convergenceMetric.toFixed(3) });

    return {
      agentType: 'tournament',
      success: true,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      matchesPlayed: matches.length,
      convergence: convergenceMetric,
    };
  }

  estimateCost(payload: AgentPayload): number {
    const numVariations = 8; // typical pool size in COMPETITION
    const estimatedComparisons = Math.min(numVariations * 3, 40);
    const callsPerComparison = 2 * 1.2; // bias mitigation + ~20% multi-turn
    const textTokens = Math.ceil(payload.originalText.length / 4) * 2;
    const promptOverhead = 200;
    const inputTokens = textTokens + promptOverhead;
    const outputTokens = 10;
    const costPerCall = (inputTokens / 1_000_000) * 0.0008 + (outputTokens / 1_000_000) * 0.004;
    return costPerCall * estimatedComparisons * callsPerComparison;
  }

  canExecute(state: PipelineState): boolean {
    return state.pool.length >= 2;
  }
}
