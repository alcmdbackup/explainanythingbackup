# Investigate Cost Controls Evolution Parallel Generation Research

## Problem Statement
The new parallel generate-rank pipeline dispatches N agents in parallel, which changes how budget consumption and cost tracking work compared to the sequential pipeline. This project investigates whether the current two-layer budget model (V2CostTracker + LLMSpendingGate) correctly handles concurrent reservations, potential overspending, and cost attribution across N parallel GenerateFromSeedArticleAgent invocations.

## Requirements (from GH Issue #941)
1. Verify V2CostTracker reserve() is safe under N parallel agents
2. Verify LLMSpendingGate handles concurrent reservations correctly
3. Identify any cost tracking gaps or missing metrics
4. Check that generation_cost/ranking_cost split works under parallel dispatch
5. Ensure discarded variant costs are still captured
6. Review orphaned reservation cleanup for parallel runs
7. Investigate budget waste risk: with N parallel agents, budget exhaustion can cause all in-flight agents to fail mid-generation simultaneously — unlike sequential execution where at most 1 variant is lost at any budget boundary. Analyze how many variants can be "wasted" (cost paid but result discarded or failed) and whether the 1.3x reserve margin amplifies this problem. Propose mitigations if needed.

## Key Mechanics

**reserve() and recordSpend() are a matched pair.** `reserve()` adds to `totalReserved`; `recordSpend()` removes from `totalReserved` and adds to `totalSpent`. The budget gate checks `totalSpent + totalReserved + newReservation > budgetUsd` — the sum of already-spent and all in-flight reserved amounts. After a successful LLM call, the reservation is released and replaced by the actual cost:

```
reserve($0.13):     spent=$0.00  reserved=$0.13  available=$0.87
recordSpend($0.09): spent=$0.09  reserved=$0.00  available=$0.91
```

**`BudgetExceededError` is only thrown at `reserve()`, never mid-LLM-call.** Any call that passes `reserve()` always runs to completion — there is no mid-flight cancellation. "Budget exceeded" means the *next* LLM call that tries to start is blocked.

**The waste scenario.** All 9 agents call `reserve()` before any LLM call completes. At that moment `totalReserved` reflects all 9 estimates but `totalSpent` is still zero — so all 9 can pass the check simultaneously. Once LLM calls complete and `recordSpend()` fires, `totalSpent` grows. Any generation call whose `reserve()` passed will complete and be paid for — even if by the time it finishes there's no budget left for the ranking phase that follows.

**Budget exhaustion behavior by agent type:**

*GenerateFromSeedArticleAgent* has two sequential phases (one generation call, then N ranking calls via binary search). Budget can be exceeded at three points:
- **At generation reserve**: throws before HTTP call, no money spent, returns `variant=null, status='budget'`
- **At first ranking reserve** (after generation succeeded): generation money already spent; `rankSingleVariant` catches the error, returns zero matches; variant usually discarded (default mu rarely beats top-15% cutoff)
- **Mid-ranking** (K comparisons done, K+1-th blocked): partial ranking used for surface/discard; if surfaced, K completed matches are returned to `MergeRatingsAgent`

*SwissRankingAgent* dispatches all pairs in parallel via `Promise.allSettled`. Budget-failed pairs reject individually without cancelling other pairs. Completed matches are always preserved — it has natural partial tolerance.

---

## High Level Summary

The parallel evolution pipeline is **mostly safe** for cost tracking and attribution, but has **three significant gaps**:

1. **Budget waste risk is real but bounded**: With 9 parallel agents and no in-flight LLM call cancellation, budget exhaustion can waste 1–8 additional agent costs simultaneously. The 1.3x reserve margin helps prevent reservation races but does not prevent in-flight waste. There is no AbortController mechanism to cancel ongoing LLM calls when budget is detected as exhausted.

2. **Silent failure tracking gap**: When an agent returns `variant=null` (format validation failure, unknown strategy, non-budget LLM error), the result is silently ignored in `runIterationLoop.ts:354-383`. The LLM cost for that call is paid and recorded in `evolution_agent_invocations` but never surfaced in any metrics or variant tracking. `BudgetExceededWithPartialResults.partialResult` is set in `Agent.ts:69` but never consumed anywhere.

