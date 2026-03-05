-- Rename evolution_hall_of_fame_* → evolution_arena_* and update schema for unified Arena model.
-- All variants (including in-run) persist to Arena; rank constraint removed; sync_to_arena RPC added.
-- Made idempotent: skips renames if tables/indexes/constraints were already renamed.

-- ============================================================
-- Part A: Rename 4 tables (skip if already renamed)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'evolution_hall_of_fame_topics' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE evolution_hall_of_fame_topics RENAME TO evolution_arena_topics;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'evolution_hall_of_fame_entries' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE evolution_hall_of_fame_entries RENAME TO evolution_arena_entries;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'evolution_hall_of_fame_comparisons' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE evolution_hall_of_fame_comparisons RENAME TO evolution_arena_comparisons;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'evolution_hall_of_fame_elo' AND table_type = 'BASE TABLE') THEN
    ALTER TABLE evolution_hall_of_fame_elo RENAME TO evolution_arena_elo;
  END IF;
END $$;

-- ============================================================
-- Part B: Rename indexes (skip if old name doesn't exist)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hall_of_fame_topics_prompt_unique') THEN
    ALTER INDEX idx_hall_of_fame_topics_prompt_unique RENAME TO idx_arena_topics_prompt_unique;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hall_of_fame_entries_topic') THEN
    ALTER INDEX idx_hall_of_fame_entries_topic RENAME TO idx_arena_entries_topic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hall_of_fame_comparisons_topic') THEN
    ALTER INDEX idx_hall_of_fame_comparisons_topic RENAME TO idx_arena_comparisons_topic;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hall_of_fame_elo_topic_ordinal') THEN
    ALTER INDEX idx_hall_of_fame_elo_topic_ordinal RENAME TO idx_arena_elo_topic_ordinal;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hof_elo_topic_anchor_eligible') THEN
    ALTER INDEX idx_hof_elo_topic_anchor_eligible RENAME TO idx_arena_elo_topic_anchor_eligible;
  END IF;
END $$;

-- ============================================================
-- Part C: Drop indexes incompatible with all-variants model
-- ============================================================
-- run_id+rank unique constraint prevents multiple entries per run (we now persist ALL variants)
DROP INDEX IF EXISTS idx_hall_of_fame_entries_run_rank;
DROP INDEX IF EXISTS idx_arena_entries_run_rank;
-- rank-based ordering replaced by elo-based ordering
DROP INDEX IF EXISTS idx_hof_entries_topic_rank;
DROP INDEX IF EXISTS idx_arena_entries_topic_rank;

-- ============================================================
-- Part D: Rename FK constraints (skip if old name doesn't exist)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'evolution_hall_of_fame_entries_topic_id_fkey') THEN
    ALTER TABLE evolution_arena_entries RENAME CONSTRAINT evolution_hall_of_fame_entries_topic_id_fkey TO evolution_arena_entries_topic_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'evolution_hall_of_fame_entries_evolution_run_id_fkey') THEN
    ALTER TABLE evolution_arena_entries RENAME CONSTRAINT evolution_hall_of_fame_entries_evolution_run_id_fkey TO evolution_arena_entries_evolution_run_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'evolution_hall_of_fame_comparisons_topic_id_fkey') THEN
    ALTER TABLE evolution_arena_comparisons RENAME CONSTRAINT evolution_hall_of_fame_comparisons_topic_id_fkey TO evolution_arena_comparisons_topic_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'evolution_hall_of_fame_elo_topic_id_fkey') THEN
    ALTER TABLE evolution_arena_elo RENAME CONSTRAINT evolution_hall_of_fame_elo_topic_id_fkey TO evolution_arena_elo_topic_id_fkey;
  END IF;
  -- D.2: Rename FK constraints that were never renamed from the original article_bank_* prefix
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'article_bank_entries_evolution_variant_id_fkey') THEN
    ALTER TABLE evolution_arena_entries RENAME CONSTRAINT article_bank_entries_evolution_variant_id_fkey TO evolution_arena_entries_evolution_variant_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'article_bank_comparisons_entry_a_id_fkey') THEN
    ALTER TABLE evolution_arena_comparisons RENAME CONSTRAINT article_bank_comparisons_entry_a_id_fkey TO evolution_arena_comparisons_entry_a_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'article_bank_comparisons_entry_b_id_fkey') THEN
    ALTER TABLE evolution_arena_comparisons RENAME CONSTRAINT article_bank_comparisons_entry_b_id_fkey TO evolution_arena_comparisons_entry_b_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'article_bank_comparisons_winner_id_fkey') THEN
    ALTER TABLE evolution_arena_comparisons RENAME CONSTRAINT article_bank_comparisons_winner_id_fkey TO evolution_arena_comparisons_winner_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'article_bank_elo_entry_id_fkey') THEN
    ALTER TABLE evolution_arena_elo RENAME CONSTRAINT article_bank_elo_entry_id_fkey TO evolution_arena_elo_entry_id_fkey;
  END IF;
END $$;

-- ============================================================
-- Part E: Update CHECK constraints
-- ============================================================

-- E.1: Drop rank bounds check — rank is now fully nullable (no min/max)
ALTER TABLE evolution_arena_entries
  DROP CONSTRAINT IF EXISTS hall_of_fame_entries_rank_check;

-- E.2: Expand generation_method to include 'evolution' (pipeline-generated variants)
ALTER TABLE evolution_arena_entries
  DROP CONSTRAINT IF EXISTS hall_of_fame_entries_generation_method_check;
-- Also drop the new-name constraint to make ADD idempotent
ALTER TABLE evolution_arena_entries
  DROP CONSTRAINT IF EXISTS arena_entries_generation_method_check;

