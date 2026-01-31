-- Batch eval run tracking for content quality evaluations.
-- Part of Phase D: Quality Evals system.

CREATE TABLE content_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_articles INT NOT NULL DEFAULT 0,
  completed_articles INT NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  dimensions TEXT[] NOT NULL DEFAULT ARRAY['clarity', 'structure', 'engagement', 'overall'],
  error_message TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'manual',
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- For admin UI: recent runs list
CREATE INDEX idx_eval_runs_status
  ON content_eval_runs (status, created_at DESC);

-- Add FK from content_quality_scores to content_eval_runs
ALTER TABLE content_quality_scores
  ADD CONSTRAINT fk_quality_scores_eval_run
  FOREIGN KEY (eval_run_id) REFERENCES content_eval_runs(id) ON DELETE SET NULL;
