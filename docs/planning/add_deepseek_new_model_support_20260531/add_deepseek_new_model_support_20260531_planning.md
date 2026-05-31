# Add Deepseek New Model Support Plan

## Background
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek. The models must be selectable in the evolution strategy-creation UI, priced **cache-aware** for budget tracking (on BOTH the `llmCallTracking` row AND the evolution budget gate), and configured as non-thinking models.

## Requirements (from GH Issue #1155)
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek.

Resolved decisions (see research doc + below):
- Both models register as **non-reasoning** (`supportsReasoning:false`), **thinking OFF** by default.
- Do **not** capture the reasoning trace.
- Explicitly **disable thinking** (`thinking:{type:'disabled'}`) for non-reasoning DeepSeek models.
- No changes to default-model constants.
- **Cache-aware pricing (Option A):** account for DeepSeek's cache-hit vs cache-miss input rates **on every cost path that feeds budget tracking** (plan-review iteration 1 found the evolution gate is a separate path — see Phase 2b).

## Verified Pricing (source: https://api-docs.deepseek.com/quick_start/pricing)
The deepseek-v4-pro 75% promo ends **2026-05-31 15:59 UTC (today)** → use **standard** rates.

| Model | Input cache-hit /1M | Input cache-miss /1M | Output /1M |
|---|---|---|---|
| deepseek-v4-flash | $0.0028 | $0.14 | $0.28 |
| deepseek-v4-pro (standard) | $0.0145 | $1.74 | $3.48 |

`inputPer1M` = cache-miss (full) rate; new `cachedInputPer1M` = cache-hit rate. Both: 1M context, 384K max output. No `reasoningPer1M` (CoT off).

> ⚠️ **MUST-VERIFY before merge:** exact prices and the `usage` field name `prompt_cache_hit_tokens` are from docs/research and not yet confirmed against a live DeepSeek response (`usage` is typed `any`, so a wrong field silently degrades to cache-miss billing — conservative, not a crash). Confirm with one real API call.

## Problem
DeepSeek is already wired (`getDeepSeekClient` → `https://api.deepseek.com`), but only `deepseek-chat` is registered, and our cost model uses a single `inputPer1M` that ignores caching. The cache-hit rate is 50× (flash) / 120× (pro) cheaper than cache-miss, and the evolution pipeline reuses large prompts, so a single rate misprices every call. There are **two independent cost paths**: (1) `src/lib/services/llms.ts:622` → the `llmCallTracking` row; (2) `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:209/217` → `costTracker.recordSpend()`, the **evolution budget gate**. Both must become cache-aware or the gate keeps over-reserving on cache-heavy runs (premature budget exhaustion). Also, DeepSeek defaults thinking ON, so a non-reasoning entry alone still incurs CoT cost unless `llms.ts` sends `thinking:{type:'disabled'}`.

## Options Considered
- [x] **Option A: Cache-aware pricing (both paths) + registry entries + `thinking:disabled` (CHOSEN)**: Extend the cost model, thread the cache-hit token count through to both cost paths, add two registry entries, disable thinking. Accurate budget accounting end-to-end.
- [ ] **Option B: Conservative single (cache-miss) rate, defer cache-aware**: Over-reports up to ~120× on cache-heavy pro calls. Rejected.
- [ ] **Option C: Conservative, no follow-up**: Permanent over-reporting. Rejected.

## calculateLLMCost call-site inventory (verified)
Adding a 5th optional arg `cachedPromptTokens = 0` is backward-compatible (all sites compile unchanged). Sites and intended behavior:
- `src/lib/services/llms.ts:622` (OpenAI-compatible path, incl. DeepSeek) — **thread cached count** (Phase 2a).
- `src/lib/services/llms.ts:761` (Anthropic path) — leave at 0 (DeepSeek never routes here; Anthropic has no `cachedInputPer1M`).
- `src/lib/services/llms.ts:827` (pre-flight reservation) — leave at 0 → conservative over-reserve (correct).
- `evolution/.../createEvolutionLLMClient.ts:209` and `:217` (budget gate) — **thread cached count** (Phase 2b).
- Other sites (`costAnalytics.ts:441`, `oneshotGenerator.ts:*`, `run-evolution-local.ts:*`) — leave at 0; non-DeepSeek or estimation/analytics contexts where `cachedInputPer1M` is undefined → no-op.

## Phased Execution Plan

