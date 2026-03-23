# Evolution Logs Refactor Research

## Problem Statement
Refactor the evolution logging system so that different entities (agent invocations, runs, experiments, strategies) can produce logs. Logs should aggregate upward through the entity hierarchy, so viewing logs for a run includes logs from its agent invocations, and viewing experiment logs includes all run and invocation logs. A standardized UI component will display logs for any entity along with all contained sub-entities.

## Requirements (from GH Issue #NNN)
- Different entities can produce logs - agent invocations, runs, experiments, strategies
- Logs are aggregated up - e.g. agent invocations can be displayed on containing runs and experiments and strategies
- There is a standardized UI component that displays logs for the corresponding entity as well as all contained things. E.g. on run "log" tab in evolution admin UI, you can see logs for that run, all contained agent invocations, etc

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution Docs
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- [list of code files reviewed]
