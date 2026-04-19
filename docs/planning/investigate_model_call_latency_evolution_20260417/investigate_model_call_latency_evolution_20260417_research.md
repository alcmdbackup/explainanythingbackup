# Investigate Model Call Latency Evolution Research

## Problem Statement
LLM calls in the evolution pipeline on staging are showing 30+ second latencies. We need to benchmark Gemini, DeepSeek, and GPT-5 Nano under different concurrency levels (1, 5, 10 parallel calls) to establish baseline latency, then investigate the root cause of the high latencies observed in production run data.

## Requirements
I want to tests running Gemini, Deepseek, and Gpt5 nano calls - 1 at a time, 5 at a time and 10 at a time to test typical call latency. My run data on stage is showing that typical LLM calls take 30+ seconds to complete which takes very long. Do this test first, but then otherwise help me figure out why.

## High Level Summary

The 30+ second latency observed on staging is likely a combination of:
1. **Actual provider latency** (the dominant factor — needs benchmarking to quantify)
2. **Awaited DB overhead after each LLM call** (~200-700ms per call from tracking + metrics writes)
3. **Semaphore queuing** under high parallelism (can add seconds when 20-slot limit is hit)
4. **Spending gate DB round-trips** on cache miss (100-300ms, infrequent)

Key discovery: The `writeMetricMax` calls in `createEvolutionLLMClient.ts` are **awaited** (not fire-and-forget as commented), adding 100-300ms per LLM call. The `saveLlmCallTracking` in `llms.ts` uses `.insert().select().single()` (2 DB round-trips) and is also awaited, adding another 100-400ms.

## Target Models for Benchmark

| Model | ID | Provider | Routing | Pricing (in/out per 1M) |
|-------|------|----------|---------|------------------------|
| GPT-5 Nano | `gpt-5-nano` | OpenAI | Direct | $0.05 / $0.40 |
| DeepSeek Chat | `deepseek-chat` | DeepSeek | Direct | $0.28 / $0.42 |
| Gemini 2.5 Flash Lite | `google/gemini-2.5-flash-lite` | Google via OpenRouter | Extra hop | $0.10 / $0.40 |

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/environments.md — local dev env, staging DB access
- docs/docs_overall/debugging.md — read-only DB query tools
- All evolution docs (15 files)
- docs/feature_deep_dives/request_tracing_observability.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/metrics_analytics.md
- src/config/llmPricing.ts
- src/lib/services/llms.ts

## Code Files Read
- `src/config/llmPricing.ts` — LLM token pricing, model lookup, cost calculation
- `src/config/modelRegistry.ts` — Model registry with provider routing, pricing, evolution support flags
- `src/lib/services/llms.ts` — LLM service routing (OpenAI, Anthropic, DeepSeek, OpenRouter), call tracking, tracing
- `src/lib/services/llmSemaphore.ts` — FIFO semaphore, default 20 slots, only for `evolution_*` calls
- `src/lib/services/llmSpendingGate.ts` — Global budget gate with cache TTLs (daily=30s, kill=5s, monthly=60s)
- `src/lib/schemas/schemas.ts` — `llmCallTracking` schema (no duration_ms field), `allowedLLMModelSchema`
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — Retry logic (3x backoff 1s/2s/4s), 60s timeout, awaited writeMetricMax
- `evolution/src/lib/pipeline/infra/trackInvocations.ts` — `duration_ms` written to `evolution_agent_invocations`
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — AgentCostScope pattern for parallel isolation
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `median_sequential_gfsa_duration_ms` metric computed at finalization
- `evolution/src/lib/core/Agent.ts` — `Date.now()` timing, writes `duration_ms` to invocations
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — Records `generation.durationMs` and `ranking.durationMs` in execution_detail
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — Per-comparison `durationMs` tracked
- `evolution/src/lib/metrics/writeMetrics.ts` — `writeMetricMax` calls `upsert_metric_max` RPC (1 DB round-trip, awaited)
- `evolution/src/lib/shared/computeRatings.ts` — `buildComparisonPrompt()` structure
- `evolution/src/lib/comparison.ts` — 2-pass reversal comparison (2 parallel LLM calls per comparison)
- `evolution/scripts/test-judge-models-v2.ts` — Existing benchmark template using direct OpenAI SDK + OpenRouter
- `evolution/scripts/run-evolution-local.ts` — Standalone runner with direct provider factory pattern
- `instrumentation.ts` — OpenTelemetry spans for LLM calls, duration auto-tracked, sent to Honeycomb

