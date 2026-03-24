# Stuck Stage Evolution Run Research

## Problem Statement
54 stale claimed evolution runs on staging are blocking the claim_evolution_run concurrency check (54 >= 5 limit), preventing new runs from being claimed. The watchdog that should detect stale heartbeats and reclaim dead runs exists in the codebase but is not wired into the batch runner. This fix will clean up stale runs and wire the heartbeat timeout into the claim function to prevent recurrence.

## Requirements (from GH Issue #TBD)
1. Reset 54 stale claimed runs to failed on staging
2. Add heartbeat timeout to claim_evolution_run so stale claims (>10min no heartbeat) are auto-expired before the concurrency check
3. Wire the existing watchdog ops module into the batch runner

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/minicomputer_deployment.md

## Code Files Read
- [list of code files reviewed]
