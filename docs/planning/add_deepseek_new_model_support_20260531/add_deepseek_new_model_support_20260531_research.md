# Add Deepseek New Model Support Research

## Problem Statement
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek. The models must be selectable in the evolution strategy-creation UI, and the codebase must know whether each is a thinking (reasoning) or non-thinking model so they can be configured appropriately in the model registry.

## Requirements (from GH Issue #1155)
Add direct API integration support for deepseek-v4-pro and deepseek-v4-flash using direct API integration with deepseek.

Expanded scope (from /research directive):
- Determine whether each model is a thinking or non-thinking model and configure it correctly in the config.
- Add both models to the model-selection dropdown in the evolution admin dashboard / strategy creation wizard.
- Use the existing direct DeepSeek API integration path (no OpenRouter).

## High Level Summary
The integration is **mostly a registry change, not a new client**. DeepSeek is already wired: `src/lib/services/llms.ts` has `getDeepSeekClient()` pointing at `https://api.deepseek.com` (OpenAI-compatible SDK), routed by `isDeepSeekModel()` (prefix `deepseek-`). Any `deepseek-v4-*` ID routes there automatically.

`src/config/modelRegistry.ts` (`MODEL_REGISTRY`) is the **single source of truth**. Adding two entries auto-propagates to:
- the zod allow-list `allowedLLMModelSchema` (derived via `getEvolutionModelIds()`),
- pricing `LLM_PRICING` (derived via `registryPricing`),
- the UI dropdown list `MODEL_OPTIONS` (derived via `getModelOptions()`),

which feeds **all four** model `<select>`s in the strategy-creation wizard. **No database migration** is required — model columns (`evolution_variants.model`, `llmCallTracking.model`, etc.) are plain `TEXT` with no CHECK/enum constraint.

