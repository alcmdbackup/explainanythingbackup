-- Archive improvements: experiment archiving with pre_archive_status, run archived boolean,
-- RPCs for non-archived run listing and experiment archive/unarchive with cascade.

BEGIN;

-- 1. Add pre_archive_status column to preserve state before archiving
ALTER TABLE evolution_experiments
  ADD COLUMN IF NOT EXISTS pre_archive_status TEXT;

-- 2. Drop and recreate CHECK constraint to add 'archived'
ALTER TABLE evolution_experiments
  DROP CONSTRAINT IF EXISTS evolution_experiments_status_check;
ALTER TABLE evolution_experiments
  ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled', 'archived'));

-- 3. Add archived boolean to runs (separate from execution status)
ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

COMMIT;

-- 4. Index for filtering non-archived runs (common query path)
-- CONCURRENTLY cannot be inside a transaction block
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_runs_not_archived
  ON evolution_runs(archived) WHERE archived = false;

-- 5. RPC for fetching non-archived runs (Supabase JS client cannot express LEFT JOIN)
CREATE OR REPLACE FUNCTION get_non_archived_runs(
  p_status TEXT DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT false
)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_include_archived THEN
    IF p_status IS NOT NULL THEN
      RETURN QUERY SELECT r.* FROM evolution_runs r WHERE r.status = p_status;
    ELSE
      RETURN QUERY SELECT r.* FROM evolution_runs r;
    END IF;
  ELSE
    IF p_status IS NOT NULL THEN
      RETURN QUERY
        SELECT r.* FROM evolution_runs r
        LEFT JOIN evolution_experiments e ON r.experiment_id = e.id
        WHERE r.archived = false
          AND (e.status IS NULL OR e.status != 'archived')
          AND r.status = p_status;
    ELSE
      RETURN QUERY
        SELECT r.* FROM evolution_runs r
        LEFT JOIN evolution_experiments e ON r.experiment_id = e.id
        WHERE r.archived = false
          AND (e.status IS NULL OR e.status != 'archived');
    END IF;
  END IF;
END;
$$;

-- 6. RPC for archiving experiment + cascading to runs (atomic)
CREATE OR REPLACE FUNCTION archive_experiment(p_experiment_id UUID)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only terminal experiments can be archived
  IF NOT EXISTS (
    SELECT 1 FROM evolution_experiments
    WHERE id = p_experiment_id AND status IN ('completed', 'failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Only terminal experiments (completed/failed/cancelled) can be archived';
  END IF;

  -- Save current status and archive
  UPDATE evolution_experiments
  SET pre_archive_status = status,
      status = 'archived',
      updated_at = NOW()
  WHERE id = p_experiment_id;

  -- Cascade: archive linked runs
  UPDATE evolution_runs
  SET archived = true
  WHERE experiment_id = p_experiment_id AND archived = false;
END;
$$;

-- 7. RPC for unarchiving experiment + restoring runs (atomic)
CREATE OR REPLACE FUNCTION unarchive_experiment(p_experiment_id UUID)
RETURNS void
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM evolution_experiments
    WHERE id = p_experiment_id AND status = 'archived'
  ) THEN
    RAISE EXCEPTION 'Experiment is not archived';
  END IF;

  -- Restore previous status
  UPDATE evolution_experiments
  SET status = COALESCE(pre_archive_status, 'completed'),
      pre_archive_status = NULL,
      updated_at = NOW()
  WHERE id = p_experiment_id;

  -- Unarchive all linked runs
  UPDATE evolution_runs
  SET archived = false
  WHERE experiment_id = p_experiment_id AND archived = true;
END;
$$;

-- 8. Security: restrict RPC access to service_role only
REVOKE ALL ON FUNCTION get_non_archived_runs(TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_non_archived_runs(TEXT, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION archive_experiment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_experiment(UUID) TO service_role;

REVOKE ALL ON FUNCTION unarchive_experiment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unarchive_experiment(UUID) TO service_role;

-- 9. Notify PostgREST to pick up new RPCs
NOTIFY pgrst, 'reload schema';
