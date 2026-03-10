# Investigate Evolution Cost Estimation Overrun Research

## Problem Statement
Run 223bc062 exceeded costs in production. The goal is to investigate whether better cost estimation could have prevented this overrun, understand how the estimation system worked for this run, and identify root causes in the cost estimation and budget tracking systems.

## Requirements (from GH Issue #686)
- Use supabase prod query tool to investigate how estimation worked for run 223bc062
- Use budget tracking table (evolution_budget_events) to see what happened during the run
- Write an evolution_budget deep dive document to cover how the estimation system works, if one doesn't already exist

## High Level Summary

**Root cause identified: Tournament agent's per-call cost estimation is ~3.7x too low for gpt-5-nano judge model.**

Run 223bc062 had a $0.05 budget cap but spent $0.0689 (38% overrun). The tournament agent reserved $0.014 total across 61 calls but actually spent $0.053 — **3.7x the reservation**. The system's 30% safety margin on reservations was completely inadequate for this model. The budget went negative at $0.045 spent and continued spending 24 more calls before the agent naturally completed, ending at -$0.019 available budget.

The fundamental bug: `recordSpend()` accepts any actualCost without checking if it exceeds the budget cap. Once reservations are made (with underestimated amounts), the actual spend is recorded unconditionally. The tournament agent fires many parallel comparisons, and by the time spend events arrive, the budget is already deeply negative.

## Run 223bc062 — Production Data

### Run Configuration
| Field | Value |
|-------|-------|
| Budget cap | $0.05 |
| Total cost | $0.0689 (38% over budget) |
| Estimated cost | NULL (no pre-run estimate) |
| Status | completed (budget_exhausted) |
| Iterations completed | 2 of 5 |
| Generation model | deepseek-chat |
| Judge model | gpt-5-nano |
| Enabled agents | iterativeEditing, reflection |
| Continuation count | 0 |

### Per-Agent Cost Breakdown
| Agent | Reserved | Spent | Ratio (Spent/Reserved) | Calls |
|-------|----------|-------|----------------------|-------|
| tournament | $0.0143 | $0.0531 | **3.72x** | 61 |
| calibration | $0.0038 | $0.0079 | 2.09x | 18 |
| iterativeEditing | $0.0032 | $0.0056 | 1.76x | 10 |
| generation | $0.0007 | $0.0012 | 1.74x | 6 |
| reflection | $0.0016 | $0.0011 | 0.71x | 3 |
| proximity | - | $0.0000 | - | 1 |

### Budget Event Timeline
- **Budget went negative** at 20:15:12 ($0.045 spent, available = -$0.0005)
- Tournament started at 20:14:26, reserved ~$0.000234/call avg
- Tournament actual spend was ~$0.000870/call avg
- **24 more tournament spend events** after budget went negative
- Final state: $0.069 spent, available = -$0.019

### Why No Pre-Run Estimate
- `estimated_cost_usd: null` and `cost_estimate_detail: null`
- This means either: no strategy was provided at queue time, or the estimation threw an exception
- Without an estimate, the queue-time budget validation (`estimated > budget → reject`) was **skipped**

## Root Cause Analysis

### Primary Issue: Token Cost Underestimation for gpt-5-nano

The `estimateTokenCost()` function in `llmClient.ts` estimates pre-call costs with:
- Input tokens: `prompt.length / 4` (rough heuristic)
- Output tokens: 150 fixed for `taskType: 'comparison'` or empirical ratio from baselines
- Cost: `(input/1M × inputPrice) + (output/1M × outputPrice)`

For tournament comparisons using gpt-5-nano:
- Average reservation: ~$0.000234/call (estimate × 1.3)
- Average actual cost: ~$0.000870/call
- **Actual was 3.7x the estimate** — the 30% margin covers a max 1.3x ratio

Likely causes:
1. **gpt-5-nano pricing not accurately reflected** in the estimation function
2. **Completion tokens much higher than 150** for comparison judgments
3. **No empirical output ratio** cached for gpt-5-nano tournament calls

