# Production claim_evolution_run RPC Overload Ambiguity — Research

**Date**: 2026-02-22T05:24:26Z
**Git Commit**: a60216f7
**Branch**: fix/new_error_prod_continuation_evolutinon_20260221
**GitHub Issue**: #522

## Research Question

Why does the Vercel cron runner fail with "Could not choose the best candidate function between: public.claim_evolution_run(p_runner_id => text), public.claim_evolution_run(p_runner_id => text, p_run_id => uuid)" when trying to claim evolution runs in production?

## Summary

**Two PostgreSQL function overloads of `claim_evolution_run` exist simultaneously in production**, and PostgREST cannot disambiguate between them when the caller omits the optional `p_run_id` parameter. This is caused by migration `20260221000002` (table rename) recreating only the 1-arg version without dropping the 2-arg version that migration `20260221000001` created.

## Detailed Findings

### The Migration Sequence (Chronological)

| # | Migration | What it does to `claim_evolution_run` |
|---|-----------|--------------------------------------|
| 1 | `20260214000001` | Creates `claim_evolution_run(TEXT)` → RETURNS SETOF content_evolution_runs |
| 2 | `20260216000001` | CREATE OR REPLACE body of `claim_evolution_run(TEXT)` — adds continuation_pending support. Same signature, body-only change. |
| 3 | `20260221000001` | CREATE OR REPLACE `claim_evolution_run(TEXT, UUID DEFAULT NULL)` — **creates a SECOND function** because PostgreSQL treats different arg counts as different signatures. Now two overloads exist. |
| 4 | `20260221000002` | Part D.1: `DROP FUNCTION IF EXISTS claim_evolution_run(TEXT)` then `CREATE OR REPLACE claim_evolution_run(TEXT)` → RETURNS SETOF evolution_runs. Drops and recreates the 1-arg version with the new table name. **Does NOT drop the 2-arg version from step 3.** |

### State After All Migrations

Two functions coexist in `pg_proc`:

1. **`claim_evolution_run(p_runner_id TEXT)`** — RETURNS SETOF evolution_runs (from migration 4, works correctly)
2. **`claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)`** — RETURNS SETOF content_evolution_runs (from migration 3, orphaned — references dropped view after migration `20260221000006`)

### Why PostgREST Can't Disambiguate

When the cron calls `.rpc('claim_evolution_run', { p_runner_id: 'cron-runner-xxx' })`:
- The 1-arg version matches directly (exact match)
- The 2-arg version ALSO matches because `p_run_id` has `DEFAULT NULL`
- PostgREST's overload resolution requires an unambiguous match — it cannot choose

This is a well-known PostgREST limitation: it cannot disambiguate between `f(a)` and `f(a, b DEFAULT x)` when called with just argument `a`.

### The Caller Code

File: `evolution/src/services/evolutionRunnerCore.ts:42-46`

```typescript
const { data: claimedRows, error: claimError } = await supabase
  .rpc('claim_evolution_run', {
    p_runner_id: options.runnerId,
    ...(options.targetRunId ? { p_run_id: options.targetRunId } : {}),
  });
```

When cron runs (no `targetRunId`), only `p_runner_id` is sent → both overloads match → error.

### All Callers

| Caller | File | p_runner_id | p_run_id | Context |
|--------|------|-------------|----------|---------|
| Cron GET | `src/app/api/evolution/run/route.ts` | `cron-runner-{uuid}` | Never sent | Every 5 min via vercel.json |
| Admin POST | `src/app/api/evolution/run/route.ts` | `admin-trigger` | Optional (from body.runId) | Manual trigger |
| Batch runner | `evolution/scripts/evolution-runner.ts` | `runner-{uuid}` | Never sent | CLI batch execution |

### Root Cause

Migration `20260221000002` (line 43) correctly recognized the need to DROP+RECREATE because the return type changed (`content_evolution_runs` → `evolution_runs`). However, it only dropped `claim_evolution_run(TEXT)` — not `claim_evolution_run(TEXT, UUID)` from the prior migration `20260221000001`. The comment on line 32-34 even documents the PostgreSQL overload behavior:

```sql
-- Must DROP + RECREATE (not just CREATE OR REPLACE) because:
-- - claim_evolution_run: RETURNS SETOF and %ROWTYPE reference the old table name in signature
```

But the DROP on line 43 only targets the 1-arg signature:
```sql
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
```

The 2-arg signature `claim_evolution_run(TEXT, UUID)` from migration `20260221000001` survives untouched.

### Related Prior Research

- `docs/planning/test_out_evolution_run_fix_20260220/` — designed the `p_run_id` parameter addition and the unified endpoint consolidation
- `docs/planning/debug_run_not_resuming_prod_20260221/` — investigated continuation_pending resumption failures
- `docs/planning/simplify_supabase_evolution_set_20260221/` — the table rename project that introduced migration `20260221000002`

## Code References

- `supabase/migrations/20260214000001_claim_evolution_run.sql` — original 1-arg function
- `supabase/migrations/20260221000001_add_target_run_id_to_claim.sql` — 2-arg overload (the one that should survive)
- `supabase/migrations/20260221000002_evolution_table_rename.sql:42-73` — recreates 1-arg, forgets to drop 2-arg
- `supabase/migrations/20260221000006_drop_evolution_compat_views.sql` — drops `content_evolution_runs` view (breaks orphaned 2-arg function)
- `evolution/src/services/evolutionRunnerCore.ts:42-46` — the RPC caller that triggers the error
- `src/app/api/evolution/run/route.ts` — unified cron/admin endpoint
- `evolution/scripts/evolution-runner.ts:55-57` — batch runner RPC call (never sends p_run_id)

## Architecture Documentation

### PostgREST Function Resolution

PostgREST (Supabase's API layer) resolves RPC calls by matching provided parameter names against all function overloads. When multiple overloads match (one exact, one via DEFAULT), it returns the "Could not choose the best candidate function" error. This differs from PostgreSQL's native resolution, which would prefer the exact-arity match.

### The Fix Path

A new migration needs to:
1. Drop BOTH overloads: `DROP FUNCTION IF EXISTS claim_evolution_run(TEXT)` and `DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID)`
2. Recreate a single 2-arg version: `claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL) RETURNS SETOF evolution_runs` — combining the targeted claiming feature from migration `20260221000001` with the correct table reference from `20260221000002`

## Fix Implemented

**Migration**: `supabase/migrations/20260222000001_fix_claim_evolution_run_overload.sql`

The fix migration:
1. `DROP FUNCTION IF EXISTS claim_evolution_run(TEXT)` — removes 1-arg version
2. `DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID)` — removes orphaned 2-arg version
3. `CREATE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)` — single function, returns `SETOF evolution_runs`, combines targeted claiming with correct table reference
4. `NOTIFY pgrst, 'reload schema'` — immediate PostgREST cache refresh

Uses `CREATE FUNCTION` (not `CREATE OR REPLACE`) after explicit DROPs — if DROPs fail, CREATE errors rather than silently adding a third overload.

**Verification**: All 6 unit tests in `evolutionRunnerCore.test.ts` pass. All 3 callers (cron, admin, batch) are compatible — the 2-arg version with `DEFAULT NULL` matches both calling patterns.

## Open Questions

1. Has migration `20260221000006` (drop compat views) been deployed to production? If so, the orphaned 2-arg function referencing `content_evolution_runs` would fail at execution time even if PostgREST chose it.
2. Are there any pending/continuation_pending runs currently stuck in production that need manual intervention?
