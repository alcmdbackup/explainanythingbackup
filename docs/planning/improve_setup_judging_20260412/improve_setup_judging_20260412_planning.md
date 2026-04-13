# Improve Setup Judging Plan

## Background
Improve the evolution pipeline's setup and judging by adding cheap judge models (Qwen 8B, Google Gemini, GPT-5 Nano), centralizing model configuration into a registry with max temperature validation, setting judge temperature to 0, adding configurable generation temperature to strategy config, and changing OpenSkill beta to 0.

## Requirements (from GH Issue #961)
- Change beta to 0 in my Openskill implementation
- I want to speed up judging for evolution. Add want to add two models - Qwen 8b, a Google one. Both cost around $.10 per M input or less. Help me find these actual models and add support for these in my evolution system, including in model dropdown list on strategy creation.
- Refactor to consolidate my model information into a central model registry.
    - Add my 2 new models to this registry
    - Add maximum temperature into this model registry
- Set temperature to 0 for all models when they are used as judges
- Add the ability to configure (optionally) a generation temperature for generation models, from the strategy config. Make sure to find the max temperature for all of our available models and add them to our model registry, to validate the user's input from the strategy creation screen to make sure temp is a valid value.

## Problem
The evolution pipeline lacks cheap judge model options (cheapest current judge is gpt-4.1-nano at $0.10/M), model metadata is scattered across 3+ files making new model additions error-prone, temperature is not configurable (neither for judges nor generators), and OpenSkill uses a default beta that adds unnecessary performance variability noise to text quality ratings, slowing convergence. The default judge model should be the cheapest viable option (`qwen/qwen3-8b` at $0.05/M).

## New Models to Add

| Model | ID | Input $/M | Output $/M | Provider | Context |
|-------|----|-----------|------------|----------|---------|
| GPT-5 Nano | `gpt-5-nano` | $0.05 | $0.40 | OpenAI direct | 400K |
| Gemini 2.5 Flash Lite | `google/gemini-2.5-flash-lite` | $0.10 | $0.40 | OpenRouter | 1M |
| Qwen3 8B | `qwen/qwen3-8b` | $0.05 | $0.40 | OpenRouter | 40K |

## Options Considered
- [x] **Option A: Central model registry + temperature threading**: Create `src/config/modelRegistry.ts` as single source of truth for all model metadata (pricing, max temp, provider, display name). Derive existing schemas and pricing from it. Thread temperature through `callLLM` chain. — **Selected**: cleanest approach, makes adding future models trivial.
- [ ] **Option B: Minimal additions only**: Just add models to existing scattered files, add temperature as a separate concern. — Rejected: doesn't address the fragmentation problem, more files to touch per new model.
- [ ] **Option C: Provider-specific registries**: One registry per provider (OpenAI, OpenRouter, Anthropic). — Rejected: over-engineered for 16 models, splits a naturally unified concern.

## Phased Execution Plan

### Phase 1: Central Model Registry
Create a single source of truth for all model metadata, then migrate consumers to use it.

- [ ] Create `src/config/modelRegistry.ts` with a `MODEL_REGISTRY` map keyed by model ID containing:
  - `id: string` — exact API model ID
  - `displayName: string` — human-readable name for UI
  - `provider: 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'local'`
  - `inputPer1M: number` — input price per 1M tokens
  - `outputPer1M: number` — output price per 1M tokens
  - `reasoningPer1M?: number` — reasoning token price (o1/o3 models)
  - `maxTemperature: number | null` — null means temperature not supported (e.g., o3-mini)
  - `supportsEvolution: boolean` — whether it appears in the evolution model dropdown
  - `openRouterModelId?: string` — the model ID to send to OpenRouter API (e.g., `qwen/qwen3-8b` stays as-is, `gpt-oss-20b` becomes `openai/gpt-oss-20b`)
