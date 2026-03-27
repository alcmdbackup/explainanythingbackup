# Strategy Metrics Evolution Research

## Problem Statement
The evolution pipeline's `persistRunResults` finalization step does not propagate metrics (run_count, total_cost, avg_final_elo, best_final_elo) to the parent strategy entity after a run completes. The E2E test `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") consistently fails in CI. The run completes successfully, variants are created, invocations recorded, and run-level metrics are computed, but `evolution_metrics` for entity_type='strategy' is empty. Additionally, the arena leaderboard shows raw mu and sigma values which are hard to interpret without knowing the Elo conversion factor.

## Requirements (from GH Issue #848)
1. Fix `persistRunResults.ts` to call `propagateMetricsToParents()` after writing run-level metrics, cascading to parent strategy and experiment entities
2. Ensure the E2E test at `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") passes
3. Update the arena leaderboard UI to show Elo uncertainty range (e.g. "1200 ± 45") instead of raw mu and sigma columns, which are hard to interpret without knowing the conversion factor

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/architecture.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/README.md
- evolution/docs/agents/overview.md

## Code Files Read
- [list of code files reviewed]
