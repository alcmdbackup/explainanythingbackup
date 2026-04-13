// Central model registry — single source of truth for all LLM model metadata.
// Pricing, provider routing, max temperature, and evolution eligibility all derive from here.

export type ModelProvider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'local';

export interface ModelInfo {
  /** Exact model ID used in API calls and stored in DB. */
  id: string;
  /** Human-readable name for UI display. */
  displayName: string;
  /** Which provider/client routes this model's API calls. */
  provider: ModelProvider;
  /** Input price per 1M tokens in USD. */
  inputPer1M: number;
  /** Output price per 1M tokens in USD. */
  outputPer1M: number;
  /** Reasoning token price per 1M tokens (o1/o3 models). */
  reasoningPer1M?: number;
  /** Maximum temperature the model accepts. null = temperature not supported. */
  maxTemperature: number | null;
  /** Whether this model appears in the evolution strategy creation dropdown. */
  supportsEvolution: boolean;
  /**
   * The model ID to send to OpenRouter's API.
   * For models like gpt-oss-20b, this is 'openai/gpt-oss-20b'.
   * For models already in provider/model format (e.g. qwen/qwen3-8b), this equals the id.
   * Only set for openrouter provider models.
   */
  openRouterModelId?: string;
}

// ─── Registry ───────────────────────────────────────────────────

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // OpenAI GPT-4o
  'gpt-4o': {
    id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai',
    inputPer1M: 2.50, outputPer1M: 10.00, maxTemperature: 2.0, supportsEvolution: true,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai',
    inputPer1M: 0.15, outputPer1M: 0.60, maxTemperature: 2.0, supportsEvolution: true,
  },

  // OpenAI GPT-4.1
  'gpt-4.1': {
    id: 'gpt-4.1', displayName: 'GPT-4.1', provider: 'openai',
    inputPer1M: 2.00, outputPer1M: 8.00, maxTemperature: 2.0, supportsEvolution: true,
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini', displayName: 'GPT-4.1 Mini', provider: 'openai',
    inputPer1M: 0.40, outputPer1M: 1.60, maxTemperature: 2.0, supportsEvolution: true,
  },
  'gpt-4.1-nano': {
    id: 'gpt-4.1-nano', displayName: 'GPT-4.1 Nano', provider: 'openai',
    inputPer1M: 0.10, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
  },

  // OpenAI GPT-5
  'gpt-5.2': {
    id: 'gpt-5.2', displayName: 'GPT-5.2', provider: 'openai',
    inputPer1M: 1.75, outputPer1M: 14.00, maxTemperature: 2.0, supportsEvolution: true,
  },
  'gpt-5.2-pro': {
    id: 'gpt-5.2-pro', displayName: 'GPT-5.2 Pro', provider: 'openai',
    inputPer1M: 3.50, outputPer1M: 28.00, maxTemperature: 2.0, supportsEvolution: true,
  },
  'gpt-5-mini': {
    id: 'gpt-5-mini', displayName: 'GPT-5 Mini', provider: 'openai',
    inputPer1M: 0.25, outputPer1M: 2.00, maxTemperature: 2.0, supportsEvolution: true,
  },
  'gpt-5-nano': {
    id: 'gpt-5-nano', displayName: 'GPT-5 Nano', provider: 'openai',
    inputPer1M: 0.05, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
  },

  // OpenAI reasoning
  'o3-mini': {
    id: 'o3-mini', displayName: 'o3-mini', provider: 'openai',
    inputPer1M: 1.10, outputPer1M: 4.40, maxTemperature: null, supportsEvolution: true,
  },

  // DeepSeek
  'deepseek-chat': {
    id: 'deepseek-chat', displayName: 'DeepSeek Chat', provider: 'deepseek',
    inputPer1M: 0.28, outputPer1M: 0.42, maxTemperature: 2.0, supportsEvolution: true,
  },

  // Anthropic
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic',
    inputPer1M: 3.00, outputPer1M: 15.00, maxTemperature: 1.0, supportsEvolution: true,
  },

  // OpenRouter
  'gpt-oss-20b': {
    id: 'gpt-oss-20b', displayName: 'GPT-OSS 20B', provider: 'openrouter',
    inputPer1M: 0.03, outputPer1M: 0.14, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'openai/gpt-oss-20b',
  },
  'google/gemini-2.5-flash-lite': {
    id: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'openrouter',
    inputPer1M: 0.10, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'google/gemini-2.5-flash-lite',
  },
  'qwen/qwen3-8b': {
    id: 'qwen/qwen3-8b', displayName: 'Qwen3 8B', provider: 'openrouter',
    inputPer1M: 0.05, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'qwen/qwen3-8b',
  },

  // Local (Ollama)
  'LOCAL_qwen2.5:14b': {
    id: 'LOCAL_qwen2.5:14b', displayName: 'Qwen 2.5 14B (Local)', provider: 'local',
    inputPer1M: 0, outputPer1M: 0, maxTemperature: 2.0, supportsEvolution: true,
  },
};

// ─── Startup validation ─────────────────────────────────────────

const registryKeys = Object.keys(MODEL_REGISTRY);
if (registryKeys.length === 0) {
  throw new Error('MODEL_REGISTRY is empty — at least one model must be defined');
}

const evolutionModels = registryKeys.filter(k => MODEL_REGISTRY[k]!.supportsEvolution);
if (evolutionModels.length === 0) {
  throw new Error('MODEL_REGISTRY has no models with supportsEvolution=true');
}

// ─── Default judge model ────────────────────────────────────────

export const DEFAULT_JUDGE_MODEL = 'qwen/qwen3-8b';

// ─── Lookup helpers ─────────────────────────────────────────────

/** Get model info by ID. Returns undefined for unknown models. */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY[modelId];
}

/** Get max temperature for a model. Returns undefined for unknown models, null for models that don't support temperature. */
export function getModelMaxTemperature(modelId: string): number | null | undefined {
  return MODEL_REGISTRY[modelId]?.maxTemperature;
}

/** Get all model IDs that support evolution (for schema derivation). */
export function getEvolutionModelIds(): string[] {
  return Object.keys(MODEL_REGISTRY).filter(k => MODEL_REGISTRY[k]!.supportsEvolution);
}

/** Get model options for UI dropdowns: { label: displayName, value: id }. */
export function getModelOptions(): Array<{ label: string; value: string }> {
  return getEvolutionModelIds().map(id => ({
    label: MODEL_REGISTRY[id]!.displayName,
    value: id,
  }));
}

/** Check if a model routes through OpenRouter. */
export function isOpenRouterModel(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.provider === 'openrouter';
}

/** Get the API-facing model ID for OpenRouter calls. Falls back to the model ID itself. */
export function getOpenRouterApiModelId(modelId: string): string {
  return MODEL_REGISTRY[modelId]?.openRouterModelId ?? modelId;
}