- [ ] Populate registry with all 16 models (13 existing + 3 new). Note: `gpt-5-nano` is new, existing models that remain are the other 13 from the current `allowedLLMModelSchema`:

  | Model ID | Display Name | Provider | In $/M | Out $/M | Max Temp |
  |----------|-------------|----------|--------|---------|----------|
  | `gpt-4o` | GPT-4o | openai | 2.50 | 10.00 | 2.0 |
  | `gpt-4o-mini` | GPT-4o Mini | openai | 0.15 | 0.60 | 2.0 |
  | `gpt-4.1` | GPT-4.1 | openai | 2.00 | 8.00 | 2.0 |
  | `gpt-4.1-mini` | GPT-4.1 Mini | openai | 0.40 | 1.60 | 2.0 |
  | `gpt-4.1-nano` | GPT-4.1 Nano | openai | 0.10 | 0.40 | 2.0 |
  | `gpt-5.2` | GPT-5.2 | openai | 1.75 | 14.00 | 2.0 |
  | `gpt-5.2-pro` | GPT-5.2 Pro | openai | 3.50 | 28.00 | 2.0 |
  | `gpt-5-mini` | GPT-5 Mini | openai | 0.25 | 2.00 | 2.0 |
  | `gpt-5-nano` | GPT-5 Nano | openai | 0.05 | 0.40 | 2.0 |
  | `o3-mini` | o3-mini | openai | 1.10 | 4.40 | null |
  | `deepseek-chat` | DeepSeek Chat | deepseek | 0.28 | 0.42 | 2.0 |
  | `claude-sonnet-4-20250514` | Claude Sonnet 4 | anthropic | 3.00 | 15.00 | 1.0 |
  | `gpt-oss-20b` | GPT-OSS 20B | openrouter | 0.03 | 0.14 | 2.0 |
  | `LOCAL_qwen2.5:14b` | Qwen 2.5 14B (Local) | local | 0.00 | 0.00 | 2.0 |
  | `google/gemini-2.5-flash-lite` | Gemini 2.5 Flash Lite | openrouter | 0.10 | 0.40 | 2.0 |
  | `qwen/qwen3-8b` | Qwen3 8B | openrouter | 0.05 | 0.40 | 2.0 |

- [ ] Refactor `src/config/llmPricing.ts`:
  - Keep `LLM_PRICING` for non-registry versioned model entries (e.g., `gpt-4o-2024-11-20`) used for prefix matching
  - Import registry entries into `LLM_PRICING` so registry is the source of truth for allowed models
  - `getModelPricing()` checks registry first, then falls back to `LLM_PRICING` prefix matching
- [ ] Refactor `src/lib/schemas/schemas.ts`:
  - Derive `allowedLLMModelSchema` from registry keys where `supportsEvolution: true`
  - Export helper: `getModelMaxTemperature(modelId: string): number | null`
- [ ] Refactor `src/lib/utils/modelOptions.ts`:
  - Derive `MODEL_OPTIONS` from registry (use `displayName` for label, `id` for value)
- [ ] Refactor `src/lib/services/llms.ts`:
  - Replace `isOpenRouterModel()` exact-match with registry lookup: `getModelInfo(model).provider === 'openrouter'`
  - Use `openRouterModelId` from registry for API model name transformation (line 300-301)
  - Keep `isDeepSeekModel()`, `isAnthropicModel()`, `isLocalModel()` as derived from registry provider field
- [ ] Add startup validation: assert registry has >= 1 model, >= 1 evolution model. Use `z.enum([...keys] as [string, ...string[]])` to guarantee non-empty enum at compile time.
- [ ] Add unit test: slashed model IDs (`qwen/qwen3-8b`, `google/gemini-2.5-flash-lite`) round-trip through Zod parse + JSON serialize/deserialize
- [ ] Grep all `MODEL_OPTIONS` imports — update consumers (`strategies/page.tsx`, `ExperimentForm.tsx`) to use `{ label, value }` shape directly (remove `.map()` wrappers)
- [ ] Run lint, tsc, build; update existing tests in `llmPricing.test.ts` and `llms.test.ts`

