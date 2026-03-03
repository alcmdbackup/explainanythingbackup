-- Expand hall-of-fame rank constraint from <= 3 to <= 10 and add evolution_ranked generation method.
-- Enables feeding top-10 variants per run into the Hall of Fame instead of top-2.

-- Backward compatible: existing rows with rank IN (1,2,3) or rank IS NULL satisfy the new CHECK.
-- No data UPDATE required.

-- ─── 1. Widen rank CHECK (1-3 → 1-10) ──────────────────────────────────────
-- DROP + ADD required; PostgreSQL has no ALTER CONSTRAINT for CHECK predicates.
ALTER TABLE evolution_hall_of_fame_entries
  DROP CONSTRAINT IF EXISTS hall_of_fame_entries_rank_check;

ALTER TABLE evolution_hall_of_fame_entries
  ADD CONSTRAINT hall_of_fame_entries_rank_check
  CHECK (rank IS NULL OR (rank >= 1 AND rank <= 10));

COMMENT ON COLUMN evolution_hall_of_fame_entries.rank IS
  'Hall of fame rank within a run: 1-10 (1 = winner), NULL = legacy pre-rank entry';

-- ─── 2. Add evolution_ranked to generation_method CHECK ─────────────────────
-- 'evolution_ranked' is the new canonical value for rank 2-10 entries.
-- 'evolution_top3' is kept for backward compat — existing rows must not break.
-- DROP + ADD required; PostgreSQL has no ALTER CONSTRAINT for CHECK predicates.
ALTER TABLE evolution_hall_of_fame_entries
  DROP CONSTRAINT IF EXISTS hall_of_fame_entries_generation_method_check;

ALTER TABLE evolution_hall_of_fame_entries
  ADD CONSTRAINT hall_of_fame_entries_generation_method_check
  CHECK (generation_method IN (
    'oneshot',
    'evolution_winner',
    'evolution_baseline',
    'evolution_top3',
    'evolution_ranked'
  ));

COMMENT ON COLUMN evolution_hall_of_fame_entries.generation_method IS
  'How this entry was generated. evolution_top3 is a legacy label kept for existing rows; '
  'new rank 2-10 entries use evolution_ranked.';

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- ALTER TABLE evolution_hall_of_fame_entries DROP CONSTRAINT IF EXISTS hall_of_fame_entries_rank_check;
-- ALTER TABLE evolution_hall_of_fame_entries ADD CONSTRAINT hall_of_fame_entries_rank_check
--   CHECK (rank IS NULL OR (rank >= 1 AND rank <= 3));
-- ALTER TABLE evolution_hall_of_fame_entries DROP CONSTRAINT IF EXISTS hall_of_fame_entries_generation_method_check;
-- ALTER TABLE evolution_hall_of_fame_entries ADD CONSTRAINT hall_of_fame_entries_generation_method_check
--   CHECK (generation_method IN ('oneshot', 'evolution_winner', 'evolution_baseline', 'evolution_top3'));
