# Explore Running Model Locally Plan

## Background
Explore running AI models locally (e.g., via Ollama, llama.cpp, vLLM) to reduce API costs and enable offline development. The minicomputer (GMKtec M6 Ultra, Ryzen 7640HS, 32GB DDR5, no dedicated GPU) already runs the evolution runner via systemd. A local model server could run alongside it.

## Requirements (from GH Issue #668)
Help me choose a suitable model, then outline how we can expose the model to our runner if needed.

## Problem
The evolution pipeline currently uses cloud LLM APIs (DeepSeek, OpenAI) for all article generation and judging, incurring ongoing costs (~$100-200/month). The minicomputer that hosts the evolution runner has 32GB RAM but no GPU, limiting local inference to CPU-only with quantized models. We need to integrate a local model server into the existing provider abstraction layer with minimal code changes, while accepting slower inference speeds in exchange for zero marginal cost.

## Options Considered

### Hosting Framework
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Ollama** | Easiest setup, systemd-ready, auto-downloads models, OpenAI-compatible API | Slightly slower than raw llama.cpp | **Chosen** — simplicity wins for this use case |
| vLLM | Best throughput for batch | Heavier install, GPU-focused optimizations | Overkill for CPU-only |
| llama.cpp server | Lightest weight, fastest CPU inference | Manual model management, less polished API | Good fallback if Ollama has issues |

### Model Selection
| Model | RAM | Speed (est.) | JSON Support | Verdict |
|-------|-----|-------------|-------------|---------|
| Qwen 2.5 7B Q4_K_M | ~5GB | ~15 tok/s | Good | Good for judging/tagging |
| **Qwen 2.5 14B Q4_K_M** | ~9GB | ~8 tok/s | Good | **Chosen** — best quality/speed balance |
| Qwen 2.5 32B Q4_K_M | ~20GB | ~3 tok/s | Good | Too slow for batch |
| Llama 3.3 70B Q2_K | ~28GB | ~1 tok/s | Moderate | Not practical |

### Integration Strategy
| Option | Description | Verdict |
|--------|-------------|---------|
| **Prefix-based routing** | `LOCAL_qwen2.5:14b` model name, strip prefix for Ollama API | **Chosen** — matches existing DeepSeek pattern |
| Separate endpoint config | Different env var per use case | Over-engineered |
| Replace DeepSeek entirely | Switch all evolution to local | Too risky as first step |

## Phased Execution Plan

### Phase 1: Install Ollama on Minicomputer
- SSH into minicomputer
- Install Ollama safely (not blind curl|sh on a production machine):
  ```bash
  # Download install script, review it, then run
  curl -fsSL https://ollama.com/install.sh -o /tmp/ollama-install.sh
  less /tmp/ollama-install.sh  # review
  bash /tmp/ollama-install.sh
  ```
- **Pin minimum Ollama version >= 0.3.0** (required for `json_object` response_format support with Qwen models)
- Pull model: `ollama pull qwen2.5:14b`
- Configure Ollama to bind to localhost only: set `OLLAMA_HOST=127.0.0.1` in `/etc/systemd/system/ollama.service.d/override.conf`
- Verify systemd service is running: `systemctl status ollama`
- Test API endpoint: `curl http://localhost:11434/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"qwen2.5:14b","messages":[{"role":"user","content":"Hello"}]}'`
- Test structured output: verify `response_format: { type: "json_object" }` returns valid JSON
- Benchmark: time a ~500 token generation to confirm speed expectations

### Phase 2: Codebase Integration (4 files, ~30 lines)

**File 1: `src/lib/schemas/schemas.ts`** (~line 116)
- Add `"LOCAL_qwen2.5:14b"` to `allowedLLMModelSchema` enum
- Note: `configValidation.ts` derives `ALLOWED_MODELS` from this schema automatically — no separate change needed

**File 2: `src/lib/services/llms.ts`**

Add detection function (after `isAnthropicModel`, ~line 165):
```typescript
function isLocalModel(model: string): boolean {
  return model.startsWith('LOCAL_');
}
```

Add client getter (after `getAnthropicClient`, ~line 185):
```typescript
let localClient: OpenAI | null = null;
function getLocalClient(): OpenAI {
  if (!localClient) {
    localClient = new OpenAI({
      apiKey: 'local',  // Ollama requires no auth; dummy value satisfies SDK constructor
      baseURL: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1',
      maxRetries: 3,
      timeout: 300000,  // 5 min — CPU inference at ~8 tok/s needs much more than the default 60s
    });
  }
  return localClient;
}
```

Modify client selection in `callOpenAIModel()` (line 243):
```typescript
// BEFORE:
const client = isDeepSeekModel(validatedModel) ? getDeepSeekClient() : getOpenAIClient();

// AFTER:
const client = isLocalModel(validatedModel)
  ? getLocalClient()
  : isDeepSeekModel(validatedModel) ? getDeepSeekClient() : getOpenAIClient();
```

Strip `LOCAL_` prefix for the API model field (after line 204, before building requestOptions):
```typescript
// Strip 'LOCAL_' prefix so Ollama receives the actual model name (e.g., 'qwen2.5:14b')
const apiModel = isLocalModel(validatedModel) ? validatedModel.replace('LOCAL_', '') : validatedModel;
// Then use apiModel instead of validatedModel in requestOptions.model (line 219)
```

