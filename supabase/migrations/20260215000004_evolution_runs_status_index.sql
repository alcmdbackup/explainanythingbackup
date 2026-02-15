-- DB-2: Add composite index on (status, created_at DESC) for evolution run listing queries.
-- The dashboard and runner cron both filter by status and sort by created_at.
-- Rollback: DROP INDEX IF EXISTS idx_evolution_runs_status;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_runs_status
  ON content_evolution_runs (status, created_at DESC);
