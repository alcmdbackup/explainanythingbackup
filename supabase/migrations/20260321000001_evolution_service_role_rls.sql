-- Allow service_role full access to evolution tables through RLS.
-- The deny_all policy (20260315000001) blocks all roles; this adds an explicit
-- bypass for service_role so the batch runner and E2E test seeds can operate.

CREATE POLICY service_role_all ON evolution_strategy_configs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_arena_topics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_experiments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_variants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_agent_invocations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_run_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_arena_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_arena_comparisons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON evolution_arena_batch_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
