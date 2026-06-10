/**
 * LLM token pricing configuration.
 * Registry models are imported as the source of truth; versioned variants
 * are kept here for prefix-match fallback (e.g. gpt-4o-2024-11-20 → gpt-4o pricing).
 * Prices are per 1M tokens in USD.
 */

import { MODEL_REGISTRY } from './modelRegistry';

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  reasoningPer1M?: number;
  /** Cache-hit input price per 1M tokens. When set, cache-hit prompt tokens bill at
   *  this rate while the remaining (cache-miss) prompt tokens use inputPer1M. */
  cachedInputPer1M?: number;
}

// Build pricing from registry (source of truth for registered models)
const registryPricing: Record<string, ModelPricing> = Object.fromEntries(
  Object.values(MODEL_REGISTRY).map(info => [info.id, {
    inputPer1M: info.inputPer1M,
    outputPer1M: info.outputPer1M,
    ...(info.reasoningPer1M != null && { reasoningPer1M: info.reasoningPer1M }),
    ...(info.cachedInputPer1M != null && { cachedInputPer1M: info.cachedInputPer1M }),
  }]),
);

// Versioned model variants for prefix-match fallback (not in registry)
const VERSIONED_PRICING: Record<string, ModelPricing> = {
  // OpenAI GPT-4o versioned
  'gpt-4o-2024-11-20': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-2024-08-06': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-2024-05-13': { inputPer1M: 5.00, outputPer1M: 15.00 },

  // OpenAI GPT-4o-mini versioned
  'gpt-4o-mini-2024-07-18': { inputPer1M: 0.15, outputPer1M: 0.60 },

  // OpenAI o1 reasoning models
  'o1-mini': { inputPer1M: 3.00, outputPer1M: 12.00, reasoningPer1M: 12.00 },
  'o1-mini-2024-09-12': { inputPer1M: 3.00, outputPer1M: 12.00, reasoningPer1M: 12.00 },
  'o1-preview': { inputPer1M: 15.00, outputPer1M: 60.00, reasoningPer1M: 60.00 },
  'o1-preview-2024-09-12': { inputPer1M: 15.00, outputPer1M: 60.00, reasoningPer1M: 60.00 },
  'o1-2024-12-17': { inputPer1M: 15.00, outputPer1M: 60.00, reasoningPer1M: 60.00 },
  'o1': { inputPer1M: 15.00, outputPer1M: 60.00, reasoningPer1M: 60.00 },

  // OpenAI GPT-4 Turbo
  'gpt-4-turbo': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-4-turbo-2024-04-09': { inputPer1M: 10.00, outputPer1M: 30.00 },
  'gpt-4-turbo-preview': { inputPer1M: 10.00, outputPer1M: 30.00 },

  // OpenAI GPT-4
  'gpt-4': { inputPer1M: 30.00, outputPer1M: 60.00 },
  'gpt-4-0613': { inputPer1M: 30.00, outputPer1M: 60.00 },

  // OpenAI GPT-3.5 Turbo
  'gpt-3.5-turbo': { inputPer1M: 0.50, outputPer1M: 1.50 },
  'gpt-3.5-turbo-0125': { inputPer1M: 0.50, outputPer1M: 1.50 },

  // Anthropic Claude 3.5
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-sonnet-20240620': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-haiku-20241022': { inputPer1M: 0.80, outputPer1M: 4.00 },

  // Anthropic Claude 3
  'claude-3-opus-20240229': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-sonnet-20240229': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },
};

// Merge: registry entries take precedence, then versioned fallbacks
export const LLM_PRICING: Record<string, ModelPricing> = {
  ...VERSIONED_PRICING,
  ...registryPricing,
};

// Default pricing for unknown models (conservative estimate)
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 10.00, outputPer1M: 30.00 };

/**
 * Get pricing for a specific model.
 * Returns default pricing if model not found.
 */
export function getModelPricing(model: string): ModelPricing {
  const exact = LLM_PRICING[model];
  if (exact) return exact;

  // Prefix match fallback — sort by key length descending so longer (more specific) prefixes win
  const prefixMatch = Object.entries(LLM_PRICING)
    .sort((a, b) => b[0].length - a[0].length)
    .find(([key]) => model.startsWith(key));

  return prefixMatch?.[1] ?? DEFAULT_PRICING;
}

/** Calculate estimated cost in USD for an LLM call.
 *  `cachedPromptTokens` is the cache-hit subset of `promptTokens` (e.g. DeepSeek's
 *  `usage.prompt_cache_hit_tokens`). When the model has a `cachedInputPer1M` rate, that
 *  subset bills at the cache-hit rate and the remainder at `inputPer1M`; otherwise all
 *  prompt tokens bill at `inputPer1M` (cachedPromptTokens is ignored). */
export function calculateLLMCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  reasoningTokens: number = 0,
  cachedPromptTokens: number = 0
): number {
  // B021: reject non-finite / negative token counts. A provider bug returning -1 would
  // produce negative spend, silently deflating reported cost and un-tripping the budget
  // gate. Throw loudly instead.
  if (
    !Number.isFinite(promptTokens) || promptTokens < 0 ||
    !Number.isFinite(completionTokens) || completionTokens < 0 ||
    !Number.isFinite(reasoningTokens) || reasoningTokens < 0 ||
    !Number.isFinite(cachedPromptTokens) || cachedPromptTokens < 0
  ) {
    throw new Error(
      `calculateLLMCost: token counts must be finite non-negative numbers ` +
      `(model=${model}, prompt=${promptTokens}, completion=${completionTokens}, ` +
      `reasoning=${reasoningTokens}, cached=${cachedPromptTokens})`,
    );
  }

  const pricing = getModelPricing(model);

  // Cache-hit tokens are a subset of promptTokens. Only split when the model defines a
  // cache-hit rate; otherwise bill all prompt tokens at inputPer1M (existing behavior).
  // Math.min clamps a provider returning cached > prompt so we never over-count.
  const cachedTokens = pricing.cachedInputPer1M != null
    ? Math.min(cachedPromptTokens, promptTokens)
    : 0;
  const fullInputTokens = promptTokens - cachedTokens;
  const inputCost = (fullInputTokens / 1_000_000) * pricing.inputPer1M
    + (cachedTokens / 1_000_000) * (pricing.cachedInputPer1M ?? pricing.inputPer1M);
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
  const reasoningCost = pricing.reasoningPer1M
    ? (reasoningTokens / 1_000_000) * pricing.reasoningPer1M
    : 0;

  // Round to 6 decimal places to match database precision
  return Math.round((inputCost + outputCost + reasoningCost) * 1_000_000) / 1_000_000;
}

/**
 * Format cost as a currency string.
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}