3. **No cross-validation between budget and parallelism**: `numVariants` (default 9) and `budgetUsd` are validated independently with no warning if the budget is insufficient for even one full parallel iteration. A tight budget can result in most agents being discarded immediately.

The core cost tracking mechanisms (V2CostTracker, writeMetricMax, generation_cost/ranking_cost split) are correct and race-safe. The LLMSpendingGate daily cap is atomically enforced; only the monthly cap has a minor 60s-cache window risk.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/cost_optimization.md
- evolution/docs/architecture.md
- evolution/docs/arena.md
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/logging.md
- evolution/docs/agents/overview.md
- evolution/docs/reference.md (skipped — file too large)
- evolution/docs/visualization.md
- docs/docs_overall/llm_provider_limits.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/error_handling.md

### Prior Project Docs (for context)
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_research.md
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_planning.md
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_progress.md

## Code Files Read

### Core Budget Infrastructure
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — V2CostTracker with synchronous reserve(), RESERVE_MARGIN=1.3
- `evolution/src/lib/pipeline/infra/createLLMClient.ts` — LLM wrapper with reserve/spend/release per call, writes cost metrics live
- `src/lib/services/llmSpendingGate.ts` — Global daily/monthly cap with JS cache (30s/60s TTL) + DB atomic RPC
- `supabase/migrations/20260408000001_upsert_metric_max.sql` — Postgres GREATEST upsert for writeMetricMax

### Pipeline Orchestration
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Main orchestrator; Promise.allSettled dispatch; result processing loop
- `evolution/src/lib/core/Agent.ts` — Agent base class; first await is createInvocation(); BudgetExceededWithPartialResults handling
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — Full agent code; 4 return paths (success, generation_failed, budget, format invalid)
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — Binary search ranking; catches BudgetExceededError internally

### Finalization & Metrics
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Discarded variants persisted with persisted=false; no per-purpose cost recompute at finalization
- `evolution/src/lib/metrics/writeMetrics.ts` — writeMetricMax definition
- `evolution/src/lib/metrics/registry.ts` — generation_cost/ranking_cost metric definitions (compute: () => 0, written live by createLLMClient)
- `evolution/src/lib/core/agentNames.ts` — COST_METRIC_BY_AGENT mapping: generation→generation_cost, ranking→ranking_cost

### Schema & Config
- `evolution/src/lib/schemas.ts` — EvolutionConfig; numVariants (default 9, range 1-100); budgetUsd (max $50); no cross-validation
- `evolution/src/lib/core/types.ts` — AgentContext (no AbortSignal); AgentResult (partialResult field present but unused)
- `src/config/llmPricing.ts` — DeepSeek: $0.14/$0.28 per 1M; GPT-4.1-nano: $0.10/$0.40 per 1M

### Tests
- `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — Parallel reserve scenarios (3 agents); property tests
- `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — Parallel dispatch; budget exhaustion; one-reject-others-ok
- `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` — generation/ranking split correctness
- `src/__tests__/integration/evolution-metric-max-upsert.integration.test.ts` — Concurrent metric writes
- `src/lib/services/llmSpendingGate.test.ts` — Spending gate unit tests

---

## Key Findings

### Finding 1: V2CostTracker reserve() is safe under parallel agents

`reserve()` is **synchronous** (no awaits) in `trackBudget.ts:58-66`. All N agents' reserve calls execute in the Node.js event loop without interleaving. The sequence `check → increment totalReserved → return margined` is atomic. The available budget decrements correctly for each successive agent.

With `RESERVE_MARGIN=1.3`, each agent reserves `estimated × 1.3`. This means the N-th agent's reserve call throws `BudgetExceededError` before its LLM call, preventing it from entering an in-flight state. This is **correct and protective**: the reserve is the last synchronous gate before an async LLM call.

**Reserve IS NOT all-at-once**: Agents begin execution concurrently, but each agent's first `await` is `createInvocation()` (DB INSERT) in `Agent.ts:19`. Reserve happens later, inside `createLLMClient.complete()` at line 64. So reserves occur as each agent's execution reaches the LLM call, not all simultaneously before any LLM call begins.

