-- Add run_summary JSONB column to content_evolution_runs for post-run analytics persistence.

ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS run_summary JSONB DEFAULT NULL;

COMMENT ON COLUMN content_evolution_runs.run_summary IS
  'Post-run analytics: eloHistory, diversityHistory, matchStats, metaFeedback, baselineRank.
   Sensitive data - ensure RLS policies restrict access appropriately if RLS is enabled.';

-- GIN index for JSONB queries from admin UI.
-- NOTE: Do NOT use CONCURRENTLY — Supabase migrations run inside transactions.
CREATE INDEX IF NOT EXISTS idx_evolution_runs_summary_gin
  ON content_evolution_runs USING GIN (run_summary)
  WHERE run_summary IS NOT NULL;
