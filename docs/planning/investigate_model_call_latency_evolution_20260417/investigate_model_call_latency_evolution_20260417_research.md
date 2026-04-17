# Investigate Model Call Latency Evolution Research

## Problem Statement
LLM calls in the evolution pipeline on staging are showing 30+ second latencies. We need to benchmark Gemini, DeepSeek, and GPT-5 Nano under different concurrency levels (1, 5, 10 parallel calls) to establish baseline latency, then investigate the root cause of the high latencies observed in production run data.

## Requirements
I want to tests running Gemini, Deepseek, and Gpt5 nano calls - 1 at a time, 5 at a time and 10 at a time to test typical call latency. My run data on stage is showing that typical LLM calls take 30+ seconds to complete which takes very long. Do this test first, but then otherwise help me figure out why.

## High Level Summary
[To be populated during research]

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- All evolution docs (15 files)
- docs/feature_deep_dives/request_tracing_observability.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/metrics_analytics.md
- src/config/llmPricing.ts
- src/lib/services/llms.ts

## Code Files Read
- src/config/llmPricing.ts — LLM token pricing, model lookup, cost calculation
- src/lib/services/llms.ts — LLM service routing (OpenAI, Anthropic, DeepSeek, OpenRouter), call tracking, tracing
