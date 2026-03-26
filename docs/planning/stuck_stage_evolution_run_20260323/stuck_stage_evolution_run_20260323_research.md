# Stuck Stage Evolution Run Research

## Problem Statement
54 stale claimed evolution runs on staging are blocking the claim_evolution_run concurrency check (54 >= 5 limit), preventing new runs from being claimed. The watchdog that should detect stale heartbeats and reclaim dead runs exists in the codebase but is not wired into the batch runner. This fix will clean up stale runs and wire the heartbeat timeout into the claim function to prevent recurrence.

## Requirements (from GH Issue #794)
1. Reset 54 stale claimed runs to failed on staging
2. Add heartbeat timeout to claim_evolution_run so stale claims (>10min no heartbeat) are auto-expired before the concurrency check
3. Wire the existing watchdog ops module into the batch runner

## High Level Summary

The root cause is a combination of three issues:

1. **Stale runs with null heartbeats**: The old `claim_evolution_run` overload (2-arg version without advisory lock) set `last_heartbeat = now()` on claim, but 54 runs ended up with `last_heartbeat = NULL`. These runs were claimed around 01:27-01:48 UTC on 2026-03-23 and their runners died without cleanup.

2. **Concurrency check blocks all new claims**: The newer `claim_evolution_run` (3-arg version with advisory lock) counts all `claimed` + `running` runs before allowing a claim. With 54 stale claimed runs, this count (54) always exceeds `p_max_concurrent` (default 5), so no new run can ever be claimed.

3. **Watchdog not wired in + null-heartbeat blind spot**: The watchdog in `evolution/src/lib/ops/watchdog.ts` exists but is documented as "not currently wired into the batch runner." Additionally, even if it were running, it uses `.lt('last_heartbeat', cutoff)` which does not match NULL values — so the 54 null-heartbeat runs would still be missed.

## Key Findings

### Two overloads of claim_evolution_run existed
- **2-arg** `(text, uuid)`: Simple SKIP LOCKED claim, no concurrency check, no advisory lock
- **3-arg** `(text, uuid, integer)`: Advisory lock + concurrency check + SKIP LOCKED

Both existed simultaneously, causing Postgres overload resolution ambiguity risk. The 2-arg version was the likely source of the 54 unchecked claims.

### Heartbeat mechanism works but has no safety net
- Heartbeat writes every 30s to `evolution_runs.last_heartbeat` (in `claimAndExecuteRun.ts`)
- Always cleaned up in `finally` block
- But if runner process crashes hard (OOM, SIGKILL), no cleanup runs and the run stays `claimed` forever

### Experiment status
- Experiment `6818a5b3` ("test") is `running` with 1 pending run (`65500e0a`)
- The pending run has `budget_cap_usd = 0.05`, `pipeline_version = v2`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md — Runner lifecycle, claim mechanism, watchdog section (lines 384-408)
- evolution/docs/evolution/minicomputer_deployment.md — Batch runner scripts, heartbeat/stale detection docs (lines 262-266)

## Code Files Read
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Core claim + execute orchestrator, heartbeat interval, markRunFailed
- `evolution/src/lib/ops/watchdog.ts` — Stale run detection, uses Supabase `.lt()` which misses NULL heartbeats
- `evolution/src/lib/ops/watchdog.test.ts` — Unit tests for watchdog
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — Fresh schema migration for context

## Database Queries Run (staging: ifubinffdbyewoezcidz)
- `SELECT * FROM evolution_runs WHERE id::text LIKE '65500e0a%'` — Found the stuck run (pending, no runner, no heartbeat)
- `SELECT status, count(*) FROM evolution_runs WHERE status IN ('claimed', 'running', 'pending') GROUP BY status` — 54 claimed, 1 pending
- `SELECT pg_get_functiondef(...)` — Retrieved both claim_evolution_run overloads
- `SELECT * FROM evolution_experiments WHERE id = '6818a5b3-...'` — Experiment is "test", status running
- `SELECT status, min(last_heartbeat), max(last_heartbeat) FROM evolution_runs WHERE status = 'claimed'` — All heartbeats NULL, created 01:27-01:48 UTC
