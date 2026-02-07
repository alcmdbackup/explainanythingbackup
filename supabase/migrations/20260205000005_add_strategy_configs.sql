-- Migration: Add strategy configs table for tracking unique configurations
-- Enables analysis of which model/iteration/budget combos produce best results

CREATE TABLE strategy_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_hash TEXT NOT NULL UNIQUE,  -- 12-char sha256 prefix, immutable

  -- User-facing fields
  name TEXT NOT NULL,                -- User-editable display name
  description TEXT,                  -- Optional notes
  label TEXT NOT NULL,               -- Auto-generated summary

  -- Full config for inspection and reproduction
  config JSONB NOT NULL,             -- Complete StrategyConfig object

  -- Aggregated metrics (updated after each run)
  run_count INT DEFAULT 0,
  total_cost_usd NUMERIC(10, 4) DEFAULT 0,
  avg_final_elo NUMERIC(8, 2),
  avg_elo_per_dollar NUMERIC(12, 2),
  best_final_elo NUMERIC(8, 2),
  worst_final_elo NUMERIC(8, 2),
  stddev_final_elo NUMERIC(8, 2),

  first_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_strategy_configs_hash ON strategy_configs(config_hash);
CREATE INDEX idx_strategy_configs_name ON strategy_configs(name);
CREATE INDEX idx_strategy_configs_elo_per_dollar ON strategy_configs(avg_elo_per_dollar DESC NULLS LAST);

-- Link evolution runs to strategy configs
ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS strategy_config_id UUID REFERENCES strategy_configs(id);

CREATE INDEX idx_evolution_runs_strategy ON content_evolution_runs(strategy_config_id);

COMMENT ON TABLE strategy_configs IS 'Unique model/iteration/budget configurations with aggregated performance metrics';
COMMENT ON COLUMN strategy_configs.config_hash IS 'SHA256 hash of normalized config for deduplication';
COMMENT ON COLUMN strategy_configs.label IS 'Auto-generated summary like "Gen: ds-chat | Judge: 4.1-nano | 10 iters"';

-- Function to update strategy aggregates after a run completes
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
BEGIN
  -- Get current stats
  SELECT
    run_count,
    total_cost_usd,
    avg_final_elo,
    best_final_elo,
    worst_final_elo
  INTO v_stats
  FROM strategy_configs
  WHERE id = p_strategy_id;

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
-- DROP FUNCTION IF EXISTS update_strategy_aggregates;
-- DROP INDEX IF EXISTS idx_evolution_runs_strategy;
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS strategy_config_id;
-- DROP INDEX IF EXISTS idx_strategy_configs_elo_per_dollar;
-- DROP INDEX IF EXISTS idx_strategy_configs_name;
-- DROP INDEX IF EXISTS idx_strategy_configs_hash;
-- DROP TABLE IF EXISTS strategy_configs;
