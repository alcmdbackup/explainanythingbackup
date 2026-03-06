// Calibration ranking agent for new pool entrants.
// Runs pairwise comparison with position-bias mitigation against stratified opponents.

import { AgentBase } from './base';
import { PoolManager } from '../core/pool';
import { updateRating, updateDraw, createRating } from '../core/rating';
import { compareWithBiasMitigation as compareStandalone } from '../comparison';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Match, CalibrationExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';

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

    // Build callLLM wrapper that handles errors like the original comparePair
    const callLLM = async (prompt: string): Promise<string> => {
      try {
        return await ctx.llmClient.complete(prompt, this.name, {
          model: ctx.payload.config.judgeModel,
          taskType: 'comparison' as const,
        });
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        ctx.logger.error('Comparison error', { error: String(error) });
        return ''; // parseWinner('') → null → partial failure handling
      }
    };

    // Delegate to standalone comparison (no cache — we manage ComparisonCache separately)
    const result = await compareStandalone(textA, textB, callLLM);

    ctx.logger.debug('Comparison results', { idA, idB, winner: result.winner, confidence: result.confidence });

    const winnerId = result.winner === 'B' ? idB : idA;

    const match: Match = {
      variationA: idA, variationB: idB,
      winner: winnerId, confidence: result.confidence,
      turns: result.turns, dimensionScores: {},
    };

    // Cache valid bias-mitigated results in ComparisonCache
    if (result.confidence > 0) {
      const loserId = winnerId === idA ? idB : idA;
      ctx.comparisonCache?.set(textA, textB, false, {
        winnerId, loserId, confidence: result.confidence, isDraw: result.winner === 'TIE',
      });
    }
    return match;
  }

  /** Extract fulfilled matches from Promise.allSettled, re-throw BudgetExceededError, apply rating updates. */
  private processSettledResults(
    results: PromiseSettledResult<Match>[],
    opponents: Array<{ id: string; var: { text: string } }>,
    allMatches: Match[],
    state: PipelineState,
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
      state.matchHistory.push(match);
      this.applyRatingUpdate(state, match, entrantId);
      matchDetails.push({
        opponentId: opponents[i].id,
        winner: match.winner,
        confidence: match.confidence,
        cacheHit: false,
      });
    }
    return fulfilled;
  }

  private applyRatingUpdate(state: PipelineState, match: Match, entrantId: string): void {
    const winnerId = match.winner;
    const oppId = match.variationA === entrantId ? match.variationB : match.variationA;
    const loserId = winnerId === entrantId ? oppId : entrantId;

    const entrantRating = state.ratings.get(entrantId) ?? createRating();
    const oppRating = state.ratings.get(oppId) ?? createRating();

    const isDraw = match.confidence === 0 || winnerId === loserId;

    if (isDraw) {
      const [newE, newO] = updateDraw(entrantRating, oppRating);
      state.ratings.set(entrantId, newE);
      state.ratings.set(oppId, newO);
    } else {
      const winnerRating = winnerId === entrantId ? entrantRating : oppRating;
      const loserRating = winnerId === entrantId ? oppRating : entrantRating;
      const [newW, newL] = updateRating(winnerRating, loserRating);
      state.ratings.set(winnerId, newW);
      state.ratings.set(loserId, newL);
    }

    state.matchCounts.set(entrantId, (state.matchCounts.get(entrantId) ?? 0) + 1);
    state.matchCounts.set(oppId, (state.matchCounts.get(oppId) ?? 0) + 1);
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    // Filter out entries whose sigma is already below threshold (already well-calibrated from Arena)
    const newEntrants = [...state.newEntrantsThisIteration].filter((id) => {
      const rating = state.ratings.get(id);
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

      const ratingBefore = state.ratings.get(entrantId) ?? createRating();
      const ratingBeforeSnapshot = { mu: ratingBefore.mu, sigma: ratingBefore.sigma };

      const opponentIds = poolManager.getCalibrationOpponents(
        entrantId,
        ctx.payload.config.calibration.opponents,
      );

      const minOpp = ctx.payload.config.calibration.minOpponents ?? 2;

      // Filter to valid opponents upfront
      const validOpponents = opponentIds
        .map((id) => ({ id, var: varLookup.get(id) }))
        .filter((o): o is { id: string; var: typeof entrantVar } => o.var !== undefined);

      // Batched parallelism: run first batch, check for early exit, then remaining
      const firstBatch = validOpponents.slice(0, minOpp);
      const remainingBatch = validOpponents.slice(minOpp);

      const entrantMatchDetails: CalibrationExecutionDetail['entrants'][0]['matches'] = [];

      // Run first batch in parallel
      const firstResults = await Promise.allSettled(
        firstBatch.map(async (opp) =>
          this.compareWithBiasMitigation(ctx, entrantId, entrantVar.text, opp.id, opp.var.text),
        ),
      );

      const firstMatches = this.processSettledResults(
        firstResults, firstBatch, matches, state, entrantId, entrantMatchDetails,
      );

      // AGENT-7: Check for early exit: all first-batch results decisive AND average confidence high?
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
          moreResults, remainingBatch, matches, state, entrantId, entrantMatchDetails,
        );
      }

      const ratingAfter = state.ratings.get(entrantId) ?? createRating();
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

    return this.successResult(ctx, { matchesPlayed: matches.length, convergence: avgConfidence, executionDetail: detail });
  }

  estimateCost(payload: AgentPayload): number {
    const strategies = payload.config.generation.strategies;
    const opponents = payload.config.calibration.opponents;
    const numComparisons = strategies * opponents * 2; // bias mitigation doubles calls
    const textTokens = Math.ceil(payload.originalText.length / 4) * 2;
    const promptOverhead = 200;
    const inputTokens = textTokens + promptOverhead;
    const outputTokens = 10;
    const costPerComparison = (inputTokens / 1_000_000) * 0.0004 + (outputTokens / 1_000_000) * 0.0016;
    return costPerComparison * numComparisons;
  }

  canExecute(state: PipelineState): boolean {
    return state.newEntrantsThisIteration.length > 0 && state.pool.length >= 2;
  }
}
