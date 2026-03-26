# Fix Dead Evolution Runs Stage Progress

## Phase 1: Research & Diagnosis
### Work Done
- Queried stage Supabase DB via MCP to find 3 failed runs (65500e0a, 94bf8627, ce267827)
- All failed with "stale claim auto-expired by claim_evolution_run"
- Traced root cause to runner_id mismatch: processRunQueue.ts claims with RUNNER_ID but executeV2Run hardcodes "legacy-${runId}"
- Confirmed via evolution_run_logs that finalization aborts with "run status changed externally"
- Inspected claim_evolution_run RPC source via pg_proc

### Issues Encountered
- evolution/docs/operations.md doesn't exist (referenced in architecture doc)
- Architecture doc references file paths that don't match current code structure

### User Clarifications
- Runner is on a minicomputer using processRunQueue.ts with systemd timer
- Runs were working before (last success: f3d9e9e9 on Mar 22)

## Phase 2: Implementation
...
