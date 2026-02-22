-- RPC to get the latest checkpoint ID per (run_id, iteration) for a given run.
-- Used by the pruning step in finalizePipelineRun() to keep one checkpoint per iteration.

CREATE OR REPLACE FUNCTION get_latest_checkpoint_ids_per_iteration(p_run_id UUID)
RETURNS TABLE(id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (ec.run_id, ec.iteration) ec.id
  FROM evolution_checkpoints ec
  WHERE ec.run_id = p_run_id
  ORDER BY ec.run_id, ec.iteration, ec.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;
