# Evolution Logs Refactor Plan

## Background
Refactor the evolution logging system so that different entities (agent invocations, runs, experiments, strategies) can produce logs. Logs should aggregate upward through the entity hierarchy, so viewing logs for a run includes logs from its agent invocations, and viewing experiment logs includes all run and invocation logs. A standardized UI component will display logs for any entity along with all contained sub-entities.

## Requirements (from GH Issue #NNN)
- Different entities can produce logs - agent invocations, runs, experiments, strategies
- Logs are aggregated up - e.g. agent invocations can be displayed on containing runs and experiments and strategies
- There is a standardized UI component that displays logs for the corresponding entity as well as all contained things. E.g. on run "log" tab in evolution admin UI, you can see logs for that run, all contained agent invocations, etc

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
- `evolution/docs/evolution/data_model.md` - evolution_run_logs schema changes for multi-entity logging
- `evolution/docs/evolution/architecture.md` - logging architecture updates
- `evolution/docs/evolution/visualization.md` - new standardized log UI component