### Phase 2: Add 3 New Models
Add `gpt-5-nano`, `google/gemini-2.5-flash-lite`, and `qwen/qwen3-8b` to the system.

- [ ] Add all 3 models to `MODEL_REGISTRY` in `src/config/modelRegistry.ts` (done in Phase 1 table above)
- [ ] For OpenRouter models (`google/gemini-2.5-flash-lite`, `qwen/qwen3-8b`):
  - These use `provider/model` format natively — set `openRouterModelId` to the model ID as-is (no prefix transformation needed, unlike `gpt-oss-20b` which needs `openai/` prefix)
  - Ensure `isOpenRouterModel()` (now registry-based) recognizes them
- [ ] For `gpt-5-nano`: already routed through OpenAI client, just needs schema + pricing entries (handled by registry)
- [ ] Set `qwen/qwen3-8b` as the default judge model:
  - In `src/app/admin/evolution/strategies/page.tsx`: set `judgeModel` field default value to `'qwen/qwen3-8b'`
  - In `src/config/modelRegistry.ts`: add `defaultJudge: true` flag (or export `DEFAULT_JUDGE_MODEL` constant)
- [ ] Verify all 3 models appear in the strategy creation dropdown
- [ ] Run lint, tsc, build; add pricing test cases for new models

### Phase 3: OpenSkill Beta = 0
Set beta to 0 for faster convergence in rating updates.

- [ ] In `evolution/src/lib/shared/computeRatings.ts`:
  - Line 38: Change `osRate([[winner], [loser]], { rank: [1, 2] })` → `osRate([[winner], [loser]], { rank: [1, 2], beta: 0 })`
  - Line 50: Change `osRate([[a], [b]], { rank: [1, 1] })` → `osRate([[a], [b]], { rank: [1, 1], beta: 0 })`
- [ ] Do NOT change the local `BETA` constants in `rankSingleVariant.ts` (line 26) and `swissPairing.ts` (line 16) — those are for Bradley-Terry win-probability calculations, unrelated to openskill's beta
- [ ] Run lint, tsc; update `computeRatings.test.ts` and `computeRatings.property.test.ts`
- [ ] Add empirical beta=0 test: run 10 matches with beta=0 and verify sigma decreases faster than with default beta (same match sequence)
- [ ] Add property test: with beta=0, winner mu after N matches >= winner mu with default beta (same outcomes) — validates faster convergence claim

### Phase 4: Temperature Support
Thread temperature through the LLM call chain, set judge temp to 0, and add configurable generation temp.

**Step 4a: Add temperature to callLLM chain**
- [ ] In `src/lib/services/llms.ts`:
  - Add `temperature?: number` to `CallLLMOptions` interface
  - In `callOpenAIModel()` (line 304-319): add `temperature` to `requestOptions`. **Guard**: `if (temperature !== undefined && getModelMaxTemperature(model) !== null) { requestOptions.temperature = Math.min(temperature, getModelMaxTemperature(model)!) }` — use `!== undefined` not truthiness (temperature=0 is valid), skip entirely if maxTemp is null (o3-mini)
  - In `callAnthropicModel()` (line 485-509): add `temperature` to message params. Same guard: `if (temperature !== undefined && getModelMaxTemperature(model) !== null) { params.temperature = Math.min(temperature, getModelMaxTemperature(model)!) }` — clamps to per-model max from registry (1.0 for Claude)
  - Thread `options.temperature` through `callLLMModelRaw()` → `routeLLMCall()` → provider functions
- [ ] Run lint, tsc; update `llms.test.ts`

**Step 4b: Set judge temperature to 0 in evolution**
- [ ] In `evolution/src/lib/pipeline/claimAndExecuteRun.ts` (lines 160-174):
  - Modify the `llmProvider` wrapper to accept temperature from options
  - The wrapper calls `callLLM()` — pass `temperature` in the `CallLLMOptions` (last param)
