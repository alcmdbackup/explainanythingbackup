# Something Went Wrong Experiments Evolution Research

## Problem Statement
Bugs in production - 1. going to experiments page after starting a single experiment gives "something is wrong" error 2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist" 3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## Requirements (from GH Issue #NNN)
1. Going to experiments page after starting a single experiment gives "something is wrong" error
2. When going to view details for 2e34834a, see that "Run 2e34834a-aa91-4163-9a70-e546d2d65aa4 not foundcolumn evolution_agent_invocations.agent_attribution does not exist"
3. Run 2e34834a itself is marked as completed, but seem to have failed in production when looking at notifications. Please debug what happened.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/request_tracing_observability.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md

### Evolution Pipeline Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- [list of code files reviewed]
