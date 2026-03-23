-- Rollback: DROP VIEW IF EXISTS evolution_run_costs; DROP FUNCTION IF EXISTS get_run_total_cost(UUID); DROP INDEX IF EXISTS idx_invocations_run_cost;
-- Cost aggregation helpers for the evolution admin UI.
-- Provides a SECURITY DEFINER function for single-run cost and a view for batch queries.

-- 1. Single-run cost function (SECURITY DEFINER to respect RLS)
CREATE OR REPLACE FUNCTION get_run_total_cost(p_run_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM evolution_agent_invocations WHERE run_id = p_run_id;
$$;

REVOKE ALL ON FUNCTION get_run_total_cost(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_run_total_cost(UUID) TO service_role;

-- 2. Batch cost view (for list pages)
CREATE OR REPLACE VIEW evolution_run_costs AS
  SELECT run_id, COALESCE(SUM(cost_usd), 0) AS total_cost_usd
  FROM evolution_agent_invocations
  GROUP BY run_id;

REVOKE ALL ON evolution_run_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON evolution_run_costs TO service_role;

-- 3. Covering index for cost aggregation
CREATE INDEX IF NOT EXISTS idx_invocations_run_cost ON evolution_agent_invocations(run_id, cost_usd);
