-- Add SELECT-only RLS policies for readonly_local role on all evolution tables.
-- This allows npm run query:prod to read evolution data for debugging.
-- Skipped gracefully when readonly_local role does not exist (e.g. staging/production).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    RAISE NOTICE 'readonly_local role does not exist — skipping policy creation';
    RETURN;
  END IF;

  -- Drop existing policies first (idempotent for local re-runs)
  DROP POLICY IF EXISTS readonly_select ON evolution_strategy_configs;
  DROP POLICY IF EXISTS readonly_select ON evolution_arena_topics;
  DROP POLICY IF EXISTS readonly_select ON evolution_experiments;
  DROP POLICY IF EXISTS readonly_select ON evolution_runs;
  DROP POLICY IF EXISTS readonly_select ON evolution_variants;
  DROP POLICY IF EXISTS readonly_select ON evolution_agent_invocations;
  DROP POLICY IF EXISTS readonly_select ON evolution_run_logs;
  DROP POLICY IF EXISTS readonly_select ON evolution_arena_entries;
  DROP POLICY IF EXISTS readonly_select ON evolution_arena_comparisons;
  DROP POLICY IF EXISTS readonly_select ON evolution_arena_batch_runs;

  -- Create SELECT-only policies
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
END
$$;