The real work beyond "add two registry entries" depends on whether we want **reasoning ("thinking") support** wired end-to-end. Both models are **dual-mode** (thinking ON by default, toggle via a `thinking` body param). If we register either as a reasoning model, there are concrete gaps in `llms.ts` (no DeepSeek branch for reasoning-effort, no reader for DeepSeek's `reasoning_content` trace, no `thinking` toggle mechanism). If we register both as plain chat models, the dropdown + routing + cost tracking all work with just the registry edit — but a DeepSeek model left "non-reasoning" will still think internally unless we send `thinking:{type:'disabled'}`.

⚠️ **Verification debt:** the web-research findings (exact model IDs existing, pricing, a 75%-off promo "ending 2026-05-31 15:59 UTC" = today) are partly self-contradictory and could be model-hallucinated despite citing api-docs.deepseek.com. Treat model existence, exact IDs, and pricing as **MUST-VERIFY against the live `/models` endpoint or a real test call** before merge.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md — `DEEPSEEK_API_KEY` is a shared repo CI secret + required env var (already provisioned for the evolution pipeline).
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs
- (none added — standard docs only per project request)

## Code Files Read
- `src/config/modelRegistry.ts` — `MODEL_REGISTRY`, `ModelInfo` interface, helpers (`getEvolutionModelIds`, `getModelOptions`, `getModelDefaultReasoningEffort`, `modelSupportsReasoning`, `isOpenRouterModel`), module-init invariant (`supportsReasoning` ↔ `defaultReasoningEffort`). Existing `deepseek-chat` entry at lines 116-120.
- `src/config/llmPricing.ts` — `registryPricing` derived from registry; `calculateLLMCost` (input+output+optional reasoning).
- `src/lib/services/llms.ts` — DeepSeek client (269-296), `isDeepSeekModel` (298, private), routing (876-891), reasoning-effort request block (435-459), reasoning-trace extraction (541-615), token read (537-539), JSON-mode handling (461-467), streaming loop (502-526).
- `src/lib/schemas/schemas.ts` — `allowedLLMModelSchema` (74-78, dynamic enum), `llmCallTrackingSchema` (`reasoning_tokens` optional).
- `src/lib/utils/modelOptions.ts` — `MODEL_OPTIONS` = `getModelOptions()`.
- `src/app/admin/evolution/strategies/new/page.tsx` — the 4 model dropdowns (generation 882-892, judge 896-906, editing 913-924, approver 929-940), all consuming `MODEL_OPTIONS`.
- `src/app/admin/evolution-dashboard/page.tsx` — confirmed **no** model selector here.
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — hardcoded `'deepseek-chat'` default (line 198).
- `evolution/src/lib/config/promptBankConfig.ts` — seed/benchmark configs referencing `deepseek-chat`.
- Tests: `src/config/modelRegistry.test.ts`, `src/lib/schemas/schemas.test.ts`, `src/config/llmPricing.test.ts`, `src/lib/services/llms.test.ts`, `evolution/src/lib/schemas.test.ts`, `evolution/src/services/strategyPreviewActions.test.ts`, E2E `09-admin/admin-strategy-crud.spec.ts` + `admin-strategy-wizard.spec.ts`.

## Key Findings

1. **Single source of truth = `MODEL_REGISTRY`.** Adding two entries with `supportsEvolution: true` auto-flows to the allow-list schema, pricing, and all four wizard dropdowns. No component edits, no schema edit, no migration.

2. **DeepSeek routing already exists.** `routeLLMCall` → `callOpenAIModel` → `getDeepSeekClient` (base `https://api.deepseek.com`, OpenAI-compatible, `maxRetries:0`, 60s timeout). New `deepseek-v4-*` IDs route automatically via the `deepseek-` prefix.

3. **"Dashboard dropdown" does not exist as a separate surface.** The evolution dashboard (`/admin/evolution-dashboard`) has no model selector. The model `<select>`s live in the **strategy creation wizard** (`/admin/evolution/strategies/new`): Generation, Judge, Editing, Approver — all fed by the shared `MODEL_OPTIONS`. This wizard is the surface the requirement refers to. (Generation/Judge use `id="generation-model"`/`#judge-model`; Editing/Approver have `data-testid`.)

4. **Both models are dual-mode (thinking + non-thinking), thinking ON by default.** Per DeepSeek docs (unverified — see caveat): thinking is toggled with body param `thinking:{type:'enabled'|'disabled'}`; `reasoning_effort` accepts `'high'|'max'` (`low`/`medium` coerced to `high`); chain-of-thought returns in `message.reasoning_content` (and `delta.reasoning_content` when streaming); reasoning-token count in `usage.completion_tokens_details.reasoning_tokens`. Legacy `deepseek-chat`/`deepseek-reasoner` are said to alias v4-flash's non-thinking/thinking modes (both deprecating).

5. **The registry's single `supportsReasoning` boolean cannot express "dual-mode."** A model is registered as either reasoning or not. Practical options:
   - Register `deepseek-v4-pro` as reasoning (`supportsReasoning:true`, `defaultReasoningEffort:'high'`) and `deepseek-v4-flash` as non-reasoning (`supportsReasoning:false`).
   - Or register both non-reasoning (simplest; dropdown + routing + cost work immediately).
   - **Gotcha:** a DeepSeek model registered as non-reasoning will STILL think internally (default-on) unless `llms.ts` sends `thinking:{type:'disabled'}` — which it currently never does.

6. **`llms.ts` gaps if we wire reasoning (file:line):**
   - **Reasoning-effort block (435-459):** DeepSeek falls into the OpenAI `else` branch, which sets `reasoning_effort` (DeepSeek accepts this) plus `reasoning:{summary:'auto'}` (DeepSeek ignores unknown fields — harmless but messy). Needs a `isDeepSeekModel` branch to (a) map effort to `'high'|'max'`, (b) send `thinking:{type:'disabled'}` for non-reasoning.
   - **Trace extraction (541-615):** **No DeepSeek branch.** DeepSeek falls into the OpenAI `else` looking for `message.reasoning`/`output[].summary`, which DeepSeek does not return → trace silently set `'unavailable'`. Need a branch reading `message.reasoning_content` (cast required; OpenAI SDK type omits it).
   - **Streaming (502-526):** only accumulates `delta.content`; `delta.reasoning_content` is dropped. Recommend supporting reasoning trace in **non-streaming** path only (mirrors the existing o-series limitation).
   - **`isDeepSeekModel` is private (298)** — export it for the new branches.

7. **Cost accounting: do NOT set `reasoningPer1M` for DeepSeek.** `usage.completion_tokens` already includes reasoning tokens (billed at the output rate). `calculateLLMCost` adds `reasoningCost` ON TOP only when `reasoningPer1M` is set → setting it would **double-count**. This matches how the existing reasoning-capable OpenRouter models (`gpt-oss-20b`, `qwen/qwen3-8b`) omit `reasoningPer1M`. (Only OpenAI o1 VERSIONED_PRICING sets it, because OpenAI's accounting differs.) `llmCallTracking.reasoning_tokens` is `.optional()` — new models won't break inserts.

8. **Pricing (UNVERIFIED — placeholders pending live confirmation):** flash ≈ input-miss $0.14 / input-hit $0.0028 / output $0.28; pro (promo) ≈ input-miss $0.435 / output $0.87, post-promo possibly ~4× (ambiguous). Context 1M, max output 384K. JSON mode (`response_format:{type:'json_object'}`) supported — already the DeepSeek path at llms.ts:462.

9. **Tests to add/update:** `modelRegistry.test.ts` (`getModelOptions` includes both new IDs), `schemas.test.ts` (`allowedLLMModelSchema` parses both), `llmPricing.test.ts` (pricing present, no reasoningPer1M), `llms.test.ts` (`isOpenRouterModel` false for both; + reasoning_content extraction & thinking-toggle tests if reasoning wired), `evolution/src/lib/schemas.test.ts` (reasoning-model error-message list, only if `supportsReasoning:true`), E2E `admin-strategy-crud.spec.ts` (assert dropdown contains `deepseek-v4-pro`/`deepseek-v4-flash`, mirroring the gpt-oss-20b test ~line 92).

10. **Other hardcoded model literals (change only if desired):** `DEFAULT_MODEL='gpt-4.1-mini'` (llms.ts:98), `DEFAULT_JUDGE_MODEL='qwen-2.5-7b-instruct'` (modelRegistry.ts:194), `claimAndExecuteRun.ts:198` default `'deepseek-chat'`, `promptBankConfig.ts` seed configs. None require changes to merely surface the new models.

## Open Questions (for planning / user)
1. **Verify reality:** Do `deepseek-v4-pro` and `deepseek-v4-flash` actually exist as API model IDs, and what are the real current prices? (Confirm via `GET https://api.deepseek.com/models` with `DEEPSEEK_API_KEY`, or a live test call. The "promo ends today" claim is a hallucination red flag.)
2. **Thinking config decision:** Register pro=reasoning / flash=non-reasoning, both non-reasoning, or both reasoning? This drives whether we touch `llms.ts` at all.
3. **Scope of reasoning wiring:** If any model is reasoning, do we want the chain-of-thought trace captured (requires the `reasoning_content` branch + thinking-toggle in `llms.ts`), or is dropdown-selectability + correct cost tracking enough for v1 (trace = `'unavailable'`)?
4. **Non-thinking enforcement:** If flash is registered non-reasoning, do we add the `thinking:{type:'disabled'}` send so it's genuinely non-thinking (cheaper/faster), or accept default thinking-on?
5. Should any default-model constant switch to a v4 model, or leave all defaults as-is?

## Decisions (resolved 2026-05-31)
1. **Models exist** — proceed without a blocking live-API existence check (still sanity-check pricing before merge).
2. **Both models non-reasoning, thinking OFF by default** — register `deepseek-v4-pro` and `deepseek-v4-flash` with `supportsReasoning:false`, no `defaultReasoningEffort`, no `reasoningPer1M`.
3. **Do NOT capture reasoning trace** — no `reasoning_content` extraction branch needed.
4. **Reasoning off / thinking disabled** — since DeepSeek defaults thinking ON, `llms.ts` must explicitly send `thinking:{type:'disabled'}` for non-reasoning DeepSeek models so they behave as plain chat (temperature honored, no CoT tokens). This is the only `llms.ts` change required.
5. Defaults unchanged — no change to `DEFAULT_MODEL` / `DEFAULT_JUDGE_MODEL` / pipeline default.
