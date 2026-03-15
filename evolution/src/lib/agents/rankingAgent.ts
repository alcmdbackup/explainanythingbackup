// Unified ranking agent: triage (calibration) + fine-ranking (Swiss tournament) in a single execute().
// Replaces separate CalibrationRanker + Tournament agents with a two-step flow.

import { AgentBase } from './base';
import { PairwiseRanker } from './pairwiseRanker';
import { PoolManager } from '../core/pool';
import { updateRating, updateDraw, isConverged, createRating, DEFAULT_MU, DEFAULT_SIGMA, type Rating } from '../core/rating';
import { compareWithBiasMitigation as compareStandalone } from '../comparison';
import { RATING_CONSTANTS } from '../config';
import type { AgentResult, ExecutionContext, ReadonlyPipelineState, AgentPayload, Match, TextVariation, RankingExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import type { PipelineAction } from '../core/actions';

// ─── Constants ──────────────────────────────────────────────────

/** Sigma threshold below which entries skip triage (already calibrated from Arena). */
const CALIBRATED_SIGMA_THRESHOLD = 5.0;

/** Draw detection threshold: confidence below this is treated as a draw. */
const DRAW_CONFIDENCE_THRESHOLD = 0.3;

// ─── Budget pressure configuration ─────────────────────────────

interface BudgetPressureConfig {
  multiTurnThreshold: number;
  maxMultiTurnDebates: number;
  maxComparisons: number;
}

/** 3-tier budget pressure: low (<0.5), medium (0.5–0.8), high (≥0.8). */
function budgetPressureConfig(pressure: number): BudgetPressureConfig {
  if (pressure < 0.5) {
    return { multiTurnThreshold: 100, maxMultiTurnDebates: 3, maxComparisons: 40 };
  }
  if (pressure < 0.8) {
    return { multiTurnThreshold: 75, maxMultiTurnDebates: 1, maxComparisons: 25 };
  }
  return { multiTurnThreshold: 30, maxMultiTurnDebates: 0, maxComparisons: 15 };
}

// ─── Swiss pairing (inline — single consumer) ──────────────────

function normalizePair(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function swissPairing(
  variants: TextVariation[],
  ratings: Map<string, Rating>,
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

// ─── Helper: compute top-20% cutoff ────────────────────────────

function computeTop20Cutoff(ratings: Map<string, Rating>): number {
  if (ratings.size === 0) return DEFAULT_MU;
  const sorted = [...ratings.values()].map((r) => r.mu).sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(sorted.length * 0.2) - 1);
  return sorted[idx];
}

// ─── RankingAgent ───────────────────────────────────────────────

export class RankingAgent extends AgentBase {
  readonly name = 'ranking';
  private readonly pairwise = new PairwiseRanker();

  canExecute(state: ReadonlyPipelineState): boolean {
    return state.pool.length >= 2;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_payload: AgentPayload): number {
    return 0; // Cost estimated centrally by costEstimator
  }

  // ─── Triage: calibrate new entrants one match at a time ───────

  private async compareWithBiasMitigation(
    ctx: ExecutionContext,
    idA: string,
    textA: string,
    idB: string,
    textB: string,
  ): Promise<Match> {
    if (ctx.comparisonCache) {
      const cached = ctx.comparisonCache.get(textA, textB, false);
      if (cached) {
        ctx.logger.debug('Cache hit for triage comparison', { idA, idB });
        const isDraw = cached.isDraw || cached.winnerId === null;
        const winner = isDraw ? idA : cached.winnerId!;
        return {
          variationA: idA, variationB: idB,
          winner, confidence: isDraw ? 0 : cached.confidence,
          turns: 2, dimensionScores: {},
        };
      }
    }

    const callLLM = async (prompt: string): Promise<string> => {
      try {
        return await ctx.llmClient.complete(prompt, this.name, {
          model: ctx.payload.config.judgeModel,
          taskType: 'comparison' as const,
          comparisonSubtype: 'simple' as const,
        });
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        ctx.logger.error('Comparison error', { error: String(error) });
        return '';
      }
    };

    const result = await compareStandalone(textA, textB, callLLM);
    const winnerId = result.winner === 'B' ? idB : idA;
    const match: Match = {
      variationA: idA, variationB: idB,
      winner: winnerId, confidence: result.confidence,
      turns: result.turns, dimensionScores: {},
    };

    if (result.confidence > 0) {
      const loserId = winnerId === idA ? idB : idA;
      ctx.comparisonCache?.set(textA, textB, false, {
        winnerId, loserId, confidence: result.confidence, isDraw: result.winner === 'TIE',
      });
    }
    return match;
  }

  private applyRatingUpdate(
    localRatings: Map<string, Rating>,
    localMatchCounts: Map<string, number>,
    match: Match,
    entrantId: string,
  ): void {
    const winnerId = match.winner;
    const oppId = match.variationA === entrantId ? match.variationB : match.variationA;
    const loserId = winnerId === entrantId ? oppId : entrantId;
    const entrantRating = localRatings.get(entrantId) ?? createRating();
    const oppRating = localRatings.get(oppId) ?? createRating();
    const isDraw = match.confidence === 0 || winnerId === loserId;

    if (isDraw) {
      const [newE, newO] = updateDraw(entrantRating, oppRating);
      localRatings.set(entrantId, newE);
      localRatings.set(oppId, newO);
    } else {
      const winnerRating = winnerId === entrantId ? entrantRating : oppRating;
      const loserRating = winnerId === entrantId ? oppRating : entrantRating;
      const [newW, newL] = updateRating(winnerRating, loserRating);
      localRatings.set(winnerId, newW);
      localRatings.set(loserId, newL);
    }

    localMatchCounts.set(entrantId, (localMatchCounts.get(entrantId) ?? 0) + 1);
    localMatchCounts.set(oppId, (localMatchCounts.get(oppId) ?? 0) + 1);
  }

  private async executeTriage(
    ctx: ExecutionContext,
    top20Cutoff: number,
    localRatings: Map<string, Rating>,
    localMatchCounts: Map<string, number>,
  ): Promise<{
    triageDetails: RankingExecutionDetail['triage'];
    allMatches: Match[];
    eliminatedIds: Set<string>;
  }> {
    const { state, logger } = ctx;
    const newEntrants = [...state.newEntrantsThisIteration].filter((id) => {
      const rating = localRatings.get(id);
      if (rating && rating.sigma < CALIBRATED_SIGMA_THRESHOLD) {
        logger.debug('Skipping triage for low-sigma entry', { id, sigma: rating.sigma });
        return false;
      }
      return true;
    });

    const poolManager = new PoolManager(state);
    const varLookup = new Map(state.pool.map((v) => [v.id, v]));
    const allMatches: Match[] = [];
    const triageDetails: RankingExecutionDetail['triage'] = [];
    const eliminatedIds = new Set<string>();

    for (const entrantId of newEntrants) {
      const entrantVar = varLookup.get(entrantId);
      if (!entrantVar) {
        logger.warn('Missing entrant', { id: entrantId });
        continue;
      }

      const ratingBefore = localRatings.get(entrantId) ?? createRating();
      const ratingBeforeSnapshot = { mu: ratingBefore.mu, sigma: ratingBefore.sigma };

      const opponentIds = poolManager.getCalibrationOpponents(
        entrantId,
        ctx.payload.config.calibration.opponents,
      );
      const validOpponents = opponentIds
        .map((id) => ({ id, var: varLookup.get(id) }))
        .filter((o): o is { id: string; var: typeof entrantVar } => o.var !== undefined);

      const matchDetails: RankingExecutionDetail['triage'][0]['matches'] = [];
      let eliminated = false;

      // Run matches one at a time for sequential elimination
      const minOpp = ctx.payload.config.calibration.minOpponents ?? 2;
      let decisiveCount = 0;
      let totalConf = 0;

      for (let i = 0; i < validOpponents.length; i++) {
        const opp = validOpponents[i];
        try {
          const match = await this.compareWithBiasMitigation(
            ctx, entrantId, entrantVar.text, opp.id, opp.var.text,
          );
          allMatches.push(match);
          this.applyRatingUpdate(localRatings, localMatchCounts, match, entrantId);
          matchDetails.push({
            opponentId: opp.id,
            winner: match.winner,
            confidence: match.confidence,
            cacheHit: false,
          });

          totalConf += match.confidence;
          if (match.confidence >= 0.7) decisiveCount++;

          // Check elimination after each match: mu + 2σ < cutoff
          const currentRating = localRatings.get(entrantId) ?? createRating();
          if (currentRating.mu + 2 * currentRating.sigma < top20Cutoff && i >= minOpp - 1) {
            logger.debug('Triage elimination', { entrantId, mu: currentRating.mu, sigma: currentRating.sigma, cutoff: top20Cutoff });
            eliminated = true;
            eliminatedIds.add(entrantId);
            break;
          }

          // Early exit on decisive results
          if (i >= minOpp - 1 && decisiveCount >= minOpp) {
            const avgConf = totalConf / (i + 1);
            if (avgConf >= 0.8) {
              logger.debug('Triage early exit: decisive results', { entrantId, matchesPlayed: i + 1 });
              break;
            }
          }
        } catch (error) {
          if (error instanceof BudgetExceededError) throw error;
          logger.warn('Triage match failed', { entrantId, oppId: opp.id, error: String(error) });
        }
      }

      const ratingAfter = localRatings.get(entrantId) ?? createRating();
      triageDetails.push({
        variantId: entrantId,
        opponents: validOpponents.map((o) => o.id),
        matches: matchDetails,
        eliminated,
        ratingBefore: ratingBeforeSnapshot,
        ratingAfter: { mu: ratingAfter.mu, sigma: ratingAfter.sigma },
      });
    }

    return { triageDetails, allMatches, eliminatedIds };
  }

  // ─── Fine-ranking: Swiss tournament among eligible contenders ──

  private getTopQuartileMu(ratings: Map<string, Rating>): number {
    if (ratings.size < 4) {
      const mus = [...ratings.values()].map((r) => r.mu);
      return mus.length > 0 ? Math.max(...mus) : DEFAULT_MU;
    }
    const sorted = [...ratings.values()].map((r) => r.mu).sort((a, b) => b - a);
    return sorted[Math.floor(sorted.length / 4)];
  }

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

  /** Re-throw BudgetExceededError from any rejected promise in a settled batch. */
  private rethrowBudgetErrors(results: PromiseSettledResult<unknown>[]): void {
    for (const r of results) {
      if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
        throw r.reason;
      }
    }
  }

  private async executeFineRanking(
    ctx: ExecutionContext,
    eliminatedIds: Set<string>,
    top20Cutoff: number,
    localRatings: Map<string, Rating>,
    localMatchCounts: Map<string, number>,
  ): Promise<{
    fineRankingDetail: RankingExecutionDetail['fineRanking'];
    fineMatches: Match[];
    totalComparisons: number;
    budgetPressure: number;
    budgetTier: RankingExecutionDetail['budgetTier'];
    flowEnabled: boolean;
  }> {
    const { state, logger } = ctx;

    // Compute budget pressure post-triage
    const budgetPressure = Math.max(0, Math.min(1,
      1 - (ctx.costTracker.getAvailableBudget() / ctx.payload.config.budgetCapUsd),
    ));
    const budgetCfg = budgetPressureConfig(budgetPressure);
    let budgetTier: RankingExecutionDetail['budgetTier'] = 'low';
    if (budgetPressure >= 0.8) budgetTier = 'high';
    else if (budgetPressure >= 0.5) budgetTier = 'medium';

    const structured = ctx.payload.config.calibration.opponents > 3;
    const maxComparisons = Math.min(budgetCfg.maxComparisons, 40);
    const topKConfig = ctx.payload.config.tournament.topK;
    const flowEnabled = ctx.payload.config.enabledAgents?.includes('flowCritique') ?? false;

    // Filter to eligible contenders: not eliminated + mu + 2σ >= cutoff
    const contenders = state.pool.filter((v) => {
      if (eliminatedIds.has(v.id)) return false;
      const r = localRatings.get(v.id) ?? createRating();
      return r.mu + 2 * r.sigma >= top20Cutoff;
    });

    logger.info('Fine-ranking start', {
      contenders: contenders.length,
      budgetPressure: budgetPressure.toFixed(2),
      maxComparisons,
    });

    if (contenders.length < 2) {
      return {
        fineRankingDetail: { rounds: 0, exitReason: 'no_contenders', convergenceStreak: 0 },
        fineMatches: [],
        totalComparisons: 0,
        budgetPressure,
        budgetTier,
        flowEnabled,
      };
    }

    // Ensure all contenders have ratings
    for (const v of contenders) {
      if (!localRatings.has(v.id)) {
        localRatings.set(v.id, createRating());
      }
    }

    const completedPairs = new Set<string>();
    let multiTurnCount = 0;
    const fineMatches: Match[] = [];
    let totalComparisons = 0;
    let convergenceStreak = 0;
    let exitReason: RankingExecutionDetail['fineRanking']['exitReason'] = 'maxRounds';
    const maxRounds = 50;
    const convergenceChecks = 2;
    const maxStaleRounds = 1;
    let staleRounds = 0;

    for (let round = 0; round < maxRounds; round++) {
      // Time-based yield
      if (ctx.timeContext) {
        const elapsed = Date.now() - ctx.timeContext.startMs;
        const remaining = ctx.timeContext.maxDurationMs - elapsed;
        if (remaining < 120_000) {
          logger.info('Fine-ranking yielding due to time pressure', { round, remaining });
          exitReason = 'time_limit';
          break;
        }
      }

      if (totalComparisons >= maxComparisons) {
        exitReason = 'budget';
        break;
      }

      // Mid-round budget safety
      if (ctx.costTracker.getAvailableBudget() < ctx.payload.config.budgetCapUsd * 0.05) {
        logger.info('Fine-ranking aborting: available budget below 5%');
        exitReason = 'budget';
        break;
      }

      const pairs = swissPairing(contenders, localRatings, completedPairs, topKConfig);
      if (pairs.length === 0) {
        staleRounds++;
        if (staleRounds >= maxStaleRounds) {
          exitReason = 'stale';
          break;
        }
        continue;
      }
      staleRounds = 0;

      const remainingBudget = maxComparisons - totalComparisons;
      const cappedPairs = pairs.slice(0, remainingBudget);
      const topQuartileMu = this.getTopQuartileMu(localRatings);

      const pairConfigs = cappedPairs.map(([varA, varB]) => {
        const useMultiTurn = this.needsMultiTurn(
          varA.id, varB.id, localRatings, budgetCfg, multiTurnCount, topQuartileMu,
        );
        if (useMultiTurn) multiTurnCount++;
        return { varA, varB, useMultiTurn };
      });

      const roundResults = await Promise.allSettled(
        pairConfigs.map(async ({ varA, varB, useMultiTurn }) =>
          this.runComparison(ctx, varA, varB, useMultiTurn, structured),
        ),
      );

      // Apply rating updates
      for (let pi = 0; pi < roundResults.length; pi++) {
        const result = roundResults[pi];
        if (result.status !== 'fulfilled') continue;
        const match = result.value;
        const { varA, varB } = pairConfigs[pi];
        fineMatches.push(match);

        const winnerId = match.winner;
        const loserId = winnerId === varA.id ? varB.id : varA.id;
        const winnerRating = localRatings.get(winnerId) ?? createRating();
        const loserRating = localRatings.get(loserId) ?? createRating();

        if (match.confidence < DRAW_CONFIDENCE_THRESHOLD) {
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

      this.rethrowBudgetErrors(roundResults);

      // Flow comparison (optional)
      if (flowEnabled) {
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
          this.rethrowBudgetErrors(flowResults);
        } catch (flowErr) {
          if (flowErr instanceof BudgetExceededError) throw flowErr;
          logger.warn('Flow comparison round failed (non-fatal)', { round, error: String(flowErr) });
        }
      }

      // Sigma-based convergence check for contenders
      const sortedByMu = [...localRatings.entries()]
        .map(([id, r]) => ({ id, r }))
        .sort((a, b) => b.r.mu - a.r.mu);
      const convergenceTopKIds = new Set(sortedByMu.slice(0, topKConfig).map((e) => e.id));
      const eligibleForConvergence = sortedByMu
        .filter((e) => e.r.mu >= 3 * e.r.sigma || convergenceTopKIds.has(e.id))
        .map((e) => e.r);

      if (eligibleForConvergence.length > 0 && eligibleForConvergence.every((r) => isConverged(r, RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD))) {
        convergenceStreak++;
        if (convergenceStreak >= convergenceChecks) {
          logger.info('Fine-ranking converged (sigma-based)', { round, comparisons: totalComparisons });
          exitReason = 'convergence';
          break;
        }
      } else {
        convergenceStreak = 0;
      }
    }

    return {
      fineRankingDetail: { rounds: totalComparisons, exitReason, convergenceStreak },
      fineMatches,
      totalComparisons,
      budgetPressure,
      budgetTier,
      flowEnabled,
    };
  }

  // ─── Main execute ─────────────────────────────────────────────

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    // Create local mutable copies for rating computation
    const localRatings = new Map(state.ratings);
    const localMatchCounts = new Map(state.matchCounts);

    const top20Cutoff = computeTop20Cutoff(localRatings);

    logger.info('Ranking start', { poolSize: state.pool.length, top20Cutoff: top20Cutoff.toFixed(2) });

    // Step 1: Triage new entrants
    const hasNewEntrants = state.newEntrantsThisIteration.some((id) => {
      const rating = localRatings.get(id);
      return !rating || rating.sigma >= CALIBRATED_SIGMA_THRESHOLD;
    });

    let triageDetails: RankingExecutionDetail['triage'] = [];
    let triageMatches: Match[] = [];
    let eliminatedIds = new Set<string>();

    if (hasNewEntrants) {
      const triageResult = await this.executeTriage(ctx, top20Cutoff, localRatings, localMatchCounts);
      triageDetails = triageResult.triageDetails;
      triageMatches = triageResult.allMatches;
      eliminatedIds = triageResult.eliminatedIds;
    }

    // Step 2: Fine-ranking among eligible contenders
    const {
      fineRankingDetail,
      fineMatches,
      totalComparisons: fineComparisons,
      budgetPressure,
      budgetTier,
      flowEnabled,
    } = await this.executeFineRanking(ctx, eliminatedIds, top20Cutoff, localRatings, localMatchCounts);

    const allMatches = [...triageMatches, ...fineMatches];

    // Build RECORD_MATCHES action with all accumulated updates
    const actions: PipelineAction[] = [];
    if (allMatches.length > 0) {
      const ratingUpdates: Record<string, { mu: number; sigma: number }> = {};
      for (const [id, r] of localRatings) {
        ratingUpdates[id] = { mu: r.mu, sigma: r.sigma };
      }
      const matchCountIncrements: Record<string, number> = {};
      for (const [id, count] of localMatchCounts) {
        const original = state.matchCounts.get(id) ?? 0;
        const increment = count - original;
        if (increment > 0) {
          matchCountIncrements[id] = increment;
        }
      }
      actions.push({
        type: 'RECORD_MATCHES',
        matches: allMatches,
        ratingUpdates,
        matchCountIncrements,
      });
    }

    // Recompute eligible contenders for the detail
    const eligibleContenders = state.pool.filter((v) => {
      if (eliminatedIds.has(v.id)) return false;
      const r = localRatings.get(v.id) ?? createRating();
      return r.mu + 2 * r.sigma >= top20Cutoff;
    }).length;

    // Convergence metric
    let convergenceMetric = 1.0;
    if (localRatings.size > 1) {
      const sigmas = [...localRatings.values()].map((r) => r.sigma);
      const avgSigma = sigmas.reduce((s, v) => s + v, 0) / sigmas.length;
      convergenceMetric = Math.max(0, Math.min(1, 1 - avgSigma / DEFAULT_SIGMA));
    }

    logger.info('Ranking complete', {
      triageMatches: triageMatches.length,
      fineMatches: fineMatches.length,
      totalMatches: allMatches.length,
      convergenceMetric: convergenceMetric.toFixed(3),
      eliminated: eliminatedIds.size,
    });

    const detail: RankingExecutionDetail = {
      detailType: 'ranking',
      triage: triageDetails,
      fineRanking: fineRankingDetail,
      budgetPressure,
      budgetTier,
      top20Cutoff,
      eligibleContenders,
      totalComparisons: triageMatches.length + fineComparisons,
      flowEnabled,
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };

    return {
      agentType: 'ranking',
      success: true,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      matchesPlayed: allMatches.length,
      convergence: convergenceMetric,
      executionDetail: detail,
      actions,
    };
  }
}
