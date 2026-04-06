# Generate Rank Evolution Parallel Research

## Problem Statement
The evolution pipeline currently runs generate and rank operations sequentially, which makes some runs very slow. This project will identify and implement the most viable parallelization opportunities within the existing pipeline architecture to improve throughput and reduce wall-clock time per evolution run.

## Requirements (from GH Issue #914)
Requirements to be determined during research phase. Initial scope includes:
- Analyze current pipeline execution flow to identify parallelization bottlenecks
- Propose the most viable parallelization strategy (parallel variant generation, parallel ranking comparisons, overlapping generate+rank phases, or a combination)
- Implement parallelization with proper error handling, budget tracking, and rate limit awareness
- Maintain existing convergence detection and checkpoint behavior
- Add metrics to measure throughput improvement
- Unit and integration tests for parallel execution paths

## High Level Summary

Research across 8 parallel agents (2 rounds of 4) reveals **three distinct parallelization opportunities** with varying feasibility:

| Opportunity | Feasibility | Speedup Estimate | Complexity |
|-------------|-------------|------------------|------------|
| **A. Cross-iteration overlap (Gen N+1 ∥ Rank N)** | **HIGH** | ~25-30% wall-clock reduction | Low-Medium |
| **B. Parallel ranking comparisons (within Swiss rounds)** | **LIMITED** | ~15-20% of ranking time | Medium-High |
| **C. Parallel triage comparisons** | **NOT FEASIBLE** | N/A | N/A (data dependencies) |

**Key finding:** Generation N+1 has **zero data dependencies** on Ranking N. Feedback is optional and currently unused in the main pipeline. This allows generation to start immediately while ranking is still running.

**Key constraint:** The `LLMSemaphore` (default 20 concurrent calls) already exists and would naturally throttle parallel LLM calls. Budget tracking via `V2CostTracker.reserve()` is synchronous and parallel-safe under Node.js single-threaded event loop.

## Detailed Findings

### 1. Current Pipeline Execution Flow

**Entry:** `claimAndExecuteRun()` in `evolution/src/lib/pipeline/claimAndExecuteRun.ts:89-181`
**Loop:** `evolveArticle()` in `evolution/src/lib/pipeline/loop/runIterationLoop.ts:70-251`

Each iteration is strictly sequential:
```
Iteration N:
  Generate (30-60s) → await → Rank (60-180s) → await → Check convergence
Iteration N+1:
  Generate (30-60s) → await → Rank (60-180s) → await → Check convergence
```

**Time split:** Generation ~25-30% of iteration time, Ranking ~70-75%.

### 2. Generation Phase

**File:** `evolution/src/lib/pipeline/loop/generateVariants.ts:65-129`
**Agent:** `evolution/src/lib/core/agents/GenerationAgent.ts:45-62`

- Runs 3 strategies in **parallel** via `Promise.allSettled()` (already parallelized internally)
- Each strategy: build prompt → LLM call → validate format → create variant
- Config: `strategiesPerRound` (default 3), `generationModel` (default DeepSeek)
- Budget reserve is synchronous (parallel-safe)
- Inputs: `text` (constant), `iteration` (number), `llm`, `config`
- **Does NOT use feedback from prior ranking** — feedback parameter is optional and never passed from main loop

### 3. Ranking Phase

**File:** `evolution/src/lib/pipeline/loop/rankVariants.ts:651-775`
**Agent:** `evolution/src/lib/core/agents/RankingAgent.ts:69-101`

Two-phase sequential structure:

**Phase 1 — Triage (lines 289-431):**
- For each new entrant: select stratified opponents → sequential comparisons → immediate rating update
- Early exit: elimination if `mu + 2σ < top20Cutoff`, or if 2+ decisive matches with avg confidence ≥ 0.8
- **Cannot parallelize:** opponent selection depends on updated ratings after each comparison

**Phase 2 — Swiss Fine-Ranking (lines 446-599):**
- Up to 20 rounds of Swiss-paired comparisons
- Pairs computed once per round, then executed **sequentially**
- Rating updates after each comparison affect next comparison's utility
- Convergence: all eligible `sigma < 3.0` for 2 consecutive rounds
- **Could batch within rounds** but rating quality degrades with stale ratings

**Each comparison:** 2 parallel LLM calls via `run2PassReversal()` → `Promise.all()` (already parallelized)

### 4. Budget & Cost Tracking

**Per-run:** `V2CostTracker` in `evolution/src/lib/pipeline/infra/trackBudget.ts`
- `reserve()` is **synchronous** — explicitly designed for parallel safety (line 55-56 comment)
- 1.3x safety margin on reservations
- Budget tiers: low (<50% spent, 40 comparisons), medium (50-80%, 25), high (>80%, 15)

**Global:** `LLMSpendingGate` in `src/lib/services/llmSpendingGate.ts`
- In-memory TTL cache (30s daily, 60s monthly, 5s kill switch)
- DB-atomic RPC for near-cap reservations
- Category split: `evolution` vs `non_evolution`

### 5. Concurrency Infrastructure

**LLMSemaphore:** `src/lib/services/llmSemaphore.ts`
- Custom FIFO counting semaphore, default limit 20 concurrent calls
- Configurable via `EVOLUTION_MAX_CONCURRENT_LLM` env var
- Applied only to evolution calls (callSource starts with `evolution_`)
- Retry logic respects semaphore (retries re-acquire)

