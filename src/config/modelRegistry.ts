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
  /** Cache-hit input price per 1M tokens (e.g. DeepSeek context caching). When set,
   *  cache-hit prompt tokens bill at this rate while cache-miss tokens use inputPer1M.
   *  Omit for providers without a separate cache-hit tier. */
  cachedInputPer1M?: number;
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
  /**
   * Default reasoning config for models that support thinking/reasoning modes.
   * Applied as a fallback when the caller does not specify `reasoningEffort`.
   * Not set for models that don't support reasoning.
   * See evolution/docs/cost_optimization.md for the impact on latency/cost.
   */
  defaultReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /**
   * Whether this model supports thinking-mode / reasoning-effort routing.
   * REQUIRED on every entry (no defaulting) so the Zod cross-field refinement
   * in strategyConfigBaseSchema (Phase 1.14) and the cascade resolver guard in
   * debateDispatch.ts (Phase 2.5) can rely on it without falling back to
   * `defaultReasoningEffort !== undefined` proxy checks.
   *
   * Invariant (enforced at module init below): if `supportsReasoning === true`,
   * `defaultReasoningEffort` MAY be set; if `supportsReasoning === false`,
   * `defaultReasoningEffort` MUST NOT be set.
   *
   * Source: bring_back_debate_agent_20260506 Phase 1.19.
   */
  supportsReasoning: boolean;
  /**
   * Whether this model supports OpenAI-style schema-enforced structured output
   * (`response_format: { type: 'json_schema', ... }`). When false/unset, structured
   * callLLM requests fall back to `{ type: 'json_object' }` (JSON-forced but NOT
   * schema-enforced). Only meaningful for `openrouter` provider models — OpenAI always
   * uses json_schema; DeepSeek/Local always use json_object. Default unset (= false).
   * Set true only for OpenRouter models verified to honor json_schema (e.g. Gemini).
   * See fix_openrouter_json_schema_structured_output_20260608.
   */
  supportsJsonSchema?: boolean;
}

