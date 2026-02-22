# Consolidate LLM Infrastructure Research

## Problem Statement
The codebase has two parallel LLM infrastructure systems: a centralized `callOpenAIModel` service used by 13+ production call sites, and an evolution pipeline LLM client that wraps the same function but maintains its own duplicate pricing table. This research documents how both systems work today — their call patterns, model routing, cost tracking, and budget enforcement — to inform consolidation planning.

## High Level Summary

### Two-Layer Architecture

**Layer 1: Central LLM Service** (`src/lib/services/llms.ts`)
- Single function `callOpenAIModel` handles all LLM API calls across the entire application
- Supports OpenAI and DeepSeek via separate lazy-initialized clients
- Routes DeepSeek models (`deepseek-*`) to a different base URL
- Handles streaming and non-streaming modes, structured output (Zod → `zodResponseFormat`), and plain text
- Every call is tracked in the `llmCallTracking` Supabase table with full token counts and estimated cost
- Cost calculation uses `calculateLLMCost()` from `src/config/llmPricing.ts`
- Wrapped with `withLogging` for automatic entry/exit/timing telemetry and OpenTelemetry span creation

**Layer 2: Evolution LLM Client** (`src/lib/evolution/core/llmClient.ts`)
- Wraps `callOpenAIModel` with budget enforcement via `CostTracker`
- Defaults to `deepseek-chat` for cost efficiency
- Maintains its **own** `MODEL_PRICING` table (duplicate of `llmPricing.ts` but with different structure — per-token vs per-1M-token)
- Uses `estimateTokenCost()` heuristic (prompt.length / 4) for pre-call budget reservation
- Actual costs are tracked by the underlying `callOpenAIModel` → `saveLlmCallTracking` path

### Model Selection Patterns

| Context | Default Model | Override Mechanism |
|---------|---------------|-------------------|
| Main site (most services) | `gpt-4.1-mini` (`default_model`) | Hardcoded per-service |
| Main site (lightweight) | `gpt-4.1-nano` (`lighter_model`) | Hardcoded per-service |
| Evolution generation/reflection | `deepseek-chat` | `config.generationModel` |
| Evolution judge/ranking | `gpt-4.1-nano` | `config.judgeModel` |

### Cost Tracking: Dual Systems

1. **Global**: `llmCallTracking` table captures every API call. Admin dashboard at `/admin/costs` shows totals, daily breakdown, per-model, per-user costs.
2. **Evolution-specific**: `evolution_runs.total_cost_usd` tracks aggregate run cost. Visualization dashboards query `llmCallTracking` filtered by `call_source LIKE 'evolution_%'` for per-agent breakdowns.

---

## Detailed Findings

### 1. Central LLM Service (`src/lib/services/llms.ts`)

**Function signature** (line 153):
```typescript
async function callOpenAIModel(
    prompt: string,
    call_source: string,     // e.g., 'evaluateTags', 'evolution_GeneratorAgent'
    userid: string,
    model: AllowedLLMModelType,
    streaming: boolean,
    setText: ((text: string) => void) | null,
    response_obj: ResponseObject = null,
    response_obj_name: string | null = null,
    debug: boolean = true
): Promise<string>
```

**Client initialization** (lines 86-131):
- OpenAI client: lazy singleton, 3 retries, 60s timeout
- DeepSeek client: lazy singleton at `https://api.deepseek.com`, 3 retries, 60s timeout
- Routing: `isDeepSeekModel()` checks `model.startsWith('deepseek-')`

**Structured output handling** (lines 193-200):
- OpenAI models: uses `zodResponseFormat(schema, name)` for native structured output
- DeepSeek models: falls back to `{ type: 'json_object' }` (no native JSON Schema support)

**Observability** (lines 202-277):
- Creates OpenTelemetry span via `createLLMSpan()` with model, prompt length, call source, streaming attributes
- Records completion/prompt/total tokens and finish reason on span

**Call tracking** (lines 280-299):
- After every successful call, constructs `LlmCallTrackingType` object
- Calls `saveLlmCallTracking()` which validates with Zod and inserts into `llmCallTracking` table
- Includes `estimated_cost_usd` calculated via `calculateLLMCost()`