### Phase 1: Cache-aware pricing infrastructure
- [ ] `src/config/llmPricing.ts` — add optional `cachedInputPer1M?: number` to `ModelPricing`, placed adjacent to `reasoningPer1M` (after the two required price fields) for symmetry.
- [ ] `src/config/modelRegistry.ts` — add optional `cachedInputPer1M?: number` to `ModelInfo`, same placement (next to `reasoningPer1M`).
- [ ] `src/config/llmPricing.ts` — in the `registryPricing` builder, spread it with the existing guard pattern: `...(info.cachedInputPer1M != null && { cachedInputPer1M: info.cachedInputPer1M })`.
- [ ] `src/config/llmPricing.ts` — extend `calculateLLMCost` with 5th optional arg `cachedPromptTokens = 0`:
  ```typescript
  const cached = pricing.cachedInputPer1M != null
    ? Math.min(cachedPromptTokens, promptTokens) : 0;
  const fullInput = promptTokens - cached;
  const inputCost = (fullInput / 1e6) * pricing.inputPer1M
                  + (cached / 1e6) * (pricing.cachedInputPer1M ?? pricing.inputPer1M);
  ```
  Extend the B021 finite/non-negative guard to also reject non-finite/negative `cachedPromptTokens`. When `cachedInputPer1M` is undefined, `cached=0` → all prompt tokens bill at `inputPer1M` (existing behavior byte-for-byte). `Math.min` prevents `cached > prompt` over-counting / negatives.

### Phase 2: Thread the cache-hit token count to BOTH cost paths

#### Phase 2a — `llms.ts` (tracking-row path)
- [ ] `src/lib/services/llms.ts` (~537) — read the split from `usage`:
  ```typescript
  const cachedPromptTokens = usage.prompt_cache_hit_tokens
    ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  ```
- [ ] `src/lib/services/llms.ts` (~622) — pass it: `calculateLLMCost(costModel, promptTokens, completionTokens, reasoningTokens, cachedPromptTokens)`.
- [ ] `src/lib/services/llms.ts` (32-55) — add `cachedPromptTokens?: number` to `LLMUsageMetadata`, and set it in the `usageMeta` object (~651).
- [ ] Note: streaming may not return cache-hit tokens on the final chunk; `?? 0` degrades gracefully to full-rate (conservative). Acceptable for v1.

#### Phase 2b — evolution budget-gate path
- [ ] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` (82-86) — add `cachedPromptTokens?: number` to `RawProviderUsage`.
- [ ] Same file (209, 217) — pass `usage.cachedPromptTokens ?? 0` as the 5th arg to both `calculateLLMCost` calls feeding `costTracker.recordSpend`.
- [ ] `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — add `cachedPromptTokens?: number` to the rawProvider usage shape (the `{ promptTokens; completionTokens; reasoningTokens? }` type at lines 192/193/256), capture it in the `onUsage` callback (214-220) via `cachedPromptTokens: u.cachedPromptTokens`, and include it in the `capturedUsage` fallback (226).
- [ ] Other declarations of the rawProvider usage shape (verified paths): `evolution/src/lib/core/types.ts:169` (the `AgentContext.rawProvider.complete()` return type — the one Agent.ts:130 passes into createEvolutionLLMClient), `evolution/src/lib/pipeline/setup/buildRunContext.ts:197`, `evolution/src/lib/pipeline/loop/runIterationLoop.ts:182`, `evolution/src/lib/pipeline/setup/generateSeedArticle.ts:80`. **These are pass-through-only** (only `createEvolutionLLMClient` reads `usage.*` for cost — grep-confirmed), and an OPTIONAL `cachedPromptTokens?` is return-covariant-compatible, so they compile WITHOUT edits. Add the optional field to `core/types.ts:169` for inventory completeness/clarity; the three pipeline files need no change for correctness (cosmetic only).
- [ ] Confirm `npm run typecheck` passes after threading (backstop for any missed usage-shape declaration).

### Phase 3: Register the two models
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
- [ ] Auto-propagation (no edits): `allowedLLMModelSchema`, `LLM_PRICING`, `MODEL_OPTIONS` → all four wizard dropdowns. Module-init invariant passes (no `defaultReasoningEffort`). Existing `deepseek-chat` pricing left untouched (out of scope).

