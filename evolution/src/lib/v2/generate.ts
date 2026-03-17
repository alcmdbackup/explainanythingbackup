// Generates new text variants using parallel LLM strategies with format validation.

import type { TextVariation, EvolutionLLMClient } from '../types';
import type { EvolutionConfig } from './types';
import { BudgetExceededError } from '../types';
import { BudgetExceededWithPartialResults } from './errors';
import { validateFormat } from '../agents/formatValidator';
import { FORMAT_RULES } from '../agents/formatRules';
import { createTextVariation } from '../core/textVariationFactory';

// ─── Strategy prompts ────────────────────────────────────────────

const STRATEGIES = ['structural_transform', 'lexical_simplify', 'grounding_enhance'] as const;

function buildPrompt(
  text: string,
  strategy: (typeof STRATEGIES)[number],
  feedback?: { weakestDimension: string; suggestions: string[] },
): string {
  const feedbackSection = feedback
    ? `\n## Feedback\nWeakest dimension: ${feedback.weakestDimension}\nSuggestions:\n${feedback.suggestions.map((s) => `- ${s}`).join('\n')}\n`
    : '';

  switch (strategy) {
    case 'structural_transform':
      return `You are an expert writing editor. AGGRESSIVELY restructure this text with full creative freedom.

## Original Text
${text}
${feedbackSection}
## Task
Reorder sections, paragraphs, and ideas. Merge, split, or eliminate sections. Invert the structure (conclusion-first, bottom-up, problem-solution, narrative arc). Change heading hierarchy. Reorganize by chronological, thematic, comparative, or other principle. MUST preserve original intention, meaning, and all key points exactly. Do not add, remove, or alter the substance.

Output a radically restructured version. Same core message, completely different organization. Do NOT make timid, incremental changes — reimagine the organization from scratch.
${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;

    case 'lexical_simplify':
      return `You are an expert writing editor. Simplify the language of this text.

## Original Text
${text}
${feedbackSection}
## Task
Replace complex words with simpler alternatives. Shorten overly long sentences. Remove unnecessary jargon. Improve accessibility. Maintain the meaning.

Output a lexically simplified version.
${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;

    case 'grounding_enhance':
      return `You are an expert writing editor. Make this text more concrete and grounded.

## Original Text
${text}
${feedbackSection}
## Task
Add specific examples and details. Make abstract concepts concrete. Include sensory details. Strengthen connection to real-world experience. Maintaining the core message.

Output a more grounded and concrete version.
${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Generate new text variants using parallel LLM strategies.
 * Returns validated variants (format failures are silently discarded).
 * Throws BudgetExceededWithPartialResults if budget exceeded mid-generation.
 */
export async function generateVariants(
  text: string,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  feedback?: { weakestDimension: string; suggestions: string[] },
): Promise<TextVariation[]> {
  const count = Math.min(config.strategiesPerRound ?? 3, STRATEGIES.length);
  const activeStrategies = STRATEGIES.slice(0, count);

  const results = await Promise.allSettled(
    activeStrategies.map(async (strategy) => {
      const prompt = buildPrompt(text, strategy, feedback);
      const generated = await llm.complete(prompt, 'generation', {
        model: config.generationModel as Parameters<typeof llm.complete>[2] extends { model?: infer M } ? M : never,
      });
      const fmt = validateFormat(generated);
      if (!fmt.valid) return null;
      return createTextVariation({
        text: generated.trim(),
        strategy,
        iterationBorn: iteration,
        parentIds: [],
        version: 0,
      });
    }),
  );

  const variants: TextVariation[] = [];
  let budgetError: BudgetExceededError | null = null;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      variants.push(result.value);
    } else if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
      budgetError = budgetError ?? result.reason;
    }
  }

  if (budgetError) {
    throw new BudgetExceededWithPartialResults(variants, budgetError);
  }

  return variants;
}
