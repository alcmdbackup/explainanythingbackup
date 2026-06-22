-- Fix get_llm_spend_buckets: "structure of query does not match function result type".
-- llmCallTracking.call_source (and .model) are `character varying`, but the function's
-- RETURNS TABLE declares them `text` and returned `t.call_source` WITHOUT a cast, so plpgsql
-- RETURN QUERY rejected the varchar→text structural mismatch the moment the query returned a
-- row (an empty time-window silently passed, which is why this hid until real in-range spend
-- existed). `model` happened to escape only because its COALESCE(..., 'unknown') text literal
-- promoted it to text. Cast both columns to text explicitly.
--
-- New migration (NOT an in-place edit of 20260620000003/4 — those are already applied).
-- CREATE OR REPLACE is idempotent; safe to re-apply.
-- Rollback: revert to the 20260620000004 body (re-introduces the bug).

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_granularity NOT IN ('hour', 'day', 'week') THEN
    RAISE EXCEPTION 'invalid granularity: %', p_granularity USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
    SELECT date_trunc(p_granularity, t.created_at) AS bucket,
           t.call_source::text AS call_source,
           COALESCE(NULLIF(t.model, ''), 'unknown')::text AS model,
           t.is_test,
           count(*)::bigint AS call_count,
           COALESCE(SUM(t.total_tokens), 0)::bigint AS total_tokens,
           COALESCE(SUM(t.estimated_cost_usd), 0)::numeric AS total_cost
    FROM "llmCallTracking" t
    WHERE t.created_at >= p_start
      AND t.created_at <  p_end
      AND (p_include_test OR t.is_test = false)
    GROUP BY 1, 2, 3, 4;
END;
$$;

REVOKE ALL ON FUNCTION get_llm_spend_buckets(text, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_llm_spend_buckets(text, timestamptz, timestamptz, boolean) TO service_role;
