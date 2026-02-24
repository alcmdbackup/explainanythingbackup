// Evolution LLM client wrapping callLLM with budget enforcement and structured output parsing.
// Defaults to DeepSeek v3 (deepseek-chat) for cost efficiency; handles callLLM → JSON.parse → Zod.validate pipeline.

import { z } from 'zod';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionLLMClient, CostTracker, EvolutionLogger, LLMCompletionOptions } from '../types';
import { LLMRefusalError } from '../types';
import { getModelPricing } from '@/config/llmPricing';

/** Default model for evolution pipeline — DeepSeek v3 is significantly cheaper than gpt-4.1-mini. */
export const EVOLUTION_DEFAULT_MODEL: AllowedLLMModelType = 'deepseek-chat';

/** System UUID for evolution pipeline LLM calls (llmCallTracking.userid is uuid NOT NULL). */
export const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

/** Estimate token cost before making a call (rough heuristic: ~4 chars per token). */
export function estimateTokenCost(prompt: string, model?: string, taskType?: 'comparison' | 'generation'): number {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimatedOutputTokens = taskType === 'comparison' ? 150 : Math.ceil(estimatedInputTokens * 0.5);
  const pricing = getModelPricing(model ?? EVOLUTION_DEFAULT_MODEL);
  return (
    (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M
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
    // Retry after cleaning trailing commas
    const cleaned = raw.replace(/,(\s*[}\]])/g, '$1');
    return schema.parse(JSON.parse(cleaned));
  }
}

/** Create an EvolutionLLMClient wrapping callLLM with budget enforcement. */
export function createEvolutionLLMClient(
  costTracker: CostTracker,
  evolutionLogger: EvolutionLogger,
): EvolutionLLMClient {
  return {
    async complete(prompt: string, agentName: string, options?: LLMCompletionOptions): Promise<string> {
      const model = options?.model ?? EVOLUTION_DEFAULT_MODEL;
      const invocationId = options?.invocationId;
      const taskType = options?.taskType;
      const estimate = estimateTokenCost(prompt, model, taskType);
      await costTracker.reserveBudget(agentName, estimate);

      const result = await callLLM(
        prompt,
        `evolution_${agentName}`,
        EVOLUTION_SYSTEM_USERID,
        model,
        false,
        null,
        null,
        null,
        options?.debug ?? false,
        {
          onUsage: (usage) => {
            costTracker.recordSpend(agentName, usage.estimatedCostUsd, invocationId);
          },
          evolutionInvocationId: invocationId,
        },
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
      const invocationId = options?.invocationId;
      const taskType = options?.taskType;
      const estimate = estimateTokenCost(prompt, model, taskType);
      await costTracker.reserveBudget(agentName, estimate);

      const zodObj = schema instanceof z.ZodObject ? schema : null;
      const raw = await callLLM(
        prompt,
        `evolution_${agentName}`,
        EVOLUTION_SYSTEM_USERID,
        model,
        false,
        null,
        zodObj,
        zodObj ? schemaName : null,
        options?.debug ?? false,
        {
          onUsage: (usage) => {
            costTracker.recordSpend(agentName, usage.estimatedCostUsd, invocationId);
          },
          evolutionInvocationId: invocationId,
        },
      );

      const parsed = parseStructuredOutput(raw, schema);
      evolutionLogger.debug('Structured LLM call complete', { agentName, schemaName });
      return parsed;
    },
  };
}

/**
 * Wrap a base llmClient with a fixed invocationId.
 * Delegates to the base client — does NOT reimplement complete()/completeStructured().
 * The only interception is injecting invocationId into the options passed down.
 */
export function createScopedLLMClient(
  base: EvolutionLLMClient,
  invocationId: string,
): EvolutionLLMClient {
  return {
    async complete(prompt, agentName, options) {
      return base.complete(prompt, agentName, { ...options, invocationId });
    },
    async completeStructured(prompt, schema, schemaName, agentName, options) {
      return base.completeStructured(prompt, schema, schemaName, agentName, { ...options, invocationId });
    },
  };
}
