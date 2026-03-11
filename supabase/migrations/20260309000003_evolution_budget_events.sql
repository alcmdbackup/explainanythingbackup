-- Budget event audit log for diagnosing reservation leaks and budget exhaustion.
CREATE TABLE evolution_budget_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL CHECK (event_type IN ('reserve', 'spend', 'release_ok', 'release_failed')),
  agent_name TEXT NOT NULL,
  amount_usd NUMERIC(10,6) NOT NULL,
  total_spent_usd NUMERIC(10,6) NOT NULL,
  total_reserved_usd NUMERIC(10,6) NOT NULL,
  available_budget_usd NUMERIC(10,6) NOT NULL,
  invocation_id UUID,
  iteration INTEGER,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_budget_events_run ON evolution_budget_events (run_id, created_at);
CREATE INDEX idx_budget_events_type ON evolution_budget_events (run_id, event_type);

-- Rollback: DROP TABLE IF EXISTS evolution_budget_events CASCADE;
