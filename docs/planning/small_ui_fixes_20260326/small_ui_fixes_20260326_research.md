# Small UI Fixes Research

## Problem Statement
Small UI fixes for the evolution admin pages. The arena leaderboard needs to show Elo uncertainty and a top 15% cutoff indicator. The evolution runs list view has a cost display issue where costs are not updated. Additionally, variants in the arena leaderboard show very high Elo scores despite having no matches, which is misleading.

## Requirements (from GH Issue #NNN)
- Arena leaderboard should show elo uncertainty, in addition to mu and sigma
- Show a cutoff for top 15% - indicate using text at the top which entry is the 15% cutoff we use for ranking
- Cost not updated on evolution runs - in evolution list view
- Variants in arena leaderboard show very high elo despite no matches

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
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/visualization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/cost_optimization.md
- evolution/docs/metrics.md
- evolution/docs/agents/overview.md
- evolution/docs/reference.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/curriculum.md

## Code Files Read
- [list of code files reviewed]
