// Swiss-style tournament ranking agent with Elo ratings.
// Wraps PairwiseRanker for efficient ranking via Swiss pairing, budget-adaptive depth, and convergence detection.

import { AgentBase } from './base';
import { PairwiseRanker } from './pairwiseRanker';
import { getAdaptiveK, updateEloWithConfidence } from '../core/elo';
import { ELO_CONSTANTS } from '../config';
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
  initialRating: number;
  maxRounds: number;
  convergenceChecks: number;
  maxComparisons: number;
  maxStaleRounds: number;
}

const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  initialRating: ELO_CONSTANTS.INITIAL_RATING,
  maxRounds: 50,
  convergenceChecks: 5,
  maxComparisons: 40,
  maxStaleRounds: 3,
};

// ─── Swiss pairing ──────────────────────────────────────────────

function normalizePair(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/** Uncertainty proxy: variants with fewer matches have higher sigma. */
function sigma(matchCount: number): number {
  return 1 / Math.sqrt(Math.min(matchCount, 20) + 1);
}

/** Elo expected score for player A against player B. */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** Info-theoretic Swiss pairing: score candidate pairs by information gain potential. */
export function swissPairing(
  variants: TextVariation[],
  eloRatings: Map<string, number>,
  completedPairs: Set<string>,
  initialRating: number,
  matchCounts: Map<string, number> = new Map(),
): Array<[TextVariation, TextVariation]> {
  if (variants.length < 2) return [];

  // Determine top-K threshold (K = max(1, floor(pool/3)))
  const k = Math.max(1, Math.floor(variants.length / 3));
  const sortedRatings = [...variants]
    .map((v) => eloRatings.get(v.id) ?? initialRating)
    .sort((a, b) => b - a);
  const topKThreshold = sortedRatings[Math.min(k, sortedRatings.length) - 1];

  // Score all candidate pairs
  const candidatePairs: Array<{ a: TextVariation; b: TextVariation; score: number }> = [];
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i];
      const b = variants[j];
      if (completedPairs.has(normalizePair(a.id, b.id))) continue;

      const rA = eloRatings.get(a.id) ?? initialRating;
      const rB = eloRatings.get(b.id) ?? initialRating;

      // Outcome uncertainty: highest when expected score ≈ 0.5
      const expA = expectedScore(rA, rB);
      const outcomeUncertainty = 1 - Math.abs(2 * expA - 1);

      // Sigma proxy: preference for under-tested variants
      const sigmaProxy = (sigma(matchCounts.get(a.id) ?? 0) + sigma(matchCounts.get(b.id) ?? 0)) / 2;

      // Top-K boost: 1.5x if both in top K
      const bothTopK = rA >= topKThreshold && rB >= topKThreshold;
      const topKBoost = bothTopK ? 1.5 : 1.0;

      candidatePairs.push({ a, b, score: outcomeUncertainty * sigmaProxy * topKBoost });
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

  /** Get top quartile Elo threshold. */
  private getTopQuartileElo(eloRatings: Map<string, number>): number {
    if (eloRatings.size < 4) {
      return eloRatings.size > 0 ? Math.max(...eloRatings.values()) : this.cfg.initialRating;
    }
    const sorted = [...eloRatings.values()].sort((a, b) => b - a);
    return sorted[Math.floor(sorted.length / 4)];
  }

  /** Check if a match needs a multi-turn tiebreaker (top-quartile close match). */
  private needsMultiTurn(
    idA: string,
    idB: string,
    eloRatings: Map<string, number>,
    budgetCfg: BudgetPressureConfig,
    multiTurnCount: number,
  ): boolean {
    if (multiTurnCount >= budgetCfg.maxMultiTurnDebates) return false;

    const ratingA = eloRatings.get(idA) ?? this.cfg.initialRating;
    const ratingB = eloRatings.get(idB) ?? this.cfg.initialRating;
    const diff = Math.abs(ratingA - ratingB);

    const topThreshold = this.getTopQuartileElo(eloRatings);
    const bothTopQuartile = ratingA >= topThreshold && ratingB >= topThreshold;
    const closeMatch = diff < budgetCfg.multiTurnThreshold;

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
      const eloA = ctx.state.eloRatings.get(varA.id) ?? this.cfg.initialRating;
      const eloB = ctx.state.eloRatings.get(varB.id) ?? this.cfg.initialRating;
      const tieWinner = eloA >= eloB ? varA.id : varB.id;
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

    // Initialize Elo for any variants not yet rated
    for (const v of pool) {
      if (!state.eloRatings.has(v.id)) {
        state.eloRatings.set(v.id, this.cfg.initialRating);
      }
    }

    const completedPairs = new Set<string>();
    let multiTurnCount = 0;
    const prevRatings = new Map(state.eloRatings);
    const matches: Match[] = [];
    let totalComparisons = 0;
    let convergenceStreak = 0;
    let staleRounds = 0;

    for (let round = 0; round < this.cfg.maxRounds; round++) {
      if (totalComparisons >= maxComparisons) {
        logger.debug('Tournament max comparisons reached', { total: totalComparisons });
        break;
      }

      const pairs = swissPairing(pool, state.eloRatings, completedPairs, this.cfg.initialRating, state.matchCounts);

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
          varA.id, varB.id, state.eloRatings, budgetCfg, multiTurnCount,
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

      // Apply Elo updates sequentially after all round promises resolve
      for (let pi = 0; pi < roundResults.length; pi++) {
        const result = roundResults[pi];
        if (result.status !== 'fulfilled') continue;

        const match = result.value;
        const { varA, varB } = pairConfigs[pi];
        matches.push(match);
        state.matchHistory.push(match);

        const kA = getAdaptiveK(state.matchCounts.get(varA.id) ?? 0);
        const kB = getAdaptiveK(state.matchCounts.get(varB.id) ?? 0);
        const kFactor = (kA + kB) / 2;

        const winnerId = match.winner;
        const loserId = winnerId === varA.id ? varB.id : varA.id;
        updateEloWithConfidence(state, winnerId, loserId, match.confidence, kFactor);

        completedPairs.add(normalizePair(varA.id, varB.id));
        totalComparisons++;
      }

      // Convergence detection: max Elo change < 10 for N consecutive checks
      let maxChange = 0;
      for (const [vid, rating] of state.eloRatings) {
        maxChange = Math.max(maxChange, Math.abs(rating - (prevRatings.get(vid) ?? rating)));
      }
      prevRatings.clear();
      for (const [vid, rating] of state.eloRatings) {
        prevRatings.set(vid, rating);
      }

      if (maxChange < 10) {
        convergenceStreak++;
        if (convergenceStreak >= this.cfg.convergenceChecks) {
          logger.info('Tournament converged', { round, comparisons: totalComparisons });
          break;
        }
      } else {
        convergenceStreak = 0;
      }
    }

    // Convergence metric: normalized rating spread (lower std = higher convergence)
    let convergenceMetric = 1.0;
    if (state.eloRatings.size > 1) {
      const ratings = [...state.eloRatings.values()];
      const mean = ratings.reduce((s, r) => s + r, 0) / ratings.length;
      const variance = ratings.reduce((s, r) => s + (r - mean) ** 2, 0) / ratings.length;
      const stdDev = Math.sqrt(variance);
      convergenceMetric = Math.max(0, Math.min(1, 1 - stdDev / 200));
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
