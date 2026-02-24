# Fix Hall of Fame Additions Evolution Plan

## Background
After runs complete, top 2 variants aren't being auto-added to hall of fame in production for evolution pipeline.

## Requirements (from GH Issue #546)
- Investigate and fix feedHallOfFame() — The feedHallOfFame() function in pipeline finalization isn't persisting top 2 variants to hall_of_fame_entries

## Problem
The `feedHallOfFame()` function uses `.upsert(entryRows, { onConflict: 'evolution_run_id,rank' })` which translates to `ON CONFLICT (evolution_run_id, rank)` in PostgreSQL. However, the only unique index on those columns is a **partial** index with `WHERE evolution_run_id IS NOT NULL`. PostgreSQL cannot infer partial indexes without a matching WHERE predicate in ON CONFLICT, and Supabase's JS client doesn't support WHERE predicates in `onConflict`. Every upsert fails with error 42P10, silently caught and logged as a warning. Confirmed via production queries: 0 auto-inserted entries exist, and the exact error is reproducible.

## Options Considered

### Option A: Replace partial index with non-partial unique index (Recommended)
- Drop `idx_hall_of_fame_entries_run_rank` (partial)
- Create new non-partial unique index on `(evolution_run_id, rank)`
- No code changes needed — existing `onConflict: 'evolution_run_id,rank'` will work
- Safe because PostgreSQL treats NULLs as distinct in unique indexes (NULL != NULL), so rows with NULL `evolution_run_id` can still have duplicate ranks
- **Pros:** Minimal change, no app code modification, fixes root cause
- **Cons:** Requires migration on production DB

### Option B: Add a non-partial UNIQUE constraint alongside the partial index
- Add `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (evolution_run_id, rank)`
- Keep partial index for backward compatibility
- **Pros:** Additive-only change
- **Cons:** Redundant index, wastes storage, confusing to have both

### Option C: Use raw SQL via Supabase RPC instead of `.upsert()`
- Create an RPC function that includes `ON CONFLICT (evolution_run_id, rank) WHERE evolution_run_id IS NOT NULL`
- **Pros:** No schema change
- **Cons:** Adds complexity, diverges from Supabase patterns, harder to maintain

### Option D: Switch from upsert to delete-then-insert
- Delete existing entries for the run, then insert new ones
- **Pros:** No schema or index changes
- **Cons:** Not atomic (race conditions), loses audit trail of created_at timestamps, more complex code

**Decision: Option A** — simplest, most correct fix. The partial predicate was unnecessary from the start.

**Verified safe:** The Elo upsert at `hallOfFameIntegration.ts:230` uses `onConflict: 'topic_id,entry_id'` which relies on a non-partial `UNIQUE (topic_id, entry_id)` constraint (from `20260201000001_article_bank.sql:70`). This is NOT affected by the same partial index issue. Other codebase upserts (`evolution_checkpoints`, `evolution_run_agent_metrics`) also use non-partial constraints and work correctly.

## Phased Execution Plan

### Phase 1: Migration — Replace partial index with non-partial

**Pre-migration validation** (run in Supabase SQL Editor before applying):
```sql
-- Verify no duplicate (evolution_run_id, rank) pairs exist that would block CREATE UNIQUE INDEX
SELECT evolution_run_id, rank, COUNT(*)
FROM evolution_hall_of_fame_entries
WHERE evolution_run_id IS NOT NULL AND rank IS NOT NULL
GROUP BY evolution_run_id, rank
HAVING COUNT(*) > 1;
-- Expected: 0 rows (since feedHallOfFame never succeeded, no data exists)
-- If duplicates found: DELETE the older duplicate rows before applying migration.
-- This scenario is extremely unlikely since production Query 1 confirmed 0 auto-inserted entries.
```

1. Create migration `supabase/migrations/20260224000001_fix_hall_of_fame_upsert_index.sql`:
   ```sql
   -- Fix: replace partial unique index with non-partial to enable ON CONFLICT inference.
   -- The partial predicate (WHERE evolution_run_id IS NOT NULL) was unnecessary because
   -- PostgreSQL already treats NULLs as distinct in unique indexes.
   --
   -- DDL in PostgreSQL is transactional — if CREATE INDEX fails, DROP INDEX is rolled back.
   DROP INDEX IF EXISTS idx_hall_of_fame_entries_run_rank;
   CREATE UNIQUE INDEX idx_hall_of_fame_entries_run_rank
     ON evolution_hall_of_fame_entries(evolution_run_id, rank);

   -- Rollback:
   -- DROP INDEX IF EXISTS idx_hall_of_fame_entries_run_rank;
   -- CREATE UNIQUE INDEX idx_hall_of_fame_entries_run_rank
   --   ON evolution_hall_of_fame_entries(evolution_run_id, rank)
   --   WHERE evolution_run_id IS NOT NULL;
   ```
2. Apply migration to production via Supabase Dashboard or CLI

### Phase 2: Add integration test for the upsert path
1. Add test in `src/__tests__/integration/hall-of-fame-actions.integration.test.ts` (which already has Supabase client setup, cleanup helpers, and table existence checks)
2. The test should exercise `.upsert()` with `onConflict: 'evolution_run_id,rank'` against the local Supabase instance
3. Verify it succeeds where it previously would have failed
4. **Note:** This test runs in `test:integration` (full suite), not `test:integration:critical`. It will run on PRs to production branch. This is acceptable since the migration itself is the fix — the test is a regression guard, not a gate.

### Phase 3: Verify end-to-end in production
1. Trigger a pipeline run (or wait for the next scheduled one)
2. Re-run Query 1 from research to confirm entries now appear:
   ```sql
   SELECT COUNT(*) FROM evolution_hall_of_fame_entries
   WHERE evolution_run_id IS NOT NULL AND rank IS NOT NULL;
   ```
3. Verify Elo ratings were initialized in `evolution_hall_of_fame_elo`
4. Verify auto re-ranking triggered

### Phase 4: Backfill (optional)
If desired, manually feed hall-of-fame entries for the 5 completed runs that were missed:
- Run `feedHallOfFame` logic manually or via a one-off script for each completed run that has variants but no hall-of-fame entries

## Testing

### Unit tests (existing — no changes needed)
- `evolution/src/lib/core/hallOfFameIntegration.test.ts` — 7 tests with mocked Supabase still valid (they test logic, not DB constraints)

### Integration test (new — in `src/__tests__/integration/hall-of-fame-actions.integration.test.ts`)
- Add test that performs `.upsert(rows, { onConflict: 'evolution_run_id,rank' })` against local Supabase
- Assert entries are created with correct `topic_id`, `rank`, `evolution_variant_id`, `generation_method`
- Assert `evolution_variant_id` FK is valid (variant must exist in `evolution_variants`)
- Verify idempotency: upsert twice with same `(evolution_run_id, rank)`, assert row count stays the same and content/cost fields are updated to new values

### Manual verification on production
- After migration: re-run Query 3 from research (the ON CONFLICT INSERT) to confirm it no longer errors
- After next pipeline run completes (check `evolution_runs` for a new `status = 'completed'` row), run Query 1 to confirm entries now appear
- Verify corresponding rows in `evolution_hall_of_fame_elo` for the new entries

## Documentation Updates
Docs that need updates:
- `evolution/docs/evolution/hall_of_fame.md` - Note that auto-feeding is now functional; document the index fix
- `evolution/docs/evolution/data_model.md` - Update if schema details reference the partial index
- `evolution/docs/evolution/reference.md` - Update migration reference
