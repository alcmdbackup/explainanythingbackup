-- Restore explanation_id column on evolution_runs.
-- This column was dropped during the V2 schema migration (noted in 20260322000006).
-- Adding it back allows the run list view to display linked explanations.
ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS explanation_id BIGINT REFERENCES explanations(id) ON DELETE SET NULL;
