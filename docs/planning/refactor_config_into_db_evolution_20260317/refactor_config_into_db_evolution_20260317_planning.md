# Refactor Config Into DB Evolution Plan

## Background
Refactor strategy config so it is linked from run, not contained in run. Currently, when a run is queued, key strategy fields are snapshot-copied into the run's `config` JSONB column. This creates data duplication and makes it harder to trace config provenance. The goal is to store the run config in the database as a proper linked entity rather than an inline JSONB blob.

## Requirements (from GH Issue #TBD)
Refactor strategy config so it is linked from run, not contained in run. Refactor the run config so that it is stored in the DB.

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
- `evolution/docs/evolution/architecture.md` - Config propagation and pipeline execution flow
- `evolution/docs/evolution/data_model.md` - Strategy system, config propagation section
- `evolution/docs/evolution/reference.md` - Configuration section, resolveConfig(), strategy config details
- `evolution/docs/evolution/cost_optimization.md` - Strategy identity and pre-registration
- `evolution/docs/evolution/strategy_experiments.md` - Strategy pre-registration flow
- `evolution/docs/evolution/entity_diagram.md` - Entity relationships if schema changes
- `evolution/docs/evolution/visualization.md` - Admin UI config display
- `evolution/docs/evolution/curriculum.md` - Module 6: Config System
