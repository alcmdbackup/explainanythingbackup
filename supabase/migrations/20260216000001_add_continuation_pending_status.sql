-- Adds continuation_pending status and checkpoint_and_continue RPC for continuation-passing.
-- Allows evolution runs to yield mid-execution and resume from checkpoint on next cron cycle.

-- Wrap constraint swap in a transaction to prevent invalid status values
-- between DROP and ADD (without this, concurrent writes could insert garbage).
BEGIN;
  ALTER TABLE content_evolution_runs
    DROP CONSTRAINT content_evolution_runs_status_check;
  ALTER TABLE content_evolution_runs
    ADD CONSTRAINT content_evolution_runs_status_check
    CHECK (status IN ('pending','claimed','running','completed','failed','paused','continuation_pending'));
  ALTER TABLE content_evolution_runs
    ADD COLUMN IF NOT EXISTS continuation_count INT NOT NULL DEFAULT 0;
COMMIT;

-- CONCURRENTLY cannot run inside a transaction, so this is a separate statement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_runs_continuation
  ON content_evolution_runs (created_at ASC) WHERE status = 'continuation_pending';

-- Update claim_evolution_run RPC to also claim continuation_pending runs,
-- prioritizing them over pending (already invested compute).
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT)
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
  ORDER BY
    -- Prioritize continuation_pending (already invested cost) over pending
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

-- Atomic checkpoint + status transition RPC.
-- Persists a checkpoint AND transitions run to continuation_pending in one transaction,
-- eliminating the race window where the process could be killed between two separate DB calls.
CREATE OR REPLACE FUNCTION checkpoint_and_continue(
  p_run_id UUID,
  p_iteration INT,
  p_phase TEXT,
  p_state_snapshot JSONB,
  p_pool_length INT DEFAULT 0,
  p_total_cost_usd NUMERIC DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- Upsert checkpoint (matches existing persistCheckpoint pattern).
  -- Uses 'iteration_complete' as last_agent to distinguish from per-agent checkpoints.
  INSERT INTO evolution_checkpoints (run_id, iteration, phase, last_agent, state_snapshot, created_at)
  VALUES (p_run_id, p_iteration, p_phase, 'iteration_complete', p_state_snapshot, NOW())
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
