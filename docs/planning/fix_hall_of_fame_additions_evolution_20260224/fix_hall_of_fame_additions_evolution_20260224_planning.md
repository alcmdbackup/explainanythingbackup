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

## Phased Execution Plan

### Phase 1: Migration — Replace partial index with non-partial
1. Create migration `supabase/migrations/20260224000001_fix_hall_of_fame_upsert_index.sql`:
   ```sql
   -- Fix: replace partial unique index with non-partial to enable ON CONFLICT inference.
   -- The partial predicate (WHERE evolution_run_id IS NOT NULL) was unnecessary because
   -- PostgreSQL already treats NULLs as distinct in unique indexes.
   DROP INDEX IF EXISTS idx_hall_of_fame_entries_run_rank;
   CREATE UNIQUE INDEX idx_hall_of_fame_entries_run_rank
     ON evolution_hall_of_fame_entries(evolution_run_id, rank);
   ```
2. Apply migration to production via Supabase Dashboard or CLI

### Phase 2: Add integration test for the upsert path
1. Add a test in `hallOfFameIntegration.test.ts` (or a new integration test) that exercises the actual `.upsert()` with `onConflict: 'evolution_run_id,rank'` against a real Supabase instance
2. Verify it succeeds where it previously would have failed

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

### Integration test (new)
- Add test that performs actual upsert with `onConflict: 'evolution_run_id,rank'` against real Supabase
- Verify entries are created with correct `topic_id`, `rank`, `evolution_variant_id`, `generation_method`
- Verify idempotency: running upsert twice with same `evolution_run_id` + `rank` updates rather than duplicates

### Manual verification on production
- After migration: run Query 1 and Query 3 from research to confirm the error is gone
- After next pipeline run: verify hall-of-fame entries appear for the new run

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/hall_of_fame.md` - Note that auto-feeding is now functional; document the index fix
- `evolution/docs/evolution/data_model.md` - Update if schema details reference the partial index
- `evolution/docs/evolution/reference.md` - Update migration reference
- `evolution/docs/evolution/architecture.md` - No change needed (finalizePipelineRun flow unchanged)
- `evolution/docs/evolution/visualization.md` - No change needed (UI unchanged)
- `evolution/docs/evolution/rating_and_comparison.md` - No change needed (rating logic unchanged)
- `evolution/docs/evolution/strategy_experiments.md` - No change needed
- `evolution/docs/evolution/agents/overview.md` - No change needed
- `evolution/docs/evolution/agents/generation.md` - No change needed
- `evolution/docs/evolution/cost_optimization.md` - No change needed