### Phase 4: Disable thinking for non-reasoning DeepSeek models (`llms.ts`)
- [ ] Export `isDeepSeekModel` (currently private ~line 298): `export function isDeepSeekModel(...)`.
- [ ] Add `modelSupportsReasoning` to the **existing** destructured import from `@/config/modelRegistry` at `src/lib/services/llms.ts:20` (do NOT add a new import line; `modelSupportsReasoning` is already exported at modelRegistry.ts:218).
- [ ] In `callOpenAIModel`, after the reasoning-effort block (~line 459, where `validatedModel` and `requestOptions` are in scope and before the request is sent):
  ```typescript
  // DeepSeek defaults thinking ON. For non-reasoning DeepSeek models, disable it so they
  // behave as plain chat (temperature honored, no CoT tokens billed).
  if (isDeepSeekModel(validatedModel) && !modelSupportsReasoning(validatedModel)) {
    (requestOptions as unknown as Record<string, unknown>).thinking = { type: 'disabled' };
  }
  ```
  Guard ensures it never leaks to non-DeepSeek providers; cast mirrors existing `reasoning`/`reasoning_effort` extra-field pattern (llms.ts:445-456).

### Phase 5: Tests
- [ ] Add/extend unit tests (see Testing section).
- [ ] Add E2E dropdown assertion.

### Phase 6: Verify & document
- [ ] Full local checks (lint, tsc, build, unit, ESM, integration, E2E critical).
- [ ] Doc updates (see Documentation Updates).

## Testing

### Unit Tests
- [ ] `src/config/llmPricing.test.ts` —
  - cache-aware calc: `calculateLLMCost('deepseek-v4-pro', 1000, 500, 0, 800)` = (200/1e6)·1.74 + (800/1e6)·0.0145 + (500/1e6)·3.48 = 0.000348 + 0.0000116 + 0.00174 = **0.0020996 → rounds to 0.0021; assert `toBeCloseTo(0.0021, 6)`** (mirror the o1 test at llmPricing.test.ts:65-70).
  - backward-compat: omitting the 5th arg bills all prompt tokens at `inputPer1M`.
  - fallback: a model without `cachedInputPer1M` (e.g. `gpt-4o`) passed `cachedPromptTokens>0` still bills all input at full rate.
  - guard: negative / non-finite `cachedPromptTokens` throws (B021 extension).
  - `LLM_PRICING['deepseek-v4-pro'].cachedInputPer1M === 0.0145`, flash `=== 0.0028`.
  - invariant (cheap, recommended): for every model with `cachedInputPer1M` set, assert `cachedInputPer1M <= inputPer1M` (sanity given the 120× gap motivating the feature).
- [ ] `src/config/modelRegistry.test.ts` — `getModelOptions()` "includes new models" test: add `deepseek-v4-pro`/`deepseek-v4-flash`.
- [ ] `src/lib/schemas/schemas.test.ts` — `allowedLLMModelSchema.parse('deepseek-v4-pro')` / flash succeed.
- [ ] `src/lib/services/llms.test.ts` — **all new deepseek tests must set `process.env.DEEPSEEK_API_KEY='test-deepseek-key'`** (the `beforeEach` at ~line 71 resets env to OPENAI/SUPABASE only; without this `getDeepSeekClient()` at ~277 throws). Mirror the OpenRouter env pattern at ~line 922.
  - `isOpenRouterModel('deepseek-v4-pro')`/flash `=== false` (mirror existing deepseek-chat assertion ~line 914).
  - mock a `deepseek-v4-flash` create call → assert request includes `thinking:{type:'disabled'}` (capture via `mockCreateSpy.mock.calls[0][0]`, pattern at ~line 1038).
  - mock a deepseek response whose `usage` includes `prompt_cache_hit_tokens` AND whose `model` field is `'deepseek-v4-flash'` (cost uses `costModel = modelUsed` from `completion.model`, llms.ts:617/532 — a blank/wrong model falls back to DEFAULT_PRICING and the assertion would pass for the wrong reason). Assert tracked `estimated_cost_usd` reflects the cached rate (lower than all-miss). Use the `estimated_cost_usd` assertion pattern at ~line 680.
- [ ] `evolution` budget-gate cache-awareness: add a `createEvolutionLLMClient` test asserting that a `RawProviderUsage` with `cachedPromptTokens` produces a `recordSpend`/`getTotalSpent()` amount using the cached rate (lower than all-miss). **Mirror `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts:181-231` (the "Bug A regression" test)** — it mocks a provider returning `usage:{promptTokens,completionTokens}` and asserts `ct.getTotalSpent()` via `toBeCloseTo`; add `cachedPromptTokens` to the mocked usage for a `deepseek-v4-flash` variant.

