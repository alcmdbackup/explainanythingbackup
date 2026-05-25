-- Follow-up to 20260524000003 + 20260524000004.
--
-- Root cause of the silent rollback breaking llmCallTracking inserts (and
-- evolution fixture seedLlmCallTracking, and every evolution LLM call):
--
-- The trigger function update_per_user_daily_cost_rollup() guards with
-- `NEW.userid IS NULL OR NEW.userid = ''`. But `llmCallTracking.userid` is
-- `uuid NOT NULL` (see 20251109053825_fix_drift.sql). PostgreSQL attempts to
-- cast the empty-string literal `''` to uuid for the comparison, which raises
-- `22P02 invalid input syntax for type uuid: ""`, and the outer INSERT into
-- llmCallTracking rolls back.
--
-- The schema comment in 20260524000003 ("llmCallTracking.userid is TEXT") was
-- wrong — it's UUID. The IS NULL / = '' guard was defensive copy-paste from
-- TEXT-column patterns and never made sense for this trigger.
--
-- Fix: drop both guards. `NEW.userid` is `uuid NOT NULL`, so neither can fire.
-- Keep the `estimated_cost_usd IS NULL` guard (that column IS nullable).

CREATE OR REPLACE FUNCTION update_per_user_daily_cost_rollup()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  -- estimated_cost_usd is nullable; can't roll up what has no cost.
  IF NEW.estimated_cost_usd IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO per_user_daily_cost_rollups (date, user_id, call_source, total_cost_usd, call_count, updated_at)
  VALUES (
    (NEW.created_at AT TIME ZONE 'UTC')::date,
    NEW.userid::text,
    COALESCE(NEW.call_source, 'unknown'),
    NEW.estimated_cost_usd,
    1,
    now()
  )
  ON CONFLICT (date, user_id, call_source) DO UPDATE
    SET total_cost_usd = per_user_daily_cost_rollups.total_cost_usd + EXCLUDED.total_cost_usd,
        call_count = per_user_daily_cost_rollups.call_count + 1,
        updated_at = now();

  RETURN NEW;
END;
$$;
