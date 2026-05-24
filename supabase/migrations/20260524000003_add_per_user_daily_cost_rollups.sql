-- Per-user daily LLM cost rollups for the guest-account $10/day cap (Phase 4 of
-- fixes_explainanything_for_public_demo_20260523).
--
-- Existing `daily_cost_rollups` is a global aggregate keyed by (date, category).
-- This sibling table tracks per-user spend so LlmSpendingGate.checkPerUserCap()
-- can enforce a per-user limit (initially only used to cap the demo guest at $10/day,
-- but the schema is general-purpose).
--
-- No backfill: per-user tracking starts the moment this migration deploys.
-- Existing daily_cost_rollups remains untouched for the global cap path.

-- Use TEXT for user_id (not UUID) because llmCallTracking.userid is TEXT and
-- contains both UUID-formatted user IDs AND the system user constant
-- '00000000-0000-4000-8000-000000000001'. Avoiding the cast keeps the trigger simple.
CREATE TABLE IF NOT EXISTS per_user_daily_cost_rollups (
  date DATE NOT NULL,
  user_id TEXT NOT NULL,
  call_source TEXT NOT NULL,
  total_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  call_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (date, user_id, call_source)
);

-- Hot-path read: SELECT SUM(total_cost_usd) ... WHERE user_id = $1 AND date = current_date
CREATE INDEX IF NOT EXISTS idx_per_user_rollup_user_date
  ON per_user_daily_cost_rollups (user_id, date);

-- Deny-all RLS default + service_role bypass (mirrors evolution-table convention).
ALTER TABLE per_user_daily_cost_rollups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON per_user_daily_cost_rollups;
CREATE POLICY deny_all ON per_user_daily_cost_rollups
  FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS service_role_all ON per_user_daily_cost_rollups;
CREATE POLICY service_role_all ON per_user_daily_cost_rollups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger: increment the per-user rollup after every llmCallTracking insert.
-- SECURITY DEFINER so the trigger can write through RLS, and explicit search_path
-- per Postgres SECURITY DEFINER best practice (prevents search_path attacks).
CREATE OR REPLACE FUNCTION update_per_user_daily_cost_rollup()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Skip rows with no userid or no cost — they can't be attributed.
  IF NEW.userid IS NULL OR NEW.userid = '' OR NEW.estimated_cost_usd IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO per_user_daily_cost_rollups (date, user_id, call_source, total_cost_usd, call_count, updated_at)
  VALUES (
    (NEW.created_at AT TIME ZONE 'UTC')::date,
    NEW.userid,
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

DROP TRIGGER IF EXISTS trg_per_user_daily_cost_rollup ON "llmCallTracking";
CREATE TRIGGER trg_per_user_daily_cost_rollup
  AFTER INSERT ON "llmCallTracking"
  FOR EACH ROW EXECUTE FUNCTION update_per_user_daily_cost_rollup();

COMMENT ON TABLE per_user_daily_cost_rollups IS
  'Per-user daily LLM cost rollups. Populated by trigger on llmCallTracking insert. Used by LlmSpendingGate.checkPerUserCap() for per-user caps (e.g., $10/day on the demo guest account).';
