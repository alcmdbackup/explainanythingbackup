# Stuck Stage Evolution Run Plan

## Background
54 stale claimed evolution runs on staging are blocking the claim_evolution_run concurrency check (54 >= 5 limit), preventing new runs from being claimed. The watchdog that should detect stale heartbeats and reclaim dead runs exists in the codebase but is not wired into the batch runner. This fix will clean up stale runs and wire the heartbeat timeout into the claim function to prevent recurrence.

## Requirements (from GH Issue #794)
1. Reset 54 stale claimed runs to failed on staging
2. Add heartbeat timeout to claim_evolution_run so stale claims (>10min no heartbeat) are auto-expired before the concurrency check
3. Wire the existing watchdog ops module into the batch runner

## Problem
Evolution run `65500e0a` is stuck in `pending` on staging because 54 stale `claimed` runs are blocking the concurrency check in `claim_evolution_run`. These runs have NULL `last_heartbeat` values from an old claim function overload, and their runners died ~22 hours ago. The watchdog that should clean these up exists but was never wired into the batch runner, and even if it were, its query uses `.lt()` which doesn't match NULL values.

## Options Considered

### Option A: Fix only the watchdog and wire it into the batch runner
- **Pros**: Uses existing code, watchdog already has tests
- **Cons**: Requires the batch runner to be running for cleanup to happen; if no runner is active, stale runs accumulate forever. Also a race condition: watchdog runs separately from claim, so a brief window exists where stale runs still block claims.

### Option B: Add stale expiry directly into claim_evolution_run RPC (chosen)
- **Pros**: Self-healing — every claim attempt auto-expires stale runs atomically within the advisory lock. No external process needed. Eliminates the race condition since expiry + count + claim happen in one serialized transaction.
- **Cons**: Slightly more work per claim call (one extra UPDATE). Negligible cost given claims are infrequent.

### Option C: Cron job / pg_cron for periodic cleanup
- **Pros**: Runs independently of application code
- **Cons**: Requires pg_cron extension, adds infrastructure dependency, still has timing gaps between cleanup runs.

**Decision**: Option B — embed stale expiry in the claim RPC. Also fix the watchdog's null-heartbeat blind spot as defense-in-depth.

## Phased Execution Plan

### Phase 1: Immediate Unblock (manual SQL on staging)
- Run UPDATE to reset 54 stale claimed runs to `failed`
- Handle NULL heartbeats: use `(last_heartbeat IS NULL OR last_heartbeat < cutoff) AND created_at < cutoff`
- Verify pending run `65500e0a` is now claimable

### Phase 2: Preventive Migration
- Drop both old `claim_evolution_run` overloads (2-arg and 3-arg)
- Create single canonical function with stale expiry logic:
  - Advisory lock
  - UPDATE stale runs (heartbeat > 10min old OR null heartbeat with created_at > 10min) to `failed`
  - Count active runs
  - SKIP LOCKED claim
- Apply migration to staging via Supabase MCP

### Phase 3: Fix Watchdog Null Heartbeat Blind Spot
- Change `.lt('last_heartbeat', cutoff)` to `.or()` filter covering both stale and null heartbeats
- Update watchdog test mock from `.lt()` to `.or()`
- Add test case for null heartbeat runs

## Testing

### Unit Tests Modified
- `evolution/src/lib/ops/watchdog.test.ts`
  - Updated mock to use `.or()` instead of `.lt()` chain
  - Added test: "marks runs with null heartbeat as stale"

### Manual Verification on Staging
- Confirmed 54 stale runs reset to failed
- Confirmed pending run `65500e0a` still pending and unblocked
- Confirmed new `claim_evolution_run` function deployed with correct signature (single overload)
- Verified function body includes stale expiry logic via `pg_get_functiondef()`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` — Update "Watchdog" section (lines 392-399) to document that stale expiry now happens inside the claim RPC; remove warning about manual intervention
- `evolution/docs/evolution/minicomputer_deployment.md` — Update "Heartbeat and Stale Detection" section (lines 262-266) to reflect automatic expiry in claim function
