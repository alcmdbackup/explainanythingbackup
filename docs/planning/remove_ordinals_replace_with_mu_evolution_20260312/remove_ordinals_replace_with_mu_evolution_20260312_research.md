# Remove Ordinals Replace With Mu Evolution Research

## Problem Statement
Remove ordinal (mu - 3*sigma) as the ranking/display metric throughout the evolution pipeline. Replace all ordinal usage with pure mu for sorting, Elo scale conversion, and persistence. The ordinal function penalizes uncertainty, which is already communicated via sigma/CI — baking it into the point estimate double-counts uncertainty.

## Requirements (from GH Issue #NNN)
Completely get rid of concept of ordinals from codebase. Replace with mu everywhere for evolution ranking.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/experimental_framework.md

## Code Files Read
- [list of code files reviewed]
