# Improve Setup Judging Research

## Problem Statement
Improve the evolution pipeline's setup and judging by adding cheap judge models (Qwen 8B, Google), centralizing model configuration into a registry with max temperature validation, setting judge temperature to 0, adding configurable generation temperature to strategy config, and changing OpenSkill beta to 0.

## Requirements (from GH Issue #961)
- Change beta to 0 in my Openskill implementation
- I want to speed up judging for evolution. Add want to add two models - Qwen 8b, a Google one. Both cost around $.10 per M input or less. Help me find these actual models and add support for these in my evolution system, including in model dropdown list on strategy creation.
- Refactor to consolidate my model information into a central model registry.
    - Add my 2 new models to this registry
    - Add maximum temperature into this model registry
- Set temperature to 0 for all models when they are used as judges
- Add the ability to configure (optionally) a generation temperature for generation models, from the strategy config. Make sure to find the max temperature for all of our available models and add them to our model registry, to validate the user's input from the strategy creation screen to make sure temp is a valid value.

## High Level Summary

### 1. OpenSkill Beta Change
- **Current**: `osRate([[winner], [loser]], { rank: [1, 2] })` — no beta passed, uses openskill default (`sigma/2 ≈ 4.167`)
- **Change**: Pass `beta: 0` to all `osRate()` calls in `computeRatings.ts`
- **Effect**: Zero performance variability assumption → faster mu updates, faster sigma reduction, faster convergence. Mathematically valid (no division-by-zero risk). Good fit for text quality ranking where the 2-pass reversal already mitigates judge noise.
- **Files**: `evolution/src/lib/shared/computeRatings.ts` lines 38, 50 — two one-line changes
- **Local BETA constants** in `rankSingleVariant.ts` (line 26) and `swissPairing.ts` (line 16) are for win-probability calculations, NOT openskill — leave unchanged.

### 2. New Cheap Models (3 selected)
| Model | ID | Input $/M | Output $/M | Provider | Context |
|-------|----|-----------|------------|----------|---------|
| GPT-5 Nano | `gpt-5-nano` | $0.05 | $0.40 | OpenAI direct | 400K |
| Gemini 2.5 Flash Lite | `google/gemini-2.5-flash-lite` | $0.10 | $0.40 | OpenRouter | 1M |
| Qwen3 8B | `qwen/qwen3-8b` | $0.05 | $0.40 | OpenRouter | 40K |

`gpt-5-nano` already routes through OpenAI client (just needs schema + pricing). The two OpenRouter models use `provider/model` format natively — no prefix transformation needed (unlike `gpt-oss-20b` which gets `openai/` prefixed). Existing `isOpenRouterModel()` needs expansion from exact-match to registry-based lookup.

### 3. Central Model Registry
Currently model info is scattered across 3 files:
- `src/lib/schemas/schemas.ts` (allowedLLMModelSchema — 14 enum entries)
- `src/config/llmPricing.ts` (LLM_PRICING — 46 pricing entries)
- `src/lib/services/llms.ts` (provider routing — isDeepSeekModel, isOpenRouterModel, isAnthropicModel, isLocalModel)

**Refactor plan**: Create `src/config/modelRegistry.ts` as single source of truth containing for each model:
- Model ID, display name, provider
- Input/output pricing per 1M tokens
- Max temperature
- Whether it's an allowed evolution model

Derive `allowedLLMModelSchema`, `LLM_PRICING`, `MODEL_OPTIONS`, and provider routing from this registry.

### 4. Temperature Support
**Current state**: Temperature is NOT configurable anywhere in the production call chain. Neither OpenAI nor Anthropic calls set temperature (defaulting to provider defaults: OpenAI=1.0, Anthropic=1.0). Only `run-evolution-local.ts` hardcodes `temperature: 0.7`.

**Judge vs Generation distinction**: Already cleanly separated:
- Generation calls use `agentName: 'generation'` with `config.generationModel`
- Judge/ranking calls use `agentName: 'ranking'` with `config.judgeModel` and `taskType: 'comparison'`

