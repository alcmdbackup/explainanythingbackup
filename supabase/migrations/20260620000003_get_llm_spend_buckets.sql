-- Granularity-aware LLM spend aggregation for the admin spending dashboard. One function
-- covers hour/day/week (via date_trunc) so we don't add per-granularity views. Buckets are
-- grouped by call_source/model/is_test; the app folds call_source → entity/category in TS.
-- Mirrors the secure pattern of the sibling RPCs in 20260228000001_add_llm_cost_security.sql.
-- Rollback: DROP FUNCTION IF EXISTS get_llm_spend_buckets(text,timestamptz,timestamptz,boolean);

CREATE OR REPLACE FUNCTION get_llm_spend_buckets(
  p_granularity text,           -- 'hour' | 'day' | 'week'
  p_start timestamptz,
  p_end   timestamptz,
  p_include_test boolean DEFAULT true
) RETURNS TABLE (
  bucket timestamptz,
  call_source text,
  model text,
  is_test boolean,
  call_count bigint,
  total_tokens bigint,
  total_cost numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc(
           -- whitelist guard: a bad value yields a clean NULL error, never raw SQL
           CASE WHEN p_granularity IN ('hour','day','week') THEN p_granularity ELSE NULL END,
           created_at
         ) AS bucket,
         call_source,
         COALESCE(NULLIF(model, ''), 'unknown') AS model,
         is_test,
         count(*)::bigint AS call_count,
         COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
         COALESCE(SUM(estimated_cost_usd), 0)::numeric AS total_cost
  FROM "llmCallTracking"
  WHERE created_at >= p_start
    AND created_at <  p_end
    AND (p_include_test OR is_test = false)
  GROUP BY 1, 2, 3, 4;
$$;

REVOKE ALL ON FUNCTION get_llm_spend_buckets(text, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_llm_spend_buckets(text, timestamptz, timestamptz, boolean) TO service_role;
