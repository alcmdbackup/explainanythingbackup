# Small Evolution Fixes Research

## Problem Statement
A few small fixes for the evolution dashboard. This project addresses several UX and functionality gaps in the evolution admin UI including strategy archiving, experiment strategy selection, arena cost-based filtering, invocation detail linking, and strategy creation form improvements.

## Requirements (from GH Issue #TBD)
- [ ] Should be able to archive strategies and hide them from appropriate places
- [ ] Should be able to select from pre-defined strategies in "start experiment" - these should explain key settings when selected. Remove ability to define net new strategy/group (select existing instead), creating a new strategy should be done from strategies tab.
- [ ] Experiment should only let you add matching strategies with same cost budget
- [ ] Update "create strategy" from strategy overview page so it is like "create run" from "start experiment". Get rid of pipeline type and iterations option (we run until we hit limit). Also add a field for cost limit for that strategy.
- [ ] No invocation details page is linked from invocation overview tab in evolution dashboard
- [ ] Arena should only compare strategies with similar cost limits against each other. Should start with a default filter.

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
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md

## Code Files Read
- [list of code files reviewed]
