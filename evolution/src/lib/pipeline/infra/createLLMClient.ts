// V2 LLM client wrapper with retry on transient errors and cost tracking integration.
// Writes cost metrics to DB after each successful LLM call (fire-and-forget) so cost
// survives sudden process crashes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { BudgetExceededError } from '../../types';
import { isTransientError } from '../../shared/classifyErrors';
import { getModelPricing, type ModelPricing } from '@/config/llmPricing';
import type { V2CostTracker } from './trackBudget';
import type { EntityLogger } from './createEntityLogger';
import { writeMetric } from '../../metrics/writeMetrics';
import type { MetricName } from '../../metrics/types';

// ─── Cost estimation ─────────────────────────────────────────────

/** Calculate cost from character counts (chars/4 ≈ tokens for English text). Rounded to 6 decimal places. */
function calculateCost(inputChars: number, outputChars: number, pricing: ModelPricing): number {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  const rawCost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
  return Math.round(rawCost * 1_000_000) / 1_000_000;
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
  logger?: EntityLogger,
  db?: SupabaseClient,
  runId?: string,
): EvolutionLLMClient {
  return {
    async complete(
      prompt: string,
      agentName: string,
      options?: LLMCompletionOptions,
    ): Promise<string> {
      const model = (options?.model as string) ?? defaultModel;
      const pricing = getModelPricing(model);
      const outputEstimate = OUTPUT_TOKEN_ESTIMATES[agentName] ?? 1000;
      // outputEstimate is in tokens; multiply by 4 to convert to chars for calculateCost
      const estimated = calculateCost(prompt.length, outputEstimate * 4, pricing);

      // Reserve budget (synchronous — parallel safe)
      const margined = costTracker.reserve(agentName, estimated);

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let timeoutId: NodeJS.Timeout | undefined;
        try {
          logger?.debug('LLM call attempt', { phaseName: agentName, attempt, model });
          const response = await Promise.race([
            rawProvider.complete(prompt, agentName, { model }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('LLM call timeout (60s)')), PER_CALL_TIMEOUT_MS);
            }),
          ]);

          // Validate response is non-empty string
          if (typeof response !== 'string' || response.trim().length === 0) {
            throw new Error('Empty LLM response');
          }

          // Success — record actual cost
          const actual = calculateCost(prompt.length, response.length, pricing);
          costTracker.recordSpend(agentName, actual, margined);

          // Fire-and-forget: persist cost to DB so it survives process crashes.
          // Cost tracker is the source of truth; DB write is best-effort.
          if (db && runId) {
            const totalSpent = costTracker.getTotalSpent();
            const phaseCost = costTracker.getPhaseCosts()[agentName] ?? 0;
            writeMetric(db, 'run', runId, 'cost' as MetricName, totalSpent, 'during_execution')
              .catch((err) => logger?.warn('Fire-and-forget cost write failed', { phaseName: agentName, error: err instanceof Error ? err.message : String(err) }));
            writeMetric(db, 'run', runId, `agentCost:${agentName}` as MetricName, phaseCost, 'during_execution')
              .catch((err) => logger?.warn('Fire-and-forget agentCost write failed', { phaseName: agentName, error: err instanceof Error ? err.message : String(err) }));
          }

          logger?.info('LLM call succeeded', { phaseName: agentName, promptChars: prompt.length, responseChars: response.length, costUsd: actual, attempt });
          return response;
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            // Budget errors are NOT retried
            costTracker.release(agentName, margined);
            logger?.error('Budget exceeded in LLM call', { phaseName: agentName });
            throw error;
          }

          lastError = error instanceof Error ? error : new Error(String(error));

          if (!isTransientError(error) || attempt === MAX_RETRIES) {
            costTracker.release(agentName, margined);
            logger?.error('LLM call failed', { phaseName: agentName, totalAttempts: attempt + 1, error: lastError.message.slice(0, 500) });
            throw lastError;
          }

          logger?.warn('LLM transient error', { phaseName: agentName, attempt, error: lastError.message.slice(0, 500) });
          // Exponential backoff before retry
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
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
