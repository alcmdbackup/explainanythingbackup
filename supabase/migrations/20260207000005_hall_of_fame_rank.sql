-- Migration 1e: Add rank to article_bank_entries and expand generation_method.
-- Enables top-3 hall of fame entries per run.

-- Add rank column (1-3 for hall of fame, NULL for legacy single-winner entries)
ALTER TABLE article_bank_entries
  ADD COLUMN IF NOT EXISTS rank INT;

ALTER TABLE article_bank_entries
  ADD CONSTRAINT article_bank_entries_rank_check
  CHECK (rank IS NULL OR (rank >= 1 AND rank <= 3));

-- Unique index: one entry per rank per run (enables upsert dedup for top-3 feeding)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_entries_run_rank
  ON article_bank_entries(evolution_run_id, rank)
  WHERE evolution_run_id IS NOT NULL;

-- Expand generation_method to include 'evolution_top3' for rank 2-3 entries
ALTER TABLE article_bank_entries
  DROP CONSTRAINT IF EXISTS article_bank_entries_generation_method_check;

ALTER TABLE article_bank_entries
  ADD CONSTRAINT article_bank_entries_generation_method_check
  CHECK (generation_method IN ('oneshot', 'evolution_winner', 'evolution_baseline', 'evolution_top3'));

COMMENT ON COLUMN article_bank_entries.rank IS 'Hall of fame rank: 1-3, NULL = legacy pre-migration entry';

-- Rollback:
-- ALTER TABLE article_bank_entries DROP CONSTRAINT IF EXISTS article_bank_entries_rank_check;
-- ALTER TABLE article_bank_entries DROP COLUMN IF EXISTS rank;
-- DROP INDEX IF EXISTS idx_bank_entries_run_rank;
-- ALTER TABLE article_bank_entries DROP CONSTRAINT IF EXISTS article_bank_entries_generation_method_check;
-- ALTER TABLE article_bank_entries ADD CONSTRAINT article_bank_entries_generation_method_check CHECK (generation_method IN ('oneshot', 'evolution_winner', 'evolution_baseline'));
