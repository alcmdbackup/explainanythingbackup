-- Fix: replace partial unique index with non-partial to enable ON CONFLICT inference.
-- The partial predicate (WHERE evolution_run_id IS NOT NULL) prevented PostgreSQL from
-- inferring the index for Supabase JS .upsert() calls. NULLs are already treated as
-- distinct in unique indexes, so the partial predicate was unnecessary.
-- DDL in PostgreSQL is transactional — if CREATE INDEX fails, DROP INDEX is rolled back.
DROP INDEX IF EXISTS idx_hall_of_fame_entries_run_rank;
CREATE UNIQUE INDEX idx_hall_of_fame_entries_run_rank
  ON evolution_hall_of_fame_entries(evolution_run_id, rank);

-- Rollback:
-- DROP INDEX IF EXISTS idx_hall_of_fame_entries_run_rank;
-- CREATE UNIQUE INDEX idx_hall_of_fame_entries_run_rank
--   ON evolution_hall_of_fame_entries(evolution_run_id, rank)
--   WHERE evolution_run_id IS NOT NULL;
