# Add Deepseek New Model Support Plan

## Background
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek. The models must be selectable in the evolution strategy-creation UI, priced correctly (cache-aware) for budget tracking, and configured as non-thinking models.

## Requirements (from GH Issue #1155)
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek.

Resolved decisions (see research doc + below):
- Both models register as **non-reasoning** (`supportsReasoning:false`), **thinking OFF** by default.
- Do **not** capture the reasoning trace.
- Explicitly **disable thinking** (`thinking:{type:'disabled'}`) for non-reasoning DeepSeek models.
- No changes to default-model constants.
- **Cache-aware pricing (Option A):** account for DeepSeek's cache-hit vs cache-miss input rates.

## Verified Pricing (source: https://api-docs.deepseek.com/quick_start/pricing)
The deepseek-v4-pro 75% promo ends **2026-05-31 15:59 UTC (today)** → use **standard** rates.

| Model | Input cache-hit /1M | Input cache-miss /1M | Output /1M |
|---|---|---|---|
| deepseek-v4-flash | $0.0028 | $0.14 | $0.28 |
| deepseek-v4-pro (standard) | $0.0145 | $1.74 | $3.48 |

`inputPer1M` = cache-miss (full) rate; new `cachedInputPer1M` = cache-hit rate. Both models: 1M context, 384K max output. No `reasoningPer1M` (CoT off; would double-count anyway).

## Problem
DeepSeek is already wired as a provider (`getDeepSeekClient` → `https://api.deepseek.com`), but only `deepseek-chat` is registered, and our cost model has a single `inputPer1M` that ignores caching. DeepSeek's cache-hit input rate is 50× (flash) to 120× (pro) cheaper than cache-miss, and the evolution pipeline reuses large prompts, so a single rate misprices every call. Also, DeepSeek defaults thinking ON, so a "non-reasoning" entry alone would still incur CoT cost/latency unless `llms.ts` sends `thinking:{type:'disabled'}`.

## Options Considered
- [x] **Option A: Cache-aware pricing + registry entries + targeted `thinking:disabled` (CHOSEN)**: Extend the cost model to bill cache-hit/miss separately; add two registry entries; disable thinking for non-reasoning DeepSeek models. Accurate budget accounting, satisfies all decisions.
- [ ] **Option B: Conservative single (cache-miss) rate, defer cache-aware**: Ships faster but over-reports cost up to ~120× on cache-heavy pro calls. Rejected — gap too large.
- [ ] **Option C: Conservative, no follow-up**: Permanent over-reporting. Rejected.

## Phased Execution Plan

### Phase 1: Cache-aware pricing infrastructure
- [ ] `src/config/llmPricing.ts` — add optional `cachedInputPer1M?: number` to the `ModelPricing` interface.
- [ ] `src/config/llmPricing.ts` — propagate it in the `registryPricing` builder: `...(info.cachedInputPer1M != null && { cachedInputPer1M: info.cachedInputPer1M })`.
- [ ] `src/config/modelRegistry.ts` — add optional `cachedInputPer1M?: number` to the `ModelInfo` interface (so registry entries can declare it).
- [ ] `src/config/llmPricing.ts` — extend `calculateLLMCost` with a 5th optional arg `cachedPromptTokens = 0` (backward-compatible). Logic:
  ```typescript
  // cachedPromptTokens is a subset of promptTokens (the cache-hit portion).
  const cached = pricing.cachedInputPer1M != null
    ? Math.min(cachedPromptTokens, promptTokens) : 0;
  const fullInput = promptTokens - cached;
  const inputCost = (fullInput / 1e6) * pricing.inputPer1M
                  + (cached / 1e6) * (pricing.cachedInputPer1M ?? pricing.inputPer1M);
  ```
  Extend the B021 finite/non-negative guard to cover `cachedPromptTokens`. When `cachedInputPer1M` is undefined (all non-DeepSeek models), `cached=0` → all prompt tokens bill at `inputPer1M` (current behavior preserved exactly).
- [ ] `src/lib/services/llms.ts` (~line 537) — read the cache-hit split from `usage`:
  ```typescript
  const cachedPromptTokens = usage.prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  ```
- [ ] `src/lib/services/llms.ts` (~line 622) — pass it through: `calculateLLMCost(costModel, promptTokens, completionTokens, reasoningTokens, cachedPromptTokens)`. (Pre-flight reservation at ~line 827 keeps `cachedPromptTokens=0` → conservative reservation, correct.)