### Finding 2: LLMSpendingGate daily cap is bulletproof; monthly cap has minor risk

**Daily cap**: `check_and_reserve_llm_budget` RPC uses `FOR UPDATE` row lock (`src/lib/services/llmSpendingGate.ts`). The lock serializes all parallel agents' DB reservations. Each subsequent agent sees the updated `reserved_usd` from previous agents. The daily cap **cannot be exceeded** by the DB layer.

**JS cache vulnerability (minor)**: The 30s TTL in-memory JS cache allows multiple concurrent agents to bypass the slow-path DB check if spending is > 10% below cap (`FAST_PATH_HEADROOM=0.10`). However, when cache is near cap, all agents fall through to the slow path and are serialized by the DB RPC. Cache inconsistency does not cause overspend.

**Monthly cap risk (bounded, ~$0.80 max)**: Monthly cache TTL is 60s. If 9 agents simultaneously pass the fast-path monthly check with a 60s-stale cache value, they can all proceed even if the true monthly total is near cap. Worst case: 9 agents × $0.10/agent = $0.90 potential overspend above monthly cap. In practice this is bounded because daily cap ($25) limits throughput, and actual LLM costs are small.

### Finding 3: generation_cost/ranking_cost split is correct and race-safe under parallel dispatch

Each LLM call in `createLLMClient.ts:88-104` writes cumulative phase costs to the DB after completion:
- `writeMetricMax(db, 'run', runId, 'cost', totalSpent, 'during_execution')`
- `writeMetricMax(db, 'run', runId, costMetricName, phaseCost, 'during_execution')` where `costMetricName` is from `COST_METRIC_BY_AGENT['generation'] = 'generation_cost'` or `'ranking_cost'`

`writeMetricMax` uses a Postgres `ON CONFLICT ... DO UPDATE SET value = GREATEST(old, new)` upsert. Concurrent writes are safe: the larger cumulative value always wins. No cost is lost.

`phaseCosts[agentName]` in `trackBudget.ts:71` is updated by a synchronous assignment (no await, no interleaving). Under Node.js single-thread model, this is atomic.

**Seed-phase costs** (`seed_title`, `seed_article`) roll into aggregate `cost` only — they are not in `COST_METRIC_BY_AGENT` and produce no per-purpose metric row.

### Finding 4: Discarded variant costs are captured

`persistRunResults.ts:172-221` persists discarded variants with `persisted: false`. The `evolution_agent_invocations` table captures cost for every invocation regardless of outcome (via `Agent.ts:65`). Cost metrics are written live per LLM call (not recomputed at finalization).

**Gap**: Variants with `variant=null` (generation failed before DB row creation) are never stored in `evolution_variants`. Their costs appear in `evolution_agent_invocations` but are not queryable via variant-level reporting. These are agents that paid for a generation LLM call but produced no usable output.

### Finding 5: Orphaned reservation cleanup is mostly correct with a gap

The LLM client releases reservations in all error paths (`createLLMClient.ts:111,119,133`). No `finally` block pattern is used, but every code exit path through the function calls `release()`. The `clamp(0)` in `trackBudget.ts:release()` prevents negative reservations.

**Cross-iteration gap**: `V2CostTracker` is created once per run (`runIterationLoop.ts:192`) and shared across all iterations. If `totalReserved` leaks upward (a reservation made but not released), subsequent iterations see artificially reduced available budget. There is no postcondition assertion after `Promise.allSettled()` to verify `totalReserved === 0`.

**No drain mechanism after allSettled**: If an agent crashes after reserving but before releasing (e.g., `updateInvocation()` throws), the orphaned reservation persists for the run's lifetime. This scenario is uncommon but undetected.

### Finding 6: Budget waste risk under parallel dispatch (CRITICAL)

**Default configuration**: `numVariants=9` parallel agents. Once any agent's LLM call starts (passes `reserve()`), no mechanism cancels that call if other agents subsequently exhaust the budget.

