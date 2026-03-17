-- Remove ordinal column from evolution_arena_elo and recalibrate Elo scale.
-- Old formula: toEloScale(x) = 1200 + x * 16  (fresh ordinal≈0 → 1200)
-- New formula: toEloScale(mu) = 1200 + (mu - 25) * 16 = 800 + mu * 16  (fresh mu=25 → 1200)
-- Net effect: all stored Elo values shift down by 400.
-- IMPORTANT: Run AFTER code deploy. Code is backward-compatible with both schemas.

-- 1. Shift elo_score down by 400 in evolution_variants
UPDATE evolution_variants SET elo_score = elo_score - 400 WHERE elo_score IS NOT NULL;

-- 2. Shift elo_rating down by 400 in evolution_arena_elo
UPDATE evolution_arena_elo SET elo_rating = elo_rating - 400;

-- 3. Shift avg_elo and elo_gain in evolution_run_agent_metrics
-- elo_gain = avg_elo - 1200, so it shifts by same amount
UPDATE evolution_run_agent_metrics SET
  avg_elo = avg_elo - 400,
  elo_gain = elo_gain - 400
WHERE avg_elo IS NOT NULL;

-- 4. Recalculate elo_per_dollar (= elo_gain / cost_usd, cannot shift by constant)
UPDATE evolution_run_agent_metrics SET
  elo_per_dollar = CASE
    WHEN cost_usd > 0 THEN (avg_elo - 1200) / cost_usd
    ELSE NULL
  END
WHERE avg_elo IS NOT NULL;

-- 5. Drop ordinal-based indexes
DROP INDEX IF EXISTS idx_arena_elo_topic_ordinal;
DROP INDEX IF EXISTS idx_hof_elo_topic_anchor_eligible;

-- 6. Drop backward-compat view that depends on ordinal (SELECT * expanded it)
DROP VIEW IF EXISTS evolution_hall_of_fame_elo;

-- 7. Drop ordinal column
ALTER TABLE evolution_arena_elo DROP COLUMN ordinal;

-- 8. Recreate backward-compat view without ordinal
CREATE OR REPLACE VIEW evolution_hall_of_fame_elo AS SELECT * FROM evolution_arena_elo;

-- 9. Recreate indexes with mu
CREATE INDEX idx_arena_elo_topic_mu
  ON evolution_arena_elo(topic_id, mu DESC);

CREATE INDEX idx_arena_elo_topic_anchor_eligible
  ON evolution_arena_elo(topic_id, mu DESC)
  WHERE match_count >= 4 AND sigma < 5.0;

-- 10. Rewrite sync_to_arena RPC without ordinal
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

  -- 3. Upsert elo ratings (no ordinal)
  FOR v_elo IN SELECT * FROM jsonb_array_elements(p_elo_rows)
  LOOP
    INSERT INTO evolution_arena_elo (
      topic_id, entry_id, mu, sigma,
      elo_rating, elo_per_dollar, match_count
    ) VALUES (
      p_topic_id,
      (v_elo->>'entry_id')::UUID,
      (v_elo->>'mu')::NUMERIC,
      (v_elo->>'sigma')::NUMERIC,
      (v_elo->>'elo_rating')::NUMERIC,
      CASE WHEN v_elo->>'elo_per_dollar' IS NOT NULL
           THEN (v_elo->>'elo_per_dollar')::NUMERIC ELSE NULL END,
      (v_elo->>'match_count')::INT
    )
    ON CONFLICT (topic_id, entry_id) DO UPDATE SET
      mu = EXCLUDED.mu,
      sigma = EXCLUDED.sigma,
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
