-- Add JSONB columns for cost estimate detail and prediction to content_evolution_runs.
-- The estimated_cost_usd NUMERIC column already exists (migration 20260205000003).
--
-- ROLLBACK:
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS cost_estimate_detail;
-- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS cost_prediction;

ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS cost_estimate_detail JSONB DEFAULT NULL;

ALTER TABLE content_evolution_runs
  ADD COLUMN IF NOT EXISTS cost_prediction JSONB DEFAULT NULL;

COMMENT ON COLUMN content_evolution_runs.cost_estimate_detail IS 'Full RunCostEstimate JSON stored at queue time';
COMMENT ON COLUMN content_evolution_runs.cost_prediction IS 'CostPrediction JSON comparing estimate to actual, stored at completion';