### Phase 2: Register the two models
- [ ] `src/config/modelRegistry.ts` — add after the existing `deepseek-chat` entry (~line 120):
  ```typescript
  'deepseek-v4-pro': {
    id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', provider: 'deepseek',
    inputPer1M: 1.74, cachedInputPer1M: 0.0145, outputPer1M: 3.48,
    maxTemperature: 2.0, supportsEvolution: true, supportsReasoning: false,
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', provider: 'deepseek',
    inputPer1M: 0.14, cachedInputPer1M: 0.0028, outputPer1M: 0.28,
    maxTemperature: 2.0, supportsEvolution: true, supportsReasoning: false,
  },
  ```
- [ ] Auto-propagation (no edits): `allowedLLMModelSchema`, `LLM_PRICING`, `MODEL_OPTIONS` → all four wizard dropdowns. Module-init invariant passes (no `defaultReasoningEffort`).
- [ ] (Optional, NOT in scope) leave existing `deepseek-chat` pricing untouched.

### Phase 3: Disable thinking for non-reasoning DeepSeek models (`llms.ts`)
- [ ] Export `isDeepSeekModel` (currently private ~line 298).
- [ ] Import `modelSupportsReasoning` from `@/config/modelRegistry`.
- [ ] In `callOpenAIModel`, after the reasoning-effort block (~line 459):
  ```typescript
  // DeepSeek defaults thinking ON. For non-reasoning DeepSeek models, disable it so they
  // behave as plain chat (temperature honored, no CoT tokens billed).
  if (isDeepSeekModel(validatedModel) && !modelSupportsReasoning(validatedModel)) {
    (requestOptions as unknown as Record<string, unknown>).thinking = { type: 'disabled' };
  }
  ```

### Phase 4: Tests
- [ ] Add/extend unit tests (see Testing section).
- [ ] Add E2E dropdown assertion.

### Phase 5: Verify & document
- [ ] Full local checks (lint, tsc, build, unit, ESM, integration, E2E critical).
- [ ] Doc updates (see Documentation Updates).

## Testing

### Unit Tests
- [ ] `src/config/llmPricing.test.ts` —
  - cache-aware calc: `calculateLLMCost('deepseek-v4-pro', 1000, 500, 0, 800)` → input = (200/1e6)·1.74 + (800/1e6)·0.0145, output = (500/1e6)·3.48; assert `toBeCloseTo`.
  - backward-compat: omitting the 5th arg bills all prompt tokens at `inputPer1M`.
  - fallback: a model with no `cachedInputPer1M` (e.g. `gpt-4o`) passed `cachedPromptTokens>0` still bills all input at full rate.
  - guard: negative/non-finite `cachedPromptTokens` throws (B021 extension).
  - `LLM_PRICING['deepseek-v4-pro'].cachedInputPer1M === 0.0145`, flash `=== 0.0028`.
- [ ] `src/config/modelRegistry.test.ts` — `getModelOptions()` "includes new models" test: add `deepseek-v4-pro`/`deepseek-v4-flash`.
- [ ] `src/lib/schemas/schemas.test.ts` — `allowedLLMModelSchema.parse('deepseek-v4-pro')` / flash succeed.
- [ ] `src/lib/services/llms.test.ts` —
  - `isOpenRouterModel('deepseek-v4-pro')`/flash `=== false` (mirror existing deepseek-chat assertion ~line 914).
  - mock a `deepseek-v4-flash` create call → assert request includes `thinking:{type:'disabled'}`.
  - mock a deepseek response with `usage.prompt_cache_hit_tokens` → assert tracked `estimated_cost_usd` reflects the cached rate (lower than the all-miss cost).

### Integration Tests
- [ ] None required — no DB schema change, no new server action. Existing suites must stay green.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — new `adminTest` mirroring the gpt-oss-20b dropdown test (~line 92): assert generation-model `<select>` option values contain `deepseek-v4-pro` and `deepseek-v4-flash`.

### Manual Verification
- [ ] `/admin/evolution/strategies/new` — both models appear in all four dropdowns.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` (local server) — dropdown assertion passes.

### B) Automated Tests
- [ ] `npm run test -- src/config/llmPricing.test.ts src/config/modelRegistry.test.ts src/lib/schemas/schemas.test.ts src/lib/services/llms.test.ts`
- [ ] Full local check trio during `/finalize` (lint + tsc + build + unit + ESM + integration + E2E critical).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — `DEEPSEEK_API_KEY` already documented; verify still correct (likely no change). No new env var.
- [ ] (No new feature deep dive; model registry + pricing are config.) Optionally note the new `cachedInputPer1M` cost field if a pricing/cost doc references the schema.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
