# Clean Up Migration History Evolution Plan

## Background
The evolution migration history has ~48 evolution-related migrations across V1→V2, with a clean-slate wipe (20260315) that made most of them dead code. Dev/staging and prod have diverged significantly — different table names, different columns, duplicate migration entries in prod. The goal is to document the current staging state in a single fresh migration and clean up the confusing history.

## Requirements (from GH Issue #773)
Help me clean up my migration history for evolution data tables. Create a fresh migration that documents the current state of evolution tables in Supabase staging.

## Problem
There are 48 evolution-related migration files, but the V2 clean-slate (20260315) drops everything and recreates from scratch, making the 33 prior evolution migrations dead code that still executes on fresh databases. Post-V2 migrations reference pre-rename table/column names, creating a confusing dependency chain. Prod has duplicate migration entries and is missing 7 post-V2 migrations. The migration history no longer tells a coherent story of the schema.

## Options Considered

### Option A: Squash all evolution migrations into fresh-schema migration
- Replace all 48 evolution migration files with a single `20260322000001_evolution_fresh_schema.sql`
- Delete the 47 old files, keep only the new one
- Manually update `supabase_migrations.schema_migrations` on dev and prod to remove old entries and insert the new one
- **Pros**: Cleanest result, single source of truth, fast `db reset`
- **Cons**: Requires manual DB intervention on both environments. Risk of breaking non-evolution migrations that ran between evolution ones. `schema_migrations` manipulation is irreversible.

