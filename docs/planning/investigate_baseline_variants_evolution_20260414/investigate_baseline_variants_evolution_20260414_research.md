# Investigate Baseline Variants Evolution Research

## Problem Statement
We want to understand why baseline variants in the last few stage runs are consistently near the strongest variants in the pool, and why the same baseline variant appears to be reused every run. Separately, we want to map out how `generateFromSeedArticle` uses the baseline variant during ranking, and explain why newly generated variants are frequently rated systematically low (elo < 1200 in many cases).

## Requirements (from GH Issue #TBD)
- Investigate why baseline variants in the last few stage runs are consistently near the strongest variants in the pool.
- Investigate why the same baseline variant is being used every run (is this expected behavior or a bug in seed selection?).
- Document how `generateFromSeedArticle` (the generate agent) uses the baseline for ranking newly generated variants (binary-search ranking against local snapshot).
- Explain why ratings for newly generated variants are often systematically low (< 1200) — identify whether this is a rating-math artifact, a judge bias, a ranking-algorithm effect, or a genuine quality signal.

## High Level Summary
[To be filled during /research — investigate stage DB runs, trace baseline loading in `buildRunContext.ts` / `generateSeedArticle`, inspect `GenerateFromSeedArticleAgent` ranking path, and analyze Elo update math + judge outputs for recent runs.]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/metrics.md
- evolution/docs/cost_optimization.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/agents/overview.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- [To be filled during /research]
