-- Add distributed tracing columns to evolution_run_logs.
-- request_id groups related log entries for a single agent execution.
-- cost_usd and duration_ms provide inline observability without parsing context JSON.

ALTER TABLE evolution_run_logs
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- Index for filtering/grouping by request_id within a run
CREATE INDEX IF NOT EXISTS idx_run_logs_request_id ON evolution_run_logs (run_id, request_id)
  WHERE request_id IS NOT NULL;
