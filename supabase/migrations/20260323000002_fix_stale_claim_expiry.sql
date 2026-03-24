-- Fix stale claimed/running runs blocking the concurrency check in claim_evolution_run.
-- Adds automatic expiry of stale runs (no heartbeat for 10+ minutes OR null heartbeat
-- with created_at > 10 minutes ago) before the concurrency count, preventing dead runners
-- from permanently blocking the claim queue.
-- ROLLBACK: DROP FUNCTION claim_evolution_run(TEXT, UUID, INT);
-- Then re-create previous version from 20260322000001.

-- Drop both overloads to avoid ambiguity, then recreate the canonical version.
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID, INT);

CREATE OR REPLACE FUNCTION claim_evolution_run(
  p_runner_id TEXT,
  p_run_id UUID DEFAULT NULL,
  p_max_concurrent INT DEFAULT 5
)
RETURNS SETOF evolution_runs AS $$
DECLARE
  v_stale_threshold INTERVAL := interval '10 minutes';
BEGIN
  -- Advisory lock serializes all claim attempts (global lock, acceptable bottleneck for <=5 runners)
  PERFORM pg_advisory_xact_lock(hashtext('evolution_claim'));

  -- Expire stale claimed/running runs before checking concurrency.
  -- Handles both null heartbeat (old claim function) and stale heartbeat.
  UPDATE evolution_runs
  SET status = 'failed',
      error_message = 'stale claim auto-expired by claim_evolution_run',
      runner_id = NULL
  WHERE status IN ('claimed', 'running')
    AND (
      (last_heartbeat IS NOT NULL AND last_heartbeat < now() - v_stale_threshold)
      OR
      (last_heartbeat IS NULL AND created_at < now() - v_stale_threshold)
    );

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
