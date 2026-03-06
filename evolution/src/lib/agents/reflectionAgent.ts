// Reflection agent providing dimensional critiques of top text variants.
// Calls LLM per variant to produce scores, examples, and notes across quality dimensions.

import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Critique, ReflectionExecutionDetail, TextVariation } from '../types';
import { QUALITY_DIMENSIONS, parseQualityCritiqueResponse } from '../flowRubric';
import { runCritiqueBatch } from '../core/critiqueBatch';

export type CritiqueDimension = string;

/** Build the LLM prompt for dimensional critique. */
function buildCritiquePrompt(text: string, dimensions: readonly string[]): string {
  const dimensionsList = dimensions.map((d) => `- ${d}`).join('\n');

  return `You are an expert writing critic. Analyze this text across multiple quality dimensions.

## Text to Analyze
<<<CONTENT>>>
${text}
<<</CONTENT>>>

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

export class ReflectionAgent extends AgentBase {
  readonly name = 'reflection';
  private readonly dimensions: readonly string[];

  constructor(dimensions?: readonly string[]) {
    super();
    this.dimensions = dimensions ?? Object.keys(QUALITY_DIMENSIONS);
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger } = ctx;

    const topVariants = state.getTopByRating(3);
    if (topVariants.length === 0) {
      return this.skipResult('No variants to critique', ctx);
    }

    logger.info('Reflection start', { numVariants: topVariants.length, dimensions: [...this.dimensions] });

    const { critiques, entries } = await runCritiqueBatch<TextVariation>(llmClient, {
      items: topVariants,
      buildPrompt: (variant) => buildCritiquePrompt(variant.text, this.dimensions),
      agentName: this.name,
      parseResponse: (raw, variant) => parseQualityCritiqueResponse(raw, variant.id),
      parallel: true,
      logger,
    });

    const variantDetails: ReflectionExecutionDetail['variantsCritiqued'] = entries.map((entry) => {
      const variantId = entry.item.id;
      if (entry.status === 'success' && entry.critique) {
        const scores = Object.values(entry.critique.dimensionScores);
        const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b) / scores.length : 0;
        logger.info('Critique generated', { variantId: variantId.slice(0, 8), avgScore: avgScore.toFixed(1) });
        return {
          variantId, status: 'success' as const, avgScore,
          dimensionScores: { ...entry.critique.dimensionScores },
          goodExamples: entry.critique.goodExamples,
          badExamples: entry.critique.badExamples,
          notes: entry.critique.notes,
        };
      }
      if (entry.status === 'error') {
        return { variantId, status: 'error' as const, error: entry.error };
      }
      return { variantId, status: 'parse_failed' as const };
    });

    // Update state
    if (!state.allCritiques) state.allCritiques = [];
    state.allCritiques.push(...critiques);

    if (!state.dimensionScores) state.dimensionScores = {};
    for (const critique of critiques) {
      state.dimensionScores[critique.variationId] = critique.dimensionScores;
    }

    logger.info('Reflection complete', { numCritiques: critiques.length });

    const detail: ReflectionExecutionDetail = {
      detailType: 'reflection',
      variantsCritiqued: variantDetails,
      dimensions: [...this.dimensions],
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };

    if (critiques.length === 0) {
      return this.failResult('All critiques failed', ctx, { executionDetail: detail });
    }
    return this.successResult(ctx, { executionDetail: detail });
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
