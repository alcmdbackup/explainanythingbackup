// Pairwise ranking agent with position-bias mitigation.
// Supports simple (A/B/TIE) and structured (5-dimension) comparison modes.

import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Match } from '../types';
import { BudgetExceededError } from '../types';

// Phase 7: Structured evaluation dimensions
export const EVALUATION_DIMENSIONS: Record<string, string> = {
  clarity: 'Is the writing clear and easy to follow?',
  flow: 'Does the text flow naturally between ideas?',
  engagement: 'Is the writing compelling and interesting?',
  voice_fidelity: "Does it preserve the original author's voice?",
  conciseness: 'Is the text appropriately concise without losing meaning?',
};

// ─── Prompt builders ────────────────────────────────────────────

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

function buildStructuredPrompt(textA: string, textB: string): string {
  const dimensionsList = Object.entries(EVALUATION_DIMENSIONS)
    .map(([name, desc]) => `- **${name}**: ${desc}`)
    .join('\n');

  return `You are an expert writing evaluator. Compare the following two text variations on multiple dimensions.

## Text A
${textA}

## Text B
${textB}

## Evaluation Dimensions
${dimensionsList}

## Instructions
Rate each dimension using ONLY "A", "B", or "TIE":
1. clarity: [A/B/TIE]
2. flow: [A/B/TIE]
3. engagement: [A/B/TIE]
4. voice_fidelity: [A/B/TIE]
5. conciseness: [A/B/TIE]

Then provide:
OVERALL_WINNER: [A/B/TIE]
CONFIDENCE: [high/medium/low]

Respond in this exact format:
clarity: [your choice]
flow: [your choice]
engagement: [your choice]
voice_fidelity: [your choice]
conciseness: [your choice]
OVERALL_WINNER: [your choice]
CONFIDENCE: [your choice]`;
}

// ─── Response parsers ───────────────────────────────────────────

export function parseWinner(response: string): string | null {
  const upper = response.trim().toUpperCase();
  if (['A', 'B', 'TIE'].includes(upper)) return upper;
  if (upper.startsWith('A')) return 'A';
  if (upper.startsWith('B')) return 'B';
  if (upper.includes('TIE')) return 'TIE';
  if (upper.includes('TEXT A') && !upper.includes('TEXT B')) return 'A';
  if (upper.includes('TEXT B') && !upper.includes('TEXT A')) return 'B';
  return null;
}

export function parseStructuredResponse(
  response: string,
): { winner: string | null; dimensionScores: Record<string, string>; confidence: number } {
  const dimensionScores: Record<string, string> = {};
  let winner: string | null = null;
  let confidence = 0.7;

  for (const line of response.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse dimension scores
    for (const dim of Object.keys(EVALUATION_DIMENSIONS)) {
      if (trimmed.toLowerCase().startsWith(`${dim}:`)) {
        const value = trimmed.split(':')[1].trim().toUpperCase();
        if (value.startsWith('A')) dimensionScores[dim] = 'A';
        else if (value.startsWith('B')) dimensionScores[dim] = 'B';
        else if (value.includes('TIE')) dimensionScores[dim] = 'TIE';
      }
    }

    // Parse overall winner
    if (trimmed.toUpperCase().includes('OVERALL_WINNER:')) {
      const value = trimmed.split(':')[1].trim().toUpperCase();
      if (value.startsWith('A')) winner = 'A';
      else if (value.startsWith('B')) winner = 'B';
      else if (value.includes('TIE')) winner = 'TIE';
    }

    // Parse confidence
    if (trimmed.toUpperCase().includes('CONFIDENCE:')) {
      const value = trimmed.split(':')[1].trim().toLowerCase();
      if (value.includes('high')) confidence = 1.0;
      else if (value.includes('low')) confidence = 0.5;
      else confidence = 0.7;
    }
  }

  // Derive winner from dimension majority if not explicit
  if (winner === null && Object.keys(dimensionScores).length > 0) {
    const aWins = Object.values(dimensionScores).filter((v) => v === 'A').length;
    const bWins = Object.values(dimensionScores).filter((v) => v === 'B').length;
    if (aWins > bWins) winner = 'A';
    else if (bWins > aWins) winner = 'B';
    else winner = 'TIE';
  }

  return { winner, dimensionScores, confidence };
}

// ─── Dimension score merging ────────────────────────────────────

function mergeDimensionScores(
  scores1: Record<string, string>,
  scores2Normalized: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  const allDims = new Set([...Object.keys(scores1), ...Object.keys(scores2Normalized)]);
  for (const dim of allDims) {
    const s1 = scores1[dim];
    const s2 = scores2Normalized[dim];
    if (s1 === s2) merged[dim] = s1 ?? 'TIE';
    else if (s1 && !s2) merged[dim] = s1;
    else if (s2 && !s1) merged[dim] = s2;
    else {
      // Disagreement: prefer non-TIE
      if (s1 !== 'TIE') merged[dim] = s1;
      else if (s2 !== 'TIE') merged[dim] = s2;
      else merged[dim] = 'TIE';
    }
  }
  return merged;
}

// ─── PairwiseRanker agent ───────────────────────────────────────

export class PairwiseRanker extends AgentBase {
  readonly name = 'pairwise';

