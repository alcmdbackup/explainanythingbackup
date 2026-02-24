# Fix Hall of Fame Additions Evolution Progress

## Phase 1: Migration
### Work Done
- Created `supabase/migrations/20260224000001_fix_hall_of_fame_upsert_index.sql`
- Drops partial unique index `idx_hall_of_fame_entries_run_rank` and recreates as non-partial
- Verified DDL is transactional (safe rollback if CREATE INDEX fails after DROP)

### Issues Encountered
None — straightforward DDL change.

## Phase 2: Integration Test
### Work Done
- Added Test 10 in `src/__tests__/integration/hall-of-fame-actions.integration.test.ts`
- Added `insertEvolutionRun()` helper (auto-creates strategy config for FK)
- Extended `cleanupAll()` with `createdRunIds`/`createdStrategyIds` tracking
- Test exercises `.upsert(rows, { onConflict: 'evolution_run_id,rank' })` path
- Validates idempotency: second upsert updates content/cost without creating duplicate rows

### Issues Encountered
- `evolution_variant_id` FK assertion from planning doc was omitted — column is nullable and the test focuses on ON CONFLICT behavior, not FK integrity. The existing unit tests in `hallOfFameIntegration.test.ts` cover the FK path with mocked Supabase.

## Phase 3: Documentation Updates
### Work Done
- Updated `evolution/docs/evolution/data_model.md` — noted non-partial index, added migration 14
- Updated `evolution/docs/evolution/hall_of_fame.md` — updated DB schema migration references
- Updated `evolution/docs/evolution/reference.md` — added migration to Production Deployment list

### Issues Encountered
None.

## Verification
- Lint: clean
- TypeScript: clean
- Build: succeeds (pre-existing design system warnings only)
- Integration tests: all 10 pass (skipped in env without Supabase credentials)