**No external concurrency libraries used** despite p-limit/p-queue being in node_modules (transitive deps)

### 6. Data Dependencies Between Iterations

```
Generation N+1 inputs:  text (const), iteration (N+1), llm, config
                        feedback? → OPTIONAL, CURRENTLY UNUSED

Ranking N+1 inputs:     pool (needs Gen N+1 output + Rank N output)
                        ratings (needs Rank N output)
                        newEntrantIds (needs Gen N+1 output)

Key insight: Gen N+1 depends on NOTHING from Rank N
             Rank N+1 depends on BOTH Rank N AND Gen N+1
```

### 7. Existing Test Coverage

| Test File | Key Coverage |
|-----------|-------------|
| `generateVariants.test.ts` | Parallel barrier test, budget exceeded with partials, format rejection |
| `rankVariants.test.ts` | Triage/Swiss phases, budget tiers, convergence, cache hits, early exit |
| `runIterationLoop.test.ts` | Multi-iteration smoke, budget exhaustion, kill detection, deadline/abort |
| `computeRatings.test.ts` | Rating math, convergence, 1000-op performance test (<200ms) |

**Mocking pattern:** `createV2MockLlm()` with `defaultText` or `rankingResponses` array, tracking via `mock.calls`.

## Initial Parallelization Ideas

### Idea A: Cross-Iteration Overlap (RECOMMENDED — Highest Impact, Lowest Risk)

**What:** Start generation N+1 while ranking N is still running.

**Why it works:**
- Generation has zero dependencies on ranking output
- Feedback is unused in current pipeline
- Budget tracking is already parallel-safe (synchronous reserves)
- LLM semaphore naturally throttles combined load

**Implementation sketch:**
```typescript
// In runIterationLoop.ts, instead of:
//   await generate() → await rank() → next iteration
// Do:
//   await generate() → start rank (don't await) → start next generate → await rank → apply results
```

**Estimated speedup:** Save ~30-60s per iteration (entire generation time overlaps with ranking).
For a 5-iteration run at ~120s/iteration: **~150-300s saved (25-30% reduction)**.

**Risk:** Low. Generation and ranking use separate LLM models (DeepSeek vs gpt-4.1-nano). Budget reserves are atomic. Pool mutation needs care (append new variants only after ranking completes).

### Idea B: Parallel Swiss Comparisons (MODERATE — Medium Impact, Medium Risk)

**What:** Within a Swiss fine-ranking round, execute all paired comparisons in parallel instead of sequentially.

**Why it could work:**
- Pairs are precomputed once per round
- Each comparison is independent (different variant pairs)
- Cache prevents redundant comparisons
- Convergence is checked after round completes

**Tradeoff:** Rating updates between comparisons improve pairing quality for the _same_ round's remaining pairs. With batching, later pairs use stale ratings. Empirically this may not matter much since pairs are already chosen.

**Implementation:** Replace the `for` loop over pairs with `Promise.all()` or a concurrency-limited batch (e.g., 5 at a time). Apply all rating updates after the batch.

**Estimated speedup:** With ~5 pairs per round × 2-3s each = ~10-15s per round. Parallelizing saves ~8-12s per round. Moderate overall impact.

**Risk:** Medium. Rating quality may degrade slightly. Need to verify convergence still works with batched updates.

### Idea C: Parallel Triage (NOT FEASIBLE)

**Why not:** Each comparison's result changes ratings, which changes opponent selection for the next comparison. Hard data dependency chain.

**Partial exception:** Could parallelize _across_ different new entrants (entrant A's triage vs entrant B's triage), but the interaction is limited — entrants share opponents and ratings. The speedup would be minimal (2-3 entrants, each doing 5 sequential comparisons).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- evolution/docs/curriculum.md
- evolution/docs/agents/overview.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/error_handling.md

## Code Files Read
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Pipeline entry, claim, heartbeat, orchestration
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Main generate→rank loop
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — Parallel strategy generation
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — Triage + Swiss fine-ranking
- `evolution/src/lib/pipeline/loop/buildPrompts.ts` — Prompt construction with optional feedback
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — V2CostTracker (reserve-before-spend)
- `evolution/src/lib/pipeline/infra/createLLMClient.ts` — LLM wrapper with retry/timeout
- `evolution/src/lib/core/Agent.ts` — Base agent template method
- `evolution/src/lib/core/agents/GenerationAgent.ts` — Generation agent
- `evolution/src/lib/core/agents/RankingAgent.ts` — Ranking agent
- `evolution/src/lib/shared/computeRatings.ts` — Rating math, 2-pass reversal, cache
- `evolution/src/lib/shared/enforceVariantFormat.ts` — Format validation
- `evolution/src/lib/types.ts` — Variant, Rating, error types
- `src/lib/services/llmSemaphore.ts` — FIFO concurrency limiter (default 20)
- `src/lib/services/llmSpendingGate.ts` — Global daily/monthly budget gate
- `src/lib/services/llms.ts` — LLM provider routing, semaphore integration
- Test files: generateVariants.test.ts, rankVariants.test.ts, runIterationLoop.test.ts, computeRatings.test.ts, GenerationAgent.test.ts, RankingAgent.test.ts
