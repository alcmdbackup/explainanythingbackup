-- Move arena_comparisons row writes out of sync_to_arena and into MergeRatingsAgent.
-- After this migration:
--   - MergeRatingsAgent (TypeScript) is the SOLE writer of evolution_arena_comparisons rows.
--     Each merge invocation writes one row per match with prompt_id NULL (in-run match).
--   - sync_to_arena no longer INSERTs match rows. Instead, on arena sync it UPDATEs
--     existing in-run rows for the run, backfilling prompt_id so they become visible in
--     arena leaderboard queries.
-- This eliminates the double-write that would otherwise occur if both writers ran (one
-- with prompt_id NULL and one with prompt_id set).
--
-- The function signature is preserved for backward compatibility — p_matches is still
-- accepted but ignored. Callers can stop passing it once code is updated; the column will
-- remain in the signature until a follow-up migration removes it.

DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB);

CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB,             -- DEPRECATED: ignored. Match rows are written by MergeRatingsAgent.
  p_arena_updates JSONB DEFAULT '[]'::JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
BEGIN
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_arena_updates) > 200 THEN
    RAISE EXCEPTION 'p_arena_updates exceeds maximum of 200 elements';
  END IF;

  -- Insert new pipeline entries (ON CONFLICT updates ratings for re-syncs)
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
      COALESCE((entry->>'arena_match_count')::INT, 0),
      COALESCE(entry->>'generation_method', 'pipeline'),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      synced_to_arena = true,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
  END LOOP;

  -- Update existing arena entries (ratings only — immutable fields preserved)
  FOR entry IN SELECT * FROM jsonb_array_elements(p_arena_updates)
  LOOP
    UPDATE evolution_variants SET
      mu = COALESCE((entry->>'mu')::NUMERIC, mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, arena_match_count)
    WHERE id = (entry->>'id')::UUID AND synced_to_arena = true;
  END LOOP;

  -- Backfill prompt_id on in-run matches written by MergeRatingsAgent.
  -- After this UPDATE the rows become visible to arena leaderboard queries
  -- (which filter by prompt_id IS NOT NULL).
  -- WHERE clause uses race-free conditional (IS NULL) so re-runs are no-ops.
  UPDATE evolution_arena_comparisons
     SET prompt_id = p_prompt_id
   WHERE run_id = p_run_id
     AND prompt_id IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB) TO service_role;
