-- Extend sync_to_arena RPC to persist parent_variant_ids + match_count from p_entries JSONB.
-- Project: investigate_paragraph_recombine_invocation_20260529 (GH #1125).
--
-- WHY: per-slot paragraph_recombine variants are persisted ONLY through this RPC (they never
-- pass through finalizeRun, where article variants get parent_variant_ids/match_count written).
-- The previous payload omitted both columns, so every per-slot rewrite landed with
-- parent_variant_ids='{}' (→ leaderboard "Seed · no parent") and match_count=0. The agent
-- already constructs rewrites with parentIds=[originalSlotVariantId] and the run tallies
-- per-variant match counts; this migration lets those values reach the columns.
--
-- SAFETY: both fields are added to the INSERT branch ONLY. The ON CONFLICT DO UPDATE branch
-- intentionally does NOT touch parent_variant_ids/match_count (mirrors the existing insert-only
-- agent_name/variant_kind pattern from 20260527000003). Article variants are upserted by
-- finalizeRun BEFORE syncToArena, so they hit ON CONFLICT and keep their finalize-written
-- lineage/counts untouched. Only fresh paragraph rewrites take the INSERT branch.
--
-- p_matches stays ignored (deprecated since 20260331000002 — comparison rows are written by
-- MergeRatingsAgent / persistSlotMatches, not here), so passing a non-empty matchHistory tallies
-- arena_match_count without double-writing evolution_arena_comparisons.
--
-- ROLLBACK (forward-only repo): re-apply the prior function body verbatim from
-- 20260527000003_extend_sync_to_arena_for_paragraph_kind.sql in a new migration. This change is
-- additive + insert-only, so reverting the function is a clean no-data-loss operation.

DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB);

CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB,             -- DEPRECATED: ignored. Match rows are written by MergeRatingsAgent / persistSlotMatches.
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
  -- agent_name, variant_kind, parent_variant_ids, match_count are read from JSONB when present
  -- (paragraph entries / new article variants) and fall through to defaults when absent — keeps
  -- existing callers backward-compatible.
  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_variants (
      id, prompt_id, synced_to_arena, run_id, variant_content,
      mu, sigma, elo_score, arena_match_count, generation_method,
      agent_name, variant_kind, parent_variant_ids, match_count, created_at
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
      -- jsonb array of uuid strings → uuid[]. (entry->>'parent_variant_ids')::uuid[] is WRONG
      -- (yields the JSON text literal, not a PG array). Absent/empty → '{}'.
      COALESCE(
        (SELECT array_agg(e::uuid) FROM jsonb_array_elements_text(entry->'parent_variant_ids') e),
        '{}'::uuid[]
      ),
      COALESCE((entry->>'match_count')::INT, 0),                -- 0 if absent
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      synced_to_arena = true,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
      -- agent_name, variant_kind, parent_variant_ids, match_count intentionally NOT updated on
      -- conflict — preserves the kind/agent label + lineage/counts set on insert (and protects
      -- article variants' finalize-written values).
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
