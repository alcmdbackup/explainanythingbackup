// Genetic evolution agent that creates new variants from top-performing parents.
// Uses mutation (clarity/structure) and crossover strategies, plus creative exploration for diversity.

import { AgentBase } from './base';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import { PoolManager } from '../core/pool';
import { createTextVariation } from '../core/textVariationFactory';
import { formatMetaFeedback } from '../utils/metaFeedback';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, TextVariation, OutlineVariant, GenerationStep, EvolutionExecutionDetail } from '../types';
import { BudgetExceededError, BASELINE_STRATEGY, isOutlineVariant } from '../types';
import { rethrowBudgetErrors } from './agentUtils';
import { getOrdinal, type Rating } from '../core/rating';

// ─── Evolution strategies ───────────────────────────────────────

export const EVOLUTION_STRATEGIES = ['mutate_clarity', 'mutate_structure', 'crossover'] as const;
export type EvolutionStrategy = (typeof EVOLUTION_STRATEGIES)[number];

// ─── Creative exploration thresholds ────────────────────────────

const CREATIVE_RANDOM_CHANCE = 0.3;
const CREATIVE_DIVERSITY_THRESHOLD = 0.5;
const CREATIVE_STAGNATION_ITERATIONS = 2;

// ─── Prompt builders ────────────────────────────────────────────

