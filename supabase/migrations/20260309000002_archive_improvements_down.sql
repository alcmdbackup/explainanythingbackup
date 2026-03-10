-- Rollback: revert archive improvements migration.

-- Revert RPCs
DROP FUNCTION IF EXISTS unarchive_experiment(UUID);
DROP FUNCTION IF EXISTS archive_experiment(UUID);
DROP FUNCTION IF EXISTS get_non_archived_runs(TEXT, BOOLEAN);

-- Revert: unarchive any archived experiments first (must happen before dropping column)
UPDATE evolution_experiments SET status = COALESCE(pre_archive_status, 'completed')
  WHERE status = 'archived';

BEGIN;
ALTER TABLE evolution_experiments DROP COLUMN IF EXISTS pre_archive_status;
ALTER TABLE evolution_experiments DROP CONSTRAINT IF EXISTS evolution_experiments_status_check;
ALTER TABLE evolution_experiments ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled'));
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS archived;
COMMIT;

DROP INDEX IF EXISTS idx_evolution_runs_not_archived;
