-- Allow service_role full access to evolution tables through RLS.
-- The deny_all policy (20260315000001) blocks all roles; this adds an explicit
-- bypass for service_role so the batch runner and E2E test seeds can operate.
-- Skips gracefully when tables do not exist (e.g. staging before V2 migration).

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'evolution_strategies',
    'evolution_prompts',
    'evolution_experiments',
    'evolution_runs',
    'evolution_variants',
    'evolution_agent_invocations',
    'evolution_run_logs',
    'evolution_arena_entries',
    'evolution_arena_comparisons',
    'evolution_arena_batch_runs'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl AND table_schema = 'public') THEN
      EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', tbl);
      EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl);
    ELSE
      RAISE NOTICE 'Table % does not exist — skipping service_role policy', tbl;
    END IF;
  END LOOP;
END
$$;
