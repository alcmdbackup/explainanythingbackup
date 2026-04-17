# Investigate Model Call Latency Evolution Progress

## Phase 1: Latency Benchmark Script
### Work Done
- Created `evolution/scripts/benchmark-latency.ts` — standalone script testing Gemini, DeepSeek, GPT-5 Nano at concurrency 1/5/10
- Gemini: 4.2s avg, 1,257 chars/s — 6x faster than alternatives
- DeepSeek: 24.7s avg, 134 chars/s — slow but reliable (0% timeout)
- GPT-5 Nano: 22.2s avg, 165 chars/s — 73% timeout rate at 30s, unusable

### Issues Encountered
- GPT-5 Nano rejects `temperature: 0` despite registry saying `maxTemperature: 2.0` — added conditional exclusion

## Phase 2: Analyze Staging Run Data
### Work Done
- Queried `evolution_agent_invocations.duration_ms` on staging (last 7 days, 160 invocations)
- Broke down GFSA latency into `generation.durationMs` vs `ranking.durationMs` via execution_detail
- DeepSeek generation: 33-106s per call for 4-8K chars output
- Gemini generation: 6-9s per call for 6-9K chars output (longer output, less time)
- Found `llmCallTracking` has no evolution data — batch runner lacks SUPABASE_SERVICE_ROLE_KEY

## Phase 3: Root Cause Investigation
### Work Done
- Root cause: raw provider token throughput, not app overhead
- Semaphore: not a bottleneck (no staircase patterns)
- Spending gate: usually cached, negligible
- OpenRouter: no extra latency (Gemini via OpenRouter is fastest)
- Discovered `writeMetricMax` is awaited (not fire-and-forget as commented) adding 100-300ms per call
- Discovered `saveLlmCallTracking` uses insert+select (2 DB round-trips), also awaited

## Phase 4: Fix Timeout/Retry Cascade
### Work Done
- Reduced per-call timeout: 60s → 20s
- Set maxRetries: 0 on all SDK clients (OpenAI, DeepSeek, OpenRouter, Anthropic, Local)
- Eliminated nested retry cascade: worst case 16 min → 87s
- Updated 3 test files to match new timeout values
- All 137 tests pass
