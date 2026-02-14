-- Per-agent-per-iteration execution records with structured JSONB detail.
-- Supports drill-down from Timeline and Explorer views.
-- Rollback: DROP TABLE evolution_agent_invocations CASCADE;

CREATE TABLE evolution_agent_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  agent_name TEXT NOT NULL,
  execution_order INT NOT NULL,
  success BOOLEAN NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  skipped BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  execution_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, iteration, agent_name)
);

CREATE INDEX idx_agent_invocations_run ON evolution_agent_invocations(run_id, iteration);
CREATE INDEX idx_agent_invocations_agent ON evolution_agent_invocations(run_id, agent_name);
