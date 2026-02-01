// Calibration ranking agent for new pool entrants.
// Runs pairwise comparison with position-bias mitigation against stratified opponents.

import { AgentBase } from './base';
import { PoolManager } from '../core/pool';
import { getAdaptiveK, updateEloWithConfidence, updateEloDraw } from '../core/elo';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Match } from '../types';
import { BudgetExceededError } from '../types';

function buildComparisonPrompt(textA: string, textB: string): string {
  return `You are an expert writing evaluator. Compare the following two text variations and determine which is better.

## Text A
${textA}

## Text B
${textB}

## Evaluation Criteria
Consider the following when making your decision:
- Clarity and readability
- Structure and flow
- Engagement and impact
- Grammar and style
- Overall effectiveness

## Instructions
Respond with ONLY one of these exact answers:
- "A" if Text A is better
- "B" if Text B is better
- "TIE" if they are equally good

Your answer:`;
}

function parseWinner(response: string): string | null {
  const upper = response.trim().toUpperCase();
  if (['A', 'B', 'TIE'].includes(upper)) return upper;
  if (upper.startsWith('A')) return 'A';
  if (upper.startsWith('B')) return 'B';
  if (upper.includes('TIE')) return 'TIE';
  if (upper.includes('TEXT A') && !upper.includes('TEXT B')) return 'A';
  if (upper.includes('TEXT B') && !upper.includes('TEXT A')) return 'B';
  return null;
}

export class CalibrationRanker extends AgentBase {
  readonly name = 'calibration';

  private async comparePair(
    ctx: ExecutionContext,
    textA: string,
    textB: string,
  ): Promise<{ winner: string | null; response: string | null }> {
    const prompt = buildComparisonPrompt(textA, textB);
    try {
      const response = await ctx.llmClient.complete(prompt, this.name, {
        model: ctx.payload.config.judgeModel,
      });
      return { winner: parseWinner(response), response };
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      ctx.logger.error('Comparison error', { error: String(error) });
      return { winner: null, response: null };
    }
  }

  private async compareWithBiasMitigation(
    ctx: ExecutionContext,
    idA: string,
    textA: string,
    idB: string,
    textB: string,
  ): Promise<Match> {
    // Check cache first (order-invariant key — safe because we cache the full bias-mitigated result)
    if (ctx.comparisonCache) {
      const cached = ctx.comparisonCache.get(textA, textB, false);
      if (cached) {
        ctx.logger.debug('Cache hit for calibration comparison', { idA, idB });
        const winner = cached.isDraw ? idA : (cached.winnerId === null ? idA : cached.winnerId);
        return {
          variationA: idA, variationB: idB,
          winner, confidence: cached.confidence,
          turns: 2, dimensionScores: {},
        };
      }
    }

    // Both rounds run concurrently — they are independent.
    // Promise.all is correct: only BudgetExceededError propagates, which should abort both.
    const [{ winner: winner1 }, { winner: winner2Raw }] = await Promise.all([
      this.comparePair(ctx, textA, textB),
      this.comparePair(ctx, textB, textA),
    ]);

    // Normalize winner2 to original frame
    let winner2: string | null = winner2Raw;
    if (winner2Raw === 'A') winner2 = 'B';
    else if (winner2Raw === 'B') winner2 = 'A';

    ctx.logger.debug('Comparison results', { idA, idB, round1: winner1, round2Normalized: winner2 });

    // Determine final winner and confidence
    let match: Match;

    if (winner1 === null || winner2 === null) {
      // Partial failure — NOT cached (allow retry on next encounter)
      const partialWinner = winner1 ?? winner2;
      if (partialWinner === 'A') return { variationA: idA, variationB: idB, winner: idA, confidence: 0.3, turns: 2, dimensionScores: {} };
      if (partialWinner === 'B') return { variationA: idA, variationB: idB, winner: idB, confidence: 0.3, turns: 2, dimensionScores: {} };
      return { variationA: idA, variationB: idB, winner: idA, confidence: 0.0, turns: 2, dimensionScores: {} };
    } else if (winner1 === winner2) {
      // Full agreement
      const winnerId = winner1 === 'B' ? idB : idA;
      match = { variationA: idA, variationB: idB, winner: winnerId, confidence: 1.0, turns: 2, dimensionScores: {} };
    } else if (winner1 === 'TIE' || winner2 === 'TIE') {
      // Partial disagreement with TIE
      const nonTie = winner1 === 'TIE' ? winner2 : winner1;
      const winnerId = nonTie === 'B' ? idB : idA;
      match = { variationA: idA, variationB: idB, winner: winnerId, confidence: 0.7, turns: 2, dimensionScores: {} };
    } else {
      // Complete disagreement — inconclusive
      match = { variationA: idA, variationB: idB, winner: idA, confidence: 0.5, turns: 2, dimensionScores: {} };
    }

    // Cache valid bias-mitigated results
    const loserId = match.winner === idA ? idB : idA;
    ctx.comparisonCache?.set(textA, textB, false, {
      winnerId: match.winner, loserId, confidence: match.confidence, isDraw: false,
    });
    return match;
  }

