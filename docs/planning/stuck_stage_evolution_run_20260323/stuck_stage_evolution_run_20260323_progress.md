# Stuck Stage Evolution Run Progress

## Phase 1: Immediate Unblock
### Work Done
- Queried staging DB to identify run `65500e0a` — status `pending`, no runner, no heartbeat, never picked up
- Found 54 runs stuck in `claimed` with NULL `last_heartbeat`, created 01:27-01:48 UTC on 2026-03-23
- Found two overloads of `claim_evolution_run` — the 3-arg version's concurrency check (54 >= 5) was blocking all claims
- First UPDATE attempt returned 0 rows because `last_heartbeat < cutoff` doesn't match NULL
- Fixed WHERE clause to handle NULLs: `(last_heartbeat IS NULL OR last_heartbeat < cutoff) AND created_at < cutoff`
- Successfully reset all 54 stale runs to `failed`
- Verified: 0 claimed/running, 1 pending (`65500e0a`)

### Issues Encountered
- NULL heartbeats: The old 2-arg `claim_evolution_run` overload apparently didn't set `last_heartbeat`, or runners crashed before the first heartbeat interval fired. Standard SQL comparison `< cutoff` doesn't match NULL.

## Phase 2: Preventive Fix
### Work Done
- Created migration `20260323000002_fix_stale_claim_expiry.sql`:
  - Drops both old overloads to eliminate ambiguity
  - Single canonical function with stale expiry before concurrency check
  - Handles both NULL and stale heartbeats
  - 10-minute threshold (matches existing `EVOLUTION_STALENESS_THRESHOLD_MINUTES` default)
- Fixed `evolution/src/lib/ops/watchdog.ts`: Changed `.lt()` to `.or()` filter to catch NULL heartbeats
- Updated `evolution/src/lib/ops/watchdog.test.ts`: Updated mock, added null heartbeat test case
- Applied migration to staging via Supabase MCP — verified single function with correct body
- All 3 watchdog tests pass

### Issues Encountered
- None — straightforward fix once root cause was identified.