## Key Findings

### 1. LLM Call Path Latency Breakdown

A typical evolution LLM call goes through this path:

```
callLLM() [llms.ts]
  ├── spendingGate.checkBudget()        0-300ms  (usually 0 on cache hit)
  ├── semaphore.acquire()               0-15s    (only evolution_* calls, 20-slot limit)
  ├── routeLLMCall → callOpenAIModel()
  │   ├── createLLMSpan()               <1ms
  │   ├── client.chat.completions.create()  VARIABLE (provider latency)
  │   ├── saveTrackingAndNotify()       100-400ms  (AWAITED, insert+select = 2 DB round-trips)
  │   └── span.end()                    <1ms
  └── spendingGate.reconcileAfterCall() fire-and-forget (good)
```

For evolution calls, `createEvolutionLLMClient` adds:
```
  ├── costTracker.reserve()             <1ms  (synchronous)
  ├── Promise.race(provider, 60s timeout)  VARIABLE
  ├── costTracker.recordSpend()         <1ms  (synchronous)
  ├── writeMetricMax(cost)              50-150ms  (AWAITED, 1 RPC)
  └── writeMetricMax(phase_cost)        50-150ms  (AWAITED, 1 RPC)
```

**Total overhead per LLM call: 200-700ms** from DB writes alone.

### 2. Semaphore Can Cause Major Delays

- `llmSemaphore.ts`: Default limit = 20 concurrent calls (`EVOLUTION_MAX_CONCURRENT_LLM`)
- FIFO queue — when at limit, calls block until a slot frees
- Only affects `evolution_*` call sources
- Under parallel GFSA dispatch (9 agents × 2+ LLM calls each = 18+ concurrent), the semaphore rarely blocks
- But with multiple concurrent runs, it becomes a bottleneck
- Observability: `semaphore.active`, `.waiting`, `.limit` getters exist but are not logged

### 3. Per-LLM-Call Duration Not Tracked in `llmCallTracking`

The `llmCallTracking` table has NO `duration_ms` column. However:
- `evolution_agent_invocations.duration_ms` tracks per-agent wall-clock time
- `execution_detail.generation.durationMs` tracks generation phase time
- `execution_detail.ranking.durationMs` tracks ranking phase time
- `execution_detail.ranking.comparisons[].durationMs` tracks per-comparison time (both passes)
- OpenTelemetry spans in Honeycomb have auto-tracked duration

### 4. Existing Benchmark Infrastructure

- `evolution/scripts/test-judge-models-v2.ts` — Direct OpenRouter SDK calls with `Date.now()` timing, perfect template
- `evolution/scripts/run-evolution-local.ts` — Full pipeline runner with `--model` flag, creates direct providers
- Pattern: `dotenv.config({ path: '.env.local' })`, then direct SDK initialization
- All target models are already registered and support evolution

### 5. Typical Prompt Sizes

| Call Type | Prompt Size | Notes |
|-----------|-------------|-------|
| Generation | 1.8-4.2 KB | Source article + strategy instructions + FORMAT_RULES (384 chars) |
| Comparison (ranking) | 2.7-6.6 KB | Two full article variants side-by-side |
| Seed title | ~300 chars | Minimal |
| Seed article | ~1 KB | Title + rules + FORMAT_RULES |

### 6. Staging DB Access

- `npm run query:staging` — interactive REPL using `readonly_local` role
- `.env.staging.readonly` config file needed
- 30-second query timeout, SELECT-only
- Can query `evolution_agent_invocations` for `duration_ms` data

### 7. Three Levels of Benchmark Needed

1. **Raw provider latency** — Direct SDK calls bypassing all app overhead
2. **Through callLLM** — Includes spending gate, semaphore, tracking writes
3. **Through evolution pipeline** — Full agent dispatch with cost tracking + metric writes

Comparing levels 1 vs 2 quantifies app overhead. Comparing 2 vs 3 quantifies evolution-specific overhead.

## Open Questions

1. What are the actual raw provider latencies for GPT-5 Nano, DeepSeek, and Gemini at different concurrency levels?
2. How much does OpenRouter add to Gemini latency vs a direct Google API call?
3. Are the awaited `writeMetricMax` + `saveLlmCallTracking` writes the main source of overhead, or is provider latency dominant?
4. What does `evolution_agent_invocations.duration_ms` look like on recent staging runs?
5. Should the `writeMetricMax` calls be made fire-and-forget to reduce per-call overhead?
