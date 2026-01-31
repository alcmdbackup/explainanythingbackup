-- Tracks evolution pipeline runs for content quality improvement.
-- Each run evolves variants of one article and selects a winner via Elo ranking.

CREATE TABLE content_evolution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  explanation_id INT NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'running', 'completed', 'failed', 'paused')),
  phase TEXT NOT NULL DEFAULT 'EXPANSION'
    CHECK (phase IN ('EXPANSION', 'COMPETITION')),
  total_variants INT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  budget_cap_usd NUMERIC(10, 4) NOT NULL DEFAULT 5.00,
  config JSONB NOT NULL DEFAULT '{}',
  current_iteration INT NOT NULL DEFAULT 0,
  variants_generated INT NOT NULL DEFAULT 0,
  error_message TEXT,
  runner_id TEXT,
  runner_agents_completed INT NOT NULL DEFAULT 0,
  last_heartbeat TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for batch runner claim query (oldest pending first)
CREATE INDEX idx_evolution_runs_pending
  ON content_evolution_runs (created_at ASC)
  WHERE status = 'pending';

-- Index for watchdog stale heartbeat check
CREATE INDEX idx_evolution_runs_heartbeat
  ON content_evolution_runs (last_heartbeat)
  WHERE status IN ('claimed', 'running');

-- Index for admin UI queries (runs for a given article)
CREATE INDEX idx_evolution_runs_explanation
  ON content_evolution_runs (explanation_id, created_at DESC);
