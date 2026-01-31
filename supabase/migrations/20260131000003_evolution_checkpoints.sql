-- Checkpoint snapshots for crash recovery during evolution runs.
-- A new checkpoint is saved after every agent execution.

CREATE TABLE evolution_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
  iteration INT NOT NULL,
  phase TEXT NOT NULL,
  last_agent TEXT NOT NULL,
  state_snapshot JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- For resume: get latest checkpoint per run
CREATE INDEX idx_checkpoints_run_latest
  ON evolution_checkpoints (run_id, created_at DESC);

-- Prevent duplicate checkpoints per iteration+agent
CREATE UNIQUE INDEX idx_checkpoints_unique_agent
  ON evolution_checkpoints (run_id, iteration, last_agent);
