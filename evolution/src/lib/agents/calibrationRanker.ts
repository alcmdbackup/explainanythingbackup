// Calibration ranking agent for new pool entrants.
// Runs pairwise comparison with position-bias mitigation against stratified opponents.

import { AgentBase } from './base';
import { PoolManager } from '../core/pool';
import { updateRating, updateDraw, createRating, type Rating } from '../core/rating';
import { compareWithBiasMitigation as compareStandalone } from '../comparison';
import type { AgentResult, ExecutionContext, ReadonlyPipelineState, AgentPayload, Match, CalibrationExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import type { PipelineAction } from '../core/actions';

/** Sigma threshold below which entries are considered already calibrated and skip calibration. */
const CALIBRATED_SIGMA_THRESHOLD = 5.0;

export class CalibrationRanker extends AgentBase {
  readonly name = 'calibration';

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
        ctx.logger.debug('Cache hit for calibration comparison', { idA, idB });
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

    ctx.logger.debug('Comparison results', { idA, idB, winner: result.winner, confidence: result.confidence });

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

  /** Extract fulfilled matches from Promise.allSettled, re-throw BudgetExceededError, apply rating updates to local copies. */
  private processSettledResults(
    results: PromiseSettledResult<Match>[],
    opponents: Array<{ id: string; var: { text: string } }>,
    allMatches: Match[],
    localRatings: Map<string, Rating>,
    localMatchCounts: Map<string, number>,
    entrantId: string,
    matchDetails: CalibrationExecutionDetail['entrants'][0]['matches'],
  ): Match[] {
    for (const r of results) {
      if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
        throw r.reason;
      }
    }

    const fulfilled: Match[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') continue;
      const match = r.value;
      fulfilled.push(match);
      allMatches.push(match);
      this.applyRatingUpdate(localRatings, localMatchCounts, match, entrantId);
      matchDetails.push({
        opponentId: opponents[i].id,
        winner: match.winner,
        confidence: match.confidence,
        cacheHit: false,
      });
    }
    return fulfilled;
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

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    // Local copies for incremental rating updates during execution
    const localRatings = new Map(state.ratings);
    const localMatchCounts = new Map(state.matchCounts);

    // Filter out entries whose sigma is already below threshold (already well-calibrated from Arena)
    const newEntrants = [...state.newEntrantsThisIteration].filter((id) => {
      const rating = localRatings.get(id);
      if (rating && rating.sigma < CALIBRATED_SIGMA_THRESHOLD) {
        logger.debug('Skipping calibration for low-sigma entry', { id, sigma: rating.sigma });
        return false;
      }
      return true;
    });
    const poolManager = new PoolManager(state);
    const varLookup = new Map(state.pool.map((v) => [v.id, v]));

    logger.info('Calibration start', { numNewEntrants: newEntrants.length, poolSize: state.pool.length });

    const matches: Match[] = [];
    const entrantDetails: CalibrationExecutionDetail['entrants'] = [];

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

      const minOpp = ctx.payload.config.calibration.minOpponents ?? 2;

      const validOpponents = opponentIds
        .map((id) => ({ id, var: varLookup.get(id) }))
        .filter((o): o is { id: string; var: typeof entrantVar } => o.var !== undefined);

      const firstBatch = validOpponents.slice(0, minOpp);
      const remainingBatch = validOpponents.slice(minOpp);

      const entrantMatchDetails: CalibrationExecutionDetail['entrants'][0]['matches'] = [];

      const firstResults = await Promise.allSettled(
        firstBatch.map(async (opp) =>
          this.compareWithBiasMitigation(ctx, entrantId, entrantVar.text, opp.id, opp.var.text),
        ),
      );

      const firstMatches = this.processSettledResults(
        firstResults, firstBatch, matches, localRatings, localMatchCounts, entrantId, entrantMatchDetails,
      );

      const avgConfidence = firstMatches.length > 0
        ? firstMatches.reduce((s, m) => s + m.confidence, 0) / firstMatches.length
        : 0;
      const allDecisive = firstMatches.length >= minOpp &&
        firstMatches.every((m) => m.confidence >= 0.7) &&
        avgConfidence >= 0.8;

      if (allDecisive) {
        logger.debug('Adaptive calibration: early exit after first batch', {
          entrantId, matchesPlayed: firstMatches.length,
        });
      } else if (remainingBatch.length > 0) {
        const moreResults = await Promise.allSettled(
          remainingBatch.map(async (opp) =>
            this.compareWithBiasMitigation(ctx, entrantId, entrantVar.text, opp.id, opp.var.text),
          ),
        );

        this.processSettledResults(
          moreResults, remainingBatch, matches, localRatings, localMatchCounts, entrantId, entrantMatchDetails,
        );
      }

      const ratingAfter = localRatings.get(entrantId) ?? createRating();
      entrantDetails.push({
        variantId: entrantId,
        opponents: validOpponents.map(o => o.id),
        matches: entrantMatchDetails,
        earlyExit: allDecisive,
        ratingBefore: ratingBeforeSnapshot,
        ratingAfter: { mu: ratingAfter.mu, sigma: ratingAfter.sigma },
      });
    }

    const avgConfidence = matches.length > 0
      ? matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
      : 0;

    logger.info('Calibration complete', {
      matchesPlayed: matches.length,
      avgConfidence,
    });

    const detail: CalibrationExecutionDetail = {
      detailType: 'calibration',
      entrants: entrantDetails,
      avgConfidence,
      totalMatches: matches.length,
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
      agentType: 'calibration',
      success: true,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      matchesPlayed: matches.length,
      convergence: avgConfidence,
      executionDetail: detail,
      actions,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_payload: AgentPayload): number {
    return 0; // Cost estimated centrally by costEstimator
  }

  canExecute(state: ReadonlyPipelineState): boolean {
    return state.newEntrantsThisIteration.length > 0 && state.pool.length >= 2;
  }
}