**Allowed models** (from `schemas.ts` line 119):
```
gpt-4o-mini, gpt-4.1-nano, gpt-5-mini, gpt-5-nano, gpt-4.1-mini, gpt-4.1-nano, deepseek-chat
```

### 2. LLM Pricing (`src/config/llmPricing.ts`)

**Structure**: `Record<string, ModelPricing>` with `inputPer1M` and `outputPer1M` (USD per 1M tokens).

**Contains 26 model entries** including:
- OpenAI GPT-4.1 family (gpt-4.1, gpt-4.1-mini, gpt-4.1-nano)
- OpenAI GPT-5 family (gpt-5-mini, gpt-5-nano)
- OpenAI GPT-4o family (4 variants)
- OpenAI GPT-4o-mini (2 variants)
- OpenAI o1 reasoning models (6 variants with `reasoningPer1M`)
- OpenAI GPT-4 Turbo/GPT-4/GPT-3.5
- DeepSeek (`deepseek-chat`)
- Anthropic Claude 3/3.5 family (5 variants)

**Fallback**: Default pricing of $10/M input, $30/M output for unknown models.

**Lookup**: First tries exact match, then prefix match (e.g., `gpt-4o-2024-11-20` matches `gpt-4o` entry).

### 3. Evolution LLM Client (`src/lib/evolution/core/llmClient.ts`)

**Duplicate pricing** (lines 14-21):
```typescript
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.00014, output: 0.00028 },
  'gpt-4.1-mini':  { input: 0.0004,  output: 0.0016 },
  'gpt-4.1-nano':  { input: 0.0001,  output: 0.0004 },
  'gpt-4o-mini':   { input: 0.0004,  output: 0.0016 },
  'gpt-5-mini':    { input: 0.0004,  output: 0.0016 },
  'gpt-5-nano':    { input: 0.0001,  output: 0.0004 },
};
```
**Bug**: Despite the comment "cost per 1M tokens", the values are 1000x lower than `llmPricing.ts` (`0.00014` vs `0.14` for deepseek-chat input). Both apply the same `/1_000_000` division, so evolution budget estimates are 1000x too low. The `$5` budget cap is effectively never enforced.

**Budget estimation** (lines 24-32): `estimateTokenCost()` uses a heuristic of ~4 chars per token, assumes 50% output ratio.

**Methods**:
- `complete()`: Plain text completion with budget reservation
- `completeStructured<T>()`: Structured output with Zod parsing, JSON cleanup for trailing commas

### 4. Evolution Cost Tracker (`src/lib/evolution/core/costTracker.ts`)

**CostTrackerImpl** tracks:
- `spentByAgent`: Map of actual costs per agent
- `reservedByAgent`: Map of optimistic pre-call reservations
- 30% safety margin on all reservations

**Budget enforcement**:
- Per-agent cap: `budgetCaps[agentName]` as percentage of `budgetCapUsd` (defaults in config.ts: generation=25%, calibration=20%, tournament=30%, evolution=20%, reflection=5%)
- Global cap: `budgetCapUsd` default $5.00
- Throws `BudgetExceededError` if either cap would be exceeded

### 5. Evolution Pipeline Agents — LLM Usage

| Agent | LLM Method | Model | Calls per Execution |
|-------|-----------|-------|-------------------|
| GenerationAgent | `complete()` | default (deepseek-chat) | 3 parallel (one per strategy) |
| EvolutionAgent (evolvePool) | `complete()` | default (deepseek-chat) | 3 + 30% chance of 4th |
| CalibrationRanker | `complete()` | `judgeModel` (gpt-4.1-nano) | 2× per pair (bias mitigation) |
| PairwiseRanker | `complete()` | `judgeModel` (gpt-4.1-nano) | 2× per pair (bias mitigation) |
| Tournament | delegates to PairwiseRanker | `judgeModel` (gpt-4.1-nano) | 15-40 comparisons adaptive |
| ReflectionAgent | `complete()` | default (deepseek-chat) | 3 parallel (top variants) |
| MetaReviewAgent | none | N/A | Pure local analysis |
| ProximityAgent | none | N/A | Deterministic embeddings (LLM deferred) |