Structured output handling — local models use same fallback as DeepSeek (line 228):
```typescript
if (isDeepSeekModel(validatedModel) || isLocalModel(validatedModel)) {
  requestOptions.response_format = { type: 'json_object' };
}
```

**File 3: `src/config/llmPricing.ts`**
- Add `'LOCAL_qwen2.5:14b': { inputPer1M: 0, outputPer1M: 0 }` pricing entry
- This ensures `calculateLLMCost()` returns $0 and spending gate reserves $0 budget

**File 4: `evolution/scripts/run-evolution-local.ts`** (~line 326, `createDirectLLMClient`)
- Add local model detection alongside existing DeepSeek/Anthropic (~line 332):
```typescript
const isLocal = model.startsWith('LOCAL_');
const apiModel = isLocal ? model.replace('LOCAL_', '') : model;
```
- Add client construction for local models (~line 401):
```typescript
if (isLocal) {
  return new OpenAI({
    apiKey: 'local',
    baseURL: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1',
    maxRetries: 3,
    timeout: 300000,
  });
}
```
- Use `apiModel` instead of `model` in the API call at line 420:
```typescript
// line 420: model → apiModel so Ollama receives 'qwen2.5:14b' not 'LOCAL_qwen2.5:14b'
const completion = await client.chat.completions.create({ model: apiModel, ... });
```
- Keep prefixed `model` name for `llmCallTracking` inserts (line 448) — distinguishes local vs cloud in cost tracking
- Guard `estimateTokenCost()` at call site (~line 414): skip cost estimation or return $0 when `isLocal` is true (function signature doesn't accept model param)
- Note: `completeStructured()` uses prompt-based JSON parsing (no `response_format`), same as DeepSeek — no changes needed there

### Phase 3: Environment Configuration
- Add `LOCAL_LLM_BASE_URL=http://localhost:11434/v1` to minicomputer's `.env.local`
- No changes needed for cloud environments (they won't have the env var; local client only created when `isLocalModel()` matches)

### Phase 4: Test with Evolution Run
- Create a test evolution run with config:
  ```json
  { "generationModel": "LOCAL_qwen2.5:14b", "judgeModel": "LOCAL_qwen2.5:14b" }
  ```
- Monitor via `journalctl -u evolution-runner -f`
- Watch for: model cold-start delay (~30-60s on first call if Ollama unloaded model from RAM), timeouts, JSON parse failures
- Compare output quality against a DeepSeek run on the same prompt
- Measure wall-clock time per run

### Phase 5: Evaluate and Decide
- Compare quality, speed, and reliability
- Decide whether to use local model for generation, judging, or both
- Consider hybrid approach: local for judging (short outputs), DeepSeek for generation
- If cold-start is an issue, configure Ollama `keep_alive` parameter to keep model loaded

## Rollback Plan
- If local model produces bad outputs or is too slow: revert model config in evolution runs back to `deepseek-chat`
- Code changes are additive (new model name, new client) — they don't affect existing cloud model paths
- No database migrations or schema changes involved

## Testing

### Unit Tests — `src/lib/services/llms.test.ts`
- Add test: `isLocalModel('LOCAL_qwen2.5:14b')` returns `true`
- Add test: `isLocalModel('gpt-4.1-mini')` returns `false`
- Add test: local client uses correct baseURL and dummy apiKey
- Add test: model name prefix stripping produces correct API model name

### Unit Tests — `src/config/llmPricing.test.ts`
- Add test: `getModelPricing('LOCAL_qwen2.5:14b')` returns `{ inputPer1M: 0, outputPer1M: 0 }`
- Add test: `calculateLLMCost('LOCAL_qwen2.5:14b', 1000, 1000, 0)` returns `0`

### Unit Tests — `src/lib/schemas/schemas.test.ts`
- Add `'LOCAL_qwen2.5:14b'` to positive validation test cases (~line 72)

### Manual Testing on Minicomputer
- Verify Ollama API responds on localhost:11434
- Verify Ollama is NOT accessible from external network (bound to 127.0.0.1)
- Run a single evolution run with local model, confirm it completes
- Compare article quality: local vs DeepSeek on same prompt
- Verify cost tracking shows $0 for local model calls
- Verify structured JSON output works (tag evaluation, match ranking)
- Test model cold-start behavior after idle period

### No E2E or CI/CD Changes Needed
- Local model is only used on minicomputer for evolution runs
- Main app (Vercel) continues using cloud APIs unchanged
- CI has no Ollama server, so local model tests use mocks or are skipped
- Existing tests unaffected: new model name is additive to the schema enum

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/llm_provider_limits.md` - Add local model as a provider with $0 cost
- `docs/docs_overall/environments.md` - Add LOCAL_LLM_BASE_URL env var, document Ollama setup on minicomputer
- `evolution/docs/evolution/minicomputer_deployment.md` - Add Ollama installation, model pull, and systemd override steps
- `docs/feature_deep_dives/search_generation_pipeline.md` - No changes needed (local model only for evolution)
- `docs/feature_deep_dives/ai_suggestions_overview.md` - No changes needed (local model only for evolution)
