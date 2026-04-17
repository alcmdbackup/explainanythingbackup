# Investigate Model Call Latency Evolution Plan

## Background
LLM calls in the evolution pipeline on staging are showing 30+ second latencies. We need to benchmark Gemini, DeepSeek, and GPT-5 Nano under different concurrency levels (1, 5, 10 parallel calls) to establish baseline latency, then investigate the root cause of the high latencies observed in production run data.

## Requirements
I want to tests running Gemini, Deepseek, and Gpt5 nano calls - 1 at a time, 5 at a time and 10 at a time to test typical call latency. My run data on stage is showing that typical LLM calls take 30+ seconds to complete which takes very long. Do this test first, but then otherwise help me figure out why.

## Problem
Evolution pipeline runs are taking significantly longer than expected, with individual LLM calls averaging 30+ seconds on staging. This could be caused by provider-side latency, concurrency bottlenecks (LLM semaphore), spending gate DB round-trips, network issues, or prompt size. Need to isolate the root cause by first establishing clean baseline latency benchmarks.

## Root Cause (confirmed)
The 30+ second latency is **raw provider throughput**, not app overhead:
- DeepSeek: ~134 chars/s, 22-25s per generation call
- GPT-5 Nano: ~153 chars/s, 22-28s per generation call, frequent 30s timeouts (73% timeout rate)
- Gemini Flash Lite: ~1,257 chars/s, 4s per generation call — 6x faster than alternatives

Secondary issue: nested retry cascades (SDK retries × evolution retries) could stall a single call for 16+ minutes. Fixed by removing SDK retries.

## Phased Execution Plan

### Phase 1: Latency Benchmark Script
- [x] Create a standalone benchmark script (`evolution/scripts/benchmark-latency.ts`)
- [x] Test at concurrency levels: 1, 5, and 10 parallel calls
- [x] Use a standardized prompt (~3,590 chars, similar to typical evolution generation prompt)
- [x] Record: wall-clock latency, tokens, response chars, throughput
- [x] Output results as a formatted table + JSON

### Phase 2: Analyze Staging Run Data
- [x] Query evolution_agent_invocations for recent runs on staging (llmCallTracking has no evolution data — batch runner lacks service role key)
- [x] Compute p50/p90/p99 latency by model and call_source
- [x] Identify latency correlates with generation model and output length
- [x] Check evolution_agent_invocations.duration_ms for per-agent latency breakdown
- [x] Break down GFSA duration into generation.durationMs vs ranking.durationMs

### Phase 3: Root Cause Investigation
- [x] Check if LLM semaphore is causing queuing delays — No, not the bottleneck
- [x] Check if spending gate DB round-trips add significant overhead — Usually cached, not significant
- [x] Check if OpenRouter routing adds latency vs direct provider calls — Gemini via OpenRouter is fastest
- [x] Check if prompt sizes have grown beyond expected ranges — All ~8.6-9.5K chars, normal
- [x] Identified root cause: slow provider token throughput (DeepSeek/Nano ~130-165 chars/s vs Gemini ~1,250 chars/s)

### Phase 4: Fix Timeout/Retry Cascade (added during investigation)
- [x] Reduce per-call timeout from 60s to 20s in createEvolutionLLMClient
- [x] Set maxRetries: 0 on all SDK clients (OpenAI, DeepSeek, OpenRouter, Anthropic, Local)
- [x] Update timeout to 20s on all SDK clients
- [x] Update tests to match new timeout values
- [x] Worst-case per-call: 87s (was 16 min)

## Benchmark Results (raw provider latency, no app overhead)

| Model | Conc | Avg ms | Med ms | P90 ms | Tok | Chars | Ch/s | Errors |
|-------|------|--------|--------|--------|-----|-------|------|--------|
| gpt-5-nano | 1 | 22,205 | 22,205 | 22,757 | 2,619 | 3,664 | 165 | 3/5 timeout |
| gpt-5-nano | 5 | 26,493 | 26,493 | 26,493 | 2,935 | 4,055 | 153 | 4/5 timeout |
| gpt-5-nano | 10 | 28,032 | 28,032 | 28,032 | 2,687 | 3,075 | 110 | 4/5 timeout |
| deepseek-chat | 1 | 25,394 | 24,686 | 31,267 | 581 | 3,401 | 134 | 0 |
| deepseek-chat | 5 | 22,163 | 22,238 | 23,414 | 556 | 3,215 | 145 | 0 |
| deepseek-chat | 10 | 23,822 | 24,478 | 25,921 | 610 | 3,508 | 147 | 0 |
| gemini-flash-lite | 1 | 4,205 | 4,206 | 4,944 | 903 | 5,287 | 1,257 | 0 |
| gemini-flash-lite | 5 | 4,129 | 3,747 | 5,269 | 883 | 5,170 | 1,252 | 0 |
| gemini-flash-lite | 10 | 4,170 | 3,943 | 5,461 | 895 | 5,250 | 1,259 | 0 |

Key findings:
- **Gemini is 6x faster** than DeepSeek and GPT-5 Nano
- **GPT-5 Nano has a 73% timeout rate** at 30s — unusable without streaming or higher timeout
- **Concurrency has minimal impact** — latency is stable across 1/5/10 (no provider-side throttling)
- **GPT-5 Nano generates 2,600+ tokens** (vs 580 for DeepSeek, 900 for Gemini) for similar output length — internal reasoning overhead

## Testing

### Unit Tests
- [x] All LLM-related tests pass (137 tests: 88 llms + 49 evolution client)

### Manual Verification
- [x] Benchmark script runs successfully and produces consistent results
- [x] Cross-referenced benchmark results with staging evolution_agent_invocations data — consistent

## Documentation Updates
- [x] Research doc updated with findings
- [x] Planning doc updated with benchmark results and root cause
