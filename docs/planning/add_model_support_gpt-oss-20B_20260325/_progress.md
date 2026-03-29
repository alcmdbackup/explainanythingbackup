# Add GPT-OSS-20B Model Support Progress

## Phase 1: Schema + Pricing
- Added `"openai/gpt-oss-20b"` to `allowedLLMModelSchema`
- Added pricing `{ inputPer1M: 0.03, outputPer1M: 0.11 }` to `LLM_PRICING`
- Lint/tsc/build: PASS

## Phase 2: Provider Client + Routing
- Added `getOpenRouterClient()` (OpenAI SDK + `https://openrouter.ai/api/v1` + `OPENROUTER_API_KEY`)
- Added `isOpenRouterModel()` — exact match: `model === 'openai/gpt-oss-20b'`
- Updated client selection: added `else if (isOpenRouterModel)` before OpenAI fallback
- Updated structured output: added `isOpenRouterModel` to `json_object` branch
- Fixed cost tracking: use `validatedModel` for OpenRouter (prevents pricing mismatch)
- Lint/tsc/build: PASS

## Phase 3: Tests
- `schemas.test.ts`: accept `openai/gpt-oss-20b`, reject `openai/gpt-oss-30b`
- `llmPricing.test.ts`: cost calculation ($0.00085 for 10k/5k tokens), pricing lookup
- `llms.test.ts`: isOpenRouterModel, missing key error, routing, structured output (json_object), cost tracking (validatedModel)
- All 259 tests PASS (5 suites)

## Phase 4: Env + Docs
- `.env.example`: added `OPENROUTER_API_KEY`
- `llm_provider_limits.md`: added OpenRouter provider row + $50/month limit
- `environments.md`: added env var reference + GitHub Secrets entry

## Phase 5: Live Verification (2026-03-26)
- Script: `/tmp/verify-openrouter.ts`
- **Non-streaming**: PASS — `response.model` = `openai/gpt-oss-20b`, content correct
- **Streaming**: PASS — accumulated content received, usage reported
- **Structured output (json_object)**: PASS — valid JSON parsed
- **Key finding**: `response.model` returns `openai/gpt-oss-20b` (matches our pricing key), so `costModel` fix works correctly
- **Note**: Model uses reasoning tokens (33-172 per call) — not charged separately by OpenRouter at current pricing