// ─── Registry ───────────────────────────────────────────────────

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // OpenAI GPT-4o
  'gpt-4o': {
    id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai',
    inputPer1M: 2.50, outputPer1M: 10.00, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai',
    inputPer1M: 0.15, outputPer1M: 0.60, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },

  // OpenAI GPT-4.1
  'gpt-4.1': {
    id: 'gpt-4.1', displayName: 'GPT-4.1', provider: 'openai',
    inputPer1M: 2.00, outputPer1M: 8.00, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini', displayName: 'GPT-4.1 Mini', provider: 'openai',
    inputPer1M: 0.40, outputPer1M: 1.60, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'gpt-4.1-nano': {
    id: 'gpt-4.1-nano', displayName: 'GPT-4.1 Nano', provider: 'openai',
    inputPer1M: 0.10, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },

  // OpenAI GPT-5 — reasoning-capable at API level but registry leaves supportsReasoning=false
  // until ops explicitly opts in (would also need defaultReasoningEffort + Phase 1.20 wiring).
  'gpt-5.2': {
    id: 'gpt-5.2', displayName: 'GPT-5.2', provider: 'openai',
    inputPer1M: 1.75, outputPer1M: 14.00, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'gpt-5.2-pro': {
    id: 'gpt-5.2-pro', displayName: 'GPT-5.2 Pro', provider: 'openai',
    inputPer1M: 3.50, outputPer1M: 28.00, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'gpt-5-mini': {
    id: 'gpt-5-mini', displayName: 'GPT-5 Mini', provider: 'openai',
    inputPer1M: 0.25, outputPer1M: 2.00, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  'gpt-5-nano': {
    id: 'gpt-5-nano', displayName: 'GPT-5 Nano', provider: 'openai',
    inputPer1M: 0.05, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },

  // OpenAI reasoning
  'o3-mini': {
    id: 'o3-mini', displayName: 'o3-mini', provider: 'openai',
    inputPer1M: 1.10, outputPer1M: 4.40, maxTemperature: null, supportsEvolution: true,
    supportsReasoning: true,
  },

  // DeepSeek (deepseek-chat is non-reasoning; the deepseek-reasoner SKU is not in registry).
  'deepseek-chat': {
    id: 'deepseek-chat', displayName: 'DeepSeek Chat', provider: 'deepseek',
    inputPer1M: 0.28, outputPer1M: 0.42, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
  // DeepSeek V4 — registered non-reasoning (thinking disabled in llms.ts; see plan).
  // pricing as of 2026-05-31 (the 75% v4-pro cut is permanent); cachedInputPer1M is the
  // cache-hit input rate — re-verify, the cache-hit rate is the volatile field.
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', provider: 'deepseek',
    inputPer1M: 0.435, cachedInputPer1M: 0.003625, outputPer1M: 0.87,
    maxTemperature: 2.0, supportsEvolution: true, supportsReasoning: false,
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', provider: 'deepseek',
    inputPer1M: 0.14, cachedInputPer1M: 0.0028, outputPer1M: 0.28,
    maxTemperature: 2.0, supportsEvolution: true, supportsReasoning: false,
  },

  // Anthropic — Sonnet 4 supports extended thinking via the Anthropic SDK, but the
  // wire-up + Phase 1.20 trace extraction are dead-code in v1 (see planning doc).
  // supportsReasoning intentionally false; flip to true in a follow-up PR + add
  // defaultReasoningEffort to enable.
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic',
    inputPer1M: 3.00, outputPer1M: 15.00, maxTemperature: 1.0, supportsEvolution: true,
    supportsReasoning: false,
  },

  // OpenRouter
  'gpt-oss-20b': {
    id: 'gpt-oss-20b', displayName: 'GPT-OSS 20B', provider: 'openrouter',
    inputPer1M: 0.03, outputPer1M: 0.14, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'openai/gpt-oss-20b',
    // OSS 20B has mandatory reasoning; 'low' is the minimum effective setting.
    // Default medium can take 6-16s per call and emit 2-4k reasoning tokens.
    defaultReasoningEffort: 'low',
    supportsReasoning: true,
  },
  'google/gemini-2.5-flash-lite': {
    id: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'openrouter',
    inputPer1M: 0.10, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'google/gemini-2.5-flash-lite',
    supportsReasoning: false,
    supportsJsonSchema: true,
  },
  // Cheap model for the nightly real-AI smoke (TEST_LLM_MODEL tier). Routed via OpenRouter.
  // VERIFY pricing against the live OpenRouter rate for google/gemini-2.5-flash before relying
  // on cost dashboards — these are best-known figures and only affect cost attribution, not routing.
  'google/gemini-2.5-flash': {
    id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'openrouter',
    inputPer1M: 0.30, outputPer1M: 2.50, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'google/gemini-2.5-flash',
    supportsReasoning: false,
    supportsJsonSchema: true,
  },
  'qwen/qwen3-8b': {
    id: 'qwen/qwen3-8b', displayName: 'Qwen3 8B', provider: 'openrouter',
    inputPer1M: 0.05, outputPer1M: 0.40, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'qwen/qwen3-8b',
    // Qwen3 allows fully disabling thinking mode. Thinking ON emits ~900 reasoning
    // tokens per call (~98% of output) and takes ~8s; thinking OFF emits ~5 tokens
    // and completes in ~1s. No quality loss observed for judge use case.
    defaultReasoningEffort: 'none',
    supportsReasoning: true,
  },
  'qwen-2.5-7b-instruct': {
    id: 'qwen-2.5-7b-instruct', displayName: 'Qwen 2.5 7B Instruct', provider: 'openrouter',
    inputPer1M: 0.04, outputPer1M: 0.10, maxTemperature: 2.0, supportsEvolution: true,
    openRouterModelId: 'qwen/qwen-2.5-7b-instruct',
    supportsReasoning: false,
  },

  // Local (Ollama)
  'LOCAL_qwen2.5:14b': {
    id: 'LOCAL_qwen2.5:14b', displayName: 'Qwen 2.5 14B (Local)', provider: 'local',
    inputPer1M: 0, outputPer1M: 0, maxTemperature: 2.0, supportsEvolution: true,
    supportsReasoning: false,
  },
};

// ─── Startup validation ─────────────────────────────────────────

if (Object.keys(MODEL_REGISTRY).length === 0) {
  throw new Error('MODEL_REGISTRY is empty — at least one model must be defined');
}
if (!Object.values(MODEL_REGISTRY).some(m => m.supportsEvolution)) {
  throw new Error('MODEL_REGISTRY has no models with supportsEvolution=true');
}
// bring_back_debate_agent_20260506 Phase 1.19 consistency check.
// supportsReasoning=false ↔ defaultReasoningEffort undefined.
for (const [id, info] of Object.entries(MODEL_REGISTRY)) {
  if (!info.supportsReasoning && info.defaultReasoningEffort !== undefined) {
    throw new Error(
      `MODEL_REGISTRY entry '${id}' has defaultReasoningEffort='${info.defaultReasoningEffort}' ` +
      `but supportsReasoning=false. Either set supportsReasoning=true or remove defaultReasoningEffort.`,
    );
  }
}

// ─── Default judge model ────────────────────────────────────────

export const DEFAULT_JUDGE_MODEL = 'qwen-2.5-7b-instruct';

// ─── Lookup helpers ─────────────────────────────────────────────

/** Get model info by ID. Returns undefined for unknown models. */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY[modelId];
}

/** Get max temperature for a model. Returns undefined for unknown models, null for models that don't support temperature. */
export function getModelMaxTemperature(modelId: string): number | null | undefined {
  return MODEL_REGISTRY[modelId]?.maxTemperature;
}

/** Get default reasoning effort for a reasoning-capable model.
 *  Returns undefined for unknown models or models that don't support reasoning. */
export function getModelDefaultReasoningEffort(modelId: string): 'none' | 'low' | 'medium' | 'high' | undefined {
  return MODEL_REGISTRY[modelId]?.defaultReasoningEffort;
}

/** Whether a model supports thinking-mode / reasoning-effort routing.
 *  Returns false for unknown models (conservative fallback — caller can't request
 *  reasoning effort on a model that may not handle it).
 *  bring_back_debate_agent_20260506 Phase 1.19. */
export function modelSupportsReasoning(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.supportsReasoning === true;
}

/** Whether the model supports schema-enforced structured output (json_schema). Used to decide,
 *  for OpenRouter structured calls, between `response_format: json_schema` (true) and the
 *  unstructured `json_object` fallback (false/unset). See callOpenAIModel in llms.ts. */
export function modelSupportsJsonSchema(modelId: string): boolean {
  return MODEL_REGISTRY[modelId]?.supportsJsonSchema === true;
}

/** Get all model IDs that support evolution (for schema derivation). */
export function getEvolutionModelIds(): string[] {
  return Object.keys(MODEL_REGISTRY).filter(k => MODEL_REGISTRY[k]!.supportsEvolution);
}

/**
 * Evolution model IDs minus those that can't run in the current deployment. `provider: 'local'`
 * models route to `LOCAL_LLM_BASE_URL` (Ollama), which is absent on Vercel — offering them in a
 * picker just yields a generic connection error. Excludes local models unless that env var is set.
 * MUST be called server-side: `LOCAL_LLM_BASE_URL` is not a NEXT_PUBLIC var, so on the client it is
 * always undefined (which would unconditionally drop local models).
 */
export function getDeployableEvolutionModelIds(): string[] {
  const localAvailable = !!process.env.LOCAL_LLM_BASE_URL;
  return getEvolutionModelIds().filter(
    k => localAvailable || MODEL_REGISTRY[k]!.provider !== 'local',
  );
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
