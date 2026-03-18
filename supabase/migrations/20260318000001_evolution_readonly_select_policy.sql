-- Add SELECT-only RLS policies for readonly_local role on all evolution tables.
-- This allows npm run query:prod to read evolution data for debugging.

CREATE POLICY readonly_select ON evolution_strategy_configs FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_arena_topics FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_experiments FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_runs FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_variants FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_agent_invocations FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_run_logs FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_arena_entries FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_arena_comparisons FOR SELECT TO readonly_local USING (true);
CREATE POLICY readonly_select ON evolution_arena_batch_runs FOR SELECT TO readonly_local USING (true);
