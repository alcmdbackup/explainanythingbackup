# Fix OpenRouter JSON Schema Structured Output Plan

## Background
The `reduce_e2e_openai_test_costs` `@prod-ai` real-AI smoke (PR #1179) revealed that OpenRouter models (e.g. `google/gemini-2.5-flash`) cannot reliably produce schema-conformant structured output: `src/lib/services/llms.ts` requests `response_format: { type: 'json_object' }` for OpenRouter/DeepSeek/Local, but only the OpenAI branch uses schema-enforced `zodResponseFormat` (`json_schema`). So forcing `TEST_LLM_MODEL=google/gemini-2.5-flash` fails `generateTitleFromUserQuery` with "No valid title1 found for vector search" (`returnExplanation.ts:47`). Prod is unaffected (title-gen runs on `gpt-4.1-mini`, OpenAI structured). Goal: make the OpenRouter structured-output path use schema-enforced `json_schema` for models that support it.

## Requirements (from GH Issue #1181)
Finding: `llms.ts` ~line 473-476 — for `isDeepSeekModel || isLocalModel || isOpenRouterModel` it sets `response_format = { type: 'json_object' }` (JSON-forced, NOT schema-enforced); only the OpenAI branch uses `zodResponseFormat`. OpenRouter is OpenAI-compatible and supports json_schema for models that support structured outputs (Gemini, GPT-4o-class), but NOT all (gpt-oss-20b, qwen variants may not).

1. Add a per-model capability flag in `src/config/modelRegistry.ts` (e.g. `supportsJsonSchema`) — do NOT assume all OpenRouter models support json_schema.
2. In `src/lib/services/llms.ts`, when a response schema is provided AND the model supports json_schema, use `zodResponseFormat` (json_schema) instead of `json_object`; otherwise keep `json_object`. Applies to OpenRouter models with the flag; keep DeepSeek + Local on `json_object`.
3. Set the flag true for `google/gemini-2.5-flash` (+ `google/gemini-2.5-flash-lite`) and any other supporting model.
4. CRITICAL: `DEFAULT_JUDGE_MODEL = qwen-2.5-7b-instruct` (judge-eval) runs structured calls via OpenRouter — verify it still works (keep on `json_object` unless qwen reliably supports json_schema). Do not regress judge-eval, evolution, or prompt-editor structured calls.
5. Validate the `@prod-ai` generation smoke (`real-generation.prod-ai.spec.ts`) now passes on Gemini.
6. Unit tests for the `response_format` routing; integration coverage; re-run the `@prod-ai` smoke via `workflow_dispatch`.

## Problem
Structured (`response_obj`) callLLM calls only enforce the Zod schema on OpenAI; on OpenRouter they fall back to unstructured `json_object`, so cheap OpenRouter models (Gemini) return JSON that doesn't match the schema, breaking consumers that require specific fields (e.g. `title1`). Research confirms only 3 structured callLLM sites exist (title/tags/match-selection), all on OpenAI in prod, and neither judge-eval (free-text) nor evolution route structured calls through this path — so the fix is low-risk and primarily unblocks the cheap-model test tier while improving structured reliability generally.

## Options Considered
- [ ] **Option A: Per-model `supportsJsonSchema` flag + use `zodResponseFormat` for flagged OpenRouter models (RECOMMENDED).** Smallest, explicit, safe — only flagged models switch; DeepSeek/Local/unflagged OpenRouter unchanged. Lets us enable Gemini now and others later after verification.
- [ ] **Option B: Switch ALL OpenRouter models to `json_schema`.** Simpler code but risky — some OpenRouter models (gpt-oss-20b, qwen) may not support json_schema and would error/regress. Rejected.
- [ ] **Option C: Leave `json_object`, add a post-parse repair/retry for OpenRouter structured calls.** Band-aid; doesn't fix the root cause and adds latency/complexity. Rejected.

## Phased Execution Plan

### Phase 1: Registry capability flag
- [ ] Add an optional `supportsJsonSchema?: boolean` field to `ModelInfo` in `src/config/modelRegistry.ts` (default undefined/false).
- [ ] Set `supportsJsonSchema: true` on `google/gemini-2.5-flash` and `google/gemini-2.5-flash-lite`. Leave qwen / gpt-oss-20b / DeepSeek / Local unset (→ json_object).
- [ ] Add a `modelSupportsJsonSchema(model): boolean` helper (mirrors existing `modelSupportsReasoning`).
- [ ] Unit test (`modelRegistry.test.ts`): gemini-2.5-flash(+lite) → true; qwen-2.5-7b-instruct / gpt-oss-20b / gpt-4.1-mini / deepseek-chat → false/undefined.

### Phase 2: Route structured output by capability in llms.ts
- [ ] In `callOpenAIModel` (`llms.ts:472-478`), when `response_obj && response_obj_name`: if `isOpenRouterModel(validatedModel) && modelSupportsJsonSchema(validatedModel)` → use `zodResponseFormat(response_obj, response_obj_name)` (json_schema); else keep the existing branch (OpenAI → zodResponseFormat; DeepSeek/Local/unflagged OpenRouter → `{ type: 'json_object' }`).
- [ ] If OpenRouter rejects `strict: true` for Gemini, set the json_schema `strict: false` (zodResponseFormat default is strict; may need a manual `{ type:'json_schema', json_schema:{ name, schema, strict:false } }`). Decide during impl based on a real call.
- [ ] Keep DeepSeek + Local strictly on `json_object` (unchanged).
- [ ] Unit test (`llms.test.ts`): with a `response_obj`, a flagged OpenRouter model sets `response_format.type === 'json_schema'`; an unflagged OpenRouter model + DeepSeek set `json_object`; OpenAI unchanged (zodResponseFormat).

### Phase 3: Validate end-to-end on Gemini
- [ ] Re-run the `@prod-ai` smoke via `gh workflow run e2e-real-ai-smoke.yml` (real Gemini); confirm `real-generation.prod-ai.spec.ts` (title → content → tags) now passes and the evolution-seed spec still passes.
- [ ] Confirm no regression to judge-eval (free-text; spot-check a judge-eval integration test still green) and evolution structured handling.

## Testing

### Unit Tests
- [ ] `src/config/modelRegistry.test.ts` — `modelSupportsJsonSchema` / flag values for gemini(+lite)=true, qwen/gpt-oss/gpt-4.1-mini/deepseek=false.
- [ ] `src/lib/services/llms.test.ts` — `response_format` selection: flagged OpenRouter + `response_obj` → `json_schema`; unflagged OpenRouter / DeepSeek → `json_object`; OpenAI → zodResponseFormat; no `response_obj` → no `response_format` set (judge path).

### Integration Tests
- [ ] Spot-check an existing judge-eval / structured integration test still passes (no regression) — no new integration test required (covered by unit + existing suite).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/02-search-generate/real-generation.prod-ai.spec.ts` (`@prod-ai`) — passes on real Gemini after the fix (validated via `workflow_dispatch` of `e2e-real-ai-smoke.yml`; this spec can't run in PR-CI).

### Manual Verification
- [ ] `gh workflow run e2e-real-ai-smoke.yml --ref <branch>` (or after merge) → `prod-ai` job's `@prod-ai` step is green for BOTH specs.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI changes. The `@prod-ai` real-AI specs validate via the dedicated workflow (real Gemini), not local Playwright.

### B) Automated Tests
- [ ] `npm run test -- --runTestsByPath src/config/modelRegistry.test.ts src/lib/services/llms.test.ts`
- [ ] `npm run test:integration` (confirm judge-eval / structured suites still green)
- [ ] Post-merge: `gh workflow run e2e-real-ai-smoke.yml` then verify the `@prod-ai` step passes.

## Documentation Updates
- [ ] `docs/feature_deep_dives/search_generation_pipeline.md` — note that structured calls (title/tags/match) use schema-enforced output; OpenRouter path uses json_schema for flagged models, json_object otherwise.
- [ ] `docs/docs_overall/llm_provider_limits.md` — note `supportsJsonSchema` for Gemini models if relevant.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — only if it documents the structured-output path (judge is free-text; likely no change).

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
