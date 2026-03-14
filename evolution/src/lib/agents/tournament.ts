// Swiss-style tournament ranking agent with OpenSkill Bayesian ratings.
// Wraps PairwiseRanker for efficient ranking via Swiss pairing, budget-adaptive depth, and sigma-based convergence.

import { AgentBase } from './base';
import { PairwiseRanker } from './pairwiseRanker';
import { updateRating, updateDraw, isConverged, createRating, DEFAULT_MU, DEFAULT_SIGMA, type Rating } from '../core/rating';
import { RATING_CONSTANTS } from '../config';
import type { AgentResult, ExecutionContext, ReadonlyPipelineState, AgentPayload, Match, TextVariation, TournamentExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import type { PipelineAction } from '../core/actions';

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
  convergenceChecks: 2,
  maxComparisons: 40,
  maxStaleRounds: 1,
  convergenceSigmaThreshold: RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD,
};

/** Re-throw BudgetExceededError from any rejected promise in a settled batch. */
function rethrowBudgetErrors(results: PromiseSettledResult<unknown>[]): void {
  for (const r of results) {
    if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
      throw r.reason;
    }
  }
}

// ─── Swiss pairing ──────────────────────────────────────────────

function normalizePair(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

/**
 * Info-theoretic Swiss pairing using OpenSkill mu and real sigma.
 * Excludes variants that are BOTH below baseline (mu < 3*sigma) AND outside the top K.
 */
export function swissPairing(
  variants: readonly TextVariation[],
  ratings: ReadonlyMap<string, Rating>,
  completedPairs: Set<string>,
  topK: number = 5,
): Array<[TextVariation, TextVariation]> {
  if (variants.length < 2) return [];

  const defaultRating = createRating();

  const withMu = variants.map((v) => {
    const r = ratings.get(v.id) ?? defaultRating;
    return { variant: v, mu: r.mu, sigma: r.sigma };
  });
  withMu.sort((a, b) => b.mu - a.mu);

  const topKIds = new Set(withMu.slice(0, topK).map((e) => e.variant.id));

  let eligible = withMu
    .filter((e) => e.mu >= 3 * e.sigma || topKIds.has(e.variant.id))
    .map((e) => e.variant);

  if (eligible.length < 2) {
    eligible = withMu.slice(0, 2).map((e) => e.variant);
  }

  const candidatePairs: Array<{ a: TextVariation; b: TextVariation; score: number }> = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (completedPairs.has(normalizePair(a.id, b.id))) continue;

      const rA = ratings.get(a.id) ?? defaultRating;
      const rB = ratings.get(b.id) ?? defaultRating;
      const BETA = DEFAULT_SIGMA * Math.SQRT2;
      const pWin = 1 / (1 + Math.exp(-(rA.mu - rB.mu) / BETA));
      const outcomeUncertainty = 1 - Math.abs(2 * pWin - 1);

      const sigmaWeight = (rA.sigma + rB.sigma) / 2;

      candidatePairs.push({ a, b, score: outcomeUncertainty * sigmaWeight });
    }
  }

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

  /** Get top quartile mu threshold. */
  private getTopQuartileMu(ratings: Map<string, Rating>): number {
    if (ratings.size < 4) {
      const mus = [...ratings.values()].map(r => r.mu);
      return mus.length > 0 ? Math.max(...mus) : DEFAULT_MU;
    }
    const sorted = [...ratings.values()].map(r => r.mu).sort((a, b) => b - a);
    return sorted[Math.floor(sorted.length / 4)];
  }

  /** Check if a match needs a multi-turn tiebreaker (top-quartile close match). */
  private needsMultiTurn(
    idA: string,
    idB: string,
    ratings: Map<string, Rating>,
    budgetCfg: BudgetPressureConfig,
    multiTurnCount: number,
    topQuartileMu: number,
  ): boolean {
    if (multiTurnCount >= budgetCfg.maxMultiTurnDebates) return false;

    const defaultRating = createRating();
    const rA = ratings.get(idA) ?? defaultRating;
    const rB = ratings.get(idB) ?? defaultRating;
    const muDiff = Math.abs(rA.mu - rB.mu);

    const bothTopQuartile = rA.mu >= topQuartileMu && rB.mu >= topQuartileMu;
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
      ctx, varA.id, varA.text, varB.id, varB.text, structured, this.name,
    );

    if (useMultiTurn && match.confidence <= 0.5) {
      const tiebreaker = await this.pairwise.comparePair(ctx, varA.text, varB.text, structured, this.name);
      const mergedDims = { ...match.dimensionScores, ...tiebreaker.dimensionScores };

      if (tiebreaker.winner === 'A') {
        return { ...match, winner: varA.id, confidence: 0.8, turns: 3, dimensionScores: mergedDims };
      }
      if (tiebreaker.winner === 'B') {
        return { ...match, winner: varB.id, confidence: 0.8, turns: 3, dimensionScores: mergedDims };
      }
      return { ...match, confidence: 0.4, turns: 3, dimensionScores: mergedDims };
    }

    return match;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    const pool = state.pool;
    const budgetPressure = 1 - (ctx.costTracker.getAvailableBudget() / ctx.payload.config.budgetCapUsd);
    const clampedPressure = Math.max(0, Math.min(1, budgetPressure));
    const budgetCfg = budgetPressureConfig(clampedPressure);
    let budgetTier: TournamentExecutionDetail['budgetTier'] = 'low';
    if (clampedPressure >= 0.8) budgetTier = 'high';
    else if (clampedPressure >= 0.5) budgetTier = 'medium';
    const structured = ctx.payload.config.calibration.opponents > 3;
    const maxComparisons = Math.min(budgetCfg.maxComparisons, this.cfg.maxComparisons);

    const topKConfig = ctx.payload.config.tournament.topK;
    logger.info('Tournament start', { poolSize: pool.length, topK: topKConfig, budgetPressure: budgetPressure.toFixed(2), maxComparisons });

    // Local copies for incremental rating updates during execution
    const localRatings = new Map(state.ratings);
    const localMatchCounts = new Map(state.matchCounts);

    for (const v of pool) {
      if (!localRatings.has(v.id)) {
        localRatings.set(v.id, createRating());
      }
    }

    const completedPairs = new Set<string>();
    let multiTurnCount = 0;
    const matches: Match[] = [];
    let totalComparisons = 0;
    let convergenceStreak = 0;
    let staleRounds = 0;
    let exitReason: TournamentExecutionDetail['exitReason'] = 'maxRounds';
    const roundDetails: TournamentExecutionDetail['rounds'] = [];

    for (let round = 0; round < this.cfg.maxRounds; round++) {
      if (ctx.timeContext) {
        const elapsed = Date.now() - ctx.timeContext.startMs;
        const remaining = ctx.timeContext.maxDurationMs - elapsed;
        if (remaining < 120_000) {
          logger.info('Tournament yielding due to time pressure', {
            round, elapsed, remaining, comparisons: totalComparisons,
          });
          exitReason = 'time_limit';
          break;
        }
      }

      if (totalComparisons >= maxComparisons) {
        logger.debug('Tournament max comparisons reached', { total: totalComparisons });
        exitReason = 'budget';
        break;
      }

      if (ctx.costTracker.getAvailableBudget() < ctx.payload.config.budgetCapUsd * 0.05) {
        logger.info('Tournament aborting: available budget below 5%', {
          available: ctx.costTracker.getAvailableBudget(),
          cap: ctx.payload.config.budgetCapUsd,
        });
        exitReason = 'budget';
        break;
      }

      const pairs = swissPairing(pool, localRatings, completedPairs, topKConfig);

      if (pairs.length === 0) {
        staleRounds++;
        if (staleRounds >= this.cfg.maxStaleRounds) {
          logger.debug('Tournament no new pairings');
          exitReason = 'stale';
          break;
        }
        continue;
      }
      staleRounds = 0;

      const remainingBudget = maxComparisons - totalComparisons;
      const cappedPairs = pairs.slice(0, remainingBudget);

      const topQuartileMu = this.getTopQuartileMu(localRatings);

      let roundMultiTurn = 0;
      const pairConfigs = cappedPairs.map(([varA, varB]) => {
        const useMultiTurn = this.needsMultiTurn(
          varA.id, varB.id, localRatings, budgetCfg, multiTurnCount, topQuartileMu,
        );
        if (useMultiTurn) { multiTurnCount++; roundMultiTurn++; }
        return { varA, varB, useMultiTurn };
      });

      const roundResults = await Promise.allSettled(
        pairConfigs.map(async ({ varA, varB, useMultiTurn }) =>
          this.runComparison(ctx, varA, varB, useMultiTurn, structured),
        ),
      );

      const roundMatches: Match[] = [];

      for (let pi = 0; pi < roundResults.length; pi++) {
        const result = roundResults[pi];
        if (result.status !== 'fulfilled') continue;

        const match = result.value;
        const { varA, varB } = pairConfigs[pi];
        matches.push(match);
        roundMatches.push(match);

        const winnerId = match.winner;
        const loserId = winnerId === varA.id ? varB.id : varA.id;
        const winnerRating = localRatings.get(winnerId) ?? createRating();
        const loserRating = localRatings.get(loserId) ?? createRating();

        if (match.confidence < 0.3) {
          const [newA, newB] = updateDraw(winnerRating, loserRating);
          localRatings.set(winnerId, newA);
          localRatings.set(loserId, newB);
        } else {
          const [newW, newL] = updateRating(winnerRating, loserRating);
          localRatings.set(winnerId, newW);
          localRatings.set(loserId, newL);
        }

        localMatchCounts.set(winnerId, (localMatchCounts.get(winnerId) ?? 0) + 1);
        localMatchCounts.set(loserId, (localMatchCounts.get(loserId) ?? 0) + 1);

        completedPairs.add(normalizePair(varA.id, varB.id));
        totalComparisons++;
      }

      roundDetails.push({
        roundNumber: round,
        pairs: pairConfigs.map(({ varA, varB }) => ({ variantA: varA.id, variantB: varB.id })),
        matches: roundMatches,
        multiTurnUsed: roundMultiTurn,
      });

      rethrowBudgetErrors(roundResults);

      // === Flow Comparison (step 9b): run on same pairs, merge into existing matches ===
      if (ctx.payload.config.enabledAgents?.includes('flowCritique') ?? false) {
        try {
          const flowResults = await Promise.allSettled(
            pairConfigs.map(async ({ varA, varB }) =>
              this.pairwise.compareFlowWithBiasMitigation(ctx, varA.id, varA.text, varB.id, varB.text, this.name),
            ),
          );

          for (let fi = 0; fi < flowResults.length; fi++) {
            const flowResult = flowResults[fi];
            const qualityResult = roundResults[fi];
            if (flowResult.status !== 'fulfilled' || qualityResult?.status !== 'fulfilled') continue;

            const flowMatch = flowResult.value;
            const qualityMatch = qualityResult.value;
            Object.assign(qualityMatch.dimensionScores, flowMatch.dimensionScores);
            if (flowMatch.frictionSpots) {
              qualityMatch.frictionSpots = flowMatch.frictionSpots;
            }
          }

          rethrowBudgetErrors(flowResults);
        } catch (flowErr) {
          if (flowErr instanceof BudgetExceededError) throw flowErr;
          logger.warn('Flow comparison round failed (non-fatal)', { round, error: String(flowErr) });
        }
      }

      // Sigma-based convergence check
      const sortedByMu = [...localRatings.entries()]
        .map(([id, r]) => ({ id, r }))
        .sort((a, b) => b.r.mu - a.r.mu);
      const convergenceTopKIds = new Set(sortedByMu.slice(0, topKConfig).map((e) => e.id));
      const eligibleForConvergence = sortedByMu
        .filter((e) => e.r.mu >= 3 * e.r.sigma || convergenceTopKIds.has(e.id))
        .map((e) => e.r);

      if (eligibleForConvergence.length > 0 && eligibleForConvergence.every((r) => isConverged(r, this.cfg.convergenceSigmaThreshold))) {
        convergenceStreak++;
        if (convergenceStreak >= this.cfg.convergenceChecks) {
          logger.info('Tournament converged (sigma-based)', { round, comparisons: totalComparisons });
          exitReason = 'convergence';
          break;
        }
      } else {
        convergenceStreak = 0;
      }
    }

    let convergenceMetric = 1.0;
    if (localRatings.size > 1) {
      const sigmas = [...localRatings.values()].map((r) => r.sigma);
      const avgSigma = sigmas.reduce((s, v) => s + v, 0) / sigmas.length;
      convergenceMetric = Math.max(0, Math.min(1, 1 - avgSigma / DEFAULT_SIGMA));
    }

    logger.info('Tournament complete', { matchesPlayed: matches.length, convergenceMetric: convergenceMetric.toFixed(3) });

    const detail: TournamentExecutionDetail = {
      detailType: 'tournament',
      budgetPressure: clampedPressure,
      budgetTier,
      rounds: roundDetails,
      exitReason,
      convergenceStreak,
      staleRounds,
      totalComparisons,
      flowEnabled: ctx.payload.config.enabledAgents?.includes('flowCritique') ?? false,
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };

    // Compute rating updates and match count increments as diffs from original state
    const ratingUpdates: Record<string, { mu: number; sigma: number }> = {};
    for (const [id, r] of localRatings) {
      const orig = state.ratings.get(id);
      if (!orig || orig.mu !== r.mu || orig.sigma !== r.sigma) {
        ratingUpdates[id] = { mu: r.mu, sigma: r.sigma };
      }
    }
    const matchCountIncrements: Record<string, number> = {};
    for (const [id, count] of localMatchCounts) {
      const origCount = state.matchCounts.get(id) ?? 0;
      const inc = count - origCount;
      if (inc > 0) matchCountIncrements[id] = inc;
    }

    const actions: PipelineAction[] = matches.length > 0
      ? [{ type: 'RECORD_MATCHES', matches, ratingUpdates, matchCountIncrements }]
      : [];

    return {
      agentType: 'tournament',
      success: true,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      matchesPlayed: matches.length,
      convergence: convergenceMetric,
      executionDetail: detail,
      actions,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_payload: AgentPayload): number {
    return 0; // Cost estimated centrally by costEstimator
  }

  canExecute(state: ReadonlyPipelineState): boolean {
    return state.pool.length >= 2;
  }
}