- [ ] In `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`:
  - Add `temperature?: number` to `LLMCompletionOptions` in `evolution/src/lib/types.ts`
  - Thread temperature through `rawProvider.complete()` opts
- [ ] In `evolution/src/lib/pipeline/claimAndExecuteRun.ts` llmProvider:
  - When `label === 'ranking'` (or `opts.taskType === 'comparison'`), set `temperature: 0`
  - When `label === 'generation'` or `'seed_title'` or `'seed_article'`, use `config.generationTemperature ?? undefined` (provider default)

**Step 4c: Add generationTemperature to StrategyConfig**
- [ ] In `evolution/src/lib/schemas.ts` — `strategyConfigSchema` (line 321):
  - Add `generationTemperature: z.number().min(0).max(2).optional()`
  - Add `.refine()` to validate temp <= model's maxTemperature using registry lookup
- [ ] In `evolution/src/lib/schemas.ts` — `evolutionConfigSchema` (line 354):
  - Add `generationTemperature: z.number().min(0).max(2).optional()`
- [ ] In `evolution/src/services/strategyRegistryActions.ts` — `createStrategySchema` (line 32):
  - Add `generationTemperature: z.number().min(0).max(2).optional()`
- [ ] In `evolution/src/services/strategyRegistryActions.ts` — `createStrategyAction` config object (line 114):
  - Add `generationTemperature: parsed.generationTemperature`
- [ ] In `evolution/src/lib/pipeline/setup/buildRunContext.ts` — EvolutionConfig construction (line 178):
  - Add `generationTemperature: stratConfig.generationTemperature`

**Step 4d: Add generationTemperature to strategy creation UI**
- [ ] In `src/app/admin/evolution/strategies/page.tsx` — `createFields` array:
  - Add field: `{ name: 'generationTemperature', label: 'Generation Temperature', type: 'number', placeholder: 'Default (provider default)' }`
- [ ] In `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx`:
  - Display `generationTemperature` in the Execution column (alongside iterations, budget, etc.)
- [ ] Add client-side validation: if model is selected, validate temp <= maxTemperature from registry
- [ ] Run lint, tsc, build; update strategy registry tests

## Testing

### Unit Tests
- [ ] `src/config/modelRegistry.test.ts` — new file: registry completeness (all required fields present), getModelInfo correctness, provider routing, slashed ID round-trip through Zod+JSON, non-empty evolution model set, contract test (every entry has id/displayName/provider/pricing/maxTemperature/supportsEvolution)
- [ ] `src/config/llmPricing.test.ts` — update: verify registry-derived pricing matches, test new model pricing (gpt-5-nano, gemini-2.5-flash-lite, qwen3-8b)
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — update: verify beta=0 is passed, test that ratings update more aggressively
- [ ] `evolution/src/lib/shared/computeRatings.property.test.ts` — update: property tests should still pass with beta=0
- [ ] `src/lib/services/llms.test.ts` — update: test temperature threading for OpenAI and Anthropic calls, test new OpenRouter model routing, test that o3-mini calls do NOT include temperature param, test isOpenRouterModel returns true for all OpenRouter registry models
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — update: test generationTemperature field in create/read/update, test Zod .refine() rejects temp > model maxTemp (e.g., 2.5 for a max-2.0 model), rejects any temp for o3-mini (maxTemp=null)
- [ ] `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — update: test that llmProvider sets temperature=0 when label==='ranking', passes config generationTemperature when label==='generation'
- [ ] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts` — update: test temperature threading through to rawProvider.complete()

### Integration Tests
- [ ] `src/__tests__/integration/evolution-pipeline.integration.test.ts` — verify temperature flows through to LLM calls in a mock pipeline run

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — verify new models appear in dropdown, verify generationTemperature field works in strategy creation form
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — verify new models visible, temperature displayed in config

