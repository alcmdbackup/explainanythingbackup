# Fix OpenRouter JSON Schema Structured Output Research

## Problem Statement
The `reduce_e2e_openai_test_costs` `@prod-ai` real-AI smoke (PR #1179) revealed that OpenRouter models (e.g. `google/gemini-2.5-flash`) cannot reliably produce schema-conformant structured output: `src/lib/services/llms.ts` requests `response_format: { type: 'json_object' }` for OpenRouter/DeepSeek/Local, but only the OpenAI branch uses schema-enforced `zodResponseFormat` (`json_schema`). So forcing `TEST_LLM_MODEL=google/gemini-2.5-flash` fails `generateTitleFromUserQuery` with "No valid title1 found for vector search" (`returnExplanation.ts:47` requires `parsedTitles.data.title1`). Prod is unaffected (title-gen runs on `gpt-4.1-mini`, OpenAI structured). Goal: make the OpenRouter structured-output path use schema-enforced `json_schema` for models that support it, so cheap OpenRouter models work for structured calls — unblocking the `@prod-ai` Gemini generation smoke and improving structured-output reliability.

## Requirements (from GH Issue #1181)
Finding: `llms.ts` ~line 473-476 — for `isDeepSeekModel || isLocalModel || isOpenRouterModel` it sets `response_format = { type: 'json_object' }` (JSON-forced, NOT schema-enforced); only the OpenAI branch uses `zodResponseFormat` (json_schema with the actual Zod schema). OpenRouter's API is OpenAI-compatible and supports `response_format` json_schema for models that support structured outputs (Gemini, GPT-4o-class), but NOT all (gpt-oss-20b, qwen variants may not).

1. Add a per-model capability flag in `src/config/modelRegistry.ts` (e.g. `supportsJsonSchema` / `structuredOutputMode: 'json_schema' | 'json_object'`) — do NOT assume all OpenRouter models support json_schema.
2. In `src/lib/services/llms.ts`, when a response schema (`response_obj`/`response_obj_name`) is provided AND the model supports json_schema, use `zodResponseFormat` (json_schema) instead of `json_object`; otherwise keep `json_object`. Applies to OpenRouter models with the flag; keep DeepSeek + Local on `json_object`.
3. Set the flag true for `google/gemini-2.5-flash` (+ `google/gemini-2.5-flash-lite`) and any other supporting model.
4. CRITICAL: `DEFAULT_JUDGE_MODEL = qwen-2.5-7b-instruct` (judge-eval) runs structured calls via OpenRouter — verify it still works (keep it on `json_object` unless qwen reliably supports json_schema). Do not regress judge-eval, evolution, or prompt-editor structured calls.
5. Validate the `@prod-ai` generation smoke (`real-generation.prod-ai.spec.ts`) now passes on Gemini after the change.
6. Unit tests for the `response_format` routing (json_schema for flagged OpenRouter models, json_object otherwise); integration coverage; re-run the `@prod-ai` smoke via `workflow_dispatch`.

## High Level Summary

Investigation **substantially de-risks** the change — the blast radius is much smaller than the requirements feared:

### The structured-output path
- `llms.ts:472-478`: `response_format` is only set when `response_obj && response_obj_name` are passed. The branch:
  - **OpenAI** → `zodResponseFormat(response_obj, response_obj_name)` = schema-enforced `json_schema`.
  - **DeepSeek / Local / OpenRouter** → `{ type: 'json_object' }` = JSON-forced, NOT schema-enforced.
- `modelUsed`/`apiModel` routing already maps OpenRouter ids via `getOpenRouterApiModelId`.

### Who actually makes STRUCTURED (`response_obj`) callLLM calls — exhaustive (4 sites, all `DEFAULT_MODEL`/OpenAI in prod):
1. `src/lib/services/returnExplanation.ts:44` — `generateTitleFromUserQuery` (`titleQuerySchema`). **This is the one that fails on Gemini.**
2. `src/lib/services/returnExplanation.ts:94` — `extractLinkCandidates` (`linkCandidatesExtractionSchema`). *(Added after plan-review iter1 — initially missed.)*
3. `src/lib/services/tagEvaluation.ts:48` — `evaluateTags`.
4. `src/lib/services/findMatches.ts:133` — `findBestMatchFromList` (`matchFoundFromListSchema`).
- All four pass `DEFAULT_MODEL` (`gpt-4.1-mini`) → in prod they use the OpenAI structured path and work. They only hit the OpenRouter `json_object` branch when an OpenRouter model is forced (the `@prod-ai` test tier via `TEST_LLM_MODEL`). All four are exercised by one real search→generate (the `@prod-ai` generation spec covers them).

### Who is NOT affected (key de-risking):
- **Judge-eval is free-text, not structured.** `computeRatings.ts:286` types the judge callLLM as `(prompt: string) => Promise<string>`; verdicts are parsed by `parseWinner` / `parseVerdictFromReasoning` from free text. It passes **no `response_obj`**, so it never sets `response_format` → switching the structured branch cannot regress the qwen judge. (Requirement #4's concern is largely moot — but we still must NOT flip qwen to json_schema blindly.)
- **Evolution pipeline** (`createEvolutionLLMClient.ts`) does NOT call `callLLM` with a `response_obj` (no matches) — it handles JSON itself. Unaffected by the `response_format` branch change.
- **Prompt editor** — uses plain text generation; not a structured `response_obj` consumer.

### Conclusion
The only path that exercises the OpenRouter structured branch today is the `@prod-ai` Gemini test tier. So switching flagged OpenRouter models to `json_schema` is low-risk: it fixes the test tier and makes structured output reliable for any future cheap-model use, with no prod path and no judge/evolution path affected. The change still touches shared `llms.ts`, so it warrants unit tests + plan-review.

### Open questions for /plan
1. Flag shape: a boolean `supportsJsonSchema` vs a `structuredOutputMode` enum. Boolean is simplest; default false (so DeepSeek/Local/unflagged OpenRouter keep `json_object`).
2. Does `zodResponseFormat` produce an OpenRouter-acceptable payload as-is? (It emits `{ type: 'json_schema', json_schema: { name, schema, strict } }` — OpenRouter is OpenAI-compatible; confirm strict mode is accepted by Gemini via OpenRouter, else set `strict: false`.)
3. Should `google/gemini-2.5-flash-lite` also get the flag (it's `supportsEvolution` and may be used as a cheaper tier)? Likely yes.
4. Confirm qwen-2.5-7b-instruct stays on `json_object` (judge is free-text anyway, but if any other path sends qwen a `response_obj`, keep it json_object unless verified).

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/judge_evaluation.md
- docs/docs_overall/llm_provider_limits.md

## Code Files Read
- src/lib/services/llms.ts (response_format selection ~472-478; apiModel/getOpenRouterApiModelId routing)
- src/lib/services/returnExplanation.ts (:44 title structured call; :47 title1 requirement)
- src/lib/services/tagEvaluation.ts (:48 structured call)
- src/lib/services/findMatches.ts (:133 structured call)
- evolution/src/lib/shared/computeRatings.ts (judge callLLM is free-text, no response_obj)
- evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts (no callLLM response_obj usage)
- src/config/modelRegistry.ts (capability flag location; gemini-2.5-flash entry)
