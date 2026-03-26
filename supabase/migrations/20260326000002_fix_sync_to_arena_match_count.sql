-- Fix sync_to_arena: pass arena_match_count from entry JSON instead of hardcoded 0.
-- The TS layer already computes per-variant match counts; this INSERT was discarding them.

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
