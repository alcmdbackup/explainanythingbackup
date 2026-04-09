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

---

## Wall-clock analysis: existing vs new pipeline

After completing the initial architecture plan, a question arose: does the new architecture actually deliver the promised speedup, or is the apparent speedup an artifact of doing less ranking work? This section analyzes both pipelines' wall-clock behavior in two regimes — cold start and warm start — to determine where the new design's speedup comes from.

### Assumptions used throughout

- LLM comparison (2-pass A/B reversal): ~3s per comparison
- LLM generation call: ~3s
- `LLMSemaphore` caps concurrent LLM calls at 20
- Binary search converges in ~8 comparisons per variant when enough opponents are available
- Triage runs ~5 comparisons per new variant
- Swiss fine-ranking runs 15-40 comparisons per iteration (budget-dependent)

### Regime 1: Cold start (initial pool = just baseline)

This is the "first run for a new topic" case. No arena entries loaded. Each iter 1 agent starts with `initialPool = [baseline]` only.

**Existing pipeline (5 iterations, 9 variants total):**

| Component | Time |
|-----------|------|
| Generation (5 iterations × 3 strategies, parallel within iter) | ~15s |
| Triage (5 iters × 3 new variants × 5 opponents, sequential) | ~225s |
| Swiss (5 iters × ~25 comparisons, sequential) | ~375s |
| **Total wall-clock** | **~10 minutes** |
| **Total LLM calls** | **~150-200** |
| **Avg variant sigma at end** | **~3 (converged)** |

**New pipeline (cold start):**

Each of the 9 parallel agents has `initialPool = [baseline]` → only 1 opponent available. Binary search picks baseline → compares → exits via `no_more_opponents` after 1 comparison.

| Component | Time |
|-----------|------|
| Iteration 1 (9 agents in parallel) | 1 gen call + 1 comparison ≈ 6s per agent, all parallel → **~6s** |
| Iteration 2 (swiss on top-3 eligible) | 3 pairs in parallel → **~3s** |
| Iteration 3 (exhausted pairs) | no_pairs → done |
| **Total wall-clock** | **~10 seconds** |
| **Total LLM calls** | **~21** |
| **Avg variant sigma at end** | **~5-7 (mostly not converged)** |

**Cold start verdict:** The new pipeline is ~60x faster, but **the speedup is mostly scope reduction** — it does 10x fewer ranking comparisons because cold-start forces most agents to exit after 1 comparison. Variants exit with sigma ~5-7 instead of ~3, meaning the winner selection is much less confident (large CI overlap between top variants).

**This is not really a parallelization win in cold start — it's a quality reduction dressed up as one.** If we want high-confidence winners from cold-start runs, the new pipeline doesn't deliver.

### Regime 2: Warm start (initial pool = baseline + 20 arena entries)

This is the "repeat topic with populated arena" case. 20 variants with established ratings (from prior runs) are loaded at iteration start. `numVariants = 30` for this scenario.

**Existing pipeline (10 iterations, 30 variants total):**

| Component | Time |
|-----------|------|
| Per iteration | Gen: ~3s, triage: ~45s, swiss: ~75s ≈ **~123s** |
| 10 iterations sequential | **~20.5 minutes** |
| **Total LLM calls** | **~400** |
| **Avg variant sigma at end** | **~3 (converged)** |

**New pipeline (warm start, 30 variants):**

Each agent has `initialPool = [baseline + 20 arena entries] = 21 opponents`. Binary search has real work to do.

- **Iteration 1:** 30 parallel agents, each running ~8 comparisons (binary search convergence) + 1 gen call
  - Per-agent critical path: ~27s (sequential within agent)
  - LLM semaphore caps concurrency at 20, so 30 agents queue slightly
  - Wall-clock: ~40s (accounting for semaphore contention)
- **Iteration 2 (swiss):** Top-15% of ~51 variants = ~8 eligible → 28 unique pairs, capped at 20
  - 20 pairs run in parallel → ~3s
