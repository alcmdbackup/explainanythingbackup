-- Allow evolution runs without an explanation (e.g. local CLI runs on markdown files).
-- Adds source column to distinguish run origin: 'explanation' (default) vs 'local:<filename>'.

ALTER TABLE content_evolution_runs
  ALTER COLUMN explanation_id DROP NOT NULL;

ALTER TABLE content_evolution_runs
  ADD COLUMN source TEXT NOT NULL DEFAULT 'explanation';

COMMENT ON COLUMN content_evolution_runs.source IS
  'Run origin: "explanation" for production runs, "local:<filename>" for CLI runs';
