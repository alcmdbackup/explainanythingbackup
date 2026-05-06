-- DOWN migration for 20260423073526_harden_rpc_guards.sql.
-- Restores the RPC bodies from migrations 20260408000001 (upsert_metric_max) and
-- 20260328000001 (lock_stale_metrics).

CREATE OR REPLACE FUNCTION upsert_metric_max(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_metric_name TEXT,
  p_value DOUBLE PRECISION,
  p_source TEXT
) RETURNS VOID
LANGUAGE sql
SECURITY INVOKER
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

REVOKE EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION lock_stale_metrics(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_metric_names TEXT[]
)
RETURNS TABLE (id UUID, metric_name TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE evolution_metrics
  SET stale = false, updated_at = now()
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND metric_name = ANY(p_metric_names)
    AND stale = true
  RETURNING id, metric_name;
$$;

REVOKE EXECUTE ON FUNCTION lock_stale_metrics(TEXT, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_stale_metrics(TEXT, UUID, TEXT[]) TO service_role;
