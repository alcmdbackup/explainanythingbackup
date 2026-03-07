-- RPC function for computing variant distribution stats (median/p90/max Elo) per run.
-- Uses PERCENTILE_CONT which is not available via the Supabase JS query builder.

CREATE OR REPLACE FUNCTION compute_run_variant_stats(p_run_id UUID)
RETURNS TABLE (
  total_variants BIGINT,
  median_elo DOUBLE PRECISION,
  p90_elo DOUBLE PRECISION,
  max_elo DOUBLE PRECISION
) LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    COUNT(elo_score),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY elo_score),
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY elo_score),
    MAX(elo_score)
  FROM evolution_variants WHERE run_id = p_run_id AND elo_score IS NOT NULL;
$$;

-- Restrict to service_role (admin-only, consistent with codebase convention)
REVOKE EXECUTE ON FUNCTION compute_run_variant_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_run_variant_stats(UUID) TO service_role;
