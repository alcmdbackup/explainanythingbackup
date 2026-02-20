# Add Logging Verify Continuation Working Research

## Problem Statement
The evolution pipeline continuation system is designed to handle Vercel's 800-second timeout by checkpointing state and resuming on the next cron cycle. Two production runs (7496e0fa and 47e5de4b) appear stuck — they have 20 checkpoints and ~800s of runtime but remain in `pending` status with `continuation_count = 0`, indicating the continuation mechanism never fired. We need to add logging to diagnose why continuation isn't working and verify the system end-to-end.

## Requirements (from GH Issue #TBD)
- Investigate why runs 7496e0fa and 47e5de4b are stuck at the Vercel 800s timeout
- Determine if the continuation migration (20260216000001) is deployed to production
- Add logging instrumentation to the evolution pipeline to diagnose continuation issues
- Verify the continuation system works end-to-end (claim → execute → checkpoint → continue → resume → complete)
- Monitor future runs to confirm continuation is functioning

## High Level Summary
Investigation of two stuck evolution runs revealed contradictory database state: both have extensive checkpoints and heartbeats indicating ~800s of pipeline execution, but `started_at` is null, `continuation_count` is 0, and status is `pending`. The continuation timeout check in `pipeline.ts` happens at the start of each iteration loop, meaning long-running agents can prevent the check from firing before Vercel's hard kill. The `checkpoint_and_continue` RPC was never called for either run.

### Key Findings
1. **Contradictory state**: Runs have 20 checkpoints and heartbeats but `started_at = null` and status = `pending` — the claim RPC should set `started_at = NOW()`
2. **continuation_count = 0**: The `checkpoint_and_continue` atomic RPC was never invoked
3. **Timing matches 800s**: Run 7496e0fa ran ~12 min, 47e5de4b ran ~13 min (≈ Vercel 800s limit)
4. **Timeout check location**: In `pipeline.ts` lines 343-349, timeout is checked at the START of each iteration, not between individual agents within an iteration
5. **Watchdog gap**: Watchdog checks for `claimed`/`running` status, but these runs are `pending` — watchdog won't process them

### Continuation Architecture
```
pending → claimed → running → [TIME CHECK] → checkpoint_and_continue RPC → continuation_pending
                                                                              ↓
                                                              [next cron] → claimed → running → ...
```

### Root Cause Hypotheses
1. **Migration not applied**: If `20260216000001` isn't deployed to production, `checkpoint_and_continue` doesn't exist
2. **Timeout check granularity**: Check only fires between iterations, not between agents — a long agent can exhaust the buffer
3. **Process killed before checkpoint**: Vercel hard-kills at 800s, no graceful shutdown
4. **Status reset**: Something (manual or script) reset runs to `pending` after timeout

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/request_tracing_observability.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/realtime_streaming.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/state_management.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/environments.md

## Code Files Read
- src/app/api/cron/evolution-runner/route.ts — Main cron endpoint, claims and executes runs
- src/app/api/cron/evolution-watchdog/route.ts — Stale run detection and recovery
- supabase/migrations/20260214000001_claim_evolution_run.sql — Original claim RPC
- supabase/migrations/20260216000001_add_continuation_pending_status.sql — Continuation RPC + status
- evolution/src/lib/core/pipeline.ts — Timeout detection and checkpoint call (via explore agent)
- evolution/src/lib/core/persistence.ts — Checkpoint persistence layer (via explore agent)
