# New Error Prod Continuation Evolution Plan

## Background

The Vercel cron runner fails to claim evolution runs in production with error: "Could not choose the best candidate function between: public.claim_evolution_run(p_runner_id => text), public.claim_evolution_run(p_runner_id => text, p_run_id => uuid)". This is a PostgreSQL function overload ambiguity caused by migration `20260221000002` (table rename) recreating only the 1-arg version of `claim_evolution_run` without dropping the 2-arg version from migration `20260221000001`.

## Requirements

1. Fix the PostgREST RPC ambiguity so the cron runner can claim evolution runs again
2. Preserve the targeted claiming capability (optional `p_run_id` parameter)
3. Ensure the function references the renamed `evolution_runs` table (not the dropped `content_evolution_runs` view)
4. Backward-compatible with all existing callers (cron, admin, batch runner)

## Problem

Two PostgreSQL function overloads coexist in production:
- `claim_evolution_run(text)` → RETURNS SETOF evolution_runs (from migration `20260221000002`)
- `claim_evolution_run(text, uuid)` → RETURNS SETOF content_evolution_runs (from migration `20260221000001`, orphaned)

PostgREST cannot disambiguate when the caller omits the optional `p_run_id` parameter. All three callers (cron, admin, batch) hit this error when not targeting a specific run.

## Options Considered

### Option A: New migration — drop both, recreate single 2-arg version (Recommended)
- Drop both overloads explicitly
- Recreate single function with `(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)` returning `SETOF evolution_runs`
- Simple, atomic, no code changes needed
- All callers already pass the correct params for the 2-arg version

### Option B: New migration — drop only the orphaned 2-arg version
- `DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID)`
- Keeps the 1-arg version from `20260221000002`
- Loses the targeted claiming feature (`p_run_id`) until a subsequent migration adds it back
- Would break admin POST calls that pass `p_run_id`

### Option C: Code change — always pass p_run_id
- Modify `evolutionRunnerCore.ts` to always pass `p_run_id: null` explicitly
- PostgREST would then match only the 2-arg version
- Doesn't fix the orphaned 1-arg function still existing
- Fragile — any new caller forgetting to pass `null` hits the same error

**Decision: Option A** — cleanest fix, preserves all functionality, single migration.

## Phased Execution Plan

### Phase 1: Create fix migration (single phase — this is a one-file fix)

**File**: `supabase/migrations/20260222000001_fix_claim_evolution_run_overload.sql`

**Contents**:
```sql
-- Fix: Drop both overloads of claim_evolution_run and recreate as single 2-arg function.
-- Migration 20260221000001 created a 2-arg version (TEXT, UUID DEFAULT NULL) via CREATE OR REPLACE,
-- which PostgreSQL treated as a new overload (different arg count = different function).
-- Migration 20260221000002 dropped+recreated only the 1-arg version with the new table name,
-- leaving the orphaned 2-arg version. PostgREST cannot disambiguate between them.

-- Drop both overloads
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);

-- Recreate as single function with optional p_run_id parameter
CREATE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run evolution_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
    AND (p_run_id IS NULL OR id = p_run_id)
  ORDER BY
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN NEXT v_run;
END;
$$;

-- Force PostgREST to see the change immediately
NOTIFY pgrst, 'reload schema';
```

**Key design decisions**:
- Uses `CREATE FUNCTION` (not `CREATE OR REPLACE`) after explicit drops — clearer intent
- Combines the `p_run_id` filtering from `20260221000001` with the `evolution_runs` table reference from `20260221000002`
- Includes `GRANT EXECUTE TO service_role` + `REVOKE FROM PUBLIC` since DROP+CREATE loses grants (per Security review)
- Includes `NOTIFY pgrst` for immediate schema cache refresh
- Preserves `continuation_pending` priority (CASE ordering)
- Preserves `FOR UPDATE SKIP LOCKED` for safe concurrent claiming
- Preserves `started_at` guard (only set on first claim, not on resume)

### Phase 2: Verify

1. Run unit tests for `evolutionRunnerCore.test.ts` to confirm caller compatibility
2. Run `supabase db push --include-all --dry-run` (if available) to validate migration syntax
3. Verify no other migrations reference the old function signatures

## Testing

### Automated
- Existing unit tests in `evolution/src/services/evolutionRunnerCore.test.ts` cover both cases:
  - Call with only `p_runner_id` (cron path) — should resolve to single function
  - Call with `p_runner_id` + `p_run_id` (admin path) — should resolve to single function
- No new tests needed — the fix is a DB-only change and existing callers are already tested

### Post-deploy verification (run immediately after migration)

```sql
-- 1. Verify exactly ONE overload exists
SELECT proname, pronargs, proargtypes::regtype[]
FROM pg_proc
WHERE proname = 'claim_evolution_run'
  AND pronamespace = 'public'::regnamespace;
-- Expected: 1 row, pronargs=2, proargtypes={text,uuid}

-- 2. Verify grants
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name = 'claim_evolution_run';
-- Expected: service_role has EXECUTE
```

### Manual verification on production
- After deploying migration: confirm cron runner logs show successful claiming
- Check `evolution_runs` table for runs transitioning from `pending` → `claimed` → `running`
- Verify admin UI "trigger run" still works (POST with `runId`)

## Rollback

If the migration partially fails (e.g., CREATE succeeds but GRANT fails), manually run:

```sql
-- Emergency rollback: recreate 1-arg version (unblocks cron, loses targeted claiming)
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);
CREATE FUNCTION claim_evolution_run(p_runner_id TEXT)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run evolution_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
  ORDER BY
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE evolution_runs
  SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  RETURN NEXT v_run;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT) FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
```

## Documentation Updates
- `evolution/docs/evolution/reference.md` — may need update to note the single-function signature
- `evolution/docs/evolution/architecture.md` — already documents the 2-arg signature, no change needed
