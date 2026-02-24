# Cost Estimates Wrong Evolution Prod Research

## Problem Statement
There are many inconsistencies with cost display in the evolution pipeline UI. Different parts of the same run detail page show different cost values for the same run, making it unclear which numbers are estimates vs. actual costs. The labels are also not clear enough to distinguish pre-run estimates from post-run actuals.

## Requirements (from GH Issue #528)
In production for run ec13e9ba, I see the following. On run details page, near the top it says that $0.14/5.00 budget has been consumed. Under timeline budget status module, it says that .07/5.00 has been consumed. Under budget details "estimated vs. actual", it says that actual is $0.04 vs. $.11 estimated. These are also not clearly labeled, so I can't tell what is an estimate from start vs. actual result.

## High Level Summary

Three different cost values are displayed on the same run detail page, each sourced from a different data path. The root causes are:

1. **Header ($0.14)** is CORRECT — reads `evolution_runs.total_cost_usd` from `CostTracker.getTotalSpent()`, properly maintained across continuations.

2. **Budget Status Card ($0.07)** UNDERCOUNTS — `getEvolutionRunBudgetAction` sums `evolution_agent_invocations.cost_usd` values, but:
   - **Missing pairwise costs**: Tournament delegates LLM calls to PairwiseRanker which tracks costs under `pairwise` agent name. No invocation row exists for `pairwise` (it's a budget key, not a pipeline agent). This accounts for ~45% of total spend.
   - **Cumulative vs incremental confusion**: `cost_usd` in invocations is cumulative per-agent per-session (via `getAgentCost(this.name)`), but the budget action sums them as if they're incremental per-invocation values. Within a single session this overcounts, but across continuation boundaries it undercounts.
   - **Continuation resets**: `spentByAgent` map resets on each continuation resume via `createCostTrackerFromCheckpoint()` which only restores `totalSpent`, not per-agent tracking.

3. **"Actual" in Estimated vs Actual ($0.04)** is WRONG — `computeCostPrediction` uses `ctx.costTracker.getAllAgentCosts()` which returns `spentByAgent` — only the LAST continuation session's costs, not the full run.

4. **Labeling is unclear** — "Estimated" and "Actual" don't clearly indicate pre-run prediction vs post-run result.

### Production Evidence (run ec13e9ba)

| Source | Value | DB Field | Correct? |
|--------|-------|----------|----------|
| Header budget bar | $0.14 | `evolution_runs.total_cost_usd` (0.1361) | YES |
| Budget Status Card | $0.07 | Sum of `evolution_agent_invocations.cost_usd` (0.0747) | NO — missing pairwise |
| "Actual" cost | $0.04 | `evolution_runs.cost_prediction.actualUsd` (0.0387) | NO — last session only |
| "Estimated" cost | $0.11 | `evolution_runs.cost_prediction.estimatedUsd` (0.1053) | YES (pre-run estimate) |
| Checkpoint total (iter 4) | $0.14 | `evolution_checkpoints.state_snapshot.costTrackerTotalSpent` (0.1361) | YES |

Key facts:
- `continuation_count = 2` (3 sessions total, run split by Vercel timeouts)
- `agent_metrics` table only has 2 agents (debate, evolution) — the only agents that made LLM calls in the final session
- Tournament shows `cost_usd = 0.000000` in ALL iterations because its LLM calls are tracked under `pairwise`

## Detailed Findings

### Finding 1: Three Cost Data Sources on One Page

The run detail page displays cost data from three independent sources:

**Source A: `evolution_runs.total_cost_usd`** (Header)
- Written by `CostTracker.getTotalSpent()` at every checkpoint and run completion
- `restoreSpent()` properly sets `totalSpent` from checkpoint on resume
- This is the authoritative cost value — always correct
- Displayed by `BudgetBar` component in `page.tsx:422-438`

**Source B: `evolution_agent_invocations.cost_usd`** (Budget Status Card)
- Each agent writes `costUsd: ctx.costTracker.getAgentCost(this.name)` to its invocation row
- `getEvolutionRunBudgetAction` (visualization actions line 628-644) sums all rows:
  ```
  for (const inv of invocations) {
    cumulative += Number(inv.cost_usd) || 0;  // treats cumulative as incremental
  }
  ```
- Displayed by `BudgetStatusCard` in `TimelineTab.tsx:100-153`

**Source C: `evolution_runs.cost_prediction`** (Estimated vs Actual panel)
- Written at run completion by `persistCostPrediction` → `computeCostPrediction`
- `actualUsd = Object.values(costTracker.getAllAgentCosts()).reduce((a,b) => a+b, 0)`
- `getAllAgentCosts()` returns `spentByAgent` which resets on each continuation
- Displayed in `TimelineTab.tsx:229-296`

### Finding 2: PairwiseRanker Cost Attribution Gap

The cost attribution chain for tournament comparisons:
1. `Tournament.execute()` calls `this.pairwise.compareWithBiasMitigation(ctx, ...)`
2. `PairwiseRanker.comparePair()` calls `ctx.llmClient.complete(prompt, this.name, ...)` where `this.name = 'pairwise'`
3. `llmClient.complete` calls `costTracker.reserveBudget('pairwise', ...)` and `costTracker.recordSpend('pairwise', ...)`
4. Tournament returns `costUsd: ctx.costTracker.getAgentCost('tournament')` = **$0.00** (no cost under 'tournament')
5. The `pairwise` cost exists in `costTracker.spentByAgent['pairwise']` and `totalSpent`, but:
   - No `pairwise` invocation row is written (PairwiseRanker isn't a pipeline agent)
   - `persistAgentMetrics` filters out `pairwise` (no variants map to it)

For run ec13e9ba, pairwise costs account for ~$0.06 (total $0.14 - invocations sum $0.07 ≈ $0.07 missing).

### Finding 3: Continuation Reset Loses Per-Agent Tracking

`createCostTrackerFromCheckpoint` (`costTracker.ts:94-98`):
```typescript
const tracker = new CostTrackerImpl(config.budgetCapUsd, config.budgetCaps);
tracker.restoreSpent(restoredTotalSpent);  // Only sets totalSpent
return tracker;  // spentByAgent is empty!
```

After each continuation:
- `getTotalSpent()` = restored + new = CORRECT
- `getAgentCost(name)` = only new session's cost = INCOMPLETE
- `getAllAgentCosts()` = only new session's agents = INCOMPLETE

This affects:
- `evolution_agent_invocations.cost_usd` — later sessions write smaller cumulative values
- `evolution_run_agent_metrics` — only has agents from the final session
- `cost_prediction.actualUsd` — only sums final session's per-agent costs

### Finding 4: Session Boundary Analysis for ec13e9ba

Based on checkpoint timestamps, duplicate execution_orders, and Vercel's ~12-min timeout:

- **Session 1** (~14:00-14:12): Iter 1 complete + iter 2 agents 0-6 (gen through debate)
- **Session 2** (~14:13-14:25): Iter 2 agents 7-10 (evolution through metaReview) + iter 3 complete + iter 4 agents 0-3 (gen through sectionDecomp)
- **Session 3** (~14:26-14:37): Iter 4 agents 4-8 (debate through metaReview) → run completes

Evidence: Iteration 2 and iteration 4 both have duplicate `execution_order` values (e.g., two agents with order=0), indicating the iteration was split across sessions with execution_order restarting.

### Finding 5: Invocation cost_usd is Cumulative Per-Agent Per-Session

Confirmed by production data within session 1 (iterations 1-2):
- generation: iter 1 = $0.000909, iter 2 = $0.001830 (≈ 2× iter 1)
- reflection: iter 1 = $0.000910, iter 2 = $0.001842 (≈ 2× iter 1)
- outlineGeneration: iter 1 = $0.001429, iter 2 = $0.003070 (≈ 2× iter 1)
- debate: iter 1 = $0.002335, iter 2 = $0.005042 (≈ 2× iter 1)

After continuation (session 2 → session 3), values reset:
- generation: iter 3 = $0.000937, iter 4 = $0.001861 (≈ 2× iter 3, but much less than iter 2)

This confirms `getAgentCost()` returns cumulative cost within a session, resetting to 0 on continuation.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/hall_of_fame.md

## Code Files Read
- `evolution/src/lib/core/costTracker.ts` — CostTrackerImpl, restoreSpent, getAgentCost
- `evolution/src/lib/core/costEstimator.ts` — computeCostPrediction, estimateRunCostWithAgentModels
- `evolution/src/lib/core/metricsWriter.ts` — persistCostPrediction, persistAgentMetrics
- `evolution/src/lib/core/llmClient.ts` — createEvolutionLLMClient, agentName parameter
- `evolution/src/lib/core/pipelineUtilities.ts` — persistAgentInvocation
- `evolution/src/lib/core/persistence.ts` — persistCheckpoint, checkpointAndMarkContinuationPending
- `evolution/src/lib/core/pipeline.ts` — executeFullPipeline, finalizePipelineRun
- `evolution/src/services/evolutionVisualizationActions.ts` — getEvolutionRunBudgetAction, getEvolutionRunTimelineAction
- `evolution/src/services/evolutionActions.ts` — getEvolutionRunByIdAction, queueEvolutionRunAction
- `evolution/src/lib/agents/tournament.ts` — Tournament delegates to PairwiseRanker
- `evolution/src/lib/agents/pairwiseRanker.ts` — PairwiseRanker.name = 'pairwise', LLM call attribution
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — BudgetBar, header display
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — BudgetStatusCard, Estimated vs Actual panel

## Production SQL Evidence

### Run overview
- `total_cost_usd` = 0.1361, `continuation_count` = 2, `estimated_cost_usd` = 0.1053
- `cost_prediction.actualUsd` = 0.0387, `cost_prediction.estimatedUsd` = 0.1053

### Agent invocations sum
- Total across all invocations: $0.0747 (vs true total $0.1361)
- Tournament: $0.00 in all iterations
- Missing ~$0.06 = pairwise comparison costs

### Agent metrics (only final session)
- debate: $0.004043, evolution: $0.002989
- Only 2 agents recorded out of 11 that ran

### Checkpoint costs (authoritative)
- iter 1: $0.0228, iter 2: $0.0619, iter 3: $0.0951, iter 4: $0.1361

## Simplification Analysis

### Finding 6: Cost Display Inventory

Full audit of all cost-related displays on the run detail page, categorized by type:

#### TOP LEVEL (total run cost — should all agree)

| # | Component | Location | Data Source | Correct? |
|---|-----------|----------|-------------|----------|
| 1 | Header budget bar | `page.tsx:422-438` | `run.total_cost_usd` | YES |
| 2 | Budget percentage | `page.tsx:323-325` | `run.total_cost_usd` | YES |
| 3 | BudgetStatusCard | `TimelineTab.tsx:100-153` | Sum of `invocations.cost_usd` | NO |
| 4 | "Actual" in Est vs Actual | `TimelineTab.tsx:229-296` | `cost_prediction.actualUsd` | NO |

**Key finding**: Items 1 and 2 already use the correct single source of truth (`evolution_runs.total_cost_usd`). Only items 3 and 4 are broken.

#### BREAKDOWN (per-agent costs — inherently approximate after continuations)

| # | Component | Location | Data Source |
|---|-----------|----------|-------------|
| 5 | Per-agent cost bars | `TimelineTab.tsx` | `invocations.cost_usd` |
| 6 | Agent metrics table | `TimelineTab.tsx` | `agent_metrics.total_cost_usd` |
| 7 | Per-agent in cost_prediction | `TimelineTab.tsx:229-296` | `cost_prediction.perAgent` |
| 8 | CostAccuracyPanel | `CostAccuracyPanel.tsx` | `cost_prediction.perAgent` |

These BREAKDOWN displays inherently require per-agent data, which is lossy after continuations. Fixing them fully requires restoring `spentByAgent` across continuations (Finding 3).

#### ESTIMATE (pre-run prediction — correct as-is)

| # | Component | Location | Data Source |
|---|-----------|----------|-------------|
| 9 | "Estimated" in Est vs Actual | `TimelineTab.tsx:229-296` | `cost_prediction.estimatedUsd` |
| 10 | `estimated_cost_usd` | `page.tsx` | `evolution_runs.estimated_cost_usd` |

#### COMPARISON (delta between estimate and actual)

| # | Component | Location | Data Source |
|---|-----------|----------|-------------|
| 11 | Delta % | `TimelineTab.tsx` | `cost_prediction.deltaPercent` |

Delta is derived from `actualUsd` vs `estimatedUsd`, so fixing `actualUsd` fixes this too.

### Finding 7: cost_prediction Write & Read Paths

**Single write path** — `metricsWriter.ts:145`:
```typescript
persistCostPrediction(ctx, computeCostPrediction(estimateParsed.data, ctx.costTracker.getAllAgentCosts()))
```

**Two consumers:**
1. `TimelineTab.tsx` — uses `actualUsd`, `deltaPercent`, `perAgent`
2. `CostAccuracyPanel.tsx` — uses only `perAgent`

**Root cause**: `getAllAgentCosts()` returns only the last continuation session's `spentByAgent` map. This makes `actualUsd` wrong, `deltaPercent` wrong, and `perAgent` incomplete.

### Finding 8: Single Source of Truth Strategy

`evolution_runs.total_cost_usd` is already the authoritative cost value:
- Written by `CostTracker.getTotalSpent()` at every checkpoint and run completion
- `restoreSpent()` properly accumulates across continuations
- Matches checkpoint state snapshots exactly
- Already used by the two most prominent displays (header bar, budget percentage)

**What needs to change for one source of truth:**

1. **BudgetStatusCard** (item 3): Switch from summing invocations to reading `total_cost_usd` directly. The budget action already has access to the run object — just use `run.total_cost_usd` instead of computing from invocations.

2. **cost_prediction.actualUsd** (item 4): Change `computeCostPrediction` to accept `totalCostUsd` (from `CostTracker.getTotalSpent()`) instead of summing `getAllAgentCosts()`. This fixes both `actualUsd` and `deltaPercent`.

3. **Per-agent breakdowns** (items 5-8): These inherently need per-agent data. Two sub-options:
   - **Minimal fix**: Accept that per-agent breakdowns are approximate after continuations. Label them clearly.
   - **Full fix**: Persist `spentByAgent` in checkpoint state and restore it in `createCostTrackerFromCheckpoint`. This makes all per-agent data correct across continuations.

4. **Labeling**: Change "Estimated" → "Pre-run Estimate" and "Actual" → "Final Cost" to make the distinction clear.