### Manual Verification
- [ ] Create a strategy with `qwen/qwen3-8b` as judge and verify it appears in the dropdown
- [ ] Create a strategy with `generationTemperature: 0.5` and verify it displays correctly
- [ ] Verify strategy config display shows temperature value

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — verify model dropdown includes new models
- [ ] Run `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — verify strategy list and config display

### B) Automated Tests
- [ ] `npm run test -- --testPathPattern modelRegistry` — new registry tests
- [ ] `npm run test -- --testPathPattern llmPricing` — pricing tests with registry
- [ ] `npm run test -- --testPathPattern computeRatings` — beta=0 rating tests
- [ ] `npm run test -- --testPathPattern llms.test` — temperature threading tests
- [ ] `npm run test -- --testPathPattern strategyRegistryActions` — strategy config tests
- [ ] `npm run lint && npm run typecheck && npm run build` — full build verification

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/rating_and_comparison.md` — document beta=0 change and faster convergence implications
- [ ] `evolution/docs/strategies_and_experiments.md` — document `generationTemperature` field in StrategyConfig
- [ ] `evolution/docs/cost_optimization.md` — add new model pricing to the LLM pricing table
- [ ] `evolution/docs/reference.md` — add new models to supported models list, document temperature behavior
- [ ] `evolution/docs/agents/overview.md` — document judge temperature=0, generation temperature configurable
- [ ] `evolution/docs/architecture.md` — document temperature threading in LLM adapter, model registry
- [ ] `evolution/docs/minicomputer_deployment.md` — no new env vars needed (uses existing OPENROUTER_API_KEY)

## Files Modified (Complete List)

| File | Changes |
|------|---------|
| `src/config/modelRegistry.ts` | **NEW** — central model registry |
| `src/config/modelRegistry.test.ts` | **NEW** — registry tests |
| `src/config/llmPricing.ts` | Refactor to import from registry |
| `src/config/llmPricing.test.ts` | Update for registry integration |
| `src/lib/schemas/schemas.ts` | Derive allowedLLMModelSchema from registry |
| `src/lib/utils/modelOptions.ts` | Derive MODEL_OPTIONS from registry with display names |
| `src/lib/services/llms.ts` | Registry-based routing, temperature threading |
| `src/lib/services/llms.test.ts` | Temperature + routing tests |
| `evolution/src/lib/shared/computeRatings.ts` | beta=0 in osRate calls |
| `evolution/src/lib/shared/computeRatings.test.ts` | beta=0 tests |
| `evolution/src/lib/shared/computeRatings.property.test.ts` | Verify properties hold with beta=0 |
| `evolution/src/lib/types.ts` | Add temperature to LLMCompletionOptions |
| `evolution/src/lib/schemas.ts` | Add generationTemperature to strategyConfigSchema + evolutionConfigSchema |
| `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` | Thread temperature through |
| `evolution/src/lib/pipeline/claimAndExecuteRun.ts` | Judge temp=0, generation temp=configurable |
| `evolution/src/lib/pipeline/setup/buildRunContext.ts` | Map generationTemperature to EvolutionConfig |
| `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` | No change (temperature NOT in hash — same model+iterations = same strategy). **Known limitation**: two strategies differing only by temperature share a hash; to A/B test temperatures, use different strategy names with identical model+iterations. |
| `evolution/src/services/strategyRegistryActions.ts` | Add generationTemperature to create schema + action |
| `evolution/src/services/strategyRegistryActions.test.ts` | Test generationTemperature field |
| `src/app/admin/evolution/strategies/page.tsx` | Add generationTemperature form field |
| `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` | Display generationTemperature |

## Review & Discussion

### Iteration 1 (Scores: Security 3/5, Architecture 4/5, Testing 3/5)

**Critical gaps identified and resolved:**

