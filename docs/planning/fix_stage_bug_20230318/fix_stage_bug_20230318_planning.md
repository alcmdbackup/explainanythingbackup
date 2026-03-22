# Fix Stage Bug Plan

## Background
The evolution V2 migration (20260315000001_evolution_v2.sql) was applied to the staging environment, but it recreated tables without all required columns and dropped tables that production code still references. The most visible error is `column evolution_variants.elo_attribution does not exist`, but there are additional broken references to dropped V1 tables throughout the codebase.

## Requirements (from GH Issue #NNN)
- Fix: `evolution_variants.elo_attribution` column does not exist in staging
- Fix: Code references to tables dropped by V2 migration:
  - `evolution_checkpoints` — referenced in test helpers and E2E specs
  - `evolution_agent_cost_baselines` — queried by `costEstimator.ts`
  - `evolution_run_agent_metrics` — queried by `experimentActions.ts`
  - `evolution_budget_events` — referenced in E2E test specs
- Full V2 cleanup: remove any other stale V1 references from codebase

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - may need schema updates reflecting V2 changes
- `evolution/docs/evolution/reference.md` - database schema and key files may need V2 updates
- `evolution/docs/evolution/architecture.md` - checkpoint references may need updating
- `evolution/docs/evolution/cost_optimization.md` - cost baselines table references