- **Iteration 3 (swiss):** Remaining 8 pairs → ~3s
- **Iteration 4:** no_pairs → done

| Component | Time |
|-----------|------|
| Iteration 1 (parallel generate+rank) | **~40s** |
| Iteration 2 (swiss, 20 pairs) | **~3s** |
| Iteration 3 (swiss, 8 pairs) | **~3s** |
| **Total wall-clock** | **~46 seconds** |
| **Total LLM calls** | **~300** (30 gen + 240 binary-search + 28 swiss) |
| **Avg variant sigma at end** | **~3 (converged)** |

**Warm start verdict:** The new pipeline is **~26x faster with equal or better quality**. The speedup comes from three real wins:

1. **Parallel agent dispatch vs sequential iterations.** The existing pipeline's fundamental bottleneck is iteration sequencing — 10 × 123s = 1230s because each iteration waits for the previous to finish. The new pipeline runs all 30 generate agents in parallel; critical path is one agent's binary search (~27-40s), not 10 iterations stacked.

2. **Binary search is more efficient than triage + Swiss.** Per variant, the new algorithm converges in ~8 comparisons where the old approach uses ~15-20 (triage + Swiss sampling). The algorithm itself does less work for the same convergence target.

3. **Eliminating cross-iteration ranking overhead.** The existing pipeline re-ranks the entire pool after each new variant batch. The new pipeline ranks each variant once (in iter 1) and then refines only the top-15% in swiss iterations.

### The fundamental question

**What fraction of production runs are warm-start vs cold-start?**

- If most runs are **warm-start** (arena is populated, prompts are repeat customers): the new pipeline is a huge win with no quality tradeoff. 20-40x speedup with equivalent ranking quality.
- If most runs are **cold-start** (new topics, one-off experiments): the new pipeline trades quality for speed. The speedup is real but comes from doing less work, not from parallelism.
- If runs are **mixed**: the tradeoff is scenario-dependent. Warm runs get a huge win, cold runs get a different kind of win.

### Where the original research estimate came from

The research doc originally estimated "~25-30% speedup" from Idea A (cross-iteration overlap). That estimate was based on overlapping generation time with ranking time, NOT on replacing the ranking algorithm itself. It was a conservative, surgical change.

The new plan is a much bigger architectural change that delivers **much larger speedups in the warm-start regime** by fundamentally restructuring the pipeline. The speedup gap between "Idea A" (25-30%) and "new pipeline" (20-40x warm, 60x cold) is driven by:

- Idea A overlaps gen and rank but keeps iteration sequencing → capped at ~30% savings
- New pipeline parallelizes across iterations AND replaces the ranking algorithm → uncapped speedup

### What to measure before committing

Before fully committing to the new architecture, it would be worth measuring:

1. **Typical initial pool size for production runs.** Query recent `evolution_runs` and count arena entries loaded. If the average is 15-20, we're mostly warm-start → new pipeline is a clear win. If the average is 0-2, we're mostly cold-start → need to decide on the quality tradeoff.

2. **Real comparison latency.** We assume ~3s per comparison. If the actual 2-pass reversal takes ~6s, all numbers double but ratios stay the same.

3. **Semaphore contention at scale.** With 30+ parallel agents, does the 20-slot semaphore create bottlenecks that erode the parallelism win? Or does it throttle reasonably?

### Verdict

**The wall-clock speedup is real and significant in the warm-start regime**, and comes from legitimate parallelization + algorithmic improvements, not just from doing less work. The cold-start regime delivers a different kind of speedup that involves a quality tradeoff.

The new architecture is the right call **if production runs are predominantly warm-start**. If production runs are predominantly cold-start, we should explicitly acknowledge the quality tradeoff and decide whether it's acceptable (much faster, less confident rankings) or whether a simpler design like Idea A would be a better fit.

**Recommendation:** Before merging the implementation, run an empirical measurement on production run data to determine the warm-start vs cold-start distribution. That measurement drives the risk assessment.
