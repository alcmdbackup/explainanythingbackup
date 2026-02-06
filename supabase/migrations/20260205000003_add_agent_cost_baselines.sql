-- Migration: Add agent cost baselines table for data-driven cost estimation
-- Stores historical averages per agent/model combo for prediction

CREATE TABLE agent_cost_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  avg_prompt_tokens INT,
  avg_completion_tokens INT,
  avg_cost_usd NUMERIC(10, 6),
  avg_text_length INT,  -- For scaling estimates by input size
  sample_size INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (agent_name, model)
);

CREATE INDEX idx_agent_cost_baselines_agent ON agent_cost_baselines(agent_name);
CREATE INDEX idx_agent_cost_baselines_model ON agent_cost_baselines(model);

COMMENT ON TABLE agent_cost_baselines IS 'Historical cost baselines per agent/model for prediction';
COMMENT ON COLUMN agent_cost_baselines.sample_size IS 'Number of calls used to compute averages (min 50 for high confidence)';

-- Add estimated_cost_usd to runs for prediction tracking
ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10, 4);

COMMENT ON COLUMN content_evolution_runs.estimated_cost_usd IS 'Predicted cost before run execution';

-- Rollback:
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS estimated_cost_usd;
-- DROP INDEX IF EXISTS idx_agent_cost_baselines_model;
-- DROP INDEX IF EXISTS idx_agent_cost_baselines_agent;
-- DROP TABLE IF EXISTS agent_cost_baselines;
