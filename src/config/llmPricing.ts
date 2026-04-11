/**
 * LLM token pricing configuration.
 * Used to calculate estimated costs for API calls.
 * Prices are per 1M tokens in USD.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  reasoningPer1M?: number;
}

// Pricing as of April 2026 - update as needed
export const LLM_PRICING: Record<string, ModelPricing> = {
  // OpenAI GPT-4.1 (latest)
  'gpt-4.1': { inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4.1-nano': { inputPer1M: 0.10, outputPer1M: 0.40 },

  // OpenAI GPT-5 (latest)
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14.00 },
  'gpt-5.2-pro': { inputPer1M: 3.50, outputPer1M: 28.00 },
  'gpt-5-mini': { inputPer1M: 0.25, outputPer1M: 2.00 },
  'gpt-5-nano': { inputPer1M: 0.05, outputPer1M: 0.40 },

  // OpenAI GPT-4o
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-2024-11-20': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-2024-08-06': { inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-4o-2024-05-13': { inputPer1M: 5.00, outputPer1M: 15.00 },

  // OpenAI GPT-4o-mini
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4o-mini-2024-07-18': { inputPer1M: 0.15, outputPer1M: 0.60 },

  // OpenAI o1 reasoning models (longer prefixes first for correct prefix matching)
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

  // OpenAI o3 reasoning models
  'o3-mini': { inputPer1M: 1.10, outputPer1M: 4.40 },

  // DeepSeek
  'deepseek-chat': { inputPer1M: 0.28, outputPer1M: 0.42 }, // V3.2 pricing per api-docs.deepseek.com

  // OpenRouter (GPT-OSS-20B via OpenRouter)
  'gpt-oss-20b': { inputPer1M: 0.03, outputPer1M: 0.14 }, // per openrouter.ai

  // Local models (Ollama) — free
  'LOCAL_qwen2.5:14b': { inputPer1M: 0, outputPer1M: 0 },

  // Anthropic Claude 4
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },

  // Anthropic Claude 3.5
  'claude-3-5-sonnet-20241022': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-sonnet-20240620': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-5-haiku-20241022': { inputPer1M: 0.80, outputPer1M: 4.00 },

  // Anthropic Claude 3
  'claude-3-opus-20240229': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-sonnet-20240229': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-haiku-20240307': { inputPer1M: 0.25, outputPer1M: 1.25 },
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

/** Calculate estimated cost in USD for an LLM call. */
export function calculateLLMCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  reasoningTokens: number = 0
): number {
  const pricing = getModelPricing(model);

  const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
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