### Secondary Issue: No Post-Reservation Overflow Check

`recordSpend(agentName, actualCost)` in `costTracker.ts`:
- Adds `actualCost` to `totalSpent` unconditionally
- Dequeues the FIFO reservation (releasing the reserved amount)
- **Never checks** if `totalSpent > budgetCapUsd` after recording

This means once a reservation is granted, the actual spend can exceed it by any amount.

### Tertiary Issue: Tournament Fires Many Parallel Calls

The tournament agent pairs variants and runs comparisons via `Promise.all`. All 61 reservations were made when budget still appeared available (each one tiny: ~$0.0002). By the time actual spend events arrived, the cumulative spend far exceeded the cap.

The reservation system checks `totalSpent + totalReserved + newReservation > cap`, but:
- Each individual reservation is small enough to pass
- The sum of all reservations ($0.014) was within budget
- The sum of all actual spends ($0.053) was not

## Key Findings

1. **Tournament is the #1 cost driver** — 77% of total run cost ($0.053 of $0.069)
2. **Per-call underestimation is ~3.7x** for gpt-5-nano tournament comparisons
3. **No pre-run estimate** existed for this run (null), so no queue-time rejection
4. **30% safety margin is inadequate** when estimation is off by >30%
5. **`recordSpend()` has no overflow guard** — budget can go arbitrarily negative
6. **Tournament parallelism amplifies the problem** — many small reservations pass individually but cumulative actual spend exceeds budget
7. **Budget went -$0.019 negative** (38% over the $0.05 cap) before the agent completed
8. The `cost_prediction` comparison (estimated vs actual) was also null since there was no estimate

## Open Questions

1. Why was `cost_estimate_detail` null? Was no strategy provided, or did estimation fail silently?
2. Is gpt-5-nano's pricing correctly modeled in `calculateLLMCost()`? What are the actual per-token prices?
3. Are baselines populated for gpt-5-nano tournament calls? If not, the heuristic fallback was used
4. Should `recordSpend()` enforce a hard cap and throw/log when budget is exceeded?
5. Should the tournament agent check available budget between rounds (not just at start)?
6. How many other runs have similar overruns? Is this a systemic issue or specific to gpt-5-nano?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- evolution/src/lib/core/costTracker.ts — Budget enforcement, reservation FIFO queues, recordSpend with no overflow check
- evolution/src/lib/core/costEstimator.ts — Pre-run estimation, baselines (50 sample min), computeCostPrediction (union-key)
- evolution/src/lib/core/llmClient.ts — estimateTokenCost (150 tokens for comparison, prompt.length/4), budgetedCallLLM
- evolution/src/lib/core/metricsWriter.ts — persistCostPrediction, persistAgentMetrics, refreshAgentCostBaselines
- evolution/src/lib/core/config.ts — MAX_RUN_BUDGET_USD=$1.00, resolveConfig budget clamping
- evolution/src/lib/core/budgetRedistribution.ts — Agent classification, no per-agent caps anymore
- evolution/src/lib/core/pipeline.ts — Agent dispatch, BudgetExceededError handling, shouldStop checks
- evolution/src/lib/core/supervisor.ts — shouldStop budget check ($0.01 threshold)
- evolution/src/lib/core/persistence.ts — Checkpoint save/load with costTrackerTotalSpent
- evolution/src/lib/index.ts — preparePipelineRun, wireBudgetEventLogger
- evolution/src/services/evolutionActions.ts — queueEvolutionRunAction, budget validation at queue time
- evolution/src/services/costAnalyticsActions.ts — Cost accuracy analytics
- evolution/src/services/eloBudgetActions.ts — Budget optimization queries
- evolution/src/services/evolutionRunnerCore.ts — Runner flow, continuation support
- supabase/migrations/20260306000001_evolution_budget_events.sql — Budget events table schema
- scripts/query-prod.ts — Production readonly query tool