**No AbortController**: `AgentContext` has no `signal` field. `createLLMClient.complete()` has a hard 60s timeout but no budget-aware cancellation. The `AbortSignal` passed to `runIterationLoop` is checked only at iteration boundaries, not inside agents.

**Worst-case waste scenario (Scenario C)**:
1. All 9 agents reserve successfully (budget was large enough at reserve time)
2. Agent 1 completes generation + ranking; records spend
3. Agents 2-8 have LLM calls in-flight; budget exhausts due to Agent 1's recorded spend
4. Agents 2-8 complete their generation LLM calls (money spent) but fail during ranking with `BudgetExceededError`
5. Up to 8 generation costs + 8 partial ranking costs wasted simultaneously

With typical costs ($0.01-0.05 per generation, $0.01-0.015 per ranking comparison), maximum waste in one iteration with 9 agents ≈ $0.40-0.45. For a tight $0.50 budget, this is catastrophic.

**The 1.3x reserve margin amplifies this problem**: The reserve makes the N-th agent more likely to fail at reserve (preventing waste), but for the 8 agents that DO reserve successfully, the margin means the system "committed" to spending 8 × estimated × 1.3 before any LLM call began.

**No config cross-validation**: `validateConfig()` validates `numVariants` and `budgetUsd` independently. There is no warning if `budgetUsd / numVariants < per_agent_cost × 1.3`.

### Finding 7: Silent failure tracking gap

**The null-variant gap**: In `runIterationLoop.ts:354-383`, the result processing loop handles: (a) success with non-null variant, (b) budgetExceeded, (c) rejected promise. **There is no handler for `fulfilled && !success && !budgetExceeded`** (e.g., network errors that Agent.run() catches but returns as `success=false`). These are silently ignored.

**Three paths that produce `variant=null` and pay LLM costs**:
1. Format validation fails (`generateFromSeedArticle.ts:243-265`) → `status='generation_failed'`, LLM call already paid
2. Unknown strategy (`generateFromSeedArticle.ts:184-203`) → immediate return, no LLM call, no cost
3. Non-budget LLM error caught in `generateFromSeedArticle.ts:206-238` → `status='generation_failed'`, LLM call may have partially completed

**`BudgetExceededWithPartialResults` is dead code**: Set in `Agent.ts:69` when execute() throws this exception, but `partialResult` is **never read** in `runIterationLoop.ts`, `MergeRatingsAgent`, or `persistRunResults.ts`. If a ranking agent hits budget mid-binary-search with 5 completed comparisons, those comparisons are discarded.

### Finding 8: Test coverage gaps

Well-covered: 3-agent parallel reserve scenarios, one-reject-others-ok pattern, cost split correctness, writeMetricMax GREATEST semantics, budget exhaustion during generate phase, SwissRankingAgent parallel pairs.

**Missing tests**:
1. All N parallel agents hit `BudgetExceededError` simultaneously — unknown orchestrator behavior
2. Budget exhaustion during merge phase (only generate phase is tested)
3. Cross-iteration cumulative budget enforcement across full generate→swiss→merge cycle
4. Null-variant silent drops — no test verifies logging or tracking of these cases
5. `BudgetExceededWithPartialResults.partialResult` consumer — dead code, no test
6. Monthly cap overspend with 60s stale cache + 9 concurrent agents
7. 9+ concurrent `checkBudget()` calls near daily cap (existing test uses only 2 concurrent clients via PostgREST HTTP)

---

## Finding 9: Bug — `persistRunResults.ts` downgrades cost metric at finalization (FIXED)

**Confirmed via live run debugging (run `7e482d75`).**

`persistRunResults.ts:255` used plain `writeMetric` (unconditional overwrite) to write the finalization cost:
```typescript
await writeMetric(db, 'run', runId, 'cost' as MetricName, result.totalCost, 'during_execution');
```

During execution, `createLLMClient.ts` correctly writes cumulative cost via `writeMetricMax` (GREATEST upsert) after each LLM call. For run `7e482d75` this reached `$0.026608` (displayed as "$0.03" in the UI). At finalization, `writeMetric` overwrote this with `$0.013468` (displayed as "$0.01") — a downgrade caused by `costTracker.getTotalSpent()` undercounting at finalization time (see Finding 10).

