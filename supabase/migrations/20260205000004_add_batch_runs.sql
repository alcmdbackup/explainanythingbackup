-- Migration: Add batch runs tracking table
-- Enables systematic exploration of model × iteration × budget configurations

CREATE TABLE batch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, paused
  total_budget_usd NUMERIC(10, 2) NOT NULL,
  spent_usd NUMERIC(10, 4) DEFAULT 0,
  estimated_usd NUMERIC(10, 4),
  runs_planned INT DEFAULT 0,
  runs_completed INT DEFAULT 0,
  runs_failed INT DEFAULT 0,
  runs_skipped INT DEFAULT 0,
  execution_plan JSONB,  -- Array of expanded run specs with status
  results JSONB,  -- Final summary after completion
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_batch_runs_status ON batch_runs(status);
CREATE INDEX idx_batch_runs_name ON batch_runs(name);
CREATE INDEX idx_batch_runs_created_at ON batch_runs(created_at DESC);

-- Link individual evolution runs to batch
ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS batch_run_id UUID REFERENCES batch_runs(id);

CREATE INDEX idx_evolution_runs_batch ON content_evolution_runs(batch_run_id);

COMMENT ON TABLE batch_runs IS 'Batch configuration for systematic model/iteration exploration';
COMMENT ON COLUMN batch_runs.execution_plan IS 'Array of ExpandedRun objects with individual run status';
COMMENT ON COLUMN batch_runs.results IS 'Final analysis results: leaderboard, best config, cost summary';

-- Rollback:
-- DROP INDEX IF EXISTS idx_evolution_runs_batch;
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS batch_run_id;
-- DROP INDEX IF EXISTS idx_batch_runs_created_at;
-- DROP INDEX IF EXISTS idx_batch_runs_name;
-- DROP INDEX IF EXISTS idx_batch_runs_status;
-- DROP TABLE IF EXISTS batch_runs;
