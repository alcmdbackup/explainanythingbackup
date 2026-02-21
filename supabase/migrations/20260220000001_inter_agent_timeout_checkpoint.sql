-- Parameterizes checkpoint_and_continue to accept a custom last_agent value.
-- Enables mid-iteration continuation yields (not just between-iteration checkpoints).

CREATE OR REPLACE FUNCTION checkpoint_and_continue(
  p_run_id UUID,
  p_iteration INT,
  p_phase TEXT,
  p_state_snapshot JSONB,
  p_pool_length INT DEFAULT 0,
  p_total_cost_usd NUMERIC DEFAULT NULL,
  p_last_agent TEXT DEFAULT 'iteration_complete'
)
RETURNS VOID AS $$
BEGIN
  -- Upsert checkpoint. last_agent is now parameterized to support both
  -- 'iteration_complete' (between iterations) and 'continuation_yield' (mid-iteration).
  INSERT INTO evolution_checkpoints (run_id, iteration, phase, last_agent, state_snapshot, created_at)
  VALUES (p_run_id, p_iteration, p_phase, p_last_agent, p_state_snapshot, NOW())
  ON CONFLICT (run_id, iteration, last_agent)
  DO UPDATE SET state_snapshot = EXCLUDED.state_snapshot,
               phase = EXCLUDED.phase,
               created_at = NOW();

  -- Update run metadata AND transition to continuation_pending atomically.
  UPDATE content_evolution_runs
  SET status = 'continuation_pending',
      runner_id = NULL,
      continuation_count = continuation_count + 1,
      current_iteration = p_iteration,
      phase = p_phase,
      last_heartbeat = NOW(),
      runner_agents_completed = p_pool_length,
      total_cost_usd = COALESCE(p_total_cost_usd, total_cost_usd)
  WHERE id = p_run_id
    AND status = 'running';  -- guard: only transition from running

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % is not in running status, cannot transition to continuation_pending', p_run_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
