# Add Model Support GPT-OSS-20B Research

## Problem Statement
Add GPT-OSS-20B as a new LLM provider via OpenRouter. This involves adding the model to the allowed models schema, creating an OpenRouter API client, adding pricing data, and updating environment configuration.

## Requirements (from GH Issue #832)
- Add support for the new GPT-OSS-20B model from OpenAI
- Make it available from model selection dropdown for strategy creation
- Have correct costs for it for budgeting purposes

## High Level Summary

GPT-OSS-20B is OpenAI's open-weight model (21B params, MoE with 3.6B active, Apache 2.0). It is NOT available through OpenAI's API — only via self-hosting or third-party providers. We'll integrate via **OpenRouter**, which provides an OpenAI-compatible API.

The integration follows the exact same pattern as the existing DeepSeek client — an `OpenAI` SDK instance with a custom base URL and API key. The model string on OpenRouter is `openai/gpt-oss-20b`.

### Key Model Details
- **Model string (OpenRouter):** `openai/gpt-oss-20b`
- **Context window:** 131,072 tokens
- **Architecture:** MoE, 21B total / 3.6B active params
- **Reasoning:** Configurable effort (low/medium/high) with chain-of-thought
- **Structured output:** Supported (function calling, JSON)
- **Streaming:** Supported
- **License:** Apache 2.0

### Pricing (OpenRouter)
- **Input:** $0.03 / 1M tokens
- **Output:** $0.11 / 1M tokens
- **Reasoning:** TBD (may match output pricing)

### OpenRouter API Details
- **Base URL:** `https://openrouter.ai/api/v1`
- **Auth:** Bearer token via `OPENROUTER_API_KEY`
- **Format:** Fully OpenAI SDK compatible
- **Headers:** Authorization (required), HTTP-Referer (optional), X-OpenRouter-Title (optional)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/llm_provider_limits.md - Current providers: OpenAI, DeepSeek, Anthropic, Local
- docs/feature_deep_dives/search_generation_pipeline.md - Generation uses DEFAULT_MODEL (gpt-4.1-mini)
- docs/feature_deep_dives/ai_suggestions_overview.md - AI suggestions use DEFAULT_MODEL + LIGHTER_MODEL
- docs/docs_overall/environments.md - Env vars, no OPENROUTER_API_KEY yet
- docs/feature_deep_dives/server_action_patterns.md - Standard action wrapping pattern

## Code Files Read
- `src/lib/schemas/schemas.ts:72-79` — allowedLLMModelSchema enum (source of truth)
- `src/config/llmPricing.ts` — LLM_PRICING record, prefix matching fallback
- `src/lib/services/llms.ts` — Model routing: client selection at line 297-304, provider routing at 572-588
- `src/lib/utils/modelOptions.ts` — MODEL_OPTIONS derived from schema, used by UI dropdowns
- `src/app/admin/evolution/strategies/page.tsx:73-74` — Strategy form uses MODEL_OPTIONS
- `evolution/src/lib/schemas.ts` — v2StrategyConfigSchema with generationModel/judgeModel
- `evolution/src/lib/pipeline/infra/createLLMClient.ts` — Evolution LLM client with cost tracking
- `src/lib/schemas/schemas.test.ts:70-90` — Model validation tests
- `src/config/llmPricing.test.ts` — Cost calculation tests

## Integration Pattern (follows DeepSeek exactly)

### DeepSeek pattern (existing, lines 172-198 in llms.ts):
```typescript
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
let deepseekClient: OpenAI | null = null;

function getDeepSeekClient(): OpenAI {
    // ... validates DEEPSEEK_API_KEY, creates OpenAI({ baseURL, apiKey })
}

function isDeepSeekModel(model: string): boolean {
    return model.startsWith('deepseek-');
}
```

### OpenRouter will follow same pattern:
```typescript
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
let openrouterClient: OpenAI | null = null;

function getOpenRouterClient(): OpenAI {
    // validates OPENROUTER_API_KEY, creates OpenAI({ baseURL, apiKey })
}

function isOpenRouterModel(model: string): boolean {
    return model.startsWith('openai/gpt-oss');
}
```

### Routing changes needed (in callOpenAIModel, line 297-304):
```typescript
let client: OpenAI;
if (isLocalModel(validatedModel)) {
    client = getLocalClient();
} else if (isDeepSeekModel(validatedModel)) {
    client = getDeepSeekClient();
} else if (isOpenRouterModel(validatedModel)) {  // NEW
    client = getOpenRouterClient();               // NEW
} else {
    client = getOpenAIClient();
}
```

### Structured output handling (line 281-287):
OpenRouter supports structured output, but safer to use `json_object` format like DeepSeek:
```typescript
if (isDeepSeekModel(validatedModel) || isLocalModel(validatedModel) || isOpenRouterModel(validatedModel)) {
    requestOptions.response_format = { type: 'json_object' };
}
```

## Files That Need Changes

| File | Change |
|------|--------|
| `src/lib/schemas/schemas.ts` | Add `"openai/gpt-oss-20b"` to allowedLLMModelSchema |
| `src/config/llmPricing.ts` | Add pricing: `{ inputPer1M: 0.03, outputPer1M: 0.11 }` |
| `src/lib/services/llms.ts` | Add `getOpenRouterClient()`, `isOpenRouterModel()`, update routing |
| `src/lib/schemas/schemas.test.ts` | Add validation test |
| `src/config/llmPricing.test.ts` | Add cost calculation test |
| `docs/docs_overall/llm_provider_limits.md` | Add OpenRouter provider entry |
| `docs/docs_overall/environments.md` | Add OPENROUTER_API_KEY env var |
| `.env.example` | Add OPENROUTER_API_KEY placeholder |

## Files That Do NOT Need Changes
- `src/lib/utils/modelOptions.ts` — Auto-derived from schema
- `src/app/admin/evolution/strategies/page.tsx` — Auto-populated from MODEL_OPTIONS
- Evolution pipeline files — Use string config, no hardcoded model checks
- `routeLLMCall()` — Already routes non-Anthropic to `callOpenAIModel()`

## Open Questions
- None remaining — ready for planning
