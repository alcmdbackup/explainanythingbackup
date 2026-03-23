-- Rename evolution tables to match V2 entity names (Prompt, Strategy).
-- Drop stale V1 tables, rename tables/columns, recreate indexes and RPCs.

-- NOTE: Supabase migrations are auto-wrapped in a transaction.
-- Do NOT add explicit BEGIN/COMMIT — it would cause nested transaction issues.

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP stale/unused tables
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS evolution_arena_elo CASCADE;
DROP TABLE IF EXISTS evolution_arena_batch_runs CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 2. DROP RPCs that reference old table/column names
--    (must drop before rename to avoid stale function bodies)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS update_strategy_aggregates(UUID, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB);

-- ═══════════════════════════════════════════════════════════════
-- 3. DROP indexes that reference old column names
--    (ALTER TABLE RENAME COLUMN does NOT rename indexes)
-- ═══════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS idx_runs_strategy;
DROP INDEX IF EXISTS idx_arena_entries_topic;
DROP INDEX IF EXISTS idx_arena_entries_active;
DROP INDEX IF EXISTS idx_arena_comparisons_topic;

-- ═══════════════════════════════════════════════════════════════
-- 4. RENAME tables
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_arena_topics RENAME TO evolution_prompts;
ALTER TABLE evolution_strategy_configs RENAME TO evolution_strategies;

-- ═══════════════════════════════════════════════════════════════
-- 5. RENAME FK columns
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_runs RENAME COLUMN strategy_config_id TO strategy_id;
ALTER TABLE evolution_arena_entries RENAME COLUMN topic_id TO prompt_id;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN topic_id TO prompt_id;

-- ═══════════════════════════════════════════════════════════════
-- 6. DROP columns from evolution_prompts
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS difficulty_tier;
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS domain_tags;

-- ═══════════════════════════════════════════════════════════════
-- 7. RECREATE indexes with new column names
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_runs_strategy ON evolution_runs (strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX idx_arena_entries_prompt ON evolution_arena_entries (prompt_id, elo_rating DESC);
CREATE INDEX idx_arena_entries_active ON evolution_arena_entries (prompt_id) WHERE archived_at IS NULL;
CREATE INDEX idx_arena_comparisons_prompt ON evolution_arena_comparisons (prompt_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 8. RECREATE RPCs with new table/column names
-- ═══════════════════════════════════════════════════════════════

-- update_strategy_aggregates: references evolution_strategies (was evolution_strategy_configs)
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE evolution_strategies
  SET
    run_count = run_count + 1,
    total_cost_usd = total_cost_usd + COALESCE(p_cost_usd, 0),
    avg_final_elo = CASE
      WHEN run_count = 0 THEN p_final_elo
      ELSE (avg_final_elo * run_count + p_final_elo) / (run_count + 1)
    END,
    best_final_elo = GREATEST(COALESCE(best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = now()
  WHERE id = p_strategy_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) TO service_role;

-- sync_to_arena: rename topic_id → prompt_id in body and parameter
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
    INSERT INTO evolution_arena_entries (id, prompt_id, run_id, content, elo_rating, mu, sigma, match_count, generation_method)
    VALUES (
      (entry->>'id')::UUID,
      p_prompt_id,
      p_run_id,
      entry->>'content',
      COALESCE((entry->>'elo_rating')::NUMERIC, 1200),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'match_count')::INT, 0),
      COALESCE(entry->>'generation_method', 'pipeline')
    )
    ON CONFLICT (id) DO UPDATE SET
      elo_rating = COALESCE((entry->>'elo_rating')::NUMERIC, evolution_arena_entries.elo_rating),
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_arena_entries.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_arena_entries.sigma),
      match_count = COALESCE((entry->>'match_count')::INT, evolution_arena_entries.match_count);
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
