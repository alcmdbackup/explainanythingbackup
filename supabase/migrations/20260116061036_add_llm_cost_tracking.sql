-- Migration: Add cost tracking to llmCallTracking table
-- Rollback: DROP VIEW IF EXISTS daily_llm_costs; ALTER TABLE "llmCallTracking" DROP COLUMN IF EXISTS estimated_cost_usd;

-- Add estimated cost column to llmCallTracking table
ALTER TABLE "llmCallTracking" ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,6);

-- Create index for cost-based queries
CREATE INDEX IF NOT EXISTS idx_llm_tracking_cost ON "llmCallTracking"(estimated_cost_usd) WHERE estimated_cost_usd IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_llm_tracking_created_at ON "llmCallTracking"(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_tracking_model ON "llmCallTracking"(model);

-- Create view for daily cost aggregation
-- Using a regular view for simplicity with Supabase RLS
CREATE OR REPLACE VIEW daily_llm_costs AS
SELECT
  DATE(created_at) as date,
  model,
  userid,
  COUNT(*) as call_count,
  SUM(prompt_tokens) as total_prompt_tokens,
  SUM(completion_tokens) as total_completion_tokens,
  SUM(reasoning_tokens) as total_reasoning_tokens,
  SUM(total_tokens) as total_tokens,
  SUM(estimated_cost_usd) as total_cost_usd
FROM "llmCallTracking"
GROUP BY DATE(created_at), model, userid;

-- Grant access to the view
GRANT SELECT ON daily_llm_costs TO authenticated;
GRANT SELECT ON daily_llm_costs TO service_role;

-- Add comment for documentation
COMMENT ON COLUMN "llmCallTracking".estimated_cost_usd IS 'Estimated cost in USD based on model token pricing at time of call';
COMMENT ON VIEW daily_llm_costs IS 'Aggregated daily LLM costs by model and user for admin analytics';
