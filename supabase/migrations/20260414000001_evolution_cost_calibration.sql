-- Per-(strategy × generation_model × judge_model × phase) cost calibration table
-- used to replace hardcoded EMPIRICAL_OUTPUT_CHARS and OUTPUT_TOKEN_ESTIMATES
-- constants with DB-backed values refreshed nightly from historical invocations.
-- See evolution/docs/cost_optimization.md (cost_estimate_accuracy_analysis_20260414).
--
-- Shadow-deploy note: this table is populated by evolution/scripts/refreshCostCalibration.ts
-- and read by evolution/src/lib/pipeline/infra/costCalibrationLoader.ts. Whether the loader's
-- values actually drive dispatch math is gated on COST_CALIBRATION_ENABLED env var (default
-- false for initial rollout); existing hardcoded constants remain authoritative fallback.

CREATE TABLE IF NOT EXISTS evolution_cost_calibration (
  strategy TEXT NOT NULL DEFAULT '__unspecified__',
  generation_model TEXT NOT NULL DEFAULT '__unspecified__',
  judge_model TEXT NOT NULL DEFAULT '__unspecified__',
  phase TEXT NOT NULL CHECK (phase IN ('generation','ranking','seed_title','seed_article')),
  avg_output_chars NUMERIC NOT NULL,
  avg_input_overhead_chars NUMERIC NOT NULL,
  avg_cost_per_call NUMERIC NOT NULL,
  n_samples INT NOT NULL CHECK (n_samples >= 1),
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy, generation_model, judge_model, phase)
);

-- RLS: deny-all + service_role bypass + conditional readonly_local select.
ALTER TABLE evolution_cost_calibration ENABLE ROW LEVEL SECURITY;

-- Clean up any pre-existing policy stubs (no-op on fresh install).
DROP POLICY IF EXISTS deny_all ON evolution_cost_calibration;
DROP POLICY IF EXISTS service_role_all ON evolution_cost_calibration;
DROP POLICY IF EXISTS readonly_select ON evolution_cost_calibration;

CREATE POLICY deny_all ON evolution_cost_calibration FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY service_role_all ON evolution_cost_calibration
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- readonly_local policy only created if the role exists (mirrors
-- 20260318000001_evolution_readonly_select_policy.sql pattern).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    EXECUTE 'CREATE POLICY readonly_select ON evolution_cost_calibration FOR SELECT TO readonly_local USING (true)';
  END IF;
END $$;

COMMENT ON TABLE evolution_cost_calibration IS
  'Per-slice (strategy, generation_model, judge_model, phase) cost-calibration stats refreshed nightly from evolution_agent_invocations. Loader: evolution/src/lib/pipeline/infra/costCalibrationLoader.ts';
