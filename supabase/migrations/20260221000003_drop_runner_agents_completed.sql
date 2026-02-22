-- Drop the dead runner_agents_completed column from evolution_runs.
-- This column was written by checkpoint operations but never read by any application code.

-- Step 1: Replace checkpoint_and_continue RPC to stop writing runner_agents_completed.
-- p_pool_length is kept as a parameter with DEFAULT 0 for backward compatibility
-- (in-flight callers won't break), but it is no longer written anywhere.
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
  -- Upsert checkpoint
  INSERT INTO evolution_checkpoints (run_id, iteration, phase, last_agent, state_snapshot, created_at)
  VALUES (p_run_id, p_iteration, p_phase, p_last_agent, p_state_snapshot, NOW())
  ON CONFLICT (run_id, iteration, last_agent)
  DO UPDATE SET state_snapshot = EXCLUDED.state_snapshot,
               phase = EXCLUDED.phase,
               created_at = NOW();

  -- Update run metadata AND transition to continuation_pending atomically.
  -- Note: runner_agents_completed removed — p_pool_length is accepted but ignored.
  UPDATE evolution_runs
  SET status = 'continuation_pending',
      runner_id = NULL,
      continuation_count = continuation_count + 1,
      current_iteration = p_iteration,
      phase = p_phase,
      last_heartbeat = NOW(),
      total_cost_usd = COALESCE(p_total_cost_usd, total_cost_usd)
  WHERE id = p_run_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % is not in running status, cannot transition to continuation_pending', p_run_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Drop the column (safe — no readers exist)
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS runner_agents_completed;
