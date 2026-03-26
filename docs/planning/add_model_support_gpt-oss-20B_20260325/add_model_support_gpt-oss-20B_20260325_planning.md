# Add Model Support GPT-OSS-20B Plan

## Background
Add GPT-OSS-20B as a new LLM provider via OpenRouter. GPT-OSS-20B is OpenAI's open-weight model (21B params, MoE with 3.6B active, Apache 2.0). It is not available through OpenAI's API — we integrate via OpenRouter, which provides an OpenAI SDK-compatible endpoint. The user needs this model available in the strategy creation dropdown for evolution experiments, with correct cost tracking for budgeting.

## Requirements (from GH Issue #832)
- Add support for the new GPT-OSS-20B model from OpenAI
- Make it available from model selection dropdown for strategy creation
- Have correct costs for it for budgeting purposes

## Problem
The platform currently supports OpenAI, DeepSeek, Anthropic, and local Ollama models. GPT-OSS-20B is an open-weight model not served by OpenAI's API, so it requires a new provider integration (OpenRouter). The existing DeepSeek integration provides an exact blueprint — an OpenAI SDK client with a custom base URL and API key. We need to add the model to the schema, wire up a new provider client, add pricing, and ensure it appears in the strategy creation UI.

## Options Considered

### Option A: OpenRouter integration (CHOSEN)
- Use OpenRouter (`https://openrouter.ai/api/v1`) as the provider
- Follows existing DeepSeek pattern exactly — OpenAI SDK with custom baseURL
- Model string: `openai/gpt-oss-20b`
- Pros: Managed hosting, no infrastructure, OpenAI SDK compatible, cheap ($0.03/$0.11 per 1M tokens)
- Cons: Adds a new provider dependency, needs OPENROUTER_API_KEY

### Option B: Local via Ollama
- Run as `LOCAL_gpt-oss:20b` on existing Ollama infrastructure
- Pros: Free, no API dependency
- Cons: Requires hardware (20B model), higher latency, limited to local dev

### Option C: Other third-party (Together AI, Groq)
- Similar to OpenRouter but less established OpenAI compatibility
- No clear advantage over OpenRouter

## Phased Execution Plan

### Phase 1: Core Schema + Pricing (no provider wiring yet)

**File: `src/lib/schemas/schemas.ts`** — Add model to enum (line 72-79):
```typescript
export const allowedLLMModelSchema = z.enum([
  "gpt-4o-mini", "gpt-4o", "gpt-4.1-nano", "gpt-4.1-mini", "gpt-4.1",
  "gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano",
  "o3-mini",
  "deepseek-chat",
  "claude-sonnet-4-20250514",
  "LOCAL_qwen2.5:14b",
  "openai/gpt-oss-20b",  // OpenRouter — GPT-OSS-20B open-weight model
]);
```

**File: `src/config/llmPricing.ts`** — Add pricing entry after DeepSeek block (after line 61):
```typescript
  // OpenRouter — GPT-OSS open-weight
  'openai/gpt-oss-20b': { inputPer1M: 0.03, outputPer1M: 0.11 },
```

**Verify:** Run lint, tsc, build. Run existing unit tests to ensure no regressions.

### Phase 2: Provider Client + Routing

**File: `src/lib/services/llms.ts`** — Add OpenRouter client (after DeepSeek client, ~line 194):
```typescript
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
let openrouterClient: OpenAI | null = null;

function getOpenRouterClient(): OpenAI {
    if (typeof window !== 'undefined') {
        throw new Error('OpenRouter client cannot be used on the client side');
    }

    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY not found in environment variables. Please check your .env file.');
    }

    if (!openrouterClient) {
        openrouterClient = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: OPENROUTER_BASE_URL,
            maxRetries: 3,
            timeout: 60000,
        });
    }

    return openrouterClient;
}

// Note: Narrow check matching only gpt-oss models on OpenRouter.
// If a second OpenRouter model is added, update this function or refactor to a set lookup.
export function isOpenRouterModel(model: string): boolean {
    return model === 'openai/gpt-oss-20b';
}
```

> **Design note:** We use exact match (not prefix) to avoid namespace collisions with future `openai/*` models. If more OpenRouter models are added, refactor to a `Set<string>` lookup derived from `allowedLLMModelSchema`.

**File: `src/lib/services/llms.ts`** — Update client selection in `callOpenAIModel` (line 297-304):
```typescript
let client: OpenAI;
if (isLocalModel(validatedModel)) {
    client = getLocalClient();
} else if (isDeepSeekModel(validatedModel)) {
    client = getDeepSeekClient();
} else if (isOpenRouterModel(validatedModel)) {
    client = getOpenRouterClient();
} else {
    client = getOpenAIClient();
}
```