### Integration Tests
- [ ] None required — no DB schema change, no new server action. Existing suites must stay green (evolution integration suites exercise the cost path; confirm no regression).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — new `adminTest` mirroring the gpt-oss-20b dropdown test (~line 92): read generation-model `<select>` option **values** via `evaluateAll` (stable-selector compliant, no nth-child) and assert they contain `deepseek-v4-pro` and `deepseek-v4-flash`. (Spec already has the required `afterAll` cleanup ~lines 22-45; new test creates no data, so cleanup rule is satisfied.)

### Manual Verification
- [ ] `/admin/evolution/strategies/new` — both models appear in all four dropdowns.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` (local server) — dropdown assertion passes.

### B) Automated Tests
- [ ] `npm run test -- src/config/llmPricing.test.ts src/config/modelRegistry.test.ts src/lib/schemas/schemas.test.ts src/lib/services/llms.test.ts`
- [ ] `npm run test:integration` (evolution cost path) + full local check trio during `/finalize` (lint + tsc + build + unit + ESM + integration + E2E critical).
- [ ] **CI full-path note:** this PR touches `src/**` AND `evolution/**` and adds an `@evolution`-tagged admin spec (ci.yml classifies `09-admin/**` as evolution), so CI runs `integration-evolution` + `integration-non-evolution` and `e2e-evolution` + `e2e-non-evolution`. Run `npm run test:integration:evolution` and `npm run test:e2e:evolution` locally before push so the new dropdown spec (which runs under e2e-evolution, not e2e-critical) isn't silently unverified.

## Rollback
Config-additive change: revert by removing the two `MODEL_REGISTRY` entries, the optional `cachedInputPer1M` field, the `thinking:disabled` branch, and the `cachedPromptTokens` threading. No DB migration, no data backfill, no env change — fully revertable by reverting the PR.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/environments.md` — `DEEPSEEK_API_KEY` already documented; verify still correct (likely no change). No new env var.
- [ ] `evolution/docs/cost_optimization.md` — if it documents the `ModelPricing` shape or cost-attribution fields, note the new `cachedInputPer1M` field and that DeepSeek cost is now cache-aware on the budget-gate path.

## Review & Discussion
### Iteration 1 (Security 2/5, Architecture 4/5, Testing 4/5)
Critical gaps fixed:
- **[Security] Evolution budget gate not cache-aware** — the gate bills via `createEvolutionLLMClient.ts:209/217` (separate from `llms.ts:622`). Added Phase 2b threading `cachedPromptTokens` through `LLMUsageMetadata` → `onUsage` (claimAndExecuteRun.ts) → `RawProviderUsage` → the gate's `calculateLLMCost` calls; added the calculateLLMCost call-site inventory.
- **[Security] Incomplete call-site sweep** — added the verified inventory of all `calculateLLMCost` sites stating which thread the cached count vs. intentionally stay at 0 (incl. Anthropic :761 and pre-flight :827).
- **[Testing] Tests throw without `DEEPSEEK_API_KEY`** — new llms.test.ts deepseek tests now set `process.env.DEEPSEEK_API_KEY`; cost test pins the mock `model` field and expected value (0.00211).
Minor fixes folded in: augment existing modelRegistry import (not a new line); field placement adjacent to `reasoningPer1M`; `cachedInputPer1M <= inputPer1M` invariant test; streaming fallback note; rollback section; MUST-VERIFY note on field name/prices.

### Iteration 2 (Security 5/5, Architecture 5/5, Testing 4/5)
Critical gap fixed:
- **[Testing] Wrong expected value in the cache-aware cost test** — corrected to `0.0020996 → 0.0021` (`toBeCloseTo(0.0021, 6)`); the prior `0.00211` would have failed.
Minor fixes folded in: corrected Phase 2b usage-shape paths (`core/types.ts:169`, `setup/buildRunContext.ts`, `loop/runIterationLoop.ts`, `setup/generateSeedArticle.ts`) and noted they are pass-through-only (no edit needed for correctness); cited the concrete evolution-gate test mirror (`createEvolutionLLMClient.test.ts:181-231`); added CI full-path note (runs e2e-evolution / integration-evolution).
