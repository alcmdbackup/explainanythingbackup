// Pairwise ranking agent with position-bias mitigation.
// Supports simple (A/B/TIE) and structured (5-dimension) comparison modes.

import { AgentBase } from './base';
import { buildComparisonPrompt, parseWinner } from '../comparison';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Match } from '../types';
import { BudgetExceededError } from '../types';
import { QUALITY_DIMENSIONS, buildFlowComparisonPrompt, parseFlowComparisonResponse } from '../flowRubric';
import type { FlowComparisonResult } from '../flowRubric';

// ─── Prompt builders ────────────────────────────────────────────

// Precomputed from constant QUALITY_DIMENSIONS to avoid rebuilding on every call.
const _DIMS_ENTRIES = Object.entries(QUALITY_DIMENSIONS);
const _DIMENSIONS_LIST = _DIMS_ENTRIES.map(([name, desc]) => `- **${name}**: ${desc}`).join('\n');
const _INSTRUCTIONS_LIST = _DIMS_ENTRIES.map(([name], i) => `${i + 1}. ${name}: [A/B/TIE]`).join('\n');
const _RESPONSE_TEMPLATE = _DIMS_ENTRIES.map(([name]) => `${name}: [your choice]`).join('\n');

function buildStructuredPrompt(textA: string, textB: string): string {
  return `You are an expert writing evaluator. Compare the following two text variations on multiple dimensions.

## Text A
${textA}

## Text B
${textB}

## Evaluation Dimensions
${_DIMENSIONS_LIST}

## Instructions
Rate each dimension using ONLY "A", "B", or "TIE":
${_INSTRUCTIONS_LIST}

Then provide:
OVERALL_WINNER: [A/B/TIE]
CONFIDENCE: [high/medium/low]

Respond in this exact format:
${_RESPONSE_TEMPLATE}
OVERALL_WINNER: [your choice]
CONFIDENCE: [your choice]`;
}

// Re-export parseWinner from shared comparison module for backward compatibility
export { parseWinner } from '../comparison';

// ─── Response parsers ───────────────────────────────────────────