**File: `src/lib/services/llms.ts`** — Update structured output handling (line 281-287, the `if (response_obj && response_obj_name)` block):
```typescript
// BEFORE:
if (isDeepSeekModel(validatedModel) || isLocalModel(validatedModel)) {
    requestOptions.response_format = { type: 'json_object' };
} else {
    requestOptions.response_format = zodResponseFormat(response_obj, response_obj_name);
}

// AFTER:
if (isDeepSeekModel(validatedModel) || isLocalModel(validatedModel) || isOpenRouterModel(validatedModel)) {
    requestOptions.response_format = { type: 'json_object' };
} else {
    requestOptions.response_format = zodResponseFormat(response_obj, response_obj_name);
}
```

> **Note:** OpenRouter does NOT support `zodResponseFormat` (JSON Schema mode) for most routed models. Use `json_object` format like DeepSeek/local.

**File: `src/lib/services/llms.ts`** — Fix cost tracking model string mismatch (line 355 area). OpenRouter's API response may return a different model string (e.g., `gpt-oss-20b` without the `openai/` prefix), which would cause pricing lookup to fall through to prefix matching and potentially match `gpt-4` ($30/$60 per 1M) — a 1000x overestimate. Fix by using `validatedModel` for OpenRouter cost calculation, same pattern as local models:
```typescript
// BEFORE (line 355):
const costModel = isLocalModel(validatedModel) ? validatedModel : modelUsed;

// AFTER:
const costModel = (isLocalModel(validatedModel) || isOpenRouterModel(validatedModel)) ? validatedModel : modelUsed;
```

**Verify:** Run lint, tsc, build.

### Phase 3: Tests

**File: `src/lib/schemas/schemas.test.ts`** — Add to `allowedLLMModelSchema` tests:
```typescript
// In 'should accept valid LLM models' test:
expect(allowedLLMModelSchema.parse('openai/gpt-oss-20b')).toBe('openai/gpt-oss-20b');

// In 'should reject invalid LLM models' test, add:
expect(() => allowedLLMModelSchema.parse('openai/gpt-oss')).toThrow();
expect(() => allowedLLMModelSchema.parse('gpt-oss-20b')).toThrow();
```

**File: `src/config/llmPricing.test.ts`** — Add cost calculation test:
```typescript
it('should calculate cost for OpenRouter gpt-oss-20b', () => {
  const cost = calculateLLMCost('openai/gpt-oss-20b', 1000000, 1000000, 0);
  expect(cost).toBeCloseTo(0.14, 4); // $0.03 input + $0.11 output
});

it('should return exact pricing for openai/gpt-oss-20b (no prefix fallback)', () => {
  const pricing = getModelPricing('openai/gpt-oss-20b');
  expect(pricing.inputPer1M).toBe(0.03);
  expect(pricing.outputPer1M).toBe(0.11);
});
```

**File: `src/lib/services/llms.test.ts`** — Add OpenRouter-specific tests (following existing Anthropic/local model test patterns):

1. **`isOpenRouterModel()` tests:**
```typescript
describe('isOpenRouterModel', () => {
  it('should return true for openai/gpt-oss-20b', () => {
    expect(isOpenRouterModel('openai/gpt-oss-20b')).toBe(true);
  });
  it('should return false for regular OpenAI models', () => {
    expect(isOpenRouterModel('gpt-4.1-mini')).toBe(false);
    expect(isOpenRouterModel('gpt-oss-20b')).toBe(false);
  });
  it('should return false for other providers', () => {
    expect(isOpenRouterModel('deepseek-chat')).toBe(false);
    expect(isOpenRouterModel('claude-sonnet-4-20250514')).toBe(false);
  });
});
```

2. **Missing API key test** (follows pattern from line 321 for OPENAI_API_KEY and line 1040 for ANTHROPIC_API_KEY):
```typescript
it('should throw error when OPENROUTER_API_KEY is not set', async () => {
  delete process.env.OPENROUTER_API_KEY;
  await expect(callLLM('test', 'test', 'user-id', 'openai/gpt-oss-20b', false, null))
    .rejects.toThrow('OPENROUTER_API_KEY not found');
});
```

3. **Routing test** (follows local model routing test pattern from line 860):
```typescript
it('should route openai/gpt-oss-20b to OpenRouter and pass model string unchanged', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  mockCreateSpy.mockResolvedValueOnce({
    choices: [{ message: { content: 'OpenRouter response' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    model: 'gpt-oss-20b', // OpenRouter may strip 'openai/' prefix in response
  });

  const result = await callLLM(
    'Test prompt', 'test_source', '00000000-0000-4000-8000-000000000001',
    'openai/gpt-oss-20b', false, null, null, null, false,
  );

  expect(result).toBe('OpenRouter response');
  // Model string passed through unchanged (unlike LOCAL_ which strips prefix)
  expect(mockCreateSpy).toHaveBeenCalledWith(
    expect.objectContaining({ model: 'openai/gpt-oss-20b' })
  );
});
```

