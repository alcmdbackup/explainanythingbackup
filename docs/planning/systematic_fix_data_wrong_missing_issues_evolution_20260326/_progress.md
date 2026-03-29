# Systematic Fix Data/Migration Issues Evolution Progress

## Phase 1: Fix Active CI Blockers
### Work Done
- Deleted `evolution-run-costs.integration.test.ts` (references dropped RPC/view)
- Fixed `createTestArenaComparison` winner field: UUID → `'a'` in `evolution-test-helpers.ts`
- Fixed `writeMetric` in `entity-actions.integration.test.ts`: wrong column name `timing` → `source`, added error checking
- Fixed `ExperimentEntity.executeAction` missing `payload` parameter (broke rename action)
- Fixed `arena_topic` stale reference in `evolution/docs/metrics.md`

### Issues Encountered
- Experiment rename test was failing due to `ExperimentEntity.executeAction` dropping the `payload` param (not forwarding to super)

## Phase 2: Add Supabase Generated Types
### Work Done
- Generated `src/lib/database.types.ts` from OpenAPI spec (38 tables, 1 view, 18 RPCs)
- Wired `Database` generic into all 6 Supabase client files
- Updated both mock files (`supabase-js.ts`, `ssr.ts`) with `SupabaseClient<Database>` casts
- Added `db:types` script to `package.json`
- Upgraded `@supabase/ssr` 0.6.1 → 0.9.0 (fixed `never` type resolution with `Database` generic)
- Fixed ~218 type errors across 14 service files (cast at query boundaries)

### Issues Encountered
- OpenAPI-generated types had `id` required in Insert (fixed to optional)
- `@supabase/ssr` 0.6.1 incompatible with `Database` generic on supabase-js 2.80 (upgraded to 0.9.0)

## Phase 3: CI Workflow Changes
### Work Done
- Added `has_migrations` output to `detect-changes` job
- Added `deploy-migrations` job with DDL guard, concurrency group, fork/dependabot guards
- Added `generate-types` job with validation-before-commit, `!failure() && !cancelled()` condition
- Updated `typecheck` to depend on `generate-types` and checkout `${{ github.head_ref }}`
- Added `.gitattributes` with `merge=theirs` for `database.types.ts`

## Phase 4: Documentation Updates
### Work Done
- Fixed `arena_topic` reference in `evolution/docs/metrics.md`
- Added generated types section to `evolution/docs/data_model.md`
- Added CI type generation docs to `evolution/docs/reference.md`
- Documented CI migration flow in `docs/docs_overall/environments.md`
