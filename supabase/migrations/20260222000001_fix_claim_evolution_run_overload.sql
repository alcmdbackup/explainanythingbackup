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

-- DROP+CREATE loses implicit grants. Re-grant to service_role (used by cron/admin callers)
-- and revoke from PUBLIC since this is SECURITY DEFINER and should not be callable by anon.
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID) FROM PUBLIC;

-- Force PostgREST to see the change immediately
NOTIFY pgrst, 'reload schema';