### 6. All `callOpenAIModel` Call Sites (13 production files)

**Main site services using `default_model` (gpt-4.1-mini)**:
- `returnExplanation.ts` — 3 calls: generateTitle, extractLinkCandidates, generateNewExplanation (streaming)
- `tagEvaluation.ts` — 1 call: evaluateTags (structured)
- `importArticle.ts` — 1 call: cleanupAndReformat (structured)
- `findMatches.ts` — 1 call: findBestMatchFromList (structured)
- `links.ts` — 2 calls: headingLinks (structured) + inlineLinks (plain)
- `linkWhitelist.ts` — 1 call: generateHeadingStandaloneTitles (structured)
- `editorFiles/actions/actions.ts` — 1 call: generateAISuggestions (structured)
- `app/api/stream-chat/route.ts` — 1 call: streaming SSE chat
- `actions/actions.ts` — imports callOpenAIModel (call site exists)

**Main site services using `lighter_model` (gpt-4.1-nano)**:
- `sourceSummarizer.ts` — 1 call: summarizeSourceContent (plain)
- `contentQualityCompare.ts` — 2 calls: scoreArticle + runComparison (structured)
- `contentQualityEval.ts` — 1 call: evaluateContentQuality (structured)
- `explanationSummarizer.ts` — 1 call: generateSummary (structured)
- `editorFiles/actions/actions.ts` — 1 call: applyAISuggestions (plain)

**Evolution pipeline** (via `llmClient.ts` wrapper):
- All evolution agents route through `createEvolutionLLMClient` → `callOpenAIModel`

### 7. Database Schema for LLM Tracking

**`llmCallTracking` table** (from migration `20251109053825_fix_drift.sql`):
- `id` (serial), `prompt` (text), `call_source` (varchar 255), `content` (text)
- `raw_api_response` (text), `model` (varchar 100)
- `prompt_tokens`, `completion_tokens`, `total_tokens`, `reasoning_tokens` (int)
- `finish_reason` (varchar 50), `created_at` (timestamptz), `userid` (uuid)
- `estimated_cost_usd` (numeric 10,6) — added in migration `20260116061036`

**`daily_llm_costs` view** (from same migration):
- Aggregates by date: total_cost, call_count, total_tokens

**`evolution_runs` table** (from migration `20260131000001`):
- `total_cost_usd` (numeric 10,4), `budget_cap_usd` (numeric 10,4)
- `run_summary` (JSONB) — added in migration `20260131000009`

### 8. Admin Dashboards

**Cost Analytics** (`/admin/costs`):
- Service: `src/lib/services/costAnalytics.ts`
- Actions: getCostSummary, getDailyCosts, getCostByModel, getCostByUser, backfillCosts
- UI: Summary cards, daily chart, model breakdown, top users

**Evolution Dashboard** (`/admin/quality/evolution/dashboard`):
- Shows per-run costs from `evolution_runs.total_cost_usd`
- Per-agent cost breakdowns queried from `llmCallTracking` filtered by `call_source LIKE 'evolution_%'`

---

## Follow-up Research: Consolidation Opportunities

### 9. Critical Finding: `recordSpend()` Is Never Called in Production

The `CostTracker.recordSpend()` method exists but is **never called in the Next.js pipeline path**. Only the standalone CLI script (`scripts/run-evolution-local.ts:317`) calls it.

**What this means**: In production, the CostTracker operates purely on pre-call heuristic estimates (chars/4 tokens, 50% output ratio, 30% safety margin). The actual token counts from the OpenAI API response — which are available inside `callOpenAIModel` at line 280 — are saved to `llmCallTracking` but never fed back to the CostTracker.

**Impact**: `evolution_runs.total_cost_usd` (set from `costTracker.getTotalSpent()` at `pipeline.ts:231,417`) reflects only accumulated reservation estimates, not actual API costs. All agents return `costUsd: 0` in their `AgentResult`.

### 10. Three Separate LLM Client Implementations

The codebase has **three** implementations of the LLM client pattern:

