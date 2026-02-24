-- Partial index on evolution_invocation_id for efficient joins.
-- Separate file: CONCURRENTLY cannot run inside a transaction.
-- Run outside default transaction wrapper: supabase db execute or --no-transaction flag.
-- Rollback: DROP INDEX IF EXISTS idx_llm_tracking_invocation;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_tracking_invocation
  ON "llmCallTracking"(evolution_invocation_id)
  WHERE evolution_invocation_id IS NOT NULL;
