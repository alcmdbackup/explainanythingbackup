-- Grant the read-only debugging role SELECT on the Supabase migration ledger so the
-- prod-drift detector (npm run query:prod / scheduled check) can reconcile applied
-- migration versions against the repo. SELECT-only on one Supabase-internal schema;
-- exposes no table data.
--
-- Captures the grant applied to production manually on 2026-05-29 so it is tracked and
-- reproducible (analyzing_migration_behavior_20260528, Phase 5 / Option b). On staging
-- (applied via the main-merge deploy) it likewise enables `npm run query:staging` to read
-- the ledger for dry-runs.
--
-- Idempotent: GRANT is a no-op on re-apply; the guards cover fresh shadow DBs where the
-- role / supabase_migrations schema may not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local')
     AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'supabase_migrations') THEN
    GRANT USAGE ON SCHEMA supabase_migrations TO readonly_local;
    GRANT SELECT ON supabase_migrations.schema_migrations TO readonly_local;
  END IF;
END $$;