**Implementation path**:
1. Add `temperature?: number` to `CallLLMOptions` in `llms.ts`
2. Thread through `callOpenAIModel` (line 311) and `callAnthropicModel` (line 488/504)
3. In `claimAndExecuteRun.ts` llmProvider wrapper (line 160-174), set temperature based on label: `'ranking'` → 0, `'generation'` → config value

### 5. Max Temperature by Model

| Model | Max Temp | Provider |
|-------|----------|----------|
| gpt-4o, gpt-4o-mini | 2.0 | OpenAI |
| gpt-4.1, gpt-4.1-mini, gpt-4.1-nano | 2.0 | OpenAI |
| gpt-5.2, gpt-5.2-pro, gpt-5-mini, gpt-5-nano | 2.0 (only with reasoning_effort=none) | OpenAI |
| o3-mini | N/A (not supported) | OpenAI |
| deepseek-chat | 2.0 | DeepSeek |
| claude-sonnet-4-20250514 | 1.0 | Anthropic |
| gpt-oss-20b | 2.0 | OpenRouter |
| qwen/qwen3-8b | 2.0 | OpenRouter |
| google/gemini-2.0-flash-lite-001 | 2.0 | OpenRouter |
| LOCAL_qwen2.5:14b | 2.0 | Ollama |

### 6. Strategy Config Changes
**Current StrategyConfig** (from `evolution/src/lib/schemas.ts` lines 321-340):
- generationModel, judgeModel, iterations (hashed for dedup)
- strategiesPerRound, budgetUsd, generationGuidance, maxVariantsToGenerateFromSeedArticle, maxComparisonsPerVariant, budgetBufferAfterParallel, budgetBufferAfterSequential

**Add**: `generationTemperature?: number` — optional, validated against model registry max temp.

**Files to change**:
1. `evolution/src/lib/schemas.ts` — strategyConfigSchema (add field)
2. `evolution/src/lib/schemas.ts` — evolutionConfigSchema (add field)
3. `evolution/src/services/strategyRegistryActions.ts` — createStrategySchema (add field)
4. `evolution/src/services/strategyRegistryActions.ts` — createStrategyAction config object (add field)
5. `evolution/src/lib/pipeline/setup/buildRunContext.ts` — EvolutionConfig construction (add field)
6. `src/app/admin/evolution/strategies/page.tsx` — createFields (add form field)
7. `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` — display the temp

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/README.md — evolution system overview, doc map
- evolution/docs/architecture.md — pipeline execution flow, LLM adapter pattern
- evolution/docs/data_model.md — strategy config JSONB schema
- evolution/docs/arena.md — OpenSkill rating mechanics in arena
- evolution/docs/rating_and_comparison.md — full ranking subsystem, beta in Swiss pairing
- evolution/docs/strategies_and_experiments.md — StrategyConfig definition, UI workflow
- evolution/docs/cost_optimization.md — LLM pricing table, cost estimation
- evolution/docs/entities.md — entity relationships
- evolution/docs/metrics.md — metrics system, cost tracking
- evolution/docs/logging.md — entity logging
- evolution/docs/visualization.md — admin UI pages
- evolution/docs/reference.md — file index, config, environment vars
- evolution/docs/agents/overview.md — agent operations, format validation
- evolution/docs/curriculum.md — learning path
- evolution/docs/minicomputer_deployment.md — deployment setup
- docs/docs_overall/testing_overview.md — testing rules
- docs/docs_overall/environments.md — env configuration
- docs/feature_deep_dives/testing_setup.md — testing patterns

