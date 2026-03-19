# Fix Stage Bug Research

## Problem Statement
The evolution V2 migration (20260315000001_evolution_v2.sql) was applied to the staging environment, but it recreated tables without all required columns and dropped tables that production code still references. The most visible error is `column evolution_variants.elo_attribution does not exist`, but there are additional broken references to dropped V1 tables throughout the codebase.

## Requirements (from GH Issue #NNN)
- Fix: `evolution_variants.elo_attribution` column does not exist in staging
- Fix: Code references to tables dropped by V2 migration:
  - `evolution_checkpoints` — referenced in test helpers and E2E specs
  - `evolution_agent_cost_baselines` — queried by `costEstimator.ts`
  - `evolution_run_agent_metrics` — queried by `experimentActions.ts`
  - `evolution_budget_events` — referenced in E2E test specs
- Full V2 cleanup: remove any other stale V1 references from codebase

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
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/reference.md

## Code Files Read
- [list of code files reviewed]
