-- Consolidate evolution_arena_entries into evolution_variants.
-- Both tables are empty on staging — zero data migration risk.
-- Rollback: see Rollback Strategy section in planning doc.

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP RPCs that reference evolution_arena_entries
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB);

-- ═══════════════════════════════════════════════════════════════
-- 2. DROP indexes on evolution_arena_entries (will be recreated on variants)
-- ═══════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS idx_arena_entries_prompt;
DROP INDEX IF EXISTS idx_arena_entries_active;
DROP INDEX IF EXISTS idx_arena_comparisons_prompt;

-- ═══════════════════════════════════════════════════════════════
-- 3. ADD arena columns to evolution_variants
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_variants
  ADD COLUMN mu NUMERIC NOT NULL DEFAULT 25,
  ADD COLUMN sigma NUMERIC NOT NULL DEFAULT 8.333,
  ADD COLUMN prompt_id UUID REFERENCES evolution_prompts(id) ON DELETE SET NULL,
  ADD COLUMN synced_to_arena BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN arena_match_count INT NOT NULL DEFAULT 0,
  ADD COLUMN generation_method TEXT DEFAULT 'pipeline',
  ADD COLUMN model TEXT,
  ADD COLUMN cost_usd NUMERIC,
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN evolution_explanation_id UUID REFERENCES evolution_explanations(id);

-- ═══════════════════════════════════════════════════════════════
-- 4. DROP dead columns from evolution_variants
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_variants DROP COLUMN IF EXISTS elo_attribution;

-- ═══════════════════════════════════════════════════════════════
-- 5. MIGRATE data (both tables empty on staging, but handle gracefully)
-- ═══════════════════════════════════════════════════════════════

-- Update existing variants that have matching arena entries (pipeline entries share IDs)
UPDATE evolution_variants ev
SET
  prompt_id = eae.prompt_id,
  synced_to_arena = true,
  mu = COALESCE(eae.mu, ev.mu),
  sigma = COALESCE(eae.sigma, ev.sigma),
  elo_score = COALESCE(eae.elo_rating, ev.elo_score),
  arena_match_count = eae.match_count,
  generation_method = eae.generation_method,
  model = eae.model,
  cost_usd = eae.cost_usd,
  archived_at = eae.archived_at,
  evolution_explanation_id = eae.evolution_explanation_id
FROM evolution_arena_entries eae
WHERE ev.id = eae.id;

-- Insert non-pipeline arena entries (oneshot, manual) that have no matching variant
INSERT INTO evolution_variants (
  id, run_id, variant_content, mu, sigma, elo_score,
  prompt_id, synced_to_arena, arena_match_count, generation_method, model,
  cost_usd, archived_at, evolution_explanation_id, created_at
)
SELECT
  eae.id, eae.run_id, eae.content, eae.mu, eae.sigma, eae.elo_rating,
  eae.prompt_id, true, eae.match_count, eae.generation_method, eae.model,
  eae.cost_usd, eae.archived_at, eae.evolution_explanation_id, eae.created_at
FROM evolution_arena_entries eae
WHERE NOT EXISTS (SELECT 1 FROM evolution_variants ev WHERE ev.id = eae.id);

-- ═══════════════════════════════════════════════════════════════
-- 6. RETARGET evolution_arena_comparisons FKs
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_arena_comparisons
  DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_a_fkey,
  DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_b_fkey;

ALTER TABLE evolution_arena_comparisons
  ADD CONSTRAINT evolution_arena_comparisons_entry_a_fkey
    FOREIGN KEY (entry_a) REFERENCES evolution_variants(id) ON DELETE CASCADE,
  ADD CONSTRAINT evolution_arena_comparisons_entry_b_fkey
    FOREIGN KEY (entry_b) REFERENCES evolution_variants(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 7. DROP evolution_arena_entries table
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS evolution_arena_entries CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 8. CREATE indexes for arena queries on evolution_variants
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_variants_arena_prompt ON evolution_variants (prompt_id, mu DESC)
  WHERE synced_to_arena = true AND archived_at IS NULL;
CREATE INDEX idx_variants_arena_active ON evolution_variants (prompt_id)
  WHERE synced_to_arena = true AND archived_at IS NULL;
CREATE INDEX idx_arena_comparisons_prompt ON evolution_arena_comparisons (prompt_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 9. RECREATE sync_to_arena RPC targeting evolution_variants
--    Uses INSERT ON CONFLICT to handle both new and existing variants.
--    New variants (from oneshot/manual) get full INSERT.
--    Existing variants (from pipeline finalize) get arena fields UPDATE.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  match JSONB;
BEGIN
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_matches) > 1000 THEN
    RAISE EXCEPTION 'p_matches exceeds maximum of 1000 elements';
  END IF;

  -- Upsert entries: INSERT for new variants, UPDATE arena fields for existing
  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_variants (
      id, prompt_id, synced_to_arena, run_id, variant_content,
      mu, sigma, elo_score, arena_match_count, generation_method, created_at
    )
    VALUES (
      (entry->>'id')::UUID,
      p_prompt_id,
      true,
      p_run_id,
      COALESCE(entry->>'variant_content', ''),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'elo_score')::NUMERIC, 1200),
      0,
      COALESCE(entry->>'generation_method', 'pipeline'),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      -- Do NOT overwrite prompt_id — it was set at finalize time from run.prompt_id
      synced_to_arena = true,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
  END LOOP;

  -- Insert match results.
  -- Note: plpgsql functions run in an implicit transaction — if any INSERT fails
  -- (e.g., FK violation from orphaned entry_a/entry_b), the entire function rolls back
  -- atomically. The caller receives an exception with the FK violation details.
  FOR match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (prompt_id, entry_a, entry_b, winner, confidence, run_id)
    VALUES (
      p_prompt_id,
      (match->>'entry_a')::UUID,
      (match->>'entry_b')::UUID,
      match->>'winner',
      COALESCE((match->>'confidence')::NUMERIC, 0),
      p_run_id
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 10. VERIFY and ENFORCE RLS policies on evolution_variants
--     ALTER TABLE ADD COLUMN preserves existing RLS policies.
--     Explicitly recreate if missing (idempotent — CREATE IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_variants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_variants' AND policyname = 'deny_all') THEN
    CREATE POLICY deny_all ON evolution_variants FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_variants' AND policyname = 'readonly_select') THEN
    CREATE POLICY readonly_select ON evolution_variants FOR SELECT TO service_role USING (true);
  END IF;
END $$;