export function parseStructuredResponse(
  response: string,
): { winner: string | null; dimensionScores: Record<string, string>; confidence: number } {
  const dimensionScores: Record<string, string> = {};
  let winner: string | null = null;
  let confidence = 0.7;

  for (const line of response.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const upperTrimmed = trimmed.toUpperCase();

    for (const dim of Object.keys(QUALITY_DIMENSIONS)) {
      if (upperTrimmed.startsWith(`${dim.toUpperCase()}:`)) {
        const value = trimmed.split(':')[1].trim().toUpperCase();
        if (value.startsWith('A')) dimensionScores[dim] = 'A';
        else if (value.startsWith('B')) dimensionScores[dim] = 'B';
        else if (value.includes('TIE')) dimensionScores[dim] = 'TIE';
        else dimensionScores[dim] = value;
      }
    }

    if (upperTrimmed.includes('OVERALL_WINNER:')) {
      const value = trimmed.split(':')[1].trim().toUpperCase();
      if (value.startsWith('A')) winner = 'A';
      else if (value.startsWith('B')) winner = 'B';
      else if (value.includes('TIE')) winner = 'TIE';
      else winner = null;
    }

    if (upperTrimmed.includes('CONFIDENCE:')) {
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

/** Merge two sets of dimension scores. On disagreement, prefer non-TIE. */
function mergeDimensionScores(
  scores1: Record<string, string>,
  scores2Normalized: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  const allDims = new Set([...Object.keys(scores1), ...Object.keys(scores2Normalized)]);
  for (const dim of allDims) {
    const s1 = scores1[dim];
    const s2 = scores2Normalized[dim];
    if (!s1 && !s2) { merged[dim] = 'TIE'; continue; }
    if (!s1) { merged[dim] = s2; continue; }
    if (!s2) { merged[dim] = s1; continue; }
    if (s1 === s2) { merged[dim] = s1; continue; }
    // Disagreement: prefer non-TIE
    merged[dim] = s1 !== 'TIE' ? s1 : s2 !== 'TIE' ? s2 : 'TIE';
  }
  return merged;
}

/** Swap A<->B in reversed-round results so they match the original frame of reference. */
function normalizeReversedResult(
  winner: string | null,
  dimensionScores: Record<string, string>,
): { winner: string | null; dimensionScores: Record<string, string> } {
  const swap = (v: string): string => {
    if (v === 'A') return 'B';
    if (v === 'B') return 'A';
    return v;
  };
  // AGENT-10: Guard against null dimensionScores from malformed LLM responses
  const dims = dimensionScores ?? {};
  const swappedDims: Record<string, string> = {};
  for (const [dim, val] of Object.entries(dims)) {
    swappedDims[dim] = swap(val);
  }
  return { winner: winner ? swap(winner) : null, dimensionScores: swappedDims };
}

// ─── Confidence aggregation ─────────────────────────────────────

/** Aggregate two bias-mitigated comparison results into a single match with confidence. */
function aggregateConfidence(
  winner1: string | null,
  winner2: string | null,
  idA: string,
  idB: string,
  baseMatch: Omit<Match, 'winner' | 'confidence'>,
): Match {
  if (winner1 === null || winner2 === null) {
    const partial = winner1 ?? winner2;
    if (partial === 'A') return { ...baseMatch, winner: idA, confidence: 0.3 };
    if (partial === 'B') return { ...baseMatch, winner: idB, confidence: 0.3 };
    return { ...baseMatch, winner: idA, confidence: 0.0 };
  }
  if (winner1 === winner2) {
    const winnerId = winner1 === 'B' ? idB : idA;
    return { ...baseMatch, winner: winnerId, confidence: 1.0 };
  }
  if (winner1 === 'TIE' || winner2 === 'TIE') {
    const nonTie = winner1 === 'TIE' ? winner2 : winner1;
    const winnerId = nonTie === 'B' ? idB : idA;
    return { ...baseMatch, winner: winnerId, confidence: 0.7 };
  }
  return { ...baseMatch, winner: idA, confidence: 0.5 };
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
    agentNameOverride?: string,
  ): Promise<{ winner: string | null; dimensionScores: Record<string, string>; confidence: number }> {
    const prompt = structured
      ? buildStructuredPrompt(textA, textB)
      : buildComparisonPrompt(textA, textB);
    try {
      const response = await ctx.llmClient.complete(prompt, agentNameOverride ?? this.name, {
        model: ctx.payload.config.judgeModel,
        taskType: 'comparison',
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
    agentNameOverride?: string,
  ): Promise<Match> {
    // Check cache first (order-invariant — safe because we cache the full bias-mitigated result)
    if (ctx.comparisonCache) {
      const cached = ctx.comparisonCache.get(textA, textB, structured);
      if (cached) {
        ctx.logger.debug('Cache hit for bias-mitigated comparison', { idA, idB, structured });
        const winner = cached.isDraw ? idA : (cached.winnerId ?? idA);
        return { variationA: idA, variationB: idB, winner, confidence: cached.confidence, turns: 2, dimensionScores: {} };
      }
    }

    // Run both comparisons concurrently (independent)
    const [r1, r2] = await Promise.all([
      this.comparePair(ctx, textA, textB, structured, agentNameOverride),
      this.comparePair(ctx, textB, textA, structured, agentNameOverride),
    ]);

    const { winner: winner2, dimensionScores: dim2Normalized } = normalizeReversedResult(r2.winner, r2.dimensionScores);
    ctx.logger.debug('Comparison results', { idA, idB, round1: r1.winner, round2Normalized: winner2 });

    const mergedDims = mergeDimensionScores(r1.dimensionScores, dim2Normalized);

    // Determine final winner and confidence
    const baseMatch = { variationA: idA, variationB: idB, turns: 2, dimensionScores: mergedDims };
    const match = aggregateConfidence(r1.winner, winner2, idA, idB, baseMatch);

    // Cache result (skip failed comparisons so retries can succeed)
    if (match.confidence > 0) {
      const loserId = match.winner === idA ? idB : idA;
      ctx.comparisonCache?.set(textA, textB, structured, {
        winnerId: match.winner, loserId, confidence: match.confidence, isDraw: false,
      });
    }
    return match;
  }

  /** Single flow comparison call. */
  private async comparePairFlow(
    ctx: ExecutionContext,
    textA: string,
    textB: string,
    agentNameOverride?: string,
  ): Promise<FlowComparisonResult> {
    const prompt = buildFlowComparisonPrompt(textA, textB);
    try {
      const response = await ctx.llmClient.complete(prompt, agentNameOverride ?? this.name, {
        model: ctx.payload.config.judgeModel,
        taskType: 'comparison',
      });
      return parseFlowComparisonResponse(response);
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      ctx.logger.error('Flow comparison error', { error: String(error) });
      return { winner: null, dimensionScores: {}, confidence: 0.0, frictionSpotsA: [], frictionSpotsB: [] };
    }
  }

  /** Flow comparison with position-bias mitigation (2-pass reversal). */
  async compareFlowWithBiasMitigation(
    ctx: ExecutionContext,
    idA: string,
    textA: string,
    idB: string,
    textB: string,
    agentNameOverride?: string,
  ): Promise<Match> {
    // Check flow cache
    if (ctx.comparisonCache) {
      const cached = ctx.comparisonCache.get(textA, textB, true, 'flow');
      if (cached) {
        ctx.logger.debug('Flow cache hit', { idA, idB });
        const winner = cached.isDraw ? idA : (cached.winnerId ?? idA);
        return { variationA: idA, variationB: idB, winner, confidence: cached.confidence, turns: 2, dimensionScores: {} };
      }
    }

    // 2-pass reversal (same pattern as quality comparison)
    const [r1, r2] = await Promise.all([
      this.comparePairFlow(ctx, textA, textB, agentNameOverride),
      this.comparePairFlow(ctx, textB, textA, agentNameOverride),
    ]);

    const { winner: winner2, dimensionScores: dim2Normalized } = normalizeReversedResult(r2.winner, r2.dimensionScores);

    // Merge dimension scores with flow: prefix
    const mergedRaw = mergeDimensionScores(r1.dimensionScores, dim2Normalized);
    const mergedDims: Record<string, string> = {};
    for (const [dim, val] of Object.entries(mergedRaw)) {
      mergedDims[`flow:${dim}`] = val;
    }

    // Deduplicate friction spots (union from both passes)
    const frictionSpots = {
      a: [...new Set([...r1.frictionSpotsA, ...r2.frictionSpotsB])],
      b: [...new Set([...r1.frictionSpotsB, ...r2.frictionSpotsA])],
    };

    const baseMatch = { variationA: idA, variationB: idB, turns: 2, dimensionScores: mergedDims, frictionSpots };
    const match = aggregateConfidence(r1.winner, winner2, idA, idB, baseMatch);

    // Cache result (skip failed comparisons so retries can succeed)
    if (match.confidence > 0) {
      const loserId = match.winner === idA ? idB : idA;
      ctx.comparisonCache?.set(textA, textB, true, {
        winnerId: match.winner, loserId, confidence: match.confidence, isDraw: false,
      }, 'flow');
    }
    return match;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;

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

    return this.successResult(ctx, { matchesPlayed: matches.length, convergence: avgConfidence });
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
