# Fix Prod Evolution V2 Error Plan

## Background
Failed to create experiment: new row for relation "evolution_experiments" violates check constraint "evolution_experiments_status_check" in production, when trying to create an evolution experiment.

## Requirements (from GH Issue #NNN)
Failed to create experiment: new row for relation "evolution_experiments" violates check constraint "evolution_experiments_status_check"

## Problem
[3-5 sentences describing the problem - refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/debugging.md` - may need updates if debugging workflow changes
- `docs/feature_deep_dives/error_handling.md` - may need updates if error handling changes
- `docs/feature_deep_dives/request_tracing_observability.md` - may need updates if tracing changes
- `docs/docs_overall/testing_overview.md` - may need updates if testing changes
- `docs/feature_deep_dives/testing_setup.md` - may need updates if test setup changes
- `docs/docs_overall/environments.md` - may need updates if environment config changes
- `docs/feature_deep_dives/server_action_patterns.md` - may need updates if action patterns change
- `docs/feature_deep_dives/realtime_streaming.md` - may need updates if streaming changes
