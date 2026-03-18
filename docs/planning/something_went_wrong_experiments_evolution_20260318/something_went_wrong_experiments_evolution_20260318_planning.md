# Something Went Wrong Experiments Evolution Plan

## Background
Bugs in production - 1. going to experiments page after starting a single experiment gives "something is wrong" error 2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist" 3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## Requirements (from GH Issue #NNN)
1. Going to experiments page after starting a single experiment gives "something is wrong" error
2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist"
3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

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
- `docs/docs_overall/debugging.md` - may need updates if debugging workflow changes
- `docs/feature_deep_dives/error_handling.md` - may need updates if error handling changes
- `docs/feature_deep_dives/request_tracing_observability.md` - may need updates if tracing changes
- `docs/docs_overall/testing_overview.md` - may need updates if testing changes
- `docs/feature_deep_dives/testing_setup.md` - may need updates if test setup changes
- `docs/docs_overall/environments.md` - may need updates if environment config changes
