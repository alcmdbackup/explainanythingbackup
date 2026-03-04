-- Migration: Add LLM cost security tables, trigger, and RPCs for defense-in-depth spending protection.
--
-- ROLLBACK:
-- DROP TRIGGER IF EXISTS llm_cost_rollup_trigger ON "llmCallTracking";
-- DROP FUNCTION IF EXISTS update_daily_cost_rollup();
-- DROP FUNCTION IF EXISTS check_and_reserve_llm_budget(TEXT, NUMERIC);
-- DROP FUNCTION IF EXISTS reconcile_llm_reservation(TEXT, NUMERIC);
-- DROP FUNCTION IF EXISTS reset_orphaned_reservations();
-- DROP TABLE IF EXISTS llm_cost_config;
-- DROP TABLE IF EXISTS daily_cost_rollups;
-- NOTIFY pgrst, 'reload schema';

-- 1. Create daily_cost_rollups table
CREATE TABLE daily_cost_rollups (
  date DATE NOT NULL,
  category TEXT NOT NULL,
  total_cost_usd NUMERIC(12,6) DEFAULT 0,
  reserved_usd NUMERIC(12,6) DEFAULT 0,
  call_count INTEGER DEFAULT 0,
  PRIMARY KEY (date, category)
);

COMMENT ON TABLE daily_cost_rollups IS 'Aggregated daily LLM costs by category for budget enforcement';
COMMENT ON COLUMN daily_cost_rollups.reserved_usd IS 'Atomically reserved budget for in-flight calls, decremented on reconciliation';

-- 2. Create llm_cost_config table
CREATE TABLE llm_cost_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);

COMMENT ON TABLE llm_cost_config IS 'Configuration for LLM cost caps and kill switch';

-- 3. RLS policies
ALTER TABLE daily_cost_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_cost_config ENABLE ROW LEVEL SECURITY;

-- daily_cost_rollups: read for authenticated, write for service_role only
CREATE POLICY "daily_cost_rollups_select" ON daily_cost_rollups
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "daily_cost_rollups_service" ON daily_cost_rollups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- llm_cost_config: read for authenticated, write for service_role only
CREATE POLICY "llm_cost_config_select" ON llm_cost_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "llm_cost_config_service" ON llm_cost_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Seed config rows
INSERT INTO llm_cost_config (key, value) VALUES
  ('daily_cap_usd', '{"value": 50}'::jsonb),
  ('monthly_cap_usd', '{"value": 500}'::jsonb),
  ('evolution_daily_cap_usd', '{"value": 25}'::jsonb),
  ('kill_switch_enabled', '{"value": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 5. AFTER INSERT trigger on llmCallTracking → upsert daily_cost_rollups
CREATE OR REPLACE FUNCTION update_daily_cost_rollup()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO daily_cost_rollups (date, category, total_cost_usd, call_count)
  VALUES (
    CURRENT_DATE,
    CASE WHEN NEW.call_source LIKE 'evolution_%' THEN 'evolution' ELSE 'non_evolution' END,
    COALESCE(NEW.estimated_cost_usd, 0),
    1
  )
  ON CONFLICT (date, category) DO UPDATE SET
    total_cost_usd = daily_cost_rollups.total_cost_usd + COALESCE(EXCLUDED.total_cost_usd, 0),
    call_count = daily_cost_rollups.call_count + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER llm_cost_rollup_trigger
  AFTER INSERT ON "llmCallTracking"
  FOR EACH ROW EXECUTE FUNCTION update_daily_cost_rollup();

-- 6. check_and_reserve_llm_budget RPC
CREATE OR REPLACE FUNCTION check_and_reserve_llm_budget(
  p_category TEXT, p_estimated_cost NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row daily_cost_rollups;
  v_cap NUMERIC;
  v_effective_total NUMERIC;
BEGIN
  -- Get or create today's row with row-level lock
  INSERT INTO daily_cost_rollups (date, category)
  VALUES (CURRENT_DATE, p_category)
  ON CONFLICT (date, category) DO NOTHING;

  SELECT * INTO v_row FROM daily_cost_rollups
  WHERE date = CURRENT_DATE AND category = p_category FOR UPDATE;

  -- Get cap from config
  SELECT (value->>'value')::NUMERIC INTO v_cap FROM llm_cost_config
  WHERE key = CASE WHEN p_category = 'evolution' THEN 'evolution_daily_cap_usd' ELSE 'daily_cap_usd' END;

  v_effective_total := v_row.total_cost_usd + v_row.reserved_usd + p_estimated_cost;

  IF v_effective_total > v_cap THEN
    RETURN jsonb_build_object('allowed', false, 'daily_total', v_row.total_cost_usd, 'daily_cap', v_cap, 'reserved', v_row.reserved_usd);
  END IF;

  -- Atomically increment reservation
  UPDATE daily_cost_rollups SET reserved_usd = reserved_usd + p_estimated_cost
  WHERE date = CURRENT_DATE AND category = p_category;

  RETURN jsonb_build_object('allowed', true, 'daily_total', v_row.total_cost_usd, 'daily_cap', v_cap, 'reserved', v_row.reserved_usd + p_estimated_cost);
END;
$$;

REVOKE ALL ON FUNCTION check_and_reserve_llm_budget(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_and_reserve_llm_budget(TEXT, NUMERIC) TO service_role;

-- 7. reconcile_llm_reservation RPC
CREATE OR REPLACE FUNCTION reconcile_llm_reservation(p_category TEXT, p_reserved NUMERIC)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE daily_cost_rollups
  SET reserved_usd = GREATEST(0, reserved_usd - p_reserved)
  WHERE date = CURRENT_DATE AND category = p_category;
END;
$$;

REVOKE ALL ON FUNCTION reconcile_llm_reservation(TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_llm_reservation(TEXT, NUMERIC) TO service_role;

-- 8. reset_orphaned_reservations RPC
CREATE OR REPLACE FUNCTION reset_orphaned_reservations()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE daily_cost_rollups SET reserved_usd = 0
  WHERE date = CURRENT_DATE AND reserved_usd > 0;
END;
$$;

REVOKE ALL ON FUNCTION reset_orphaned_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_orphaned_reservations() TO service_role;

-- 9. Backfill daily_cost_rollups from existing llmCallTracking data
INSERT INTO daily_cost_rollups (date, category, total_cost_usd, call_count)
SELECT
  DATE(created_at) as date,
  CASE WHEN call_source LIKE 'evolution_%' THEN 'evolution' ELSE 'non_evolution' END as category,
  COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd,
  COUNT(*) as call_count
FROM "llmCallTracking"
GROUP BY DATE(created_at), CASE WHEN call_source LIKE 'evolution_%' THEN 'evolution' ELSE 'non_evolution' END
ON CONFLICT (date, category) DO UPDATE SET
  total_cost_usd = EXCLUDED.total_cost_usd,
  call_count = EXCLUDED.call_count;

-- 10. Reload PostgREST schema for new RPCs
NOTIFY pgrst, 'reload schema';
