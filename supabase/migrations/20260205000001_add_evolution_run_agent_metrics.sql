-- Migration: Add per-agent cost metrics table for Elo budget optimization
-- Tracks cost, variant count, and Elo contribution per agent per run

CREATE TABLE evolution_run_agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  variants_generated INT DEFAULT 0,
  avg_elo NUMERIC(8, 2),
  elo_gain NUMERIC(8, 2),  -- avg_elo - 1200 (baseline)
  elo_per_dollar NUMERIC(12, 2),  -- (avg_elo - 1200) / cost_usd
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (run_id, agent_name)
);

CREATE INDEX idx_agent_metrics_run_id ON evolution_run_agent_metrics(run_id);
CREATE INDEX idx_agent_metrics_elo_per_dollar ON evolution_run_agent_metrics(elo_per_dollar DESC NULLS LAST);
CREATE INDEX idx_agent_metrics_agent_name ON evolution_run_agent_metrics(agent_name);

COMMENT ON TABLE evolution_run_agent_metrics IS 'Per-agent cost and Elo metrics for evolution runs';
COMMENT ON COLUMN evolution_run_agent_metrics.elo_per_dollar IS 'Elo points gained per dollar spent: (avg_elo - 1200) / cost_usd';

-- Rollback:
-- DROP INDEX IF EXISTS idx_agent_metrics_agent_name;
-- DROP INDEX IF EXISTS idx_agent_metrics_elo_per_dollar;
-- DROP INDEX IF EXISTS idx_agent_metrics_run_id;
-- DROP TABLE IF EXISTS evolution_run_agent_metrics;
