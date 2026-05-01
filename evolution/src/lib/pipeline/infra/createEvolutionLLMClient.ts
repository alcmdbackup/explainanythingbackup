// V2 LLM client wrapper with retry on transient errors and cost tracking integration.
// Writes cost metrics to DB after each successful LLM call (fire-and-forget) so cost
// survives sudden process crashes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { BudgetExceededError } from '../../types';
import { isTransientError } from '../../shared/classifyErrors';
import { getModelPricing, calculateLLMCost, type ModelPricing } from '@/config/llmPricing';
import type { V2CostTracker } from './trackBudget';
import type { EntityLogger } from './createEntityLogger';
import { writeMetricMax } from '../../metrics/writeMetrics';
import { type AgentName, COST_METRIC_BY_AGENT } from '../../core/agentNames';
import { getCalibrationRow } from './costCalibrationLoader';

// ─── Cost estimation ─────────────────────────────────────────────

/** Calculate cost from character counts (chars/4 ≈ tokens for English text). Rounded to 6 decimal places. */
export function calculateCost(inputChars: number, outputChars: number, pricing: ModelPricing): number {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  const rawCost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
  return Math.round(rawCost * 1_000_000) / 1_000_000;
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const PER_CALL_TIMEOUT_MS = 20_000;

/** Estimated output tokens by label. Keys must be valid AgentName values. */
const OUTPUT_TOKEN_ESTIMATES: Partial<Record<AgentName, number>> = {
  generation: 1000,
  ranking: 100,
  // Reflection: top-3 ranked tactics × ~200 tokens reasoning each ≈ 600 tokens (~2400 chars).
  reflection: 600,
};

// ─── Public API ──────────────────────────────────────────────────

/** Token usage metadata returned alongside the response text from a provider call. */
export interface RawProviderUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
}

/** Raw provider response — legacy bare string, or new {text, usage} shape. Discriminated at runtime. */
export type RawProviderResponse = string | { text: string; usage: RawProviderUsage };

/** Raw provider shape consumed by createEvolutionLLMClient. May return either shape above. */
export interface RawLLMProvider {
  complete(
    prompt: string,
    label: AgentName,
    opts?: { model?: string; temperature?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; invocationId?: string },
  ): Promise<RawProviderResponse>;
}

/**
 * Create a V2 EvolutionLLMClient wrapping a raw LLM provider with retry + cost tracking.
 * The raw provider is a simple { complete(prompt, label, opts?) } function. It may return
 * either a bare string (legacy) or `{ text, usage }` (new path — usage drives token-based
 * recordSpend in Phase 2).
 */
