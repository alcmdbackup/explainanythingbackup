# Refactor Config Into DB Evolution Research

## Problem Statement
Refactor strategy config so it is linked from run, not contained in run. Currently, when a run is queued, key strategy fields are snapshot-copied into the run's `config` JSONB column (`iterations` → `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps`, `enabledAgents`, `singleArticle`, `budgetCapUsd`). This creates data duplication and makes it harder to trace config provenance. The goal is to store the run config in the database as a proper linked entity rather than an inline JSONB blob.

## Requirements (from GH Issue #TBD)
Refactor strategy config so it is linked from run, not contained in run. Refactor the run config so that it is stored in the DB.

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
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/agents/overview.md

## Code Files Read
- [list of code files reviewed]
