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

### Issue 2b: Ordinal vs Mu Scale Inconsistency (Root Cause of Strategy 81acd0 Bug)

**Discovery**: Strategy 81acd0 in production shows aggregate maxElo < medianElo < p90Elo, which is nonsensical. Root cause is that per-run values and aggregated values use different scales.

**Full audit findings**:

#### Ordinal-based (the majority)
| What | File | How |
|------|------|-----|
| `elo_score` in variants table | persistence.ts:77 | `getOrdinal(rating)` |
| Arena `elo_rating` | arenaActions.ts:143,547 | `getOrdinal(rating)` |
| Arena sync from pipeline | arenaIntegration.ts:261 | `getOrdinal(rating)` |
| Strategy `avg_final_elo` | metricsWriter.ts:14 | `getOrdinal(topVariant)` |
| Agent `avg_elo`, `elo_gain` | metricsWriter.ts:194 | `getOrdinal(rating)` |
| Per-run median/p90/max (SQL RPC) | compute_run_variant_stats.sql | `PERCENTILE_CONT(elo_score)` |
| Checkpoint fallback | experimentMetrics.ts:338 | `getOrdinal(r)` |
| `elo_per_dollar` everywhere | rating.ts, arenaActions, metricsWriter | ordinal-based |

#### Mu-based (the outliers)
| What | File | How |
|------|------|-----|
| Arena `display_elo` | arenaActions.ts:381 | `ordinalToEloScale(r.mu)` |
| Arena CI bounds | arenaActions.ts:393-394 | `mu ± 1.96*sigma` |
| **Bootstrap point estimate** | experimentMetrics.ts:199 | `ordinalToEloScale(v.mu)` |
| **Bootstrap resampling** | experimentMetrics.ts:184 | `ordinalToEloScale(v.mu + v.sigma*z)` |

#### The bug
`bootstrapPercentileCI` is the only place where mu-based values get mixed with ordinal-based values **in the same context**. Per-run table rows show ordinal-based median/p90/max from the SQL RPC. Aggregate summary cards for medianElo and p90Elo come from `bootstrapPercentileCI` using mu. The mu-based values are ~144-400 Elo points higher than ordinal (gap = `3*sigma*16`), so aggregate median can exceed per-run max.

maxElo is currently unaffected (goes through `bootstrapMeanCI` using per-run ordinal values), but would get the same inflation if routed through `bootstrapPercentileCI` without fixing the scale.

#### Why ordinal is problematic for display
Ordinal (`mu - 3*sigma`) is redundant when CIs are available:
1. **Double-counts uncertainty** — penalizes the point estimate AND the CI shows the spread
2. **Arena bias toward older entries** — more matches → lower sigma → higher ordinal, even if mu is equal. Newer entries are systematically ranked lower regardless of actual quality.
3. **Temporal drift** — the same variant's ordinal-based Elo drifts upward as sigma shrinks through matches, even if mu barely changes. Makes cross-time comparisons misleading.
4. **Inconsistency** — per-run values (ordinal) vs aggregate values (mu) create impossible relationships like max < median

#### Recommendation: Use mu everywhere for display, keep ordinal only for automated conservative decisions
- Display: `ordinalToEloScale(mu)` for point estimates, `mu ± 1.96*sigma` for CIs
- Sorting/ranking in automated systems: ordinal is fine as a conservative tiebreaker
- The arena already does this correctly with `display_elo` (mu-based) separate from `elo_rating` (ordinal-based for sort)

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
