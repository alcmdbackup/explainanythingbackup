-- Phase 0 of build_website_for_evolutiOn_20260626: reserve-before-spend
-- semantics for the per-user LLM gate.
--
-- WHY a separate table from per_user_daily_cost_rollups: that table is keyed on
-- (date, user_id, call_source) and populated by an AFTER INSERT trigger on
-- llmCallTracking that writes per-call_source rows. A reservation keyed on
-- call_source='public_edit' would never be offset when actual LLM calls land on
-- call_source='evolution_<agent>' rows — three-way scoping mismatch between
-- reservation, trigger, and cap-check (see /plan-review iteration 3 finding).
--
-- This new table is keyed only on (date, user_id) and never touched by the
-- existing trigger. Cap-check sums total_cost_usd across all call_sources from
-- per_user_daily_cost_rollups AND adds reserved_usd from this new table.
-- The two tables are independent + correctly composed.
--
-- RPCs added in this migration:
--   reserve_per_user_daily_cost(p_user_id, p_date, p_estimated_usd, p_cap_usd)
--     — SELECT FOR UPDATE the reservations row, sum cross-call_source spend,
--       reject if (existing + reserved + new estimate) > cap, else increment.
--   reconcile_per_user_reservation(p_user_id, p_date, p_reserved_usd)
--     — Decrement reserved_usd with GREATEST(0, ...) floor for race safety.
--   cleanup_orphaned_per_user_reservations(p_stale_minutes)
--     — Zero out reservations older than the stale window (default 15 min).
--     — Called from processRunQueue.ts BEFORE the claim loop, once per
--       systemd-timer firing (~60s cadence on the minicomputer).
--
-- ROLLBACK:
-- DROP FUNCTION IF EXISTS cleanup_orphaned_per_user_reservations(INT);
-- DROP FUNCTION IF EXISTS reconcile_per_user_reservation(TEXT, DATE, NUMERIC);
-- DROP FUNCTION IF EXISTS reserve_per_user_daily_cost(TEXT, DATE, NUMERIC, NUMERIC);
-- DROP INDEX IF EXISTS idx_per_user_reservations_stale;
-- DROP TABLE IF EXISTS per_user_daily_reservations;
-- NOTIFY pgrst, 'reload schema';

-- 1. Reservations table
CREATE TABLE IF NOT EXISTS per_user_daily_reservations (
  date DATE NOT NULL,
  user_id TEXT NOT NULL,
  reserved_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, user_id)
);

COMMENT ON TABLE per_user_daily_reservations IS
  'Per-user pre-spend reservations for the LLM cap gate. Keyed on (date, user_id) only — independent of call_source. Cap-check sums this + per_user_daily_cost_rollups.total_cost_usd across all call_sources.';

-- 2. Partial index for the orphan-cleanup predicate (predicate-aligned)
CREATE INDEX IF NOT EXISTS idx_per_user_reservations_stale
  ON per_user_daily_reservations (updated_at)
  WHERE reserved_usd > 0;

-- 3. RLS: deny-all default + service_role bypass (mirrors per_user_daily_cost_rollups)
ALTER TABLE per_user_daily_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON per_user_daily_reservations;
CREATE POLICY deny_all ON per_user_daily_reservations
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_all ON per_user_daily_reservations;
CREATE POLICY service_role_all ON per_user_daily_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. reserve_per_user_daily_cost RPC
-- Modeled on check_and_reserve_llm_budget (supabase/migrations/20260228000001:84-117).
-- Atomic check-then-increment via SELECT FOR UPDATE — UPSERT-with-RETURNING cannot
-- reject after-the-fact, so concurrent callers at cap boundary would silently over-cap.
CREATE OR REPLACE FUNCTION reserve_per_user_daily_cost(
  p_user_id TEXT,
  p_date DATE,
  p_estimated_usd NUMERIC,
  p_cap_usd NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_reserved NUMERIC;
  v_total NUMERIC;
BEGIN
  -- Ensure reservation row exists, then lock it
  INSERT INTO per_user_daily_reservations (date, user_id, reserved_usd)
    VALUES (p_date, p_user_id, 0)
    ON CONFLICT (date, user_id) DO NOTHING;

  SELECT reserved_usd INTO v_reserved
    FROM per_user_daily_reservations
    WHERE date = p_date AND user_id = p_user_id
    FOR UPDATE;

  -- SUM total_cost_usd across ALL call_sources for (user, date) — matches existing
  -- checkPerUserCap read pattern at llmSpendingGate.ts:112-130.
  SELECT COALESCE(SUM(total_cost_usd), 0) INTO v_total
    FROM per_user_daily_cost_rollups
    WHERE date = p_date AND user_id = p_user_id;

  IF v_total + v_reserved + p_estimated_usd > p_cap_usd THEN
    RETURN jsonb_build_object(
      'ok', false,
      'dailyTotal', v_total + v_reserved,
      'dailyCap', p_cap_usd
    );
  END IF;

  UPDATE per_user_daily_reservations
    SET reserved_usd = reserved_usd + p_estimated_usd,
        updated_at = now()
    WHERE date = p_date AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reservedUsd', p_estimated_usd,
    'dailyTotal', v_total + v_reserved + p_estimated_usd,
    'dailyCap', p_cap_usd
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_per_user_daily_cost(TEXT, DATE, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_per_user_daily_cost(TEXT, DATE, NUMERIC, NUMERIC) TO service_role;

-- 5. reconcile_per_user_reservation RPC
-- App-side reconcile only; trigger stays unchanged (no double-decrement).
-- GREATEST(0, ...) floor prevents negative reservations from race conditions.
CREATE OR REPLACE FUNCTION reconcile_per_user_reservation(
  p_user_id TEXT,
  p_date DATE,
  p_reserved_usd NUMERIC
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE per_user_daily_reservations
    SET reserved_usd = GREATEST(0, reserved_usd - p_reserved_usd),
        updated_at = now()
    WHERE date = p_date AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION reconcile_per_user_reservation(TEXT, DATE, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_per_user_reservation(TEXT, DATE, NUMERIC) TO service_role;

-- 6. cleanup_orphaned_per_user_reservations RPC
-- Called from processRunQueue.ts BEFORE the claim loop. Releases reservations
-- whose corresponding llmCallTracking row never landed (e.g. mid-call crash).
CREATE OR REPLACE FUNCTION cleanup_orphaned_per_user_reservations(
  p_stale_minutes INT DEFAULT 15
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_count INT;
BEGIN
  WITH released AS (
    UPDATE per_user_daily_reservations
      SET reserved_usd = 0, updated_at = now()
      WHERE updated_at < now() - (p_stale_minutes || ' minutes')::interval
        AND reserved_usd > 0
      RETURNING 1
  )
  SELECT COUNT(*)::INT INTO v_count FROM released;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_orphaned_per_user_reservations(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_per_user_reservations(INT) TO service_role;

-- 7. Reload PostgREST schema so the new RPCs are callable from supabase-js
NOTIFY pgrst, 'reload schema';
