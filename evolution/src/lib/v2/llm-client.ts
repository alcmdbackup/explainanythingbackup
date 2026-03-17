// V2 LLM client wrapper with retry on transient errors and cost tracking integration.

import type { EvolutionLLMClient, LLMCompletionOptions } from '../types';
import { BudgetExceededError } from '../types';
import { isTransientError } from '../core/errorClassification';
import type { V2CostTracker } from './cost-tracker';

// ─── Model pricing (per 1M tokens) ──────────────────────────────

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4.1-nano': { inputPer1M: 0.10, outputPer1M: 0.40 },
  'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4.1': { inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.10 },
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.00 },
};

/** Most expensive model pricing used as fallback for unknown models. */
const FALLBACK_PRICING: ModelPricing = { inputPer1M: 15.00, outputPer1M: 60.00 };

function getPricing(model: string): ModelPricing {
  const pricing = MODEL_PRICING[model];
  if (pricing) return pricing;
  console.warn(`[V2LLMClient] Unknown model "${model}" — using most expensive pricing as fallback`);
  return FALLBACK_PRICING;
}

// ─── Cost estimation ─────────────────────────────────────────────

/** Estimate tokens as chars/4 (reasonable for English text). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateCost(promptLength: number, outputTokens: number, pricing: ModelPricing): number {
  const inputTokens = Math.ceil(promptLength / 4);
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

function computeActualCost(promptLength: number, responseLength: number, pricing: ModelPricing): number {
  const inputTokens = estimateTokens('' .padEnd(promptLength));
  const outputTokens = estimateTokens('' .padEnd(responseLength));
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const PER_CALL_TIMEOUT_MS = 60_000;

/** Estimated output tokens by label. */
const OUTPUT_TOKEN_ESTIMATES: Record<string, number> = {
  generation: 1000,
  evolution: 1000,
  ranking: 100,
};

// ─── Public API ──────────────────────────────────────────────────

/**
 * Create a V2 EvolutionLLMClient wrapping a raw LLM provider with retry + cost tracking.
 * The raw provider is a simple { complete(prompt, label, opts?) } function.
 */
export function createV2LLMClient(
  rawProvider: { complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> },
  costTracker: V2CostTracker,
  defaultModel: string,
): EvolutionLLMClient {
  return {
    async complete(
      prompt: string,
      agentName: string,
      options?: LLMCompletionOptions,
    ): Promise<string> {
      const model = (options?.model as string) ?? defaultModel;
      const pricing = getPricing(model);
      const outputEstimate = OUTPUT_TOKEN_ESTIMATES[agentName] ?? 1000;
      const estimated = estimateCost(prompt.length, outputEstimate, pricing);

      // Reserve budget (synchronous — parallel safe)
      const margined = costTracker.reserve(agentName, estimated);

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await Promise.race([
            rawProvider.complete(prompt, agentName, { model }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('LLM call timeout (60s)')), PER_CALL_TIMEOUT_MS),
            ),
          ]);

          // Success — record actual cost
          const actual = computeActualCost(prompt.length, response.length, pricing);
          costTracker.recordSpend(agentName, actual, margined);
          return response;
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            // Budget errors are NOT retried
            costTracker.release(agentName, margined);
            throw error;
          }

          lastError = error instanceof Error ? error : new Error(String(error));

          if (!isTransientError(error) || attempt === MAX_RETRIES) {
            costTracker.release(agentName, margined);
            throw lastError;
          }

          // Exponential backoff before retry
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        }
      }

      // Should not reach here, but safety net
      costTracker.release(agentName, margined);
      throw lastError ?? new Error('LLM call failed after retries');
    },

    async completeStructured(): Promise<never> {
      throw new Error('completeStructured not supported in V2');
    },
  };
}
