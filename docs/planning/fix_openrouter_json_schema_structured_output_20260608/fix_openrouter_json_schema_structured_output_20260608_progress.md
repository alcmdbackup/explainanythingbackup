# Fix OpenRouter JSON Schema Structured Output Progress

## Phase 1: Registry capability flag — DONE
- Added `supportsJsonSchema?: boolean` to `ModelInfo`; set true on `google/gemini-2.5-flash` + `-lite`.
- Added `modelSupportsJsonSchema()` helper (mirrors `modelSupportsReasoning`).
- Unit tests in `modelRegistry.test.ts` (gemini=true; qwen/gpt-oss/gpt-4.1-mini/deepseek/unknown=false).

## Phase 2: Route structured output by capability in llms.ts — DONE
- `callOpenAIModel`: flagged-OpenRouter + `response_obj` → `zodResponseFormat` with `json_schema.strict=false`; DeepSeek/Local/unflagged-OpenRouter → `json_object`; OpenAI → `zodResponseFormat` (strict).
- Imported `modelSupportsJsonSchema`. Unit tests in `llms.test.ts` assert request `response_format` per branch.

## Phase 3: Validate end-to-end on Gemini — POST-MERGE
- Re-run `e2e-real-ai-smoke.yml` (workflow_dispatch) after merge to confirm `real-generation.prod-ai.spec.ts` passes on real Gemini (exercises all 4 structured sites). Cannot run pre-merge (needs OPENROUTER_API_KEY + the gated build).

## Validation
- tsc ✓, lint ✓ (only pre-existing warnings), full unit suite 7111 ✓, build ✓.
