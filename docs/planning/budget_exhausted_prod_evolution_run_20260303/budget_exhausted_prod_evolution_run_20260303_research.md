# Budget Exhausted Prod Evolution Run Research

## Problem Statement
Investigate why evolution run 1a67a4ce exhausted its budget early in production. Determine root cause of premature budget exhaustion and implement fixes to prevent it from recurring.

## Requirements (from GH Issue #639)
- Investigate evolution run `1a67a4ce` to determine why it exhausted its budget prematurely
- Identify the root cause (misconfigured budget caps, unexpected agent costs, model pricing, etc.)
- Implement fixes to prevent recurrence
- Add safeguards or improved diagnostics if appropriate

## High Level Summary

### Run Details
- **Run ID**: `1a67a4ce-9fbd-48de-9706-6e437e9fac72`
- **Experiment**: `d80e4fb4` (manual experiment named "Test")
- **Strategy**: `gpt-5.2` generation model, `deepseek-chat` judge model, 50 iterations
- **Budget**: $0.10 (with 50 max iterations)
- **Actual cost**: $0.0709 (totalSpent from CostTracker)
- **Iterations completed**: 8 (7 EXPANSION + 1 COMPETITION)
- **Stop reason**: `budget_exhausted` (BudgetExceededError thrown by outlineGeneration at iter 8)

### Finding 1: Budget too small for iteration count
The run had $0.10 budget with 50 max iterations. At ~$0.008/iteration (generation + calibration), the run could only sustain ~12 iterations. The budget-to-iteration ratio was fundamentally unrealistic.

### Finding 2: GenerationAgent ignores `generationModel` config
The strategy specified `generationModel: 'gpt-5.2'` but the `GenerationAgent` does NOT pass the model to `llmClient.complete()`. Line 79 of `generationAgent.ts`:
```typescript
const generatedText = await llmClient.complete(prompt, this.name);
// No model option passed — defaults to deepseek-chat
```
This means the expensive `gpt-5.2` model was never actually used for generation, making the strategy config misleading. All LLM calls used the default `deepseek-chat`.

### Finding 3: Cost tracking discrepancy
- `total_cost_usd` in DB (from `getTotalSpent()`): **$0.0709**
- Sum of `evolution_agent_invocations.cost_usd`: **$0.029**
- Discrepancy: **$0.042** (2.4x)

The `recordSpend(agentName, actualCost, invocationId)` should add `actualCost` to BOTH `totalSpent` and `invocationCosts[invocationId]`. If they differ, some calls must have `invocationId = undefined`. Root cause of this discrepancy needs further investigation.

### Finding 4: `llmCallTracking` table is empty in prod
The LLM call tracking table has 0 rows. `saveLlmCallTracking()` is failing silently (non-fatal error handling). This prevents forensic analysis of individual LLM calls.

### Finding 5: Arena sync errors (non-fatal)
7 "sync_to_arena RPC failed" warnings due to FK constraint violation (`evolution_arena_entries.evolution_variant_id_fkey`). These don't affect the run but indicate arena integration issues with experiment runs.

### Finding 6: BudgetExceededError message is misleading
The error message says "spent $0.0709" but actually reports `totalSpent + totalReserved`, not just `totalSpent`. The field name `spent` in the constructor is misleading.

### Finding 7: Leaked reservations caused premature budget exhaustion (ROOT CAUSE)

The run did **NOT** actually reach the $0.10 budget limit. Leaked reservations in `CostTracker` artificially inflated the perceived spend, causing a premature stop.

**The math:**
- `totalSpent` at time of error: **$0.0709**
- outlineGeneration's estimated reservation (gpt-5.2 pricing): **~$0.001**
- With 30% safety margin: **~$0.0013**
- `totalSpent + reservation = $0.072` — well under the $0.10 cap
- For `BudgetExceededError` to fire, `totalSpent + totalReserved + withMargin > budgetCapUsd`
- Therefore `totalReserved` must have been **~$0.028** at time of error

**How reservations leak:**
In `llmClient.ts`, each `complete()` call does:
1. `costTracker.reserveBudget(agentName, estimate)` — adds to `totalReserved`
2. `callLLM(prompt, ...)` — makes the API call
3. `onUsage` callback → `costTracker.recordSpend(...)` — releases ONE reservation from FIFO queue

If `callLLM` throws (network error, timeout, rate limit), step 3 never executes. The reservation remains in `totalReserved` permanently — there is no `releaseReservation()` or `finally` block to clean up.

**Impact:**
- ~$0.028 in orphaned reservations accumulated over 8 iterations
- Real spend was only $0.029 (per invocation tracking) or $0.071 (per totalSpent)
- The run stopped at roughly **29% of actual budget capacity**
- Even by the inflated `totalSpent` measure, $0.071 + $0.001 = $0.072 is well under $0.10

**Two compounding bugs:**
1. **Inflated `totalSpent`** — $0.071 vs $0.029 invocation-attributed costs. Some `recordSpend` calls happen with `invocationId = undefined`, so costs accumulate in `totalSpent` but not in per-invocation tracking.
2. **Leaked reservations** — Failed or unmatched `reserveBudget`/`recordSpend` pairs leave ~$0.028 permanently reserved, reducing available budget.

Together these made the CostTracker believe ~$0.099 was committed ($0.071 spent + $0.028 reserved), triggering `BudgetExceededError` when the true invocation spend was only $0.029.

## Per-Agent Cost Breakdown (invocation costs)
| Agent | Cost | Invocations |
|-------|------|-------------|
| calibration | $0.024 | 7 |
| generation | $0.005 | 8 |
| outlineGeneration | $0.000 | 1 (failed - budget exceeded) |
| proximity | $0.000 | 7 |

## Per-Iteration Match Counts
| Iteration | Matches | Calibration Cost |
|-----------|---------|-----------------|
| 1 | 8 | $0.0018 |
| 2 | 7 | $0.0026 |
| 3 | 12 | $0.0047 |
| 4 | 12 | $0.0046 |
| 5 | 12 | $0.0044 |
| 6 | 9 | $0.0037 |
| 7 | 7 | $0.0026 |
| Total | 67 | $0.024 |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- `evolution/src/lib/core/costTracker.ts` - Budget enforcement and reservation system
- `evolution/src/lib/core/llmClient.ts` - LLM client with budget reservation, estimateTokenCost
- `evolution/src/lib/core/pipeline.ts` - Pipeline orchestrator, budget exhaustion handling
- `evolution/src/lib/core/persistence.ts` - Checkpoint persistence with total_cost_usd
- `evolution/src/lib/core/supervisor.ts` - shouldStop with budget check
- `evolution/src/lib/core/pipelineUtilities.ts` - Agent invocation tracking
- `evolution/src/lib/core/reversalComparison.ts` - 2-pass reversal runner
- `evolution/src/lib/agents/generationAgent.ts` - Generation agent (MISSING model passthrough)
- `evolution/src/lib/agents/calibrationRanker.ts` - Calibration with comparison wrapper
- `evolution/src/lib/comparison.ts` - Standalone comparison with bias mitigation
- `evolution/src/lib/index.ts` - preparePipelineRun factory
- `evolution/src/lib/types.ts` - BudgetExceededError definition
- `evolution/src/services/evolutionRunnerCore.ts` - Runner core
- `evolution/src/services/experimentActions.ts` - Experiment system
- `src/config/llmPricing.ts` - Model pricing table
- `src/lib/services/llms.ts` - callLLM with onUsage callback
- `src/app/api/evolution/run/route.ts` - Unified runner endpoint