export function createEvolutionLLMClient(
  rawProvider: RawLLMProvider,
  costTracker: V2CostTracker,
  defaultModel: string,
  logger?: EntityLogger,
  db?: SupabaseClient,
  runId?: string,
  /** Temperature for generation calls. Ranking calls always use 0. undefined = provider default. */
  generationTemperature?: number,
  /**
   * Bound invocationId — auto-attached to every complete() call so agents that don't pass
   * `options.invocationId` per-call still get llmCallTracking rows linked back to their
   * evolution_agent_invocations row. LAST positional param: any future optional params
   * MUST use an options object instead — see plan-review note in
   * docs/planning/debug_evolution_run_cost_20260426/_planning.md § Phase 4a.
   */
  invocationId?: string,
): EvolutionLLMClient {
  return {
    async complete(
      prompt: string,
      agentName: AgentName,
      options?: LLMCompletionOptions,
    ): Promise<string> {
      const model = (options?.model as string) ?? defaultModel;
      const temperature = agentName === 'ranking'
        ? 0
        : (options?.temperature ?? generationTemperature);
      const reasoningEffort = options?.reasoningEffort;
      const pricing = getModelPricing(model);
      // Calibration-aware per-call estimate. When COST_CALIBRATION_ENABLED='true' and the
      // loader has a row for this (agentName, model), use avg_output_chars directly.
      // Otherwise fall back to OUTPUT_TOKEN_ESTIMATES (tokens × 4 chars/token).
      const calibrated = (() => {
        const phase = agentName === 'generation' ? 'generation'
          : agentName === 'ranking' ? 'ranking'
          : agentName === 'reflection' ? 'reflection'
          : agentName === 'seed_title' ? 'seed_title'
          : agentName === 'seed_article' ? 'seed_article'
          : null;
        if (!phase) return null;
        return getCalibrationRow('__unspecified__', model, '__unspecified__', phase);
      })();
      const outputChars = calibrated?.avgOutputChars
        ?? (OUTPUT_TOKEN_ESTIMATES[agentName] ?? 1000) * 4;
      const estimated = calculateCost(prompt.length, outputChars, pricing);

      // Reserve budget (synchronous — parallel safe)
      const margined = costTracker.reserve(agentName, estimated);

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let timeoutId: NodeJS.Timeout | undefined;
        try {
          logger?.debug('LLM call attempt', { phaseName: agentName, attempt, model });
          const rawResponse = await Promise.race([
            rawProvider.complete(prompt, agentName, { model, temperature, reasoningEffort, invocationId: options?.invocationId ?? invocationId }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('LLM call timeout (20s)')), PER_CALL_TIMEOUT_MS);
            }),
          ]);

          // Discriminate raw-provider shape: bare string (legacy) vs {text, usage} (new).
          // When usage is present we compute actual cost from real provider-billed tokens
          // via calculateLLMCost — the same helper llmCallTracking.estimated_cost_usd uses.
          // Falls back to chars/4 heuristic only when the raw provider didn't supply usage.
          const response: string = typeof rawResponse === 'string' ? rawResponse : rawResponse.text;
          const usage: RawProviderUsage | null = typeof rawResponse === 'string' ? null : rawResponse.usage;

          // Validate response is a non-empty string
          if (typeof response !== 'string' || response.trim().length === 0) {
            throw new Error('Empty LLM response');
          }

          // Success — record actual cost.
          // Prefer token-based cost from provider usage (fixes Bug A: string-length heuristic
          // was 30-800% inflated for deepseek-chat and similar models). Fall back to chars/4
          // only when the raw provider predates the {text, usage} contract.
          const actual = usage && Number.isFinite(usage.promptTokens) && Number.isFinite(usage.completionTokens)
            ? calculateLLMCost(model, usage.promptTokens, usage.completionTokens, usage.reasoningTokens ?? 0)
            : calculateCost(prompt.length, response.length, pricing);
          costTracker.recordSpend(agentName, actual, margined);

          // Persist cost to DB via writeMetricMax (race-fixed via Postgres GREATEST upsert).
          // Per-purpose write only happens for agentNames with a COST_METRIC_BY_AGENT entry
          // (currently 'generation' and 'ranking'); seed-phase calls bypass this entirely
          // since they go through the V1 callLLM path, not createEvolutionLLMClient.
          if (db && runId) {
            const totalSpent = costTracker.getTotalSpent();
            const phaseCost = costTracker.getPhaseCosts()[agentName] ?? 0;
            try {
              await writeMetricMax(db, 'run', runId, 'cost', totalSpent, 'during_execution');
              const costMetricName = COST_METRIC_BY_AGENT[agentName];
              if (costMetricName) {
                await writeMetricMax(db, 'run', runId, costMetricName, phaseCost, 'during_execution');
              }
            } catch (err) {
              logger?.warn('Cost write failed (non-fatal)', { phaseName: agentName, error: err instanceof Error ? err.message : String(err) });
            }
          }

          logger?.info('LLM call succeeded', {
            phaseName: agentName,
            promptChars: prompt.length,
            responseChars: response.length,
            promptTokens: usage?.promptTokens ?? null,
            completionTokens: usage?.completionTokens ?? null,
            costSource: usage ? 'usage' : 'chars',
            costUsd: actual,
            attempt,
          });
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
