-- Migration 1d: Add pipeline_type to content_evolution_runs.
-- Tracks which pipeline (full/minimal/batch) was used for each run.

ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS pipeline_type TEXT;

ALTER TABLE content_evolution_runs
  ADD CONSTRAINT evolution_runs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch'));

COMMENT ON COLUMN content_evolution_runs.pipeline_type IS 'Pipeline used: full (supervisor), minimal (no supervisor), batch';

-- Rollback:
-- ALTER TABLE content_evolution_runs DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS pipeline_type;
