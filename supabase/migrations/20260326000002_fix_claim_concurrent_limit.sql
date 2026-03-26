-- Fix Bug #1: Concurrent run limit race condition.
-- Replace client-side count check with server-side advisory lock in claim RPC.
-- ROLLBACK: DROP FUNCTION claim_evolution_run(TEXT, UUID, INT);
-- Then re-create original 2-arg version from 20260315000001.

-- Drop old 2-arg overload to avoid function-not-unique errors
-- (new 3-arg version with DEFAULT would be ambiguous with old 2-arg version)
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);

CREATE OR REPLACE FUNCTION claim_evolution_run(
  p_runner_id TEXT,
  p_run_id UUID DEFAULT NULL,
  p_max_concurrent INT DEFAULT 5
)
RETURNS SETOF evolution_runs AS $$
BEGIN
  -- Advisory lock serializes all claim attempts (global lock, acceptable bottleneck for <=5 runners)
  PERFORM pg_advisory_xact_lock(hashtext('evolution_claim'));

  -- Atomic count check inside the lock
  IF (SELECT count(*) FROM evolution_runs WHERE status IN ('claimed', 'running')) >= p_max_concurrent THEN
    RETURN;
  END IF;

  -- Existing SKIP LOCKED claim logic
  RETURN QUERY
  UPDATE evolution_runs SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
  WHERE id = (
    SELECT id FROM evolution_runs
    WHERE status = 'pending' AND (p_run_id IS NULL OR id = p_run_id)
    ORDER BY created_at ASC LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