| Implementation | File | Used By | Calls `recordSpend`? | Has Actual Costs? |
|---|---|---|---|---|
| **Central service** | `src/lib/services/llms.ts` | All main site + evolution wrapper | N/A (no CostTracker) | Yes (saves to DB) |
| **Evolution wrapper** | `src/lib/evolution/core/llmClient.ts` | Next.js evolution pipeline | No | No (estimates only) |
| **CLI direct client** | `scripts/run-evolution-local.ts:270` | Standalone CLI | Yes (line 317) | Yes (from API response) |

The CLI script (`run-evolution-local.ts`) is the **most complete** implementation because it:
- Creates its own OpenAI client directly (bypasses `callOpenAIModel` to avoid Next.js imports)
- Calls `costTracker.recordSpend()` with real costs from `response.usage`
- Manually inserts into `llmCallTracking` table for dashboard visibility
- Has its own inlined copies of `estimateTokenCost()` (line 140) and `parseStructuredOutput()` (line 153)
- Has its own hardcoded pricing (line 290: `deepseek 0.14/0.28`, OpenAI `0.40/1.60`)

### 11. Duplicate Pricing Tables (Three Copies)

| Location | Format | Models Covered |
|---|---|---|
| `src/config/llmPricing.ts` | Per 1M tokens (`inputPer1M`) | 26 models (comprehensive) |
| `src/lib/evolution/core/llmClient.ts:14-21` | Per 1M tokens but named `{ input, output }` | 6 models |
| `scripts/run-evolution-local.ts:290-291` | Per 1M tokens (inline) | 2 models (deepseek + OpenAI) |

All three must be updated when pricing changes. The central `llmPricing.ts` is the most comprehensive.

### 12. What the Evolution Wrapper Actually Provides

Decomposing the wrapper's responsibilities reveals what must be preserved or relocated during consolidation:

**a) Budget enforcement (pre-call)**
- `costTracker.reserveBudget(agentName, estimate)` — called before every LLM call
- Per-agent caps + global cap enforcement
- Throws `BudgetExceededError` to pause pipeline
- **This is the core value of the wrapper** — the central service has no budget concept

**b) Default model routing**
- Defaults to `deepseek-chat` instead of `gpt-4.1-mini`
- Agents pass `options?.model` to override (e.g., `judgeModel` for ranking agents)
- **Trivially replaceable** — agents could pass model directly

**c) Agent-name call_source prefixing**
- Prepends `evolution_` to agent name: `evolution_${agentName}`
- **Trivially replaceable** — callers could do this themselves

**d) Structured output parsing with JSON cleanup**
- `parseStructuredOutput()` handles trailing commas in JSON
- **Note**: No agent currently uses `completeStructured()` — all use `complete()` with manual parsing
- ReflectionAgent has its own JSON extraction via regex (`reflectionAgent.ts:67`)

**e) Empty response detection**
- Throws `LLMRefusalError` on empty responses
- **Could move into central service** or remain caller-side

### 13. `callOpenAIModel` Returns Only String — The Core Blocker

The central service's return type is `Promise<string>`. Internally it has:
- `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`
- `estimated_cost_usd` (calculated via `calculateLLMCost`)
- `modelUsed`, `finishReason`

But none of this metadata is returned to callers. This is why:
- The evolution wrapper can't call `recordSpend()` with actual costs
- The CLI script bypasses `callOpenAIModel` entirely and creates its own OpenAI client

**Existing pattern for metadata returns** in the codebase:
- `returnExplanation.ts` returns `{ success, title, error }`
- `tagEvaluation.ts` returns `{ difficultyLevel, length, simpleTags, error }`
- `AgentResult` has `costUsd`, `variantsAdded`, `matchesPlayed` fields

The codebase already uses result objects with metadata — `callOpenAIModel` is the outlier returning raw string.

### 14. What Would Change If the Wrapper Were Eliminated

**Agents are clean** — all 6 LLM-calling agents access the client exclusively through `ctx.llmClient.complete()` / `ctx.llmClient.completeStructured()`. None import `callOpenAIModel` directly. None need streaming.

**The `EvolutionLLMClient` interface** (`types.ts:129-143`) is the contract:
```typescript
interface EvolutionLLMClient {
  complete(prompt, agentName, options?): Promise<string>;
  completeStructured<T>(prompt, schema, schemaName, agentName, options?): Promise<T>;
}
```

