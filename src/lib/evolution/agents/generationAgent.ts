// Generation agent that creates text variations using 3 strategies.
// Produces structural_transform, lexical_simplify, and grounding_enhance variants.

import { v4 as uuidv4 } from 'uuid';
import { AgentBase } from './base';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, TextVariation } from '../types';

const STRATEGIES = ['structural_transform', 'lexical_simplify', 'grounding_enhance'] as const;
type Strategy = typeof STRATEGIES[number];

function buildPrompt(strategy: Strategy, text: string, feedback: string | null): string {
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
      return { agentType: 'generation', success: false, costUsd: 0, error: 'No originalText in state' };
    }

    const feedback = ctx.state.metaFeedback
      ? ctx.state.metaFeedback.priorityImprovements.join('\n')
      : null;

    const variations: TextVariation[] = [];

    for (const strategy of STRATEGIES) {
      try {
        const prompt = buildPrompt(strategy, text, feedback);
        logger.debug('Generation call', { strategy, promptLength: prompt.length });

        const generatedText = await llmClient.complete(prompt, this.name);
        const fmtResult = validateFormat(generatedText);
        if (!fmtResult.valid) {
          logger.warn('Format rejected', { strategy, issues: fmtResult.issues });
          continue;
        }

        const variation: TextVariation = {
          id: uuidv4(),
          text: generatedText.trim(),
          version: state.iteration + 1,
          parentIds: [],
          strategy,
          createdAt: Date.now() / 1000,
          iterationBorn: state.iteration,
        };

        variations.push(variation);
        state.addToPool(variation);
        logger.info('Generated variation', { strategy, variationId: variation.id, textLength: variation.text.length });
      } catch (error) {
        logger.error('Generation error', { strategy, error: String(error) });
        continue;
      }
    }

    if (variations.length === 0) {
      return { agentType: 'generation', success: false, costUsd: 0, error: 'All strategies failed' };
    }

    return { agentType: 'generation', success: true, costUsd: 0, variantsAdded: variations.length };
  }

  estimateCost(payload: AgentPayload): number {
    const textTokens = Math.ceil(payload.originalText.length / 4);
    const promptOverhead = 200;
    const inputTokens = textTokens + promptOverhead;
    const outputTokens = textTokens;
    const costPerCall = (inputTokens / 1_000_000) * 0.0004 + (outputTokens / 1_000_000) * 0.0016;
    return costPerCall * STRATEGIES.length;
  }

  canExecute(state: PipelineState): boolean {
    return state.originalText.length > 0;
  }
}
