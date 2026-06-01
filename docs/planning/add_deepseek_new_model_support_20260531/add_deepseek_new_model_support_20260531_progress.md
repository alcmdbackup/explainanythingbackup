# Add Deepseek New Model Support Progress

## Phase 1: Cache-aware pricing infrastructure
### Work Done
- Added optional `cachedInputPer1M?` to `ModelInfo` (`src/config/modelRegistry.ts`) and `ModelPricing` (`src/config/llmPricing.ts`), adjacent to `reasoningPer1M`.
- `registryPricing` builder propagates `cachedInputPer1M` via the existing spread-guard pattern.
- Extended `calculateLLMCost` with a 5th optional arg `cachedPromptTokens = 0`: cache-hit subset bills at `cachedInputPer1M`, remainder at `inputPer1M`; `Math.min` clamps over-count; B021 guard extended to reject non-finite/negative cached count. Backward-compatible (no cache rate → existing behavior).

### Issues Encountered
None.

## Phase 2: Thread cached-token count to both cost paths
### Work Done
- 2a (`src/lib/services/llms.ts`): read `usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0`; pass to `calculateLLMCost`; added `cachedPromptTokens?` to `LLMUsageMetadata` and set it in `usageMeta`.
- 2b (evolution gate): added `cachedPromptTokens?` to `RawProviderUsage` (`createEvolutionLLMClient.ts`) and passed `usage.cachedPromptTokens ?? 0` to both gate `calculateLLMCost` calls; threaded through `claimAndExecuteRun.ts` (usage-shape types + `onUsage` capture) and `core/types.ts` rawProvider return type.

### Issues Encountered
None — `npm run typecheck` confirmed the optional field threads cleanly through pass-through types.

## Phase 3: Register the two models
### Work Done
- Added `deepseek-v4-pro` (input 0.435 / cached 0.003625 / output 0.87) and `deepseek-v4-flash` (0.14 / 0.0028 / 0.28) to `MODEL_REGISTRY`, `supportsReasoning:false`, `supportsEvolution:true`, with a `pricing as of 2026-05-31` comment (75% pro cut is permanent). Auto-propagates to allow-list schema, pricing, and the 4 wizard dropdowns.

## Phase 4: Disable thinking for non-reasoning DeepSeek models
### Work Done
- Exported `isDeepSeekModel`; added `modelSupportsReasoning` to the existing modelRegistry import; in `callOpenAIModel`, send `thinking:{type:'disabled'}` for non-reasoning DeepSeek models (guarded so it never reaches other providers).

## Phase 5: Tests
### Work Done
- `llmPricing.test.ts`: cache-aware calc (0.000525), backward-compat, no-cache-rate fallback, over-count clamp, B021 guard; DeepSeek V4 pricing block; `cachedInputPer1M <= inputPer1M` invariant. (34 pass)
- `modelRegistry.test.ts`: dropdown options include both models. `schemas.test.ts`: `allowedLLMModelSchema` accepts both. (215 pass with llms)
- `llms.test.ts`: `isOpenRouterModel` false for both; `thinking:{type:'disabled'}` sent; cache-aware `estimated_cost_usd` (0.00017 < all-miss 0.00028) + `cachedPromptTokens` captured.
- `createEvolutionLLMClient.test.ts`: budget-gate cache-aware billing (0.00017 < 0.00028). (22 pass)
- E2E `admin-strategy-crud.spec.ts`: dropdown includes `deepseek-v4-pro`/`deepseek-v4-flash`.

### Issues Encountered
None. Bare `npx eslint` flagged pre-existing `require()` in unrelated tests; `npm run lint` (authoritative) passes clean.

## Phase 6: Verify & document
### Work Done
- Local: `npm run lint` ✓, `npm run typecheck` ✓, `npm run build` ✓, targeted unit + evolution tests ✓.
- Remaining (handled by /finalize): full unit/ESM/integration/E2E-critical+evolution suites; backup mirror; PR.
- Live pre-merge check (assert `thinking:disabled` suppresses `reasoning_content`; spot-check live prices) — to do before merge.
