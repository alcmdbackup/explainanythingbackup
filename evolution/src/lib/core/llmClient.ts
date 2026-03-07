// Evolution LLM client wrapping callLLM with budget enforcement and structured output parsing.
// Defaults to DeepSeek v3 (deepseek-chat) for cost efficiency; handles callLLM → JSON.parse → Zod.validate pipeline.

import { z } from 'zod';
import { callLLM } from '@/lib/services/llms';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionLLMClient, CostTracker, EvolutionLogger, LLMCompletionOptions } from '../types';
import { LLMRefusalError } from '../types';
import { getModelPricing } from '@/config/llmPricing';
import { getAgentBaseline } from './costEstimator';

/** Default model for evolution pipeline — DeepSeek v3 is significantly cheaper than gpt-4.1-mini. */
export const EVOLUTION_DEFAULT_MODEL: AllowedLLMModelType = 'deepseek-chat';

/** System UUID for evolution pipeline LLM calls (llmCallTracking.userid is uuid NOT NULL). */
export const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

// ─── Empirical Output Ratio Cache ───────────────────────────────
// Stores completion/prompt token ratios from historical baselines, keyed by "agent:model".
// Populated by preloadOutputRatios() at pipeline start; used by estimateTokenCost().
const outputRatioCache = new Map<string, number>();

/**
 * Preload empirical output/input token ratios from evolution_agent_cost_baselines.
 * Call once at pipeline start — makes estimateTokenCost() data-driven instead of heuristic.
 */
export async function preloadOutputRatios(agentModels: Array<{ agentName: string; model: string }>): Promise<void> {
  await Promise.allSettled(
    agentModels.map(async ({ agentName, model }) => {
      const baseline = await getAgentBaseline(agentName, model);
      if (baseline && baseline.avgPromptTokens > 0) {
        const ratio = baseline.avgCompletionTokens / baseline.avgPromptTokens;
        outputRatioCache.set(`${agentName}:${model}`, ratio);
      }
    })
  );
}

/** Get cached output ratio for an agent/model combo, or null if not available. */
export function getOutputRatio(agentName: string, model: string): number | null {
  return outputRatioCache.get(`${agentName}:${model}`) ?? null;
}

/** Clear the output ratio cache (for testing). */
export function clearOutputRatioCache(): void {
  outputRatioCache.clear();
}

/**
 * Estimate token cost before making a call.
 * Uses empirical output ratios from baselines when available (via agentName),
 * falls back to heuristic (50% of input for generation, 150 fixed for comparison).
 */
export function estimateTokenCost(prompt: string, model?: string, taskType?: 'comparison' | 'generation', agentName?: string): number {
  const resolvedModel = model ?? EVOLUTION_DEFAULT_MODEL;
  const estimatedInputTokens = Math.ceil(prompt.length / 4);

  let estimatedOutputTokens: number;
  if (taskType === 'comparison') {
    estimatedOutputTokens = 150;
  } else {
    const empiricalRatio = agentName ? getOutputRatio(agentName, resolvedModel) : null;
    estimatedOutputTokens = empiricalRatio !== null
      ? Math.ceil(estimatedInputTokens * empiricalRatio)
      : Math.ceil(estimatedInputTokens * 0.5);
  }

  const pricing = getModelPricing(resolvedModel);
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

/** Reserve budget, call LLM, and release reservation on failure. */
async function budgetedCallLLM(
  costTracker: CostTracker,
  prompt: string,
  agentName: string,
  options: LLMCompletionOptions | undefined,
  responseObj: z.ZodObject<z.ZodRawShape> | null,
  responseObjName: string | null,
): Promise<string> {
  const model = options?.model ?? EVOLUTION_DEFAULT_MODEL;
  const invocationId = options?.invocationId;
  const estimate = estimateTokenCost(prompt, model, options?.taskType, agentName);
  await costTracker.reserveBudget(agentName, estimate);

  try {
    return await callLLM(
      prompt,
      `evolution_${agentName}`,
      EVOLUTION_SYSTEM_USERID,
      model,
      false,
      null,
      responseObj,
      responseObjName,
      options?.debug ?? false,
      {
        onUsage: (usage) => {
          costTracker.recordSpend(agentName, usage.estimatedCostUsd, invocationId);
        },
        evolutionInvocationId: invocationId,
      },
    );
  } catch (err) {
    costTracker.releaseReservation(agentName);
    throw err;
  }
}

/** Create an EvolutionLLMClient wrapping callLLM with budget enforcement. */
export function createEvolutionLLMClient(
  costTracker: CostTracker,
  evolutionLogger: EvolutionLogger,
): EvolutionLLMClient {
  return {
    async complete(prompt: string, agentName: string, options?: LLMCompletionOptions): Promise<string> {
      const result = await budgetedCallLLM(costTracker, prompt, agentName, options, null, null);

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
      const zodObj = schema instanceof z.ZodObject ? schema : null;
      const raw = await budgetedCallLLM(costTracker, prompt, agentName, options, zodObj, zodObj ? schemaName : null);

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