### Option B: Keep old files, add fresh-schema as additive idempotent migration (Recommended)
- Keep all existing migration files untouched (they're already applied on both envs)
- Add `20260322000001_evolution_fresh_schema.sql` as an idempotent migration that converges both envs to the same state
- On staging: nearly a no-op (drops 1 legacy function, fixes RLS on `evolution_explanations`)
- On prod: does the heavy lifting (renames tables/columns, adds arena columns to variants, migrates arena data, drops legacy tables)
- Add a `MIGRATIONS_NOTE.md` in `supabase/migrations/` explaining the history
- **Pros**: No manual DB intervention. Safe to deploy via normal CI. Old migrations stay as historical record. Idempotent — can be re-run safely.
- **Cons**: Old dead files remain in the repo. New developers may be confused by the volume of migration files.

### Option C: Squash old files but mark them as "applied" via repair
- Use `supabase migration repair` to mark old migrations as applied/reverted
- Replace old files with the fresh schema
- **Pros**: Cleaner file history
- **Cons**: `supabase migration repair` must be run manually per-environment. Complex coordination between dev and prod.

## Phased Execution Plan

### Phase 1: Fresh Schema Migration (Current — in progress)

The `20260322000001_evolution_fresh_schema.sql` migration has been written. It is fully idempotent and documents the current staging state.

**Changes on staging (dev):**
1. Drop 1 legacy function: `checkpoint_and_continue(UUID, JSONB)`
2. Fix RLS on `evolution_explanations`: currently has NO RLS policies — adds `deny_all` + `service_role_all`
3. Recreate `service_role_all` policies on other 8 tables (functionally identical, ensures consistency)

**Changes on prod:**
1. Drop legacy V1 tables/functions/views
2. Rename `evolution_strategy_configs` → `evolution_strategies`
3. Rename `evolution_arena_topics` → `evolution_prompts`
4. Rename `strategy_config_id` → `strategy_id`, `topic_id` → `prompt_id`
5. Drop `config` JSONB from `evolution_runs`
6. Add `budget_cap_usd` to `evolution_runs`
7. Add 10 arena columns to `evolution_variants`
8. Migrate data from `evolution_arena_entries` → `evolution_variants`
9. Drop `evolution_arena_entries`, `evolution_arena_batch_runs`, `evolution_budget_events`
10. Retarget `evolution_arena_comparisons` FKs to `evolution_variants`
11. Recreate all RPCs with correct table/column names
12. Set up all RLS policies
13. Create `evolution_run_costs` view and `get_run_total_cost` function

**NOTE**: This migration intentionally does NOT add any columns that don't already exist on staging. Known drift (missing `evolution_explanation_id` on runs/experiments, missing FK on `evolution_explanations.prompt_id`) is documented but not fixed — that belongs in a separate migration.

### Phase 2: Clean Up Old Migration Files

After Phase 1 is deployed and verified on both environments:

1. **Delete dead pre-V2 evolution migration files** from the repo (they've already been applied and are no-ops after V2):
   - `20260131000001` through `20260131000010` (10 files)
   - `20260205000001` (1 file)
   - `20260211000001`, `20260212000001` (2 files)
   - `20260214000001` (1 file)
   - `20260215000002` through `20260215000006` (4 files — only evolution ones)
   - `20260221000002`, `20260221000006` (2 files)
   - `20260222000001` (1 file)
   Total: ~21 evolution-only files that are pure dead code after V2

2. **Delete post-V2 evolution migrations** that are now superseded by the fresh schema:
   - `20260306000001_evolution_budget_events.sql`
   - `20260314000002_create_evolution_explanations.sql`
   - `20260315000001_evolution_v2.sql`
   - `20260318000001_evolution_readonly_select_policy.sql`
   - `20260318000002_config_into_db.sql`
   - `20260319000001_evolution_run_cost_helpers.sql`
   - `20260320000001_rename_evolution_tables.sql`
   - `20260321000001_evolution_service_role_rls.sql`
   - `20260321000002_consolidate_arena_into_variants.sql`

3. **Important**: Do NOT delete the files from `supabase_migrations.schema_migrations` — Supabase tracks applied migrations by version number. Deleting local files is safe as long as the DB records remain. The files are just "already applied" history.

4. **Add `supabase/migrations/EVOLUTION_HISTORY.md`** explaining:
   - The evolution schema went through V1 (20260131-20260314) → V2 clean-slate (20260315) → renames and consolidation (20260318-20260321) → fresh schema (20260322)
   - All pre-20260322 evolution migration files have been deleted from the repo since they are superseded
   - The `20260322000001_evolution_fresh_schema.sql` is the single source of truth for evolution tables
   - Legacy migration version numbers remain in `schema_migrations` as "already applied"

### Phase 3: Fix Prod Duplicate Migration Entries

Prod has duplicate migration entries in `supabase_migrations.schema_migrations`:
- `20260304000004` through `20260304000018` are copies of `20260224000001` through `20260304000003`
- `20260306000003`, `20260307000002`, `20260309000003-7` are more duplicates

These should be cleaned up via `supabase migration repair --status reverted` or a direct DELETE from `supabase_migrations.schema_migrations` for the duplicate version numbers. This is cosmetic but prevents confusion when running `supabase migration list`.

### Phase 4: Update Documentation

Update evolution docs to reflect the post-consolidation schema:
- `evolution/docs/evolution/data_model.md` — Remove `evolution_arena_entries` and `evolution_budget_events` table docs. Add arena columns to `evolution_variants` docs. Update Schema Evolution Timeline.
- `evolution/docs/evolution/entity_diagram.md` — Update diagram to show `evolution_variants` as the unified table.
- `evolution/docs/evolution/arena.md` — Update to reflect arena data lives in `evolution_variants` with `synced_to_arena` flag.
- `evolution/docs/evolution/reference.md` — Update migration history table.
- `evolution/docs/evolution/cost_optimization.md` — Remove `evolution_budget_events` references.

## Testing

- Run `supabase db reset` locally to verify the full migration chain works from scratch
- Verify the fresh schema migration is idempotent: run it twice on staging, confirm no errors
- After deploying to prod, verify all evolution tables match staging schema
- Run evolution pipeline E2E tests to confirm nothing broke

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Remove arena_entries/budget_events, add arena columns to variants, update timeline
- `evolution/docs/evolution/reference.md` - Update migration history table
- `evolution/docs/evolution/architecture.md` - Minor: verify table name references are current
- `evolution/docs/evolution/cost_optimization.md` - Remove budget_events table references
- `evolution/docs/evolution/entity_diagram.md` - Update diagram for consolidated model
- `evolution/docs/evolution/arena.md` - Update for arena-in-variants architecture
