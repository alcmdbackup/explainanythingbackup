// Evolves existing variants via LLM mutation and crossover with format validation.

import type { TextVariation, EvolutionLLMClient } from '../types';
import type { Rating } from '../shared/computeRatings';
import type { EvolutionConfig } from './types';
import { validateFormat } from '../shared/enforceVariantFormat';
import { createTextVariation } from '../types';
import { buildEvolutionPrompt } from './prompts';

// ─── Prompt builders ─────────────────────────────────────────────

function buildMutationPrompt(
  parentText: string,
  strategy: 'clarity' | 'structure',
  feedback?: { weakestDimension: string; suggestions: string[] },
): string {
  if (strategy === 'clarity') {
    return buildEvolutionPrompt(
      'You are an expert writing editor. Improve the clarity of this text.',
      'Parent Text (High-Quality)', parentText,
      'Create an improved version that simplifies complex sentences, removes ambiguous phrasing, improves word choices for precision, and maintains the core message and quality.',
      feedback,
    );
  }
  return buildEvolutionPrompt(
    'You are an expert writing editor. Improve the structure of this text.',
    'Parent Text (High-Quality)', parentText,
    'Create an improved version that reorganizes for better flow, improves paragraph breaks, strengthens transitions, and enhances logical progression.',
    feedback,
  );
}

function buildCrossoverPrompt(
  parentA: string,
  parentB: string,
  feedback?: { weakestDimension: string; suggestions: string[] },
): string {
  return buildEvolutionPrompt(
    'You are an expert writing editor. Combine the best elements of two text variations.',
    'Parent A (High-Quality)', `${parentA}\n\n## Parent B (High-Quality)\n${parentB}`,
    'Create a new version that takes the best structural elements from one parent and the best stylistic elements from the other, combines their strengths while avoiding their weaknesses, and creates something better than either parent alone.',
    feedback,
  );
}

function buildCreativePrompt(parentText: string): string {
  return buildEvolutionPrompt(
    'You are an expert creative writing editor. Create a SIGNIFICANTLY DIFFERENT version of this text.',
    'Original Text', parentText,
    'Create a new version that preserves the core meaning and key information while using a completely different structure or approach. Take creative risks the original does not, explore unconventional phrasing, tone, or organization, and aim for something that feels fresh and surprising rather than incremental.\n\nBe BOLD - this variant should stand out as notably different from typical refinements.',
  );
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Evolve existing variants via mutation and crossover.
 * Selects top-rated parents, applies clarity/structure mutation + crossover.
 * Returns validated new variants (format failures discarded).
 * BudgetExceededError propagates directly to caller.
 */
export async function evolveVariants(
  pool: TextVariation[],
  ratings: Map<string, Rating>,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  options?: {
    feedback?: { weakestDimension: string; suggestions: string[] };
    diversityScore?: number;
  },
): Promise<TextVariation[]> {
  if (pool.length === 0) return [];

  // Select parents by descending mu
  const sorted = [...pool].sort((a, b) => {
    const rA = ratings.get(a.id);
    const rB = ratings.get(b.id);
    return (rB?.mu ?? 0) - (rA?.mu ?? 0);
  });
  const parents = sorted.slice(0, 2);
  const parentIds = parents.map((p) => p.id);
  const maxVersion = Math.max(...parents.map((p) => p.version));
  const feedback = options?.feedback;

  const variants: TextVariation[] = [];

  const tryCreate = async (text: string, strategy: string): Promise<void> => {
    const fmt = validateFormat(text);
    if (!fmt.valid) return;
    variants.push(
      createTextVariation({
        text: text.trim(),
        strategy,
        iterationBorn: iteration,
        parentIds,
        version: maxVersion + 1,
      }),
    );
  };

  // Clarity mutation on parent 0
  const clarityText = await llm.complete(
    buildMutationPrompt(parents[0].text, 'clarity', feedback),
    'evolution',
  );
  await tryCreate(clarityText, 'mutate_clarity');

  // Structure mutation on parent 0
  const structText = await llm.complete(
    buildMutationPrompt(parents[0].text, 'structure', feedback),
    'evolution',
  );
  await tryCreate(structText, 'mutate_structure');

  // Crossover if 2+ parents
  if (parents.length >= 2) {
    const crossText = await llm.complete(
      buildCrossoverPrompt(parents[0].text, parents[1].text, feedback),
      'evolution',
    );
    await tryCreate(crossText, 'crossover');
  }

  // Creative exploration: fires when diversityScore > 0 AND < 0.5
  const diversity = options?.diversityScore ?? 1.0;
  if (diversity > 0 && diversity < 0.5) {
    const creativeText = await llm.complete(
      buildCreativePrompt(parents[0].text),
      'evolution',
    );
    await tryCreate(creativeText, 'creative_exploration');
  }

  return variants;
}
