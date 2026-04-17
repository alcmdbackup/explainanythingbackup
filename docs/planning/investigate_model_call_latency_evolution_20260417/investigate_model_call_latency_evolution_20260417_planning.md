# Investigate Model Call Latency Evolution Plan

## Background
LLM calls in the evolution pipeline on staging are showing 30+ second latencies. We need to benchmark Gemini, DeepSeek, and GPT-5 Nano under different concurrency levels (1, 5, 10 parallel calls) to establish baseline latency, then investigate the root cause of the high latencies observed in production run data.

## Requirements
I want to tests running Gemini, Deepseek, and Gpt5 nano calls - 1 at a time, 5 at a time and 10 at a time to test typical call latency. My run data on stage is showing that typical LLM calls take 30+ seconds to complete which takes very long. Do this test first, but then otherwise help me figure out why.

## Problem
Evolution pipeline runs are taking significantly longer than expected, with individual LLM calls averaging 30+ seconds on staging. This could be caused by provider-side latency, concurrency bottlenecks (LLM semaphore), spending gate DB round-trips, network issues, or prompt size. Need to isolate the root cause by first establishing clean baseline latency benchmarks.

## Options Considered
- [ ] **Option A: Standalone benchmark script**: Write a TypeScript script that calls each model directly via the provider SDK, bypassing the app's callLLM wrapper, to isolate raw provider latency
- [ ] **Option B: Benchmark through callLLM**: Use the app's full callLLM path to measure end-to-end latency including spending gate, semaphore, and tracking overhead
- [ ] **Option C: Both approaches**: Run both to identify how much overhead the app layer adds

## Phased Execution Plan

### Phase 1: Latency Benchmark Script
- [ ] Create a standalone benchmark script that tests Gemini, DeepSeek, and GPT-5 Nano
- [ ] Test at concurrency levels: 1, 5, and 10 parallel calls
- [ ] Use a standardized prompt (similar to typical evolution generation prompt length)
- [ ] Record: wall-clock latency, time-to-first-token (if streaming), total tokens, model reported
- [ ] Output results as a formatted table

### Phase 2: Analyze Staging Run Data
- [ ] Query llmCallTracking table for recent evolution runs on staging
- [ ] Compute p50/p90/p99 latency by model and call_source
- [ ] Identify if latency correlates with prompt size, time of day, or concurrency
- [ ] Check evolution_agent_invocations.duration_ms for per-agent latency breakdown

### Phase 3: Root Cause Investigation
- [ ] Check if LLM semaphore is causing queuing delays
- [ ] Check if spending gate DB round-trips add significant overhead
- [ ] Check if OpenRouter routing adds latency vs direct provider calls
- [ ] Check network latency from staging environment to provider endpoints
- [ ] Check if prompt sizes have grown beyond expected ranges

## Testing

### Unit Tests
- [ ] Benchmark script should validate its own output format

### Manual Verification
- [ ] Run benchmark script locally and compare with staging data
- [ ] Cross-reference benchmark results with actual evolution run latencies

## Verification

### Automated Tests
- [ ] Benchmark script runs successfully and produces consistent results

## Documentation Updates
- [ ] Update research doc with findings
- [ ] Document any configuration changes needed

## Review & Discussion
[To be populated by /plan-review]
