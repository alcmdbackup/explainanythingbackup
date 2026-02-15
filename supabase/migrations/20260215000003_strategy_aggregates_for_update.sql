-- DB-1: Add FOR UPDATE to SELECT in update_strategy_aggregates to prevent lost updates
-- under concurrent same-strategy completions. Adds statement_timeout to prevent deadlock hangs.

CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
BEGIN
  -- Prevent deadlock hangs
  SET LOCAL statement_timeout = '5s';

  -- DB-1: FOR UPDATE serializes concurrent reads for the same strategy row
  SELECT
    run_count,
    total_cost_usd,
    avg_final_elo,
    best_final_elo,
    worst_final_elo
  INTO v_stats
  FROM strategy_configs
  WHERE id = p_strategy_id
  FOR UPDATE;

  -- Update aggregates
  UPDATE strategy_configs SET
    run_count = COALESCE(v_stats.run_count, 0) + 1,
    total_cost_usd = COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd,
    avg_final_elo = (COALESCE(v_stats.avg_final_elo * v_stats.run_count, 0) + p_final_elo) / (COALESCE(v_stats.run_count, 0) + 1),
    avg_elo_per_dollar = CASE
      WHEN COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd > 0
      THEN ((COALESCE(v_stats.avg_final_elo * v_stats.run_count, 0) + p_final_elo) / (COALESCE(v_stats.run_count, 0) + 1) - 1200)
           / (COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd)
      ELSE NULL
    END,
    best_final_elo = GREATEST(COALESCE(v_stats.best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(v_stats.worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = NOW()
  WHERE id = p_strategy_id;
END;
$$ LANGUAGE plpgsql;

-- Rollback:
-- Re-run original migration 20260205000005 to restore function without FOR UPDATE