function buildMutationPrompt(strategy: 'mutate_clarity' | 'mutate_structure', parentText: string, feedback: string | null): string {
  const feedbackSection = feedback ? `\n## Feedback to Address\n${feedback}\n` : '';

  if (strategy === 'mutate_clarity') {
    return `You are an expert writing editor. Improve the clarity of this text.

## Parent Text (High-Quality)
${parentText}
${feedbackSection}
## Task
Create an improved version that simplifies complex sentences, removes ambiguous phrasing, improves word choices for precision, and maintains the core message and quality.
${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;
  }

  return `You are an expert writing editor. Improve the structure of this text.

## Parent Text (High-Quality)
${parentText}
${feedbackSection}
## Task
Create an improved version that reorganizes for better flow, improves paragraph breaks, strengthens transitions, and enhances logical progression.
${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;
}

function buildCrossoverPrompt(parentAText: string, parentBText: string, feedback: string | null): string {
  const feedbackSection = feedback ? `\n## Feedback to Address\n${feedback}\n` : '';

  return `You are an expert writing editor. Combine the best elements of two text variations.

## Parent A (High-Quality)
${parentAText}

## Parent B (High-Quality)
${parentBText}
${feedbackSection}
## Task
Create a new version that takes the best structural elements from one parent and the best stylistic elements from the other, combines their strengths while avoiding their weaknesses, and creates something better than either parent alone.
${FORMAT_RULES}
Output ONLY the combined text, no explanations.`;
}

function buildCreativeExplorationPrompt(parentText: string, overrepresented: string[], feedback: string | null): string {
  const feedbackSection = feedback ? `\n## Feedback to Address\n${feedback}\n` : '';
  const avoidSection = overrepresented.length > 0
    ? `\n## Strategies to Avoid\nThese approaches are already overrepresented in the pool:\n${overrepresented.join(', ')}\nTry a completely different approach.\n`
    : '';

  return `You are an expert creative writing editor. Create a SIGNIFICANTLY DIFFERENT version of this text.

## Original Text
${parentText}
${feedbackSection}${avoidSection}
## Task
Create a new version that preserves the core meaning and key information while using a completely different structure or approach. Take creative risks the original does not, explore unconventional phrasing, tone, or organization, and aim for something that feels fresh and surprising rather than incremental.

Be BOLD - this variant should stand out as notably different from typical refinements.
The goal is to explore new territory, not polish the existing approach.
${FORMAT_RULES}
Output ONLY the transformed text, no explanations.`;
}

function buildMutateOutlinePrompt(outline: string, originalText: string, feedback: string | null): string {
  const feedbackSection = feedback ? `\n## Feedback to Address\n${feedback}\n` : '';

  return `You are an expert writing architect. Improve this outline by restructuring sections, adding missing topics, or reordering for better flow.

## Current Outline
${outline}

## Original Text (for context)
${originalText}
${feedbackSection}
## Task
Create an improved outline with better structure, coverage, and logical flow. Keep the same format: ## headings with brief summaries.

Output ONLY the improved outline, no explanations.`;
}

function buildExpandFromOutlinePrompt(outline: string, originalText: string): string {
  return `You are a writing expert who expands outlines into full, well-developed prose.

## Task
Expand this outline into complete article text. Each section should become full paragraphs.

## Outline
${outline}

## Original Text (for reference)
${originalText}

${FORMAT_RULES}
Output ONLY the article text, no explanations.`;
}

// ─── Helper functions ───────────────────────────────────────────

/** Identify overrepresented strategies (>1.5x average count), excluding baseline. */
export function getDominantStrategies(pool: TextVariation[]): string[] {
  const eligible = pool.filter((v) => v.strategy !== BASELINE_STRATEGY);
  if (eligible.length === 0) return [];

  const counts: Record<string, number> = {};
  for (const v of eligible) {
    counts[v.strategy] = (counts[v.strategy] ?? 0) + 1;
  }

  const avg = eligible.length / Object.keys(counts).length;
  return Object.entries(counts)
    .filter(([, count]) => count > avg * 1.5)
    .map(([strategy]) => strategy);
}

/** Check if top ratings have stagnated across iterations. */
export function isRatingStagnant(
  ratings: Map<string, Rating>,
  prevTopIds: string[],
  checkIterations: number = CREATIVE_STAGNATION_ITERATIONS,
): boolean {
  if (ratings.size < 3 || prevTopIds.length < checkIterations * 3) return false;

  const currentTop3 = [...ratings.entries()]
    .sort(([, a], [, b]) => getOrdinal(b) - getOrdinal(a))
    .slice(0, 3)
    .map(([id]) => id)
    .sort()
    .join(',');

  // Compare against stored previous top-3 snapshots
  for (let i = 0; i < checkIterations; i++) {
    const offset = i * 3;
    const prevSlice = prevTopIds.slice(offset, offset + 3).sort().join(',');
    if (prevSlice !== currentTop3) return false;
  }

  return true;
}

/** Determine if creative exploration should trigger. */
export function shouldTriggerCreativeExploration(
  state: PipelineState,
  randomValue: number,
): boolean {
  if (randomValue < CREATIVE_RANDOM_CHANCE) return true;
  return state.diversityScore !== null && state.diversityScore < CREATIVE_DIVERSITY_THRESHOLD;
}

// ─── EvolutionAgent ─────────────────────────────────────────────

export class EvolutionAgent extends AgentBase {
  readonly name = 'evolution';

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger } = ctx;

    if (!this.canExecute(state)) {
      return this.failResult('No rated parents available', ctx);
    }

    const poolManager = new PoolManager(state);
    const parents = poolManager.getEvolutionParents(2);

    if (parents.length === 0) {
      return this.failResult('No parents available', ctx);
    }

    const feedback = formatMetaFeedback(state.metaFeedback);
    const feedbackUsed = feedback !== null;

    // Track parent ordinals for detail
    const parentDetails: EvolutionExecutionDetail['parents'] = parents.map(p => ({
      id: p.id,
      ordinal: getOrdinal(state.ratings.get(p.id)!),
    }));

    logger.info('Evolution start', { numParents: parents.length, parentIds: parents.map((p) => p.id) });

    // Track per-mutation results for detail
    const mutationDetails: EvolutionExecutionDetail['mutations'] = [];

    // Run all evolution strategy LLM calls in parallel
    const results = await Promise.allSettled(
      EVOLUTION_STRATEGIES.map(async (strategy) => {
        let prompt: string;
        let parentIds: string[];

        if (strategy === 'crossover' && parents.length >= 2) {
          prompt = buildCrossoverPrompt(parents[0].text, parents[1].text, feedback);
          parentIds = [parents[0].id, parents[1].id];
        } else {
          // Fall back to mutate_clarity when crossover lacks 2 parents
          const effectiveStrategy = strategy === 'crossover' ? 'mutate_clarity' : strategy;
          prompt = buildMutationPrompt(effectiveStrategy, parents[0].text, feedback);
          parentIds = [parents[0].id];
        }

        logger.debug('Evolution call', { strategy, promptLength: prompt.length });
        const generatedText = await llmClient.complete(prompt, this.name);
        const fmtResult = validateFormat(generatedText);
        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy, issues: fmtResult.issues });
          return { text: null as string | null, strategy, parentIds, version: 0 };
        }

        const parentVersions = parents.filter((p) => parentIds.includes(p.id)).map((p) => p.version);
        const maxParentVersion = parentVersions.length > 0 ? Math.max(...parentVersions) : 0;
        return { text: generatedText.trim(), strategy, parentIds, version: maxParentVersion + 1 };
      }),
    );

    rethrowBudgetErrors(results);

    // Mutate state sequentially after all promises resolve
    const variations: TextVariation[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const strategy = EVOLUTION_STRATEGIES[i];

      if (result.status === 'fulfilled' && result.value.text !== null) {
        const v = result.value;
        const variation: TextVariation = createTextVariation({
          text: v.text!,
          version: v.version,
          parentIds: v.parentIds,
          strategy: v.strategy,
          iterationBorn: state.iteration,
        });
        variations.push(variation);
        state.addToPool(variation);
        logger.info('Evolution variation', { strategy: variation.strategy, variationId: variation.id, textLength: variation.text.length });
        mutationDetails.push({ strategy, status: 'success', variantId: variation.id, textLength: variation.text.length });
      } else if (result.status === 'fulfilled') {
        mutationDetails.push({ strategy, status: 'format_rejected' });
      } else {
        logger.error('Evolution error', { error: String(result.reason) });
        mutationDetails.push({ strategy, status: 'error', error: String(result.reason) });
      }
    }

    // Creative exploration operator
    let creativeExploration = false;
    let creativeReason: 'random' | 'low_diversity' | undefined;
    let overrepresentedStrategies: string[] | undefined;

    const randomValue = Math.random();
    if (shouldTriggerCreativeExploration(state, randomValue)) {
      creativeExploration = true;
      creativeReason = randomValue < CREATIVE_RANDOM_CHANCE ? 'random' : 'low_diversity';

      try {
        const creativeParent = parents[Math.floor(Math.random() * parents.length)];
        const overrepresented = getDominantStrategies(state.pool);
        overrepresentedStrategies = overrepresented.length > 0 ? overrepresented : undefined;

        logger.info('Creative exploration triggered', {
          parentId: creativeParent.id,
          overrepresented,
        });

        const prompt = buildCreativeExplorationPrompt(creativeParent.text, overrepresented, feedback);
        const generatedText = await llmClient.complete(prompt, this.name);
        const fmtResult = validateFormat(generatedText);

        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy: 'creative_exploration', issues: fmtResult.issues });
          mutationDetails.push({ strategy: 'creative_exploration', status: 'format_rejected' });
        } else {
          const creativeVariation: TextVariation = createTextVariation({
            text: generatedText.trim(),
            version: creativeParent.version + 1,
            parentIds: [creativeParent.id],
            strategy: 'creative_exploration',
            iterationBorn: state.iteration,
          });

          variations.push(creativeVariation);
          state.addToPool(creativeVariation);
          mutationDetails.push({ strategy: 'creative_exploration', status: 'success', variantId: creativeVariation.id, textLength: creativeVariation.text.length });
          logger.info('Creative exploration complete', {
            variationId: creativeVariation.id,
            textLength: creativeVariation.text.length,
          });
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        logger.error('Creative exploration error', { error: String(error) });
        mutationDetails.push({ strategy: 'creative_exploration', status: 'error', error: String(error) });
      }
    }

    // Outline mutation: if any parent is an OutlineVariant, mutate its outline and re-expand
    const outlineParent = parents.find(p => isOutlineVariant(p)) as OutlineVariant | undefined;
    if (outlineParent) {
      try {
        logger.info('Outline mutation triggered', { parentId: outlineParent.id, weakestStep: outlineParent.weakestStep });

        const mutatedOutline = await llmClient.complete(
          buildMutateOutlinePrompt(outlineParent.outline, state.originalText, feedback),
          this.name,
        );
        const expandedText = await llmClient.complete(
          buildExpandFromOutlinePrompt(mutatedOutline, state.originalText),
          this.name,
        );

        const fmtResult = validateFormat(expandedText);
        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy: 'mutate_outline', issues: fmtResult.issues });
          mutationDetails.push({ strategy: 'mutate_outline', status: 'format_rejected' });
        } else {
          const steps: GenerationStep[] = [
            { name: 'outline', input: state.originalText, output: mutatedOutline.trim(), score: 0.5, costUsd: 0 },
            { name: 'expand', input: mutatedOutline.trim(), output: expandedText.trim(), score: 0.5, costUsd: 0 },
          ];

          const outlineVariation: OutlineVariant = {
            ...createTextVariation({
              text: expandedText.trim(),
              version: outlineParent.version + 1,
              parentIds: [outlineParent.id],
              strategy: 'mutate_outline',
              iterationBorn: state.iteration,
            }),
            steps,
            outline: mutatedOutline.trim(),
            weakestStep: null,
          };

          variations.push(outlineVariation);
          state.addToPool(outlineVariation);
          mutationDetails.push({ strategy: 'mutate_outline', status: 'success', variantId: outlineVariation.id, textLength: expandedText.trim().length });
          logger.info('Outline mutation complete', { variationId: outlineVariation.id, textLength: expandedText.length });
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        logger.error('Outline mutation error', { error: String(error) });
        mutationDetails.push({ strategy: 'mutate_outline', status: 'error', error: String(error) });
      }
    }

    const detail: EvolutionExecutionDetail = {
      detailType: 'evolution',
      parents: parentDetails,
      mutations: mutationDetails,
      creativeExploration,
      creativeReason,
      overrepresentedStrategies,
      feedbackUsed,
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };

    if (variations.length === 0) {
      return this.failResult('All evolution strategies failed', ctx, { executionDetail: detail });
    }

    return this.successResult(ctx, { variantsAdded: variations.length, executionDetail: detail });
  }

  estimateCost(payload: AgentPayload): number {
    const textTokens = Math.ceil(payload.originalText.length / 4);
    const promptOverhead = 200;
    // 2 mutations + 1 crossover (2x input) + ~30% chance of creative exploration
    const mutationInput = textTokens + promptOverhead;
    const crossoverInput = textTokens * 2 + promptOverhead;
    const outputTokens = textTokens;
    const rate = { input: 0.0008, output: 0.004 }; // per 1M tokens

    const mutationCost = (mutationInput / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
    const crossoverCost = (crossoverInput / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
    const creativeCost = mutationCost * CREATIVE_RANDOM_CHANCE;

    return mutationCost * 2 + crossoverCost + creativeCost;
  }

  canExecute(state: PipelineState): boolean {
    return state.pool.length >= 1 && state.ratings.size >= 1;
  }
}
