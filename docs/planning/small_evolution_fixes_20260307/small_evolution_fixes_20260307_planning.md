# Small Evolution Fixes Plan

## Background
A few small fixes for the evolution dashboard. This project addresses several UX and functionality gaps in the evolution admin UI including strategy archiving, experiment strategy selection, arena cost-based filtering, invocation detail linking, and strategy creation form improvements.

## Requirements (from GH Issue #TBD)
- [ ] Should be able to archive strategies and hide them from appropriate places
- [ ] Should be able to select from pre-defined strategies in "start experiment" - these should explain key settings when selected. Remove ability to define net new strategy/group (select existing instead), creating a new strategy should be done from strategies tab.
- [ ] Experiment should only let you add matching strategies with same cost budget
- [ ] Update "create strategy" from strategy overview page so it is like "create run" from "start experiment". Get rid of pipeline type and iterations option (we run until we hit limit). Also add a field for cost limit for that strategy.
- [ ] No invocation details page is linked from invocation overview tab in evolution dashboard
- [ ] Arena should only compare strategies with similar cost limits against each other. Should start with a default filter.

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
- `evolution/docs/evolution/visualization.md` - strategy archiving UI, invocation linking
- `evolution/docs/evolution/arena.md` - cost-based filtering
- `evolution/docs/evolution/cost_optimization.md` - strategy cost limit field
- `evolution/docs/evolution/strategy_experiments.md` - experiment strategy selection changes
- `evolution/docs/evolution/data_model.md` - strategy archiving schema
- `evolution/docs/evolution/reference.md` - config/feature flag changes