To eliminate the wrapper, the central service would need to:
1. Return cost metadata alongside the response string (so CostTracker can record actual spend)
2. Support a pre-call budget check hook (or accept a CostTracker/callback)
3. Keep the `EvolutionLLMClient` interface as a thin adapter (agents shouldn't change)

**The CLI script would also benefit** — currently it duplicates the entire OpenAI client setup because it can't use `callOpenAIModel` (Next.js import chain). If the central service were importable from non-Next.js contexts, the CLI script could drop 100+ lines.

### 15. Scope of Downstream Impact

**Files that would NOT change** (agents — they depend on `EvolutionLLMClient` interface, not the implementation):
- All 8 agents in `src/lib/evolution/agents/`
- `src/lib/evolution/core/pipeline.ts` (uses `ctx.costTracker.getTotalSpent()` — same API)
- `src/lib/evolution/core/supervisor.ts`

**Files that WOULD change**:
- `src/lib/services/llms.ts` — Return type expansion or new overload
- `src/lib/evolution/core/llmClient.ts` — Simplify or eliminate (main target)
- `src/lib/evolution/core/costTracker.ts` — Wire up `recordSpend()` with actual costs
- `scripts/run-evolution-local.ts` — Replace `createDirectLLMClient` with shared implementation
- `src/lib/evolution/types.ts` — Possibly update `EvolutionLLMClient` interface
- `src/config/llmPricing.ts` — Becomes single source of truth (already is, but wrappers duplicate)

**13 main-site callers would NOT change** — they don't need cost metadata (they don't budget-track).

---

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

## Code Files Read
- `src/lib/services/llms.ts` — Central LLM service (callOpenAIModel)
- `src/config/llmPricing.ts` — Model pricing table and cost calculation
- `src/lib/schemas/schemas.ts` — allowedLLMModelSchema (line 119), llmCallTrackingSchema (line 551)
- `src/lib/evolution/index.ts` — Public API re-exports
- `src/lib/evolution/types.ts` — EvolutionLLMClient, CostTracker interfaces
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig, Elo constants
- `src/lib/evolution/core/llmClient.ts` — Evolution LLM wrapper with duplicate pricing
- `src/lib/evolution/core/costTracker.ts` — Budget enforcement (CostTrackerImpl)
- `src/lib/evolution/agents/generationAgent.ts`
- `src/lib/evolution/agents/evolvePool.ts`
- `src/lib/evolution/agents/calibrationRanker.ts`
- `src/lib/evolution/agents/pairwiseRanker.ts`
- `src/lib/evolution/agents/tournament.ts`
- `src/lib/evolution/agents/reflectionAgent.ts`
- `src/lib/evolution/agents/metaReviewAgent.ts`
- `src/lib/evolution/agents/proximityAgent.ts`
- `src/lib/services/returnExplanation.ts`
- `src/lib/services/tagEvaluation.ts`
- `src/lib/services/importArticle.ts`
- `src/lib/services/findMatches.ts`
- `src/lib/services/links.ts`
- `src/lib/services/linkWhitelist.ts`
- `src/lib/services/sourceSummarizer.ts`
- `src/lib/services/contentQualityCompare.ts`
- `src/lib/services/contentQualityEval.ts`
- `src/lib/services/explanationSummarizer.ts`
- `src/lib/services/costAnalytics.ts`
- `src/lib/services/evolutionVisualizationActions.ts`
- `src/lib/services/evolutionActions.ts`
- `src/editorFiles/actions/actions.ts`
- `src/app/api/stream-chat/route.ts`
- `src/actions/actions.ts`
- `supabase/migrations/20251109053825_fix_drift.sql`
- `supabase/migrations/20260116061036_add_llm_cost_tracking.sql`
- `supabase/migrations/20260131000001_evolution_runs.sql`
- `supabase/migrations/20260131000002_evolution_variants.sql`
- `supabase/migrations/20260131000009_add_evolution_run_summary.sql`
- `scripts/run-evolution-local.ts` — Standalone CLI with its own direct LLM client and cost reconciliation
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator (minimal + full modes)
