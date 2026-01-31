// Calibration ranking agent for new pool entrants.
// Runs pairwise comparison with position-bias mitigation against stratified opponents.

import { AgentBase } from './base';
import { PoolManager } from '../core/pool';
import { getAdaptiveK, updateEloWithConfidence, updateEloDraw } from '../core/elo';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Match } from '../types';

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
      const response = await ctx.llmClient.complete(prompt, this.name);
      return { winner: parseWinner(response), response };
    } catch (error) {
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
    // First comparison: A vs B
    const { winner: winner1 } = await this.comparePair(ctx, textA, textB);
    // Second comparison: B vs A (reversed)
    const { winner: winner2Raw } = await this.comparePair(ctx, textB, textA);

    // Normalize winner2 to original frame
    let winner2: string | null = winner2Raw;
    if (winner2Raw === 'A') winner2 = 'B';
    else if (winner2Raw === 'B') winner2 = 'A';

    ctx.logger.debug('Comparison results', { idA, idB, round1: winner1, round2Normalized: winner2 });

    // Determine final winner and confidence
    if (winner1 === null || winner2 === null) {
      // Partial failure
      const partialWinner = winner1 ?? winner2;
      if (partialWinner === 'A') return { variationA: idA, variationB: idB, winner: idA, confidence: 0.3, turns: 2, dimensionScores: {} };
      if (partialWinner === 'B') return { variationA: idA, variationB: idB, winner: idB, confidence: 0.3, turns: 2, dimensionScores: {} };
      return { variationA: idA, variationB: idB, winner: idA, confidence: 0.0, turns: 2, dimensionScores: {} };
    }

    if (winner1 === winner2) {
      // Full agreement
      const winnerId = winner1 === 'B' ? idB : idA;
      return { variationA: idA, variationB: idB, winner: winnerId, confidence: 1.0, turns: 2, dimensionScores: {} };
    }

    // Disagreement
    if (winner1 === 'TIE' || winner2 === 'TIE') {
      const nonTie = winner1 === 'TIE' ? winner2 : winner1;
      const winnerId = nonTie === 'B' ? idB : idA;
      return { variationA: idA, variationB: idB, winner: winnerId, confidence: 0.7, turns: 2, dimensionScores: {} };
    }

    // Complete disagreement (A vs B) — inconclusive
    return { variationA: idA, variationB: idB, winner: idA, confidence: 0.5, turns: 2, dimensionScores: {} };
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

    if (!this.canExecute(state)) {
      return { agentType: 'calibration', success: false, costUsd: 0, error: 'No new entrants to calibrate' };
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

      for (const oppId of opponentIds) {
        const oppVar = varLookup.get(oppId);
        if (!oppVar) continue;

        const match = await this.compareWithBiasMitigation(ctx, entrantId, entrantVar.text, oppId, oppVar.text);
        matches.push(match);
        state.matchHistory.push(match);

        // Determine winner/loser for Elo update
        const winnerId = match.winner;
        const loserId = winnerId === entrantId ? oppId : entrantId;

        if (match.confidence === 0 || (match.winner === entrantId && winnerId === loserId)) {
          // Draw case (confidence=0 means inconclusive → treat as draw)
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
      costUsd: 0,
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