## Code Files Read
- `evolution/src/lib/shared/computeRatings.ts` — OpenSkill rating wrapper, osRate() calls, comparison logic
- `src/lib/schemas/schemas.ts` (lines 72-82) — allowedLLMModelSchema enum (14 models)
- `src/config/llmPricing.ts` — LLM_PRICING table (46 entries), getModelPricing, calculateLLMCost
- `src/lib/utils/modelOptions.ts` — MODEL_OPTIONS derived from allowedLLMModelSchema
- `src/lib/services/llms.ts` — callOpenAIModel, callAnthropicModel, provider routing, no temperature support
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — V2 LLM client wrapper, retry, cost tracking
- `evolution/src/lib/pipeline/infra/types.ts` — StrategyConfig, EvolutionConfig, EvolutionResult types
- `evolution/src/lib/schemas.ts` (lines 321-378) — strategyConfigSchema, evolutionConfigSchema definitions
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` (lines 158-191) — StrategyConfig → EvolutionConfig mapping
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — hashStrategyConfig (3 fields), labelStrategyConfig, upsertStrategy
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` (lines 160-174) — llmProvider wrapper, callLLM bridge
- `evolution/src/services/strategyRegistryActions.ts` — createStrategySchema, createStrategyAction
- `src/app/admin/evolution/strategies/page.tsx` — createFields, model dropdowns, form submission
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` — strategy config display
- `evolution/src/components/evolution/dialogs/FormDialog.tsx` — FieldDef type (text, number, select, custom, checkbox, textarea)
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — local BETA constant, judge model usage
- `evolution/src/lib/pipeline/loop/swissPairing.ts` — local BETA constant for win-probability
- `node_modules/openskill/dist/types.d.ts` — Options type confirms beta?: number is supported
- `evolution/src/lib/core/agents/SwissRankingAgent.ts` — judge model used for ranking
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — generation model used for variant creation

## Key Findings

1. **OpenSkill beta=0** is a safe, one-line-per-function change in `computeRatings.ts`. The openskill library accepts `beta` in the options object alongside `rank`. Setting to 0 assumes zero performance variability → faster convergence with fewer comparisons.

2. **Two cheap models identified**: `qwen/qwen3-8b` ($0.05/M in) and `google/gemini-2.0-flash-lite-001` ($0.075/M in) via OpenRouter. Both well under $0.10/M input requirement.

3. **OpenRouter routing** needs `isOpenRouterModel()` expanded. Currently exact-matches only `gpt-oss-20b`. New models use `provider/model` format natively (no prefix needed unlike gpt-oss-20b which gets `openai/` prefixed).

4. **Model info is fragmented** across schemas, pricing, and routing. A central registry would consolidate and make adding new models a single-file change.

5. **Temperature has zero support** in the production call chain. Needs threading through `callLLM` → `callOpenAIModel`/`callAnthropicModel`. The judge vs generation distinction is already clean (different agentName labels), making per-purpose temperature easy.

6. **Max temperatures vary**: Most models support 0-2, Anthropic Claude supports 0-1, o3-mini doesn't support temperature at all. The registry must store per-model max temp for validation.

7. **Strategy creation UI** uses `FormDialog` with `FieldDef[]` — supports `number` type natively. Adding `generationTemperature` field is straightforward. Validation can use `validate` callback.

8. **No Google/Gemini SDK** exists in codebase — both new models route through OpenRouter, requiring only `OPENROUTER_API_KEY` (already configured).

## Open Questions

1. **OpenRouter model name format**: For `qwen/qwen3-8b` and `google/gemini-2.0-flash-lite-001`, should these be stored with the `provider/` prefix in the schema (matching OpenRouter's format) or without? Current `gpt-oss-20b` strips the prefix and adds `openai/` at call time. The new models could keep their full OpenRouter ID since it already includes the provider prefix.

2. **Should generationTemperature be included in the strategy config hash?** Currently only generationModel, judgeModel, iterations are hashed. Including temperature would create distinct strategies for different temps. Recommend: YES, include in hash since temperature meaningfully affects output.

3. **Default generation temperature**: When `generationTemperature` is not set in strategy config, what should the default be? Recommend: leave undefined → provider default (1.0 for OpenAI, 1.0 for Anthropic, 1.0 for OpenRouter).
