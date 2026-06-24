-- Canonical cost dashboard (llm_costs_too_low_in_dash_20260623):
-- The /admin/costs dashboard read llmCallTracking only, which is incomplete for evolution
-- (direct-provider dev runs + the 2026-02-23 audit gap never wrote joinable rows). This adds
-- the SQL side of the app-level canonical merge: evolution spend is sourced at INVOCATION grain
-- from evolution_agent_invocations (the source of truth every execution path populates), bucketed
-- by invocation.created_at, classified test/real via run -> strategy.is_test_content.
--
-- 1. idx_invocations_created_at — the windowed SUM (this RPC) + the Layer-3 reconciliation both
--    scan evolution_agent_invocations by created_at; existing indexes lead with run_id, none on
--    created_at alone. CREATE INDEX IF NOT EXISTS = idempotent.
-- 2. get_evolution_spend_buckets — SECURITY DEFINER, search_path-pinned, mirrors
--    get_llm_spend_buckets. CREATE OR REPLACE = idempotent. NOT a UNION / does not touch
--    get_llm_spend_buckets; the app merges the two sources.
-- Rollback: DROP FUNCTION get_evolution_spend_buckets(text, timestamptz, timestamptz);
--           DROP INDEX idx_invocations_created_at;  (both safe — readers fall back via env flag).

CREATE INDEX IF NOT EXISTS idx_invocations_created_at
  ON evolution_agent_invocations (created_at);

CREATE OR REPLACE FUNCTION get_evolution_spend_buckets(
  p_granularity text,           -- 'hour' | 'day' | 'week'
  p_start timestamptz,
  p_end   timestamptz
) RETURNS TABLE (
  bucket timestamptz,
  is_test boolean,
  call_count bigint,
  total_cost numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_granularity NOT IN ('hour', 'day', 'week') THEN
    RAISE EXCEPTION 'invalid granularity: %', p_granularity USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
    SELECT date_trunc(p_granularity, i.created_at) AS bucket,
           -- strategy_id is NOT NULL FK, but LEFT JOIN + COALESCE keeps the SUM defensive:
           -- a NULL/orphan strategy classifies as real (never hide real spend).
           COALESCE(s.is_test_content, false) AS is_test,
           count(*)::bigint AS call_count,
           COALESCE(SUM(i.cost_usd), 0)::numeric AS total_cost
    FROM evolution_agent_invocations i
    LEFT JOIN evolution_runs r ON r.id = i.run_id
    LEFT JOIN evolution_strategies s ON s.id = r.strategy_id
    WHERE i.created_at >= p_start
      AND i.created_at <  p_end
    GROUP BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION get_evolution_spend_buckets(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_evolution_spend_buckets(text, timestamptz, timestamptz) TO service_role;
-- Allow the read-only debug role (npm run query:staging) to call it for verification.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_evolution_spend_buckets(text, timestamptz, timestamptz) TO readonly_local';
  END IF;
END $$;