ALTER TABLE evolution_arena_entries
  ADD CONSTRAINT arena_entries_generation_method_check
  CHECK (generation_method IN (
    'oneshot',
    'evolution_winner',
    'evolution_baseline',
    'evolution_top3',
    'evolution_ranked',
    'evolution'
  ));

COMMENT ON COLUMN evolution_arena_entries.generation_method IS
  'How this entry was generated. evolution = pipeline variant synced to Arena. '
  'evolution_top3 is a legacy label kept for existing rows.';

-- ============================================================
-- Part F: Create sync_to_arena RPC (atomic upsert of entries + matches + elo)
-- ============================================================
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_topic_id UUID,
  p_run_id UUID,
  p_entries JSONB DEFAULT '[]'::JSONB,
  p_matches JSONB DEFAULT '[]'::JSONB,
  p_elo_rows JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_entry JSONB;
  v_match JSONB;
  v_elo JSONB;
  v_rows INT;
  v_entries_inserted INT := 0;
  v_matches_inserted INT := 0;
  v_elos_upserted INT := 0;
BEGIN
  -- 1. Insert new entries
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_arena_entries (
      id, topic_id, content, generation_method, model,
      total_cost_usd, evolution_run_id, evolution_variant_id, metadata
    ) VALUES (
      (v_entry->>'id')::UUID,
      p_topic_id,
      v_entry->>'content',
      v_entry->>'generation_method',
      v_entry->>'model',
      (v_entry->>'total_cost_usd')::NUMERIC,
      p_run_id,
      (v_entry->>'evolution_variant_id')::UUID,
      COALESCE(v_entry->'metadata', '{}'::JSONB)
    )
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_entries_inserted := v_entries_inserted + v_rows;
  END LOOP;

  -- 2. Insert match comparisons
  FOR v_match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (
      topic_id, entry_a_id, entry_b_id, winner_id,
      confidence, judge_model, dimension_scores
    ) VALUES (
      p_topic_id,
      (v_match->>'entry_a_id')::UUID,
      (v_match->>'entry_b_id')::UUID,
      CASE WHEN v_match->>'winner_id' IS NOT NULL
           THEN (v_match->>'winner_id')::UUID ELSE NULL END,
      (v_match->>'confidence')::NUMERIC,
      v_match->>'judge_model',
      v_match->'dimension_scores'
    );
    v_matches_inserted := v_matches_inserted + 1;
  END LOOP;

  -- 3. Upsert elo ratings (handles both new and updated entries)
  FOR v_elo IN SELECT * FROM jsonb_array_elements(p_elo_rows)
  LOOP
    INSERT INTO evolution_arena_elo (
      topic_id, entry_id, mu, sigma, ordinal,
      elo_rating, elo_per_dollar, match_count
    ) VALUES (
      p_topic_id,
      (v_elo->>'entry_id')::UUID,
      (v_elo->>'mu')::NUMERIC,
      (v_elo->>'sigma')::NUMERIC,
      (v_elo->>'ordinal')::NUMERIC,
      (v_elo->>'elo_rating')::NUMERIC,
      CASE WHEN v_elo->>'elo_per_dollar' IS NOT NULL
           THEN (v_elo->>'elo_per_dollar')::NUMERIC ELSE NULL END,
      (v_elo->>'match_count')::INT
    )
    ON CONFLICT (topic_id, entry_id) DO UPDATE SET
      mu = EXCLUDED.mu,
      sigma = EXCLUDED.sigma,
      ordinal = EXCLUDED.ordinal,
      elo_rating = EXCLUDED.elo_rating,
      elo_per_dollar = EXCLUDED.elo_per_dollar,
      match_count = EXCLUDED.match_count,
      updated_at = NOW();
    v_elos_upserted := v_elos_upserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'entries_inserted', v_entries_inserted,
    'matches_inserted', v_matches_inserted,
    'elos_upserted', v_elos_upserted
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Part G: Backward-compatible views for zero-downtime deploy
-- Old code referencing evolution_hall_of_fame_* continues to work until code deploy completes.
-- Drop in a follow-up migration after code deploy is confirmed.
-- ============================================================
-- Drop existing views first (they may reference old table names)
DROP VIEW IF EXISTS evolution_hall_of_fame_topics;
DROP VIEW IF EXISTS evolution_hall_of_fame_entries;
DROP VIEW IF EXISTS evolution_hall_of_fame_comparisons;
DROP VIEW IF EXISTS evolution_hall_of_fame_elo;

CREATE OR REPLACE VIEW evolution_hall_of_fame_topics AS SELECT * FROM evolution_arena_topics;
CREATE OR REPLACE VIEW evolution_hall_of_fame_entries AS SELECT * FROM evolution_arena_entries;
CREATE OR REPLACE VIEW evolution_hall_of_fame_comparisons AS SELECT * FROM evolution_arena_comparisons;
CREATE OR REPLACE VIEW evolution_hall_of_fame_elo AS SELECT * FROM evolution_arena_elo;

-- ============================================================
-- Part H: Force PostgREST schema cache refresh
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB);
-- ALTER TABLE evolution_arena_entries DROP CONSTRAINT IF EXISTS arena_entries_generation_method_check;
-- ALTER TABLE evolution_arena_entries ADD CONSTRAINT hall_of_fame_entries_generation_method_check
--   CHECK (generation_method IN ('oneshot','evolution_winner','evolution_baseline','evolution_top3','evolution_ranked'));
-- ALTER TABLE evolution_arena_entries ADD CONSTRAINT hall_of_fame_entries_rank_check
--   CHECK (rank IS NULL OR (rank >= 1 AND rank <= 10));
-- Reverse table/index/constraint renames as needed.