**Fix applied**: Changed `persistRunResults.ts:255` to use `writeMetricMax`, ensuring finalization never lowers a cost that was correctly written live during execution.

---

## Finding 10: `costTracker.getTotalSpent()` undercount under parallel execution

**Root cause of the `$0.013468` finalization value in run `7e482d75`.**

`Agent.run()` computes each invocation's cost as:
```typescript
const costBefore = ctx.costTracker.getTotalSpent(); // captured AFTER createInvocation() await
// ... execute() runs, LLM calls happen ...
const cost = ctx.costTracker.getTotalSpent() - costBefore;
```

Because `costBefore` is captured from the **shared** `V2CostTracker` after the `createInvocation` DB await, it reflects whatever other parallel agents have spent up to that point. The delta therefore measures "global spend growth during this agent's window" — not "this agent's own LLM costs."

Under parallel execution, windows overlap depending on timing. In run `7e482d75`:
- Agent 4 (gen=$0.013140) completed and threw `BudgetExceededError` at ranking reserve
- At that moment, `getTotalSpent() - costBefore_4 = $0.013140` (Agent 1 had not yet made LLM calls)
- Agent 1 then ran gen + ranking: `costBefore_1 = $0.013140`, `getTotalSpent()` grew to `$0.026608`
- Agent 1's delta = `$0.026608 - $0.013140 = $0.013468` ✓

At the end of the iteration, `costTracker.getTotalSpent() = $0.026608`. But `runIterationLoop.ts` passes `totalCost: costTracker.getTotalSpent()` to `persistRunResults` only at the very end of the run. If the run ended with `costTracker.getTotalSpent() = $0.013468` (e.g., because the iteration ended before Agent 4's gen cost was recorded), the finalization write would undercount. The exact path depends on agent completion order.

**Underlying design issue**: The before/after delta approach for attribution was designed for sequential execution. It is not reliable under parallel dispatch. See Finding 11 for the cleaner design.

---

## Finding 11: Independent per-LLM-call cost attribution is cleaner than before/after delta

The shared `V2CostTracker` serves two distinct purposes that should be separated:

| Purpose | Current mechanism | Correctness under parallel execution |
|---|---|---|
| Budget gate (prevent overspend) | Shared `reserve()` — synchronous, atomic | **Correct** — must stay shared |
| Cost attribution (invocation `cost_usd`) | `getTotalSpent() - costBefore` delta | **Unreliable** — timing-dependent |
| Live metric writes | Per-LLM-call `writeMetricMax` | **Correct** — already independent |

Each `createLLMClient.complete()` already computes `actual = calculateCost(...)` at line 85 before calling `recordSpend`. Agents could accumulate their own LLM call costs independently (e.g., via a per-agent cost accumulator passed into the LLM client, or by having `complete()` return `{ text, cost }`). This would make each agent's `cost_usd` self-contained and remove the timing dependency entirely.

The shared tracker is still required for `reserve()` (budget gate) and `getAvailableBudget()` (iteration stop decision). But attribution should not depend on it.

---

## Open Questions

1. **AbortController feasibility**: Can we pass an AbortController signal into each agent and wire it to the HTTP/LLM client to cancel in-flight calls when budget is exhausted? What's the provider support for HTTP abort?

2. **Dynamic parallelism**: Should `numVariants` be dynamically reduced when `remainingBudget / numVariants < estimated_cost_per_agent`? This would require per-agent cost estimation at dispatch time.

3. **Partial match recovery**: Should `BudgetExceededWithPartialResults.partialResult` be consumed in the orchestrator to preserve comparisons that completed before budget exhaustion?

4. **Null-variant tracking**: Should failed generations (paid but no variant produced) be tracked in a separate table or as a special variant row? This affects cost attribution accuracy.

5. **Config warning vs validation**: Should small budget + high numVariants be a hard validation error, or a soft warning in logs?

6. **Fix attribution bug**: Refactor `Agent.run()` to use per-LLM-call cost accumulation instead of `getTotalSpent() - costBefore` delta. This fixes the parallel attribution undercount and makes invocation costs reliable regardless of agent completion order.