4. **Structured output test** (follows local model pattern from line 889):
```typescript
it('should use json_object response_format for OpenRouter models', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  const responseSchema = z.object({ answer: z.string() });
  mockCreateSpy.mockResolvedValueOnce({
    choices: [{ message: { content: '{"answer":"test"}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    model: 'gpt-oss-20b',
  });

  await callLLM(
    'Test prompt', 'test_source', '00000000-0000-4000-8000-000000000001',
    'openai/gpt-oss-20b', false, null, responseSchema, 'TestResponse', false,
  );

  expect(mockCreateSpy).toHaveBeenCalledWith(
    expect.objectContaining({ response_format: { type: 'json_object' } })
  );
});
```

5. **Cost tracking test** (follows local model cost test from line 918):
```typescript
it('should calculate correct cost for OpenRouter using validated model pricing', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  mockCreateSpy.mockResolvedValueOnce({
    choices: [{ message: { content: 'response' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000000, completion_tokens: 1000000, total_tokens: 2000000 },
    model: 'gpt-oss-20b', // API returns WITHOUT 'openai/' prefix
  });

  await callLLM(
    'Test prompt', 'test_source', '00000000-0000-4000-8000-000000000001',
    'openai/gpt-oss-20b', false, null, null, null, false,
  );

  const insertCall = mockSupabase.insert.mock.calls[0][0];
  // Should use openai/gpt-oss-20b pricing ($0.03/$0.11), NOT default ($10/$30)
  expect(insertCall.estimated_cost_usd).toBeCloseTo(0.14, 4);
});
```

**Verify:** Run all unit tests.

### Phase 4: Environment + Documentation

**File: `.env.example`** — Add placeholder:
```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

**File: `docs/docs_overall/llm_provider_limits.md`** — Add OpenRouter to providers table:
```markdown
| OpenRouter | [openrouter.ai/settings](https://openrouter.ai/settings) | openai/gpt-oss-20b |
```
Add recommended limit: $50/month.

**File: `docs/docs_overall/environments.md`** — Add to env vars reference (Required section):
```markdown
| `OPENROUTER_API_KEY` | OpenRouter API key (for gpt-oss-20b) |
```

Also add to the **Repository Secrets (Shared)** table in the GitHub Secrets section:
```markdown
| `OPENROUTER_API_KEY` | OpenRouter API key (evolution pipeline) |
```

> **Note:** Like `DEEPSEEK_API_KEY`, this secret is not passed in `ci.yml` because unit tests mock all LLM calls. It only needs to be set in `.env.local` for local dev and in Vercel env vars if the model is used in production.

## Rollback / Failure Handling

This model is only for evolution experiments, not user-facing generation. If OpenRouter has an outage:
- Evolution runs using `openai/gpt-oss-20b` will fail with a clear API error
- Other models and all user-facing features are unaffected
- Users can switch strategies to use a different model
- No special fallback logic needed — the error surfaces naturally through existing error handling

## Testing

### Unit Tests (modified)
- `src/lib/schemas/schemas.test.ts` — Validate `openai/gpt-oss-20b` accepted + reject invalid variants
- `src/config/llmPricing.test.ts` — Cost calculation + exact pricing lookup
- `src/lib/services/llms.test.ts` — `isOpenRouterModel()` true/false, missing API key error, routing to OpenRouter client, structured output uses `json_object`, cost tracking uses validated model string

### Manual Verification
- Add `OPENROUTER_API_KEY` to `.env.local`
- Navigate to `/admin/evolution/strategies`
- Verify `openai/gpt-oss-20b` appears in both Generation Model and Judge Model dropdowns
- Create a test strategy with `openai/gpt-oss-20b` as generation model
- Run a single evolution iteration and verify:
  - API call succeeds
  - Cost tracking records correct amounts
  - LLM call tracking logs the model name

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/llm_provider_limits.md` — Add OpenRouter provider entry and spending limits
- `docs/docs_overall/environments.md` — Add OPENROUTER_API_KEY env var
- `docs/feature_deep_dives/search_generation_pipeline.md` — No changes needed (model is for evolution, not default generation)
- `docs/feature_deep_dives/ai_suggestions_overview.md` — No changes needed
- `docs/feature_deep_dives/server_action_patterns.md` — No changes needed

## All Files Modified

| File | Type | Change |
|------|------|--------|
| `src/lib/schemas/schemas.ts` | Code | Add `"openai/gpt-oss-20b"` to enum |
| `src/config/llmPricing.ts` | Code | Add pricing entry |
| `src/lib/services/llms.ts` | Code | Add OpenRouter client, routing, structured output |
| `src/lib/schemas/schemas.test.ts` | Test | Add validation test |
| `src/config/llmPricing.test.ts` | Test | Add cost test |
| `src/lib/services/llms.test.ts` | Test | Add routing test |
| `.env.example` | Config | Add OPENROUTER_API_KEY |
| `docs/docs_overall/llm_provider_limits.md` | Docs | Add OpenRouter provider |
| `docs/docs_overall/environments.md` | Docs | Add env var reference |
