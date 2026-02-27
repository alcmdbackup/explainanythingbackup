# Prod Evolution Budget Issue Debug Research

## Problem Statement
Production evolution experiment runs are hitting budget exceeded errors because the total experiment budget ($0.50) is evenly split across all runs ($0.0625/run), which is too small for even a single iteration. Need to add a run preview to the experiment UI showing per-run budget, factor combinations, and strategy details before starting.

## Requirements (from GH Issue #TBD)
1. Add a run preview table/panel to ExperimentForm showing each L8 row with its factor values, strategy label, estimated cost, and per-run budget
2. Show the per-run budget calculation (totalBudget / numRuns) prominently with a warning when it's below a minimum threshold
3. Show redistributed per-agent budget caps for each run config (accounting for enabledAgents)
4. Surface which agents are active vs disabled per run
5. Leverage existing validateExperimentConfig() which already returns expandedConfigs

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/flow_critique.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- docs/docs_overall/debugging.md

## Code Files Read
- evolution/src/lib/core/budgetRedistribution.ts — budget redistribution logic
- evolution/src/lib/core/costTracker.ts — per-agent budget enforcement
- evolution/src/services/experimentActions.ts — experiment run creation, perRunBudget calculation (line 216)
- scripts/query-prod.ts — prod query tool

## Production Investigation
- Queried runs af3af872 and 0080d2d2 via `query:prod`
- Both runs: budgetCapUsd=$0.0625, enabledAgents=["iterativeEditing","reflection"]
- Run 0080d2d2: "Budget exceeded for calibration: spent $0.0166, cap $0.0166"
- Run af3af872: "Budget exceeded for iterativeEditing: spent $0.0051, cap $0.0055"
- Root cause: experiment total_budget_usd=$0.50 / 8 runs = $0.0625/run
- Budget redistribution is working correctly (scale factor 1.769x for 6 active agents)
- The budget is simply too small for any meaningful pipeline execution
