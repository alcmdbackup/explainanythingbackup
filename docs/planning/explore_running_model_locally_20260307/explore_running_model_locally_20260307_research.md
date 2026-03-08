# Explore Running Model Locally Research

## Problem Statement
Explore running AI models locally (e.g., via Ollama, llama.cpp, vLLM) to reduce API costs and enable offline development. Help choose a suitable model, then outline how we can expose the model to our evolution runner on the minicomputer.

## Requirements (from GH Issue #668)
Help me choose a suitable model, then outline how we can expose the model to our runner if needed.

## High Level Summary

The codebase has a well-designed, provider-agnostic LLM abstraction layer in `src/lib/services/llms.ts` that already supports OpenAI-compatible APIs via custom baseURL (proven with DeepSeek). Adding a local model would require ~10-20 lines of code changes to the provider detection and client initialization — no changes needed to the 50+ call sites.

The evolution runner is a separate Node.js process on a local minicomputer, managed by systemd timer (fires every 60s). It polls Supabase for pending runs, claims them atomically, and executes the pipeline. It already supports per-run model overrides via `evolution_runs.config` JSONB column.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/llm_provider_limits.md - Current providers: OpenAI ($200/mo), DeepSeek ($100/mo), Anthropic ($100/mo)
- docs/feature_deep_dives/search_generation_pipeline.md - Core LLM orchestration uses `callLLM()` abstraction
- docs/feature_deep_dives/ai_suggestions_overview.md - AI editor pipeline uses DEFAULT_MODEL (gpt-4.1-mini) and LIGHTER_MODEL (gpt-4.1-nano)
- docs/docs_overall/environments.md - Minicomputer uses `.env.local` + `.env.evolution-prod`

## Code Files Read

### LLM Abstraction Layer
- `src/lib/services/llms.ts` - **Central LLM router**. Routes by model name prefix: `deepseek-*` → DeepSeek client, `claude-*` → Anthropic client, everything else → OpenAI client. DeepSeek already uses OpenAI SDK with custom `baseURL` — same pattern needed for local models. Exports `callLLM()` used by all 50+ call sites.
- `src/lib/schemas/schemas.ts:116-124` - `allowedLLMModelSchema` Zod enum with all valid model names. New local model names must be added here.
- `src/config/llmPricing.ts` - Pricing table for 30+ models with `calculateLLMCost()`. Local models would need $0 pricing entries.

### Model Constants
- `src/lib/services/llms.ts:38-39` - `DEFAULT_MODEL = 'gpt-4.1-mini'`, `LIGHTER_MODEL = 'gpt-4.1-nano'`
- `evolution/src/lib/core/llmClient.ts:13` - `EVOLUTION_DEFAULT_MODEL = 'deepseek-chat'`
- `evolution/src/lib/config.ts:7-20` - Default evolution config: `judgeModel: 'gpt-4.1-nano'`, `generationModel: 'gpt-4.1-mini'`

### Evolution Runner
- `evolution/scripts/evolution-runner.ts` - Main batch runner (418 lines). Polls Supabase, claims runs atomically, executes pipeline. Flags: `--max-runs`, `--parallel`, `--max-concurrent-llm`.
- `evolution/deploy/evolution-runner.service` - systemd service unit (Type=oneshot)
- `evolution/deploy/evolution-runner.timer` - Fires every 60 seconds
- `evolution/src/lib/core/llmClient.ts` - `EvolutionLLMClient` interface wraps `callLLM()` with budget enforcement
- `evolution/src/lib/core/strategyConfig.ts:14-23` - Per-run `StrategyConfig` supports `generationModel`, `judgeModel`, `agentModels` overrides

### LLM Call Sites (all use abstraction, no changes needed)
- `src/actions/actions.ts` - Server actions use `callLLM()`
- `src/editorFiles/actions/actions.ts` - AI suggestions pipeline
- `src/app/api/stream-chat/route.ts` - Streaming endpoint
- `src/lib/services/returnExplanation.ts` - Content generation
- `src/lib/services/vectorsim.ts` - Embeddings (separate OpenAI client, NOT via abstraction)
- `evolution/src/lib/agents/*.ts` - 9+ agents all use `llmClient.complete()`

### Structured Output Support
- OpenAI/GPT: Uses `zodResponseFormat()` for structured JSON
- DeepSeek: Falls back to `{ type: 'json_object' }` (no schema enforcement)
- Anthropic: JSON format via system message
- Local models: Would likely need the DeepSeek fallback pattern (json_object mode)

## Key Findings

1. **OpenAI-compatible API pattern already exists** — DeepSeek uses `new OpenAI({ baseURL: 'https://api.deepseek.com' })`. Adding a local model (Ollama, vLLM, etc.) is the same pattern with `baseURL: 'http://localhost:11434/v1'`.

2. **Only 3-4 files need modification** to add local model support:
   - `src/lib/schemas/schemas.ts` — Add model name(s) to allowedLLMModelSchema
   - `src/lib/services/llms.ts` — Add `isLocalModel()` detection, `getLocalClient()`, and routing
   - `src/config/llmPricing.ts` — Add $0 pricing entries
   - `.env.local` / `.env.evolution-prod` — Add `LOCAL_LLM_BASE_URL`

3. **Evolution runner already supports per-run model overrides** via `evolution_runs.config` JSONB → `StrategyConfig.generationModel`. No runner code changes needed to use a local model — just set the model name in the run config.

4. **Structured output is a concern** — Local models may not support `zodResponseFormat()`. The DeepSeek fallback pattern (`{ type: 'json_object' }`) works but with weaker schema enforcement. Some pipeline steps (tag evaluation, match ranking) require structured output.

5. **Embeddings are separate** — `vectorsim.ts` uses its own OpenAI client for embeddings. Running embedding models locally would need additional work.

6. **The minicomputer is the natural host** — It already runs the evolution runner via systemd. A local model server (Ollama/vLLM) could run alongside it as another systemd service.

7. **Budget/cost tracking works automatically** — Adding $0 pricing entries means local model calls still get tracked but at zero cost.

## Model Selection Considerations

### For Evolution Pipeline (primary use case)
The evolution runner currently uses `deepseek-chat` for generation and `gpt-4.1-nano` for judging. Local model needs:
- Good instruction-following for article generation
- JSON output capability for structured responses
- Reasonable speed (evolution runs are batch, not real-time)

### Candidate Models for Local Hosting
- **Qwen 2.5 (7B/14B/32B)** — Strong instruction following, good JSON output, Apache 2.0
- **Llama 3.3 (70B)** — Best open-source quality, needs significant GPU
- **Mistral/Mixtral** — Good balance of quality and speed
- **DeepSeek-V3-0324** — Same model already used via API, could run locally

### Hosting Frameworks
- **Ollama** — Easiest setup, OpenAI-compatible API at `localhost:11434/v1`, supports quantization
- **vLLM** — Best throughput for batch workloads, OpenAI-compatible server mode
- **llama.cpp server** — Lightest weight, good for smaller models

## Open Questions

1. What GPU/hardware is available on the minicomputer? This determines max model size.
2. Is the goal cost reduction (replace DeepSeek API calls), quality improvement, or offline capability?
3. Should we support local models only for evolution, or also for the main app (article generation, AI suggestions)?
4. Are we comfortable with potentially lower structured output reliability from local models?
5. What quantization level is acceptable (Q4, Q5, Q8, FP16)?
