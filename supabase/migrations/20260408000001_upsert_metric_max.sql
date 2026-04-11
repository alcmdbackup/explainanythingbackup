-- Atomic max-value upsert for monotonically-increasing metrics (cost, generation_cost, ranking_cost).
-- Replaces last-write-wins upsert which loses concurrent updates when two writes interleave
-- and the smaller cumulative value commits after the larger one.
-- ROLLBACK: DROP FUNCTION IF EXISTS upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT);

CREATE OR REPLACE FUNCTION upsert_metric_max(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_metric_name TEXT,
  p_value DOUBLE PRECISION,
  p_source TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY INVOKER  -- service_role bypasses RLS already; no need for DEFINER
SET search_path = public
AS $$
  INSERT INTO evolution_metrics (entity_type, entity_id, metric_name, value, source, stale, updated_at)
  VALUES (p_entity_type, p_entity_id, p_metric_name, p_value, p_source, false, now())
  ON CONFLICT (entity_type, entity_id, metric_name) DO UPDATE
  SET value = GREATEST(evolution_metrics.value, EXCLUDED.value),
      source = EXCLUDED.source,
      stale = false,
      updated_at = now();
$$;

-- Re-apply access control (service_role is the only intended caller).
REVOKE EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) TO service_role;
