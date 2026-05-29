-- Extend sync_to_arena RPC to read agent_name + variant_kind from p_entries JSONB.
-- Per D10 of rank_individual_paragraphs_evolution_20260525.
--
-- Without this extension, paragraph rewrites inserted by syncToArena would land
-- with agent_name=NULL and the default variant_kind='article', defeating both
-- the kind filter (D13) and the agent_name labeling (D10).
--
-- Pattern follows 20260326000002_fix_sync_to_arena_match_count.sql which made the
-- same kind of optional-JSONB-field extension to the RPC. Forward-only; backward
-- compatible — article-level callers omitting these fields get pre-existing
-- behavior (agent_name unchanged, variant_kind defaults to 'article').
--
-- ON CONFLICT DO UPDATE branch leaves agent_name and variant_kind UNTOUCHED for
-- existing rows — re-syncs do not clobber the kind/agent label set on insert.
--
-- p_matches still ignored (deprecated since 20260331000002). Paragraph match
-- persistence uses a new persistSlotMatches helper that writes directly to
-- evolution_arena_comparisons with the slot's prompt_id (see Phase 3 of the
-- planning doc).

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

  -- Insert new pipeline entries (ON CONFLICT updates ratings for re-syncs).
  -- agent_name and variant_kind are read from JSONB when present (paragraph
  -- entries) and fall through to defaults when absent (article entries — keeps
  -- existing callers backward-compatible).
  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_variants (
      id, prompt_id, synced_to_arena, run_id, variant_content,
      mu, sigma, elo_score, arena_match_count, generation_method,
      agent_name, variant_kind, created_at
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
      entry->>'agent_name',                                     -- NULL if absent
      COALESCE(entry->>'variant_kind', 'article'),              -- 'article' if absent
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      synced_to_arena = true,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
      -- agent_name and variant_kind intentionally NOT updated on conflict —
      -- preserves the kind/agent label set on insert.
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
