-- Phase 1 of scan_codebase_for_bugs_20260422 — harden RPC guards against
-- NaN/NULL/duplicate inputs.
--
-- B068: upsert_metric_max — reject non-finite p_value (NaN and -Inf/+Inf) at the RPC boundary
--       as defense-in-depth alongside the existing Number.isFinite guard in writeMetricMax.
-- B077: upsert_metric_max — COALESCE existing value to '-Infinity'::float8 before GREATEST
--       so a pre-existing NULL doesn't cause GREATEST(NULL, new) to return NULL and
--       silently lose the upsert.
-- B073: lock_stale_metrics — SELECT DISTINCT over the input array so callers that pass
--       duplicate metric names don't issue redundant UPDATEs.
--
-- DOWN migration: 20260423073526_harden_rpc_guards.down.sql restores the bodies from
-- migrations 20260408000001 (upsert_metric_max) and 20260328000001 (lock_stale_metrics).

-- ─── B068 + B077: upsert_metric_max ──────────────────────────────

CREATE OR REPLACE FUNCTION upsert_metric_max(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_metric_name TEXT,
  p_value DOUBLE PRECISION,
  p_source TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER  -- service_role bypasses RLS already; no need for DEFINER
SET search_path = public
AS $$
BEGIN
  -- B068: reject non-finite values (NaN, +Inf, -Inf). NaN is the canonical IEEE-754 signal
  -- of a corrupt cost input; the `p_value <> p_value` idiom catches it (NaN is the only
  -- value that is not equal to itself). Explicit isNaN / isInf reject so callers get a
  -- loud failure instead of a silently-swallowed update.
  IF p_value IS NULL
     OR p_value <> p_value               -- NaN
     OR p_value = 'Infinity'::float8
     OR p_value = '-Infinity'::float8 THEN
    RAISE EXCEPTION 'upsert_metric_max: p_value must be finite (entity=% metric=%)',
      p_entity_id, p_metric_name
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO evolution_metrics (entity_type, entity_id, metric_name, value, source, stale, updated_at)
  VALUES (p_entity_type, p_entity_id, p_metric_name, p_value, p_source, false, now())
  ON CONFLICT (entity_type, entity_id, metric_name) DO UPDATE
  -- B077: COALESCE the existing value so a NULL column doesn't defeat GREATEST.
  SET value = GREATEST(COALESCE(evolution_metrics.value, '-Infinity'::float8), EXCLUDED.value),
      source = EXCLUDED.source,
      stale = false,
      updated_at = now();
END;
$$;

-- Re-apply access control (service_role is the only intended caller).
REVOKE EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metric_max(TEXT, UUID, TEXT, DOUBLE PRECISION, TEXT) TO service_role;

-- ─── B073: lock_stale_metrics dedup ──────────────────────────────

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
  -- B073: DISTINCT the input array so a caller passing duplicate metric names doesn't
  -- issue redundant UPDATEs. The underlying WHERE-clause semantics are already
  -- deduplicating (each row matches once regardless of array duplicates), but the
  -- explicit DISTINCT makes the contract unambiguous and removes the need for future
  -- readers to reason about whether the UPDATE could touch the same row twice.
  WITH unique_names AS (
    SELECT DISTINCT unnest(p_metric_names) AS metric_name
  )
  UPDATE evolution_metrics m
  SET stale = false, updated_at = now()
  FROM unique_names u
  WHERE m.entity_type = p_entity_type
    AND m.entity_id = p_entity_id
    AND m.metric_name = u.metric_name
    AND m.stale = true
  RETURNING m.id, m.metric_name;
$$;

REVOKE EXECUTE ON FUNCTION lock_stale_metrics(TEXT, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_stale_metrics(TEXT, UUID, TEXT[]) TO service_role;
