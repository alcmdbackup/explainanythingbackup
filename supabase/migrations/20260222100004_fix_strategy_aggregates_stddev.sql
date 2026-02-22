-- Migration: Fix strategy aggregates to compute stddev_final_elo using Welford's online algorithm.
-- The stddev_final_elo column exists but was never populated by update_strategy_aggregates.
-- Adds elo_sum_sq_diff column for Welford's M2 accumulator and replaces the RPC body.
-- Rollback: ALTER TABLE evolution_strategy_configs DROP COLUMN elo_sum_sq_diff;
--           then re-create update_strategy_aggregates with original body from 20260221000002.

-- 1. Add Welford's M2 accumulator column
ALTER TABLE evolution_strategy_configs
  ADD COLUMN IF NOT EXISTS elo_sum_sq_diff NUMERIC(16, 4) DEFAULT 0;

-- 2. Replace RPC with Welford's online variance algorithm
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_old RECORD;
  v_new_count INT;
  v_delta NUMERIC;
  v_new_mean NUMERIC;
  v_delta2 NUMERIC;
  v_new_m2 NUMERIC;
BEGIN
  SET LOCAL statement_timeout = '5s';

  SELECT run_count, total_cost_usd, avg_final_elo, best_final_elo, worst_final_elo, elo_sum_sq_diff
  INTO v_old
  FROM evolution_strategy_configs
  WHERE id = p_strategy_id
  FOR UPDATE;

  v_new_count := COALESCE(v_old.run_count, 0) + 1;

  -- Welford's online mean update
  v_delta := p_final_elo - COALESCE(v_old.avg_final_elo, p_final_elo);
  v_new_mean := COALESCE(v_old.avg_final_elo, 0) + v_delta / v_new_count;

  -- Welford's online M2 (sum of squared differences from running mean)
  v_delta2 := p_final_elo - v_new_mean;
  v_new_m2 := COALESCE(v_old.elo_sum_sq_diff, 0) + v_delta * v_delta2;

  UPDATE evolution_strategy_configs SET
    run_count = v_new_count,
    total_cost_usd = COALESCE(v_old.total_cost_usd, 0) + p_cost_usd,
    avg_final_elo = v_new_mean,
    avg_elo_per_dollar = CASE
      WHEN COALESCE(v_old.total_cost_usd, 0) + p_cost_usd > 0
      THEN (v_new_mean - 1200) / (COALESCE(v_old.total_cost_usd, 0) + p_cost_usd)
      ELSE NULL
    END,
    best_final_elo = GREATEST(COALESCE(v_old.best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(v_old.worst_final_elo, p_final_elo), p_final_elo),
    elo_sum_sq_diff = v_new_m2,
    stddev_final_elo = CASE
      WHEN v_new_count >= 2 THEN SQRT(v_new_m2 / (v_new_count - 1))
      ELSE NULL
    END,
    last_used_at = NOW()
  WHERE id = p_strategy_id;
END;
$$ LANGUAGE plpgsql;
