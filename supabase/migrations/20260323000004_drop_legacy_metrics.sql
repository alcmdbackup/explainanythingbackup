-- Drop legacy metrics infrastructure replaced by evolution_metrics table.
-- Deployed separately from table creation to provide a rollback window.

-- Drop legacy VIEWs and RPCs
DROP VIEW IF EXISTS evolution_run_costs;
DROP FUNCTION IF EXISTS get_run_total_cost(UUID);
DROP FUNCTION IF EXISTS update_strategy_aggregates(UUID, DOUBLE PRECISION, DOUBLE PRECISION);

-- Drop legacy aggregate columns from evolution_strategies
-- (data now lives in evolution_metrics rows)
ALTER TABLE evolution_strategies
  DROP COLUMN IF EXISTS avg_final_elo,
  DROP COLUMN IF EXISTS total_cost_usd,
  DROP COLUMN IF EXISTS best_final_elo,
  DROP COLUMN IF EXISTS worst_final_elo,
  DROP COLUMN IF EXISTS run_count;
