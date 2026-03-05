-- Add composite index on evolution_hall_of_fame_entries for topic + rank queries.
-- New query pattern introduced by top-10 HoF feeding: fetch all ranked entries for a topic
-- in rank order to display the full leaderboard seeded from pipeline runs.
--
-- Existing index idx_hall_of_fame_entries_topic covers (topic_id, created_at DESC) — good for
-- chronological listing. The new index covers (topic_id, rank ASC) for ordered rank display
-- and for rank-aware upsert conflict checking (the unique index on (evolution_run_id, rank)
-- already exists and handles write dedup, but reads by topic+rank need this read index).
--
-- NOTE: Do NOT use CONCURRENTLY — Supabase migrations run inside transactions.
CREATE INDEX IF NOT EXISTS idx_hof_entries_topic_rank
  ON evolution_hall_of_fame_entries (topic_id, rank ASC)
  WHERE rank IS NOT NULL AND deleted_at IS NULL;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_hof_entries_topic_rank;
