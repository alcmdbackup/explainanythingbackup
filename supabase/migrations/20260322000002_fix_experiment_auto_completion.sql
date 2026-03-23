-- Fix Bug #4: Experiment auto-completion without sibling run check.
-- Creates RPC that only completes experiment when ALL sibling runs are done.
-- ROLLBACK: DROP FUNCTION IF EXISTS complete_experiment_if_done(UUID, UUID);

CREATE OR REPLACE FUNCTION complete_experiment_if_done(p_experiment_id UUID, p_completed_run_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE evolution_experiments
  SET status = 'completed', updated_at = now()
  WHERE id = p_experiment_id
    AND status = 'running'
    AND NOT EXISTS (
      SELECT 1 FROM evolution_runs
      WHERE experiment_id = p_experiment_id
        AND id != p_completed_run_id
        AND status IN ('pending', 'claimed', 'running')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
