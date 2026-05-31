# Follow-up (spun out): Make the migration set self-contained

**Status:** proposed follow-up project (not started). Spun out of `analyzing_migration_behavior_20260528` after Phase 2 execution discovered the migration repo cannot rebuild a DB from scratch. Suggested branch when picked up: `feat/rebuild_self_contained_migration_baseline_<date>`.

## The finding (why this exists)
The repo's `supabase/migrations/` (94 files) is **not self-contained** — it cannot be applied to a fresh database:
- The V2 clean-slate migration `20260315000001_evolution_v2.sql` (which created the core evolution tables) **was deleted from the repo** during the V2 wipe. Only `20260322000006_evolution_fresh_schema.sql` + `...007_prod_convergence.sql` remain, and they do NOT create the core tables.
- Across all 94 migrations, only **4** evolution tables are ever `CREATE`d: `evolution_cost_calibration`, `evolution_criteria`, `evolution_metrics`, `evolution_tactics`.
- **Referenced/altered by ~60 migrations but created by NONE:** `evolution_runs`, `evolution_variants`, `evolution_prompts`, `evolution_strategies`, `evolution_experiments`, `evolution_agent_invocations`, `evolution_explanations`, `evolution_arena_comparisons`, `evolution_logs`, plus `content_evolution_runs` (a legacy view FK-referenced by `content_history.sql:11`).
- Empirically confirmed: `npm run migration:verify` against a faithful shadow DB aborts at `20260131000004_content_history.sql` (`relation "content_evolution_runs" does not exist`).

Impact: disaster recovery / new-environment provisioning from the repo is broken; the migration-verify harness can only ever run synthetic fixtures; "apply-twice against all 94" is impossible until this is fixed.

## Recommended approach: baseline from a real schema dump
1. `supabase link --project-ref ifubinffdbyewoezcidz` (staging — local prod link is blocked) and `supabase db dump --schema public,auth -f supabase/migrations/00000000000000_baseline.sql` (or a dedicated baseline dir).
2. Make the baseline idempotent (the lint + apply-twice harness below will verify) and place it FIRST so a fresh DB builds the full current schema, then subsequent migrations apply on top.
3. Reconcile existing environments' ledgers so they treat the baseline as already-applied (`supabase migration repair`). **CAUTION:** this is the deferred Option-D territory — prod has known DUPLICATE `schema_migrations` entries and was never converged (see `docs/planning/clean_up_migration_history_evolutuion_20260321/`). Prod-ledger surgery needs an owner + CI-secret prod link; do staging first.
4. Alternative (lower blast radius for the harness only): seed the shadow DB from the staging dump and apply only NEW migrations on top — verifies new work without touching prod history.

## Preserved harness groundwork (reverted from the parent project — reuse here)
These were written + validated during Phase 2 and reverted from `scripts/verify-migrations-local.sh` to avoid leaving a red gate. Re-apply them in this project once the baseline exists.

**(a) Supabase bootstrap** — insert before the apply loop (the bare `postgres:15-alpine` lacks these; without it the first migration fails `role "anon" does not exist` / `schema "auth" does not exist`). The migration set references only this surface:
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly_local') THEN CREATE ROLE readonly_local NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT NULL::text $f$;
```
(If the baseline is generated from `supabase db dump`, it will already contain the real auth schema and this bootstrap may be unnecessary — verify.)

**(b) Apply-twice idempotency loop** — add after the existing single-apply loop in `verify-migrations-local.sh`: re-apply every migration to the populated DB and `exit 1` on failure with "not idempotent on re-apply: <file>". This catches the #1073 class. NOTE: only enable once the set is self-contained AND the lint-flagged 22 files are guarded, or it goes red on `fix_drift.sql` (42P07).

## Also fold in here (deferred from the parent project)
- **Static 22-file idempotency retrofit** (the lint-flagged backlog: bare `CREATE INDEX` ×17, `CREATE TABLE` ×13, `CREATE POLICY` ×9, etc., PLUS the ~30 quoted/`USING INDEX` `ADD CONSTRAINT` in `fix_drift.sql` the lint misses). Deferred because it can't be harness-verified until the set is self-contained, and editing shipped files trips the new append-only gate (use `@migration-edit-approved`), and it largely no-ops on existing envs.
- Wire the real-94 apply-twice as a required CI job (`ci.yml migration-verify-test`) once it can pass.
- Correct `supabase/migrations/EVOLUTION_HISTORY.md` (it claims pre-2026-03-22 files were deleted; main-app ones still exist, but the evolution clean-slate file genuinely was deleted).
