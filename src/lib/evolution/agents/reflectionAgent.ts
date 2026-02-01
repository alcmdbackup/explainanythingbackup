// Reflection agent providing dimensional critiques of top text variants.
// Calls LLM per variant to produce scores, examples, and notes across quality dimensions.

import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Critique } from '../types';
import { BudgetExceededError } from '../types';

export const CRITIQUE_DIMENSIONS = [
  'clarity',
  'structure',
  'engagement',
  'precision',
  'coherence',
] as const;

export type CritiqueDimension = (typeof CRITIQUE_DIMENSIONS)[number];

/** Build the LLM prompt for dimensional critique. */
function buildCritiquePrompt(text: string, dimensions: readonly string[]): string {
  const dimensionsList = dimensions.map((d) => `- ${d}`).join('\n');

  return `You are an expert writing critic. Analyze this text across multiple quality dimensions.

## Text to Analyze
"""${text}"""

## Dimensions to Evaluate
${dimensionsList}

## Task
For each dimension, provide:
1. A score from 1-10
2. One specific good example (quote from text)
3. One specific area for improvement (quote or describe)
4. Brief notes on what works and what doesn't

## Output Format (JSON)
{
    "scores": {
        "clarity": 7,
        "structure": 8
    },
    "good_examples": {
        "clarity": "The opening paragraph clearly states..."
    },
    "bad_examples": {
        "clarity": "The phrase 'it was noted that' is vague"
    },
    "notes": {
        "clarity": "Generally clear but some passive constructions..."
    }
}

Output ONLY valid JSON, no other text.`;
}

interface CritiqueResponse {
  scores: Record<string, number>;
  good_examples: Record<string, string | string[]>;
  bad_examples: Record<string, string | string[]>;
  notes: Record<string, string>;
}

/** Parse LLM response into Critique. Handles JSON wrapped in markdown fences. */
function parseCritiqueResponse(response: string, variationId: string): Critique | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const data: CritiqueResponse = JSON.parse(jsonMatch[0]);
    if (!data.scores || typeof data.scores !== 'object') return null;

    // Normalize examples to arrays
    const toArrayRecord = (
      obj: Record<string, string | string[]> | undefined,
    ): Record<string, string[]> => {
      if (!obj) return {};
      const result: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = Array.isArray(v) ? v : [v];
      }
      return result;
    };

    return {
      variationId,
      dimensionScores: data.scores,
      goodExamples: toArrayRecord(data.good_examples),
      badExamples: toArrayRecord(data.bad_examples),
      notes: data.notes ?? {},
      reviewer: 'llm',
    };
  } catch {
    return null;
  }
}

export class ReflectionAgent extends AgentBase {
  readonly name = 'reflection';
  private readonly dimensions: readonly string[];

  constructor(dimensions?: readonly string[]) {
    super();
    this.dimensions = dimensions ?? CRITIQUE_DIMENSIONS;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger } = ctx;
    const numToCritique = 3;

    const topVariants = state.getTopByElo(numToCritique);
    if (topVariants.length === 0) {
      return { agentType: 'reflection', success: false, costUsd: 0, error: 'No variants to critique' };
    }

    logger.info('Reflection start', { numVariants: topVariants.length, dimensions: [...this.dimensions] });

    // Run all critique LLM calls in parallel
    const results = await Promise.allSettled(
      topVariants.map(async (variant) => {
        const prompt = buildCritiquePrompt(variant.text, this.dimensions);
        logger.debug('Critique call', { variantId: variant.id.slice(0, 8) });
        const response = await llmClient.complete(prompt, this.name);
        return { response, variantId: variant.id };
      }),
    );

    // Re-throw BudgetExceededError so pipeline can pause the run
    for (const result of results) {
      if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
        throw result.reason;
      }
    }

    // Parse and collect results sequentially
    const critiques: Critique[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { response, variantId } = result.value;
        const critique = parseCritiqueResponse(response, variantId);
        if (critique) {
          critiques.push(critique);
          const scores = Object.values(critique.dimensionScores);
          const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
          logger.info('Critique generated', { variantId: variantId.slice(0, 8), avgScore: avgScore.toFixed(1) });
        } else {
          logger.warn('Critique parse failed', { variantId: variantId.slice(0, 8) });
        }
      } else {
        logger.error('Critique error', { error: String(result.reason) });
      }
    }

    // Update state
    if (state.allCritiques === null) state.allCritiques = [];
    state.allCritiques.push(...critiques);

    if (state.dimensionScores === null) state.dimensionScores = {};
    for (const critique of critiques) {
      state.dimensionScores[critique.variationId] = critique.dimensionScores;
    }

    logger.info('Reflection complete', { numCritiques: critiques.length });

    return {
      agentType: 'reflection',
      success: critiques.length > 0,
      costUsd: 0, // actual cost tracked by llmClient
      error: critiques.length === 0 ? 'All critiques failed' : undefined,
    };
  }

  estimateCost(payload: AgentPayload): number {
    const avgTextLength = payload.originalText.length;
    const promptOverhead = 500;
    const inputTokens = (avgTextLength + promptOverhead) / 4;
    const outputTokens = 300;
    const costPerCritique = (inputTokens / 1_000_000) * 0.80 + (outputTokens / 1_000_000) * 4.0;
    return costPerCritique * 3;
  }

  canExecute(state: PipelineState): boolean {
    return state.pool.length >= 1;
  }
}

/** Get existing critique for a variant from state. */
export function getCritiqueForVariant(variationId: string, state: PipelineState): Critique | null {
  if (!state.allCritiques) return null;
  return state.allCritiques.find((c) => c.variationId === variationId) ?? null;
}

/** Find the weakest dimension in a critique. */
export function getWeakestDimension(critique: Critique): string | null {
  const entries = Object.entries(critique.dimensionScores);
  if (entries.length === 0) return null;
  return entries.reduce((min, curr) => (curr[1] < min[1] ? curr : min))[0];
}

/** Extract improvement suggestions from a critique (dimensions scoring < 7). */
export function getImprovementSuggestions(critique: Critique): string[] {
  const suggestions: string[] = [];
  for (const [dim, score] of Object.entries(critique.dimensionScores)) {
    if (score < 7) {
      const examples = critique.badExamples[dim];
      if (examples && examples.length > 0) {
        suggestions.push(`Improve ${dim}: ${examples[0]}`);
      } else if (critique.notes[dim]) {
        suggestions.push(`Improve ${dim}: ${critique.notes[dim]}`);
      }
    }
  }
  return suggestions;
}
