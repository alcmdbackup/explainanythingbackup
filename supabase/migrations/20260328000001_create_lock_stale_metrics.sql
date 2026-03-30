-- Atomic claim-and-clear RPC for stale metric recomputation.
-- Atomically sets stale=false and returns claimed rows. If another request already cleared
-- the stale flag, returns empty — caller skips recomputation. This is a compare-and-swap
-- pattern that prevents thundering herd without cross-transaction locking.

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
