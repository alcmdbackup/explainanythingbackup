# Fix Dead Evolution Runs Stage Research

## Problem Statement
Evolution runs on stage are dying during finalization due to a runner_id mismatch between processRunQueue.ts (which claims runs) and executeV2Run (which finalizes them). The claim RPC sets runner_id to 'v2-hostname-pid-timestamp' but executeV2Run hardcodes 'legacy-runId', causing the finalization UPDATE to match 0 rows. Additionally, executeV2Run should be fully deprecated since claimAndExecuteRun handles the full lifecycle correctly.

## Requirements (from GH Issue #TBD)
1. Fix runner_id mismatch: processRunQueue.ts passes RUNNER_ID to claim but executeV2Run hardcodes 'legacy-runId' for finalization
2. Deprecate executeV2Run: migrate processRunQueue.ts to use claimAndExecuteRun directly
3. Remove executeV2Run if no other callers exist
4. Update evolution/docs/architecture.md and minicomputer_deployment.md to reflect changes
5. Add/update unit tests for the affected code paths
6. Verify fix on stage by re-running a failed evolution run

## High Level Summary

### Root Cause: runner_id Mismatch in Finalization

The bug is a **runner_id mismatch** between the claim path and the finalization path when using `processRunQueue.ts`.

**The chain of events:**

1. `processRunQueue.ts` generates `RUNNER_ID = "v2-<hostname>-<pid>-<timestamp>"` (line 28)
2. It calls `claimNextRun()` which invokes `claim_evolution_run` RPC with `p_runner_id = RUNNER_ID` — the DB stores this value in `evolution_runs.runner_id`
3. It then calls `executeV2Run(run.id, run, db.client, llmProvider)` (line 200)
4. `executeV2Run` (claimAndExecuteRun.ts:230-248) calls `executePipeline(runId, ..., "legacy-${runId}")` — hardcoding a **different** runnerId
5. During finalization, `persistRunResults.ts:144-156` builds an UPDATE query with `WHERE runner_id = 'legacy-<runId>'`
6. But the DB has `runner_id = 'v2-gmktec-vm-...'` — **zero rows match**, finalization aborts

### DB Evidence (Stage - 2026-03-24)

Three consecutive runs all failed with `"stale claim auto-expired by claim_evolution_run"`:

| Run ID | Created | Last Heartbeat | Duration | Error |
|--------|---------|----------------|----------|-------|
| `65500e0a` | Mar 23 23:46 | Mar 24 00:19 | ~34 min | stale claim auto-expired |
| `94bf8627` | Mar 24 23:08 | Mar 24 23:11 | ~3 min | stale claim auto-expired |
| `ce267827` | Mar 24 23:10 | Mar 24 23:13 | ~3 min | stale claim auto-expired |

All three show the same pattern in `evolution_run_logs`:
- Generation completes normally (3 strategies produce variants)
- Ranking/triage completes normally
- Finalization logs: `"Finalization aborted: run status changed externally (likely killed)"`
- Arena sync completes (runs after finalization regardless)

The last successful run (`f3d9e9e9` on Mar 22) kept its `runner_id = "v2-gmktec-vm-1454637-1774158974484"` — confirming the runner_id was correctly set during claiming.

### Why Runs Appear "Stale"

After finalization aborts (returns early without setting status to 'completed'), the run stays in `running` status indefinitely. The heartbeat interval is cleared in the `finally` block after `executePipeline` returns, so no more heartbeats are sent. Eventually, a later `claim_evolution_run` call finds the heartbeat is >10 minutes old and expires it as stale.

### Two Code Paths: `claimAndExecuteRun` vs `executeV2Run`

**`claimAndExecuteRun`** (line 79-150) — the correct path:
- Creates its own Supabase client
- Claims run via RPC with `options.runnerId`
- Creates LLM provider internally
- Starts heartbeat
- Calls `executePipeline(runId, ..., options.runnerId)` — **same runnerId used for claiming**
- Used by: API route (`src/app/api/evolution/run/route.ts`)

**`executeV2Run`** (line 230-248) — the broken/deprecated path:
- Accepts externally-claimed run + DB client + LLM provider
- Starts heartbeat
- Calls `executePipeline(runId, ..., "legacy-${runId}")` — **hardcoded different runnerId**
- Used by: `processRunQueue.ts` (the minicomputer batch runner)

The `executeV2Run` function was designed as a bridge for scripts that handle claiming themselves. But since `persistRunResults.ts` added a `runner_id` check in the finalization UPDATE, the mismatch became fatal.

### Architecture Doc vs Reality

The `evolution/docs/architecture.md` describes `claimAndExecuteEvolutionRun()` in `evolution/src/services/evolutionRunnerCore.ts` as the core function, with `executeV2Run()` in `evolution/src/lib/pipeline/runner.ts`. However, the actual codebase has:
- `claimAndExecuteRun` in `evolution/src/lib/pipeline/claimAndExecuteRun.ts`
- `executeV2Run` in the same file
- No `evolutionRunnerCore.ts` file exists

The docs reference file paths that don't match the current code structure. This should be updated.

### processRunQueue.ts Analysis

The batch runner (`evolution/scripts/processRunQueue.ts`) is the primary runner for the minicomputer deployment:
- Connects to both staging and prod databases
- Round-robins claim attempts between targets
- Uses `executeV2Run` (the deprecated path) at line 200
- Generates its own `RUNNER_ID` and passes it to the claim RPC
- But `executeV2Run` ignores this and uses `"legacy-${runId}"`

### Claim RPC Analysis

The `claim_evolution_run` Postgres RPC (from DB introspection):
1. Takes advisory lock `pg_advisory_xact_lock(hashtext('evolution_claim'))`
2. Expires stale runs: `WHERE status IN ('claimed', 'running') AND last_heartbeat < now() - 10 minutes`
3. Checks concurrent limit
4. Claims next pending run with `FOR UPDATE SKIP LOCKED`

The stale-expiry sets `runner_id = NULL` on expired runs, which is why all three failed runs show `runner_id: null` in the DB.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/architecture.md
- evolution/docs/minicomputer_deployment.md
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md

## Code Files Read
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Contains both `claimAndExecuteRun` and `executeV2Run`
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Finalization with runner_id check at line 154
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Iteration loop with kill detection
- `evolution/src/lib/ops/watchdog.ts` — Stale run watchdog (10 min default threshold)
- `evolution/scripts/processRunQueue.ts` — Batch runner using executeV2Run
- `claim_evolution_run` RPC source (via pg_proc introspection)