  /** Single comparison call, returns winner label. */
  async comparePair(
    ctx: ExecutionContext,
    textA: string,
    textB: string,
    structured = false,
  ): Promise<{ winner: string | null; dimensionScores: Record<string, string>; confidence: number }> {
    const prompt = structured
      ? buildStructuredPrompt(textA, textB)
      : buildComparisonPrompt(textA, textB);
    try {
      const response = await ctx.llmClient.complete(prompt, this.name, {
        model: ctx.payload.config.judgeModel,
      });
      if (structured) {
        return parseStructuredResponse(response);
      }
      return { winner: parseWinner(response), dimensionScores: {}, confidence: 0.7 };
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      ctx.logger.error('Comparison error', { error: String(error) });
      return { winner: null, dimensionScores: {}, confidence: 0.0 };
    }
  }

  /** Compare with position-bias mitigation: run A vs B, then B vs A. */
  async compareWithBiasMitigation(
    ctx: ExecutionContext,
    idA: string,
    textA: string,
    idB: string,
    textB: string,
    structured = false,
  ): Promise<Match> {
    // Check cache first (order-invariant — safe because we cache the full bias-mitigated result)
    if (ctx.comparisonCache) {
      const cached = ctx.comparisonCache.get(textA, textB, structured);
      if (cached) {
        ctx.logger.debug('Cache hit for bias-mitigated comparison', { idA, idB, structured });
        // Map cached winnerId/loserId back to the current call's id params
        const winner = cached.isDraw ? idA : (cached.winnerId === null ? idA : cached.winnerId);
        return {
          variationA: idA, variationB: idB,
          winner, confidence: cached.confidence,
          turns: 2, dimensionScores: {},
        };
      }
    }

    // Round 1: A vs B
    const r1 = await this.comparePair(ctx, textA, textB, structured);

    // Round 2: B vs A (reversed)
    const r2 = await this.comparePair(ctx, textB, textA, structured);

    // Normalize round 2 winner to original frame
    let winner2: string | null = r2.winner;
    if (winner2 === 'A') winner2 = 'B';
    else if (winner2 === 'B') winner2 = 'A';

    // Normalize round 2 dimension scores
    const dim2Normalized: Record<string, string> = {};
    for (const [dim, val] of Object.entries(r2.dimensionScores)) {
      if (val === 'A') dim2Normalized[dim] = 'B';
      else if (val === 'B') dim2Normalized[dim] = 'A';
      else dim2Normalized[dim] = val;
    }

    ctx.logger.debug('Comparison results', { idA, idB, round1: r1.winner, round2Normalized: winner2 });

    const mergedDims = mergeDimensionScores(r1.dimensionScores, dim2Normalized);

    // Determine final winner and confidence
    let match: Match;

    if (r1.winner === null || winner2 === null) {
      // Partial failure — NOT cached (allow retry on next encounter)
      const partial = r1.winner ?? winner2;
      if (partial === 'A') return { variationA: idA, variationB: idB, winner: idA, confidence: 0.3, turns: 2, dimensionScores: mergedDims };
      if (partial === 'B') return { variationA: idA, variationB: idB, winner: idB, confidence: 0.3, turns: 2, dimensionScores: mergedDims };
      return { variationA: idA, variationB: idB, winner: idA, confidence: 0.0, turns: 2, dimensionScores: mergedDims };
    } else if (r1.winner === winner2) {
      // Full agreement
      const winnerId = r1.winner === 'B' ? idB : idA;
      match = { variationA: idA, variationB: idB, winner: winnerId, confidence: 1.0, turns: 2, dimensionScores: mergedDims };
    } else if (r1.winner === 'TIE' || winner2 === 'TIE') {
      // Partial disagreement with TIE
      const nonTie = r1.winner === 'TIE' ? winner2 : r1.winner;
      const winnerId = nonTie === 'B' ? idB : idA;
      match = { variationA: idA, variationB: idB, winner: winnerId, confidence: 0.7, turns: 2, dimensionScores: mergedDims };
    } else {
      // Complete disagreement (A vs B)
      match = { variationA: idA, variationB: idB, winner: idA, confidence: 0.5, turns: 2, dimensionScores: mergedDims };
    }

    // Cache valid bias-mitigated results
    const loserId = match.winner === idA ? idB : idA;
    ctx.comparisonCache?.set(textA, textB, structured, {
      winnerId: match.winner, loserId, confidence: match.confidence, isDraw: false,
    });
    return match;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;
    if (!this.canExecute(state)) {
      return { agentType: 'pairwise', success: false, costUsd: 0, error: 'Need at least 2 variations' };
    }

    const structured = ctx.payload.config.calibration.opponents > 3; // Use structured in COMPETITION
    const matches: Match[] = [];

    // Generate all pairs
    const pool = state.pool;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const match = await this.compareWithBiasMitigation(
          ctx, pool[i].id, pool[i].text, pool[j].id, pool[j].text, structured,
        );
        matches.push(match);
        state.matchHistory.push(match);
      }
    }

    const avgConfidence = matches.length > 0
      ? matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length
      : 0;

    logger.info('Pairwise ranking complete', { matchesPlayed: matches.length, avgConfidence });

    return {
      agentType: 'pairwise',
      success: true,
      costUsd: 0,
      matchesPlayed: matches.length,
      convergence: avgConfidence,
    };
  }

  estimateCost(payload: AgentPayload): number {
    const numVariations = 3;
    const numPairs = (numVariations * (numVariations - 1)) / 2;
    const numComparisons = numPairs * 2; // bias mitigation
    const textTokens = Math.ceil(payload.originalText.length / 4) * 2;
    const promptOverhead = 200;
    const inputTokens = textTokens + promptOverhead;
    const outputTokens = 10;
    const costPerComparison = (inputTokens / 1_000_000) * 0.0008 + (outputTokens / 1_000_000) * 0.004;
    return costPerComparison * numComparisons;
  }

  canExecute(state: PipelineState): boolean {
    return state.pool.length >= 2;
  }
}
