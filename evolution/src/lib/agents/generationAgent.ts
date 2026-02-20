// Generation agent that creates text variations using 3 strategies.
// Produces structural_transform, lexical_simplify, and grounding_enhance variants.

import { AgentBase } from './base';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import { createTextVariation } from '../core/textVariationFactory';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, TextVariation, GenerationExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { GENERATION_STRATEGIES, type GenerationStrategy } from '../core/supervisor';

function buildPrompt(strategy: GenerationStrategy, text: string, feedback: string | null): string {
  const feedbackSection = feedback
    ? `\n## Previous Feedback\nConsider this feedback when generating your variation:\n${feedback}\n`
    : '';

  switch (strategy) {
    case 'structural_transform':
      return `You are a bold writing architect who completely reimagines how text is organized.

## Task
AGGRESSIVELY restructure the following text. You have full creative freedom to completely reorder sections, paragraphs, and ideas; merge, split, or eliminate sections entirely; invert the structure (for example, conclusion-first, bottom-up, problem-solution, or narrative arc); change heading hierarchy and groupings; and reorganize around a different structural principle such as chronological, thematic, comparative, or any other approach.

You MUST preserve the original intention, meaning, and all key points exactly. Do not add, remove, or alter the substance. Only the STRUCTURE should change — and it should change dramatically. Do NOT make timid, incremental changes — reimagine the organization from scratch.
${feedbackSection}
## Original Text
${text}
${FORMAT_RULES}
## Instructions
Produce a radically restructured version. Same core message, completely different organization. Output ONLY the transformed text, no explanations.`;

    case 'lexical_simplify':
      return `You are a writing expert specializing in clarity and simplification.

## Task
Simplify the following text lexically. Replace complex words with simpler alternatives, shorten overly long sentences, remove unnecessary jargon, and make the text more accessible overall.
${feedbackSection}
## Original Text
${text}
${FORMAT_RULES}
## Instructions
Produce a lexically simplified version of the text. Maintain the meaning but improve readability and accessibility. Output ONLY the simplified text, no explanations.`;

    case 'grounding_enhance':
      return `You are a writing expert specializing in concrete and vivid writing.

## Task
Enhance the grounding of the following text. Add specific examples and details, make abstract concepts concrete, include sensory details where appropriate, and strengthen the connection to real-world experience.
${feedbackSection}
## Original Text
${text}
${FORMAT_RULES}
## Instructions
Produce a more grounded and concrete version of the text. Add specificity and vividness while maintaining the core message. Output ONLY the enhanced text, no explanations.`;
  }
}

export class GenerationAgent extends AgentBase {
  readonly name = 'generation';

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger } = ctx;
    const text = state.originalText;

    if (!text) {
      return { agentType: 'generation', success: true, skipped: true, reason: 'No originalText in state', costUsd: ctx.costTracker.getAgentCost(this.name) };
    }

    const feedback = ctx.state.metaFeedback
      ? ctx.state.metaFeedback.priorityImprovements.join('\n')
      : null;
    const feedbackUsed = feedback !== null;
    const promptLengths = new Map<GenerationStrategy, number>();

    const results = await Promise.allSettled(
      GENERATION_STRATEGIES.map(async (strategy) => {
        const prompt = buildPrompt(strategy, text, feedback);
        promptLengths.set(strategy, prompt.length);
        logger.debug('Generation call', { strategy, promptLength: prompt.length });
        const generatedText = await llmClient.complete(prompt, this.name);
        const fmtResult = validateFormat(generatedText);
        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy, issues: fmtResult.issues });
          return { text: null, strategy, formatIssues: fmtResult.issues };
        }
        return { text: generatedText.trim(), strategy, formatIssues: undefined };
      }),
    );

    // Re-throw BudgetExceededError so pipeline can pause the run
    for (const result of results) {
      if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
        throw result.reason;
      }
    }

    // Mutate state sequentially after all promises resolve, building detail alongside
    const variations: TextVariation[] = [];
    const strategyDetails: GenerationExecutionDetail['strategies'] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const strategy = GENERATION_STRATEGIES[i];
      const promptLength = promptLengths.get(strategy) ?? 0;

      if (result.status === 'fulfilled' && result.value.text) {
        const variation: TextVariation = createTextVariation({
          text: result.value.text,
          version: state.iteration + 1,
          strategy: result.value.strategy,
          iterationBorn: state.iteration,
        });
        variations.push(variation);
        state.addToPool(variation);
        logger.info('Generated variation', { strategy: variation.strategy, variationId: variation.id, textLength: variation.text.length });
        strategyDetails.push({ name: strategy, promptLength, status: 'success', variantId: variation.id, textLength: variation.text.length });
      } else if (result.status === 'fulfilled' && result.value.formatIssues) {
        strategyDetails.push({ name: strategy, promptLength, status: 'format_rejected', formatIssues: result.value.formatIssues });
      } else if (result.status === 'rejected') {
        logger.error('Generation error', { error: String(result.reason) });
        strategyDetails.push({ name: strategy, promptLength, status: 'error', error: String(result.reason) });
      }
    }

    const detail: GenerationExecutionDetail = {
      detailType: 'generation',
      strategies: strategyDetails,
      feedbackUsed,
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };

    if (variations.length === 0) {
      return { agentType: 'generation', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: 'All strategies failed', executionDetail: detail };
    }

    return { agentType: 'generation', success: true, costUsd: ctx.costTracker.getAgentCost(this.name), variantsAdded: variations.length, executionDetail: detail };
  }

  estimateCost(payload: AgentPayload): number {
    const textTokens = Math.ceil(payload.originalText.length / 4);
    const promptOverhead = 200;
    const inputTokens = textTokens + promptOverhead;
    const outputTokens = textTokens;
    const costPerCall = (inputTokens / 1_000_000) * 0.0004 + (outputTokens / 1_000_000) * 0.0016;
    return costPerCall * GENERATION_STRATEGIES.length;
  }

  canExecute(state: PipelineState): boolean {
    return state.originalText.length > 0;
  }
}