1. **[Security] o3-mini temperature incompatibility** — o3-mini rejects the `temperature` parameter entirely. 
   **Fix**: In Step 4a, when building `requestOptions` in `callOpenAIModel()`, check `maxTemperature` from registry: if `null`, do NOT include `temperature` in the request at all. This covers o3-mini and any future models that don't support temperature.

2. **[Security] Slashed model IDs (qwen/qwen3-8b)** — IDs with `/` propagate to Zod enums, JSONB storage, and code paths.
   **Fix**: Zod `z.enum()` accepts arbitrary strings (no slash issue). PostgreSQL JSONB stores/retrieves strings verbatim. Grep codebase for any `model.split('/')` or URL-path construction from model IDs — verified: `isOpenRouterModel()` uses exact equality, no splitting. OpenRouter API expects the slashed format. The `openRouterModelId` field in registry explicitly handles the API-facing model name. Add to Phase 1: a unit test asserting slashed model IDs round-trip through Zod parse + JSON serialize/deserialize.

3. **[Security] Default judge reliability (qwen3-8b via OpenRouter)** — OpenRouter availability is less guaranteed than direct APIs.
   **Fix**: The default is only a UI pre-fill for the strategy creation form. Users can always choose a different model. If OpenRouter is down at runtime, the existing retry logic (3 attempts, exponential backoff) in `createEvolutionLLMClient.ts` handles transient failures. No automatic fallback needed — the run fails with a clear error, and the user can re-run or switch judges.

4. **[Security] Registry corruption crashes app at import time** — empty or malformed registry produces a zero-member Zod enum.
   **Fix**: Add to Phase 1: registry validation at module load — `if (Object.keys(MODEL_REGISTRY).length === 0) throw new Error(...)`. Also add a unit test that the registry always has >= 1 model with `supportsEvolution: true`. The Zod enum derivation uses `z.enum([...keys] as [string, ...string[]])` which TypeScript enforces has at least one element.

5. **[Architecture] MODEL_OPTIONS shape change from string[] to {label, value}[]** — breaking interface change.
   **Fix**: Grep all imports of `MODEL_OPTIONS` during Phase 1. Currently imported in: `modelOptions.ts` (definition), `strategies/page.tsx` (dropdown), `ExperimentForm.tsx` (dropdown). Both UI consumers already wrap it as `MODEL_OPTIONS.map(m => ({ label: m, value: m }))`. The registry change will export `MODEL_OPTIONS` as `Array<{ label: string; value: string }>` directly, and the UI consumers can use it without `.map()`. Update both consumers in Phase 1. Add to Phase 1 checklist: grep all MODEL_OPTIONS imports and update each.

6. **[Architecture] Slashed model IDs in z.enum and DB** — already addressed in gap #2 above. Zod and JSONB handle slashes fine. Added unit test.

7. **[Testing] No integration test for new OpenRouter models** — routing and API compatibility unverified.
   **Fix**: Add to Testing section: a unit test in `llms.test.ts` that verifies `isOpenRouterModel()` returns true for all OpenRouter registry models and false for non-OpenRouter models. For real API compatibility, rely on E2E tests creating strategies with the new models. No real-API integration test needed (OpenRouter is mocked in integration tests just like OpenAI).

8. **[Testing] No before/after empirical validation for beta=0** — behavioral change needs comparison.
   **Fix**: Add to Phase 3 testing: a unit test that runs 10 matches with beta=0 and verifies sigma decreases faster than with default beta (using the same match sequence). Also add a property test: with beta=0, winner mu after N matches is always >= winner mu with default beta (for the same match outcomes). This validates the "faster convergence" claim empirically in the test suite.

9. **[Testing] No registry contract/snapshot test** — registry shape consumed by multiple modules.
   **Fix**: Add to `modelRegistry.test.ts`: a test that verifies every registry entry has all required fields (id, displayName, provider, inputPer1M, outputPer1M, maxTemperature, supportsEvolution). Also test that `getEvolutionModels()` returns a non-empty array and every returned ID is a valid string. This catches registry corruption before it hits consumers.
