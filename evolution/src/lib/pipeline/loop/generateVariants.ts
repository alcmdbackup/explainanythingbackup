// Generates new text variants using parallel LLM strategies with format validation.

import type { Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import type { EvolutionConfig } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';
import { BudgetExceededError } from '../../types';
import { BudgetExceededWithPartialResults } from '../infra/errors';
import { validateFormat } from '../../shared/enforceVariantFormat';
import { createVariant } from '../../types';
import { buildEvolutionPrompt } from './buildPrompts';

// ─── Strategy prompts ────────────────────────────────────────────

const STRATEGIES = ['structural_transform', 'lexical_simplify', 'grounding_enhance'] as const;

const STRATEGY_INSTRUCTIONS: Record<(typeof STRATEGIES)[number], { preamble: string; instructions: string }> = {
  structural_transform: {
    preamble: 'You are an expert writing editor. AGGRESSIVELY restructure this text with full creative freedom.',
    instructions: 'Reorder sections, paragraphs, and ideas. Merge, split, or eliminate sections. Invert the structure (conclusion-first, bottom-up, problem-solution, narrative arc). Change heading hierarchy. Reorganize by chronological, thematic, comparative, or other principle. MUST preserve original intention, meaning, and all key points exactly. Do not add, remove, or alter the substance.\n\nOutput a radically restructured version. Same core message, completely different organization. Do NOT make timid, incremental changes — reimagine the organization from scratch.',
  },
  lexical_simplify: {
    preamble: 'You are an expert writing editor. Simplify the language of this text.',
    instructions: 'Replace complex words with simpler alternatives. Shorten overly long sentences. Remove unnecessary jargon. Improve accessibility. Maintain the meaning.\n\nOutput a lexically simplified version.',
  },
  grounding_enhance: {
    preamble: 'You are an expert writing editor. Make this text more concrete and grounded.',
    instructions: 'Add specific examples and details. Make abstract concepts concrete. Include sensory details. Strengthen connection to real-world experience. Maintaining the core message.\n\nOutput a more grounded and concrete version.',
  },
};

function buildPrompt(
  text: string,
  strategy: (typeof STRATEGIES)[number],
  feedback?: { weakestDimension: string; suggestions: string[] },
): string {
  const { preamble, instructions } = STRATEGY_INSTRUCTIONS[strategy];
  return buildEvolutionPrompt(preamble, 'Original Text', text, instructions, feedback);
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
  logger?: EntityLogger,
): Promise<Variant[]> {
  const count = Math.min(config.strategiesPerRound ?? 3, STRATEGIES.length);
  const activeStrategies = STRATEGIES.slice(0, count);
  logger?.info(`Generating with ${count} strategies`, { phaseName: 'generation', iteration });

  const results = await Promise.allSettled(
    activeStrategies.map(async (strategy) => {
      const prompt = buildPrompt(text, strategy, feedback);
      const generated = await llm.complete(prompt, 'generation', {
        model: config.generationModel as LLMCompletionOptions['model'],
      });
      const fmt = validateFormat(generated);
      if (!fmt.valid) {
        logger?.warn(`Strategy ${strategy} variant failed format validation`, { phaseName: 'generation', iteration });
        return null;
      }
      logger?.debug(`Strategy ${strategy} produced variant`, { phaseName: 'generation', iteration });
      return createVariant({
        text: generated.trim(),
        strategy,
        iterationBorn: iteration,
        parentIds: [],
        version: 0,
      });
    }),
  );

  const variants: Variant[] = [];
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
