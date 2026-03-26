-- Fix Bug #13: Missing indexes for arena leaderboard queries.
-- supabase:disable-transaction
-- ^^^ Required: CONCURRENTLY cannot run inside a transaction.
-- ROLLBACK: DROP INDEX IF EXISTS idx_variants_arena_leaderboard;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variants_arena_leaderboard
  ON evolution_variants (prompt_id, mu DESC)
  WHERE synced_to_arena = true AND archived_at IS NULL;
