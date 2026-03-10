# Evolution Questions Small Fixes Research

## Problem Statement
Investigate evolution system questions around agent budgets and max Elo confidence intervals, and apply small fixes. Additionally, investigate a production run (223bc062) that exceeded its cost budget to understand what went wrong and improve cost estimation.

## Requirements (from GH Issue)
1. **Per-agent budget clarification**: Confirm that per-agent budgets are tracking-only (not enforced) and update docs/code comments to reflect this. The `CostTracker` only enforces the run-level `budgetCapUsd` — the `agentName` parameter is used solely for attribution and audit logging.
2. **maxElo confidence interval naming**: The `MetricValue.sigma` field is overloaded — for most metrics it's `null` (CIs come from bootstrap), but for `maxElo` it holds the top variant's Bayesian uncertainty (`topVariant.sigma * ELO_SCALE`). This is confusing and should be renamed or given a proper bootstrap CI.
3. **Production run 223bc062 cost overrun investigation**: Query prod Supabase `evolution_budget_events` table for run `223bc062-f932-431e-b0f7-eec4f133dee3` to understand why it exceeded budget. Identify improvements to cost estimation.

## High Level Summary

### Issue 1: Per-Agent Budgets Are Tracking-Only
- **Confirmed**: `CostTrackerImpl` (evolution/src/lib/core/costTracker.ts) only checks the global run budget at line 43: `this.totalSpent + this.totalReserved + withMargin > this.budgetCapUsd`
- The `BudgetExceededError` is always thrown with `'total'` as the agent name, never a per-agent cap
- `agentName` flows through `reserveBudget()`, `recordSpend()`, `releaseReservation()` purely for attribution (`spentByAgent` map) and audit logging (`evolution_budget_events` table)
- `budgetRedistribution.ts` computes `computeEffectiveBudgetCaps()` but these caps appear to be informational only — they're not enforced in the CostTracker
- The docs in `cost_optimization.md` and `architecture.md` mention "budget redistribution" when agents are disabled, but this only affects proportional allocation display, not enforcement

### Issue 2: maxElo Confidence Interval Naming
- `MetricValue` interface (`experimentMetrics.ts:19-24`) has `value`, `sigma`, `ci`, `n` fields
- For **most metrics** (cost, medianElo, p90Elo): `sigma` is `null`, `ci` holds bootstrap `[2.5th, 97.5th]` from 1000 iterations
- For **maxElo** (line 335): `sigma` = `topVariantSigmaElo` (the winning variant's `sigma * 16`), `ci` remains `null`
- In UI (`StrategyMetricsSection.tsx:147-149`): displays as `maxElo ±{sigma}` which looks like a CI but isn't
- `bootstrapMeanCI` in experimentMetrics.ts does propagate sigma for maxElo (line ~120: Box-Muller sampling using sigma), but the result goes into the `ci` field — meanwhile the `sigma` field still holds the raw top-variant uncertainty
- Key files: `evolution/src/experiments/evolution/experimentMetrics.ts`, `src/app/admin/evolution/strategies/[strategyId]/StrategyMetricsSection.tsx`

### Issue 3: Production Run Cost Overrun
- TODO: Query production `evolution_budget_events` and `evolution_runs` tables for run 223bc062-f932-431e-b0f7-eec4f133dee3

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/strategy_experiments.md
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/admin_panel.md

## Code Files Read
- evolution/src/lib/core/costTracker.ts — Budget enforcement (run-level only)
- evolution/src/lib/types.ts — CostTracker interface, BudgetExceededError
- evolution/src/experiments/evolution/experimentMetrics.ts — MetricValue, bootstrap CIs, maxElo sigma
- evolution/src/lib/core/eloAttribution.ts — Per-variant attribution with CI
- src/app/admin/evolution/strategies/[strategyId]/StrategyMetricsSection.tsx — UI displaying maxElo ±sigma
