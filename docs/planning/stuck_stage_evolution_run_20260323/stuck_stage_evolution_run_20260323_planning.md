# Stuck Stage Evolution Run Plan

## Background
54 stale claimed evolution runs on staging are blocking the claim_evolution_run concurrency check (54 >= 5 limit), preventing new runs from being claimed. The watchdog that should detect stale heartbeats and reclaim dead runs exists in the codebase but is not wired into the batch runner. This fix will clean up stale runs and wire the heartbeat timeout into the claim function to prevent recurrence.

## Requirements (from GH Issue #TBD)
1. Reset 54 stale claimed runs to failed on staging
2. Add heartbeat timeout to claim_evolution_run so stale claims (>10min no heartbeat) are auto-expired before the concurrency check
3. Wire the existing watchdog ops module into the batch runner

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
- `evolution/docs/evolution/architecture.md` - Update watchdog section to reflect it's now wired in; update claim mechanism docs
- `evolution/docs/evolution/minicomputer_deployment.md` - Update heartbeat/stale detection section to reflect automatic expiry in claim function
