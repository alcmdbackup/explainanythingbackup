# Investigate Cost Controls Evolution Parallel Generation Research

## Problem Statement
The new parallel generate-rank pipeline dispatches N agents in parallel, which changes how budget consumption and cost tracking work compared to the sequential pipeline. This project investigates whether the current two-layer budget model (V2CostTracker + LLMSpendingGate) correctly handles concurrent reservations, potential overspending, and cost attribution across N parallel GenerateFromSeedArticleAgent invocations.

## Requirements (from GH Issue #NNN)
1. Verify V2CostTracker reserve() is safe under N parallel agents
2. Verify LLMSpendingGate handles concurrent reservations correctly
3. Identify any cost tracking gaps or missing metrics
4. Check that generation_cost/ranking_cost split works under parallel dispatch
5. Ensure discarded variant costs are still captured
6. Review orphaned reservation cleanup for parallel runs

## High Level Summary
[Summary of findings]

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
- evolution/docs/reference.md
- evolution/docs/visualization.md
- docs/docs_overall/llm_provider_limits.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/error_handling.md

### Prior Project Docs (for context)
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_research.md
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_planning.md
- docs/planning/generate_rank_evolution_parallel_20260331/generate_rank_evolution_parallel_20260331_progress.md

## Code Files Read
- [list of code files reviewed]
