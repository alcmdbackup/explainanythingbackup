-- Adds optional p_run_id parameter to claim_evolution_run RPC.
-- When p_run_id is NULL (default), claims the oldest pending/continuation_pending run (FIFO).
-- When p_run_id is set, claims that specific run. Backward-compatible with all existing callers.

CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)
RETURNS SETOF content_evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run content_evolution_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM content_evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
    AND (p_run_id IS NULL OR id = p_run_id)
  ORDER BY
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE content_evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN NEXT v_run;
END;
$$;