  /** Apply Elo rating update for a single match result. */
  private applyEloUpdate(state: PipelineState, match: Match, entrantId: string): void {
    const winnerId = match.winner;
    const loserId = winnerId === entrantId ? match.variationB : entrantId;
    const oppId = match.variationA === entrantId ? match.variationB : match.variationA;

    if (match.confidence === 0 || (match.winner === entrantId && winnerId === loserId)) {
      const k = (getAdaptiveK(state.matchCounts.get(entrantId) ?? 0) +
                 getAdaptiveK(state.matchCounts.get(oppId) ?? 0)) / 2;
      updateEloDraw(state, entrantId, oppId, k);
    } else {
      const entrantK = getAdaptiveK(state.matchCounts.get(entrantId) ?? 0);
      const oppK = getAdaptiveK(state.matchCounts.get(oppId) ?? 0);
      const kFactor = (entrantK + oppK) / 2;
      updateEloWithConfidence(state, winnerId, loserId, match.confidence, kFactor);
    }
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    if (!this.canExecute(state)) {
      return { agentType: 'calibration', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: 'No new entrants to calibrate' };
    }

    const newEntrants = [...state.newEntrantsThisIteration];
    const poolManager = new PoolManager(state);
    const varLookup = new Map(state.pool.map((v) => [v.id, v]));

    logger.info('Calibration start', { numNewEntrants: newEntrants.length, poolSize: state.pool.length });

    const matches: Match[] = [];

    for (const entrantId of newEntrants) {
      const entrantVar = varLookup.get(entrantId);
      if (!entrantVar) {
        logger.warn('Missing entrant', { id: entrantId });
        continue;
      }

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

      // Run first batch in parallel
      const firstResults = await Promise.allSettled(
        firstBatch.map(async (opp) =>
          this.compareWithBiasMitigation(ctx, entrantId, entrantVar.text, opp.id, opp.var.text),
        ),
      );

      // Apply Elo updates sequentially for first batch
      const firstMatches: Match[] = [];
      for (const r of firstResults) {
        if (r.status !== 'fulfilled') continue;
        const match = r.value;
        firstMatches.push(match);
        matches.push(match);
        state.matchHistory.push(match);
        this.applyEloUpdate(state, match, entrantId);
      }

      // Check for early exit: all first-batch results decisive?
      const allDecisive = firstMatches.length >= minOpp &&
        firstMatches.every((m) => m.confidence >= 0.7);

      if (allDecisive) {
        logger.debug('Adaptive calibration: early exit after first batch', {
          entrantId, matchesPlayed: firstMatches.length,
        });
      } else if (remainingBatch.length > 0) {
        // Run remaining opponents in parallel
        const moreResults = await Promise.allSettled(
          remainingBatch.map(async (opp) =>
            this.compareWithBiasMitigation(ctx, entrantId, entrantVar.text, opp.id, opp.var.text),
          ),
        );
        // Apply Elo updates sequentially
        for (const r of moreResults) {
          if (r.status !== 'fulfilled') continue;
          const match = r.value;
          matches.push(match);
          state.matchHistory.push(match);
          this.applyEloUpdate(state, match, entrantId);
        }
      }
    }

    const avgConfidence = matches.length > 0
      ? matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
      : 0;

    logger.info('Calibration complete', {
      matchesPlayed: matches.length,
      avgConfidence,
    });

    return {
      agentType: 'calibration',
      success: true,
      costUsd: ctx.costTracker.getAgentCost(this.name),
      matchesPlayed: matches.length,
      convergence: avgConfidence,
    };
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
