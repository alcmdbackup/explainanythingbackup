// Evolution LLM client wrapping callOpenAIModel with budget enforcement and structured output parsing.
// Defaults to DeepSeek v3 (deepseek-chat) for cost efficiency; handles callOpenAIModel → JSON.parse → Zod.validate pipeline.

import { z } from 'zod';
import { callOpenAIModel } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionLLMClient, CostTracker, EvolutionLogger, LLMCompletionOptions } from '../types';
import { LLMRefusalError } from '../types';

/** Default model for evolution pipeline — DeepSeek v3 is significantly cheaper than gpt-4.1-mini. */
const EVOLUTION_DEFAULT_MODEL: AllowedLLMModelType = 'deepseek-chat';

/** Estimate token cost before making a call (rough heuristic: ~4 chars per token). */
export function estimateTokenCost(prompt: string): number {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5); // assume 50% output ratio
  // Rough cost per 1M tokens (use deepseek-chat pricing as default)
  const costPer1MInput = 0.14;
  const costPer1MOutput = 0.28;
  return (
    (estimatedInputTokens / 1_000_000) * costPer1MInput +
    (estimatedOutputTokens / 1_000_000) * costPer1MOutput
  );
}

/** Parse structured output with cleanup for common JSON issues. */
export function parseStructuredOutput<T>(raw: string, schema: z.ZodType<T>): T {
  if (!raw || raw.trim() === '') {
    throw new LLMRefusalError('Model returned empty response');
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    // Try cleaning common JSON issues (trailing commas)
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1');
    return schema.parse(JSON.parse(cleaned));
  }
}

/** Create an EvolutionLLMClient wrapping callOpenAIModel with budget enforcement. */
export function createEvolutionLLMClient(
  userid: string,
  costTracker: CostTracker,
  evolutionLogger: EvolutionLogger,
): EvolutionLLMClient {
  return {
    async complete(prompt: string, agentName: string, options?: LLMCompletionOptions): Promise<string> {
      const model = options?.model ?? EVOLUTION_DEFAULT_MODEL;
      const estimate = estimateTokenCost(prompt);
      await costTracker.reserveBudget(agentName, estimate);

      const result = await callOpenAIModel(
        prompt,
        `evolution_${agentName}`,
        userid,
        model,
        false,
        null,
        null,
        null,
        options?.debug ?? false,
      );

      if (!result || result.trim() === '') {
        throw new LLMRefusalError(`Empty response from ${agentName}`);
      }

      evolutionLogger.debug('LLM call complete', { agentName, promptLength: prompt.length });
      return result;
    },

    async completeStructured<T>(
      prompt: string,
      schema: z.ZodType<T>,
      schemaName: string,
      agentName: string,
      options?: LLMCompletionOptions,
    ): Promise<T> {
      const model = options?.model ?? EVOLUTION_DEFAULT_MODEL;
      const estimate = estimateTokenCost(prompt);
      await costTracker.reserveBudget(agentName, estimate);

      // callOpenAIModel accepts ZodObject for structured output
      const zodObj = schema instanceof z.ZodObject ? schema : null;
      const raw = await callOpenAIModel(
        prompt,
        `evolution_${agentName}`,
        userid,
        model,
        false,
        null,
        zodObj,
        zodObj ? schemaName : null,
        options?.debug ?? false,
      );

      const parsed = parseStructuredOutput(raw, schema);
      evolutionLogger.debug('Structured LLM call complete', { agentName, schemaName });
      return parsed;
    },
  };
}
