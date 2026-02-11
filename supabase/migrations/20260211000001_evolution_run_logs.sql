-- Per-run structured logging for evolution pipeline with cross-linking columns
-- for Timeline (iteration, agent_name) and Explorer (variant_id) views.

CREATE TABLE evolution_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL,
  agent_name TEXT,
  iteration INT,
  variant_id TEXT,
  message TEXT NOT NULL,
  context JSONB
);

-- Primary lookup: all logs for a run, newest first
CREATE INDEX idx_run_logs_run_id ON evolution_run_logs(run_id, created_at DESC);

-- Cross-link: Timeline iteration sections
CREATE INDEX idx_run_logs_iteration ON evolution_run_logs(run_id, iteration);

-- Cross-link: Timeline/Explorer agent rows
CREATE INDEX idx_run_logs_agent ON evolution_run_logs(run_id, agent_name);

-- Cross-link: Explorer variant rows
CREATE INDEX idx_run_logs_variant ON evolution_run_logs(run_id, variant_id);

-- Filter by level (e.g. errors only)
CREATE INDEX idx_run_logs_level ON evolution_run_logs(run_id, level);
