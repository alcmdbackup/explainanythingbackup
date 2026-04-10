# Better Cost Estimation Reservation Research

## Problem Statement
The evolution pipeline's cost estimation for generateFromSeedArticle is inaccurate, leading to budget waste when parallel agents exceed their budgets. The current 1-token-per-4-chars heuristic and fixed output token estimates (1000 for generation, 100 for ranking) don't reflect empirical article lengths. Additionally, parallelism in the generate iteration launches all N agents simultaneously without considering remaining budget, causing agents to fail mid-execution when budget runs out. This project aims to improve cost estimation accuracy using empirical data, establish a feedback loop for estimate validation, and modify the parallel launch strategy to be budget-aware — launching only as many agents as the remaining budget can support, then switching to sequential execution in subsequent iterations to minimize waste.

## Requirements (from GH Issue #NNN)
- Estimate the cost of generateFromSeedArticle as accurately as possible, based on model cost and empirical article lengths. This should account for both generation and ranking parts separately. Use Supabase dev to look at empirical article length, looking at debugging.md to see how to query
- Establish a feedback loop that allows us to evaluate the accuracy of our estimates
- Modify generateFromSeedArticle to handle parallelism more gracefully. To reduce waste, estimate how many you can launch in parallel, without going over the remaining budget. Do slightly less than this.
- In the iteration after this, set maximum parallel = 1 - i.e. go sequentially to reduce waste, until all budget is exhausted or all needed variants are generated.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/cost_optimization.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/reference.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md
- docs/docs_overall/llm_provider_limits.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/docs_overall/testing_overview.md

## Code Files Read
- [list of code files reviewed]
