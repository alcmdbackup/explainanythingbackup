-- Atomic run-claiming RPC for evolution batch runner.
-- Uses FOR UPDATE SKIP LOCKED to allow parallel runners to claim different runs without blocking.

CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT)
RETURNS SETOF content_evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run content_evolution_runs%ROWTYPE;
BEGIN
  -- Atomically claim the oldest pending run.
  -- SKIP LOCKED ensures concurrent callers claim different runs.
  SELECT * INTO v_run
  FROM content_evolution_runs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  -- No pending runs available
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Mark as claimed by this runner
  UPDATE content_evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = NOW()
  WHERE id = v_run.id;

  -- Return the updated row
  v_run.status := 'claimed';
  v_run.runner_id := p_runner_id;
  v_run.last_heartbeat := NOW();
  v_run.started_at := NOW();
  RETURN NEXT v_run;
END;
$$;
