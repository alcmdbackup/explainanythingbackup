# Investigate Recent Evolution Runs Plan

## Background
This project investigates recent evolution pipeline runs to verify the parallel generate-rank architecture (implemented in generate_rank_evolution_parallel_20260331) is working correctly in production. We will analyze run data end-to-end including agent invocations, structured logs, and metrics to identify any bugs or deviations from the expected behavior. The goal is to debug pipeline issues and ensure the orchestrator-driven iteration model (generate → swiss → swiss → ...) is functioning as designed.

## Requirements (from GH Issue #NNN)
Look at runs end-to-end including invocations, logs, metrics and explore if it's working properly as per our plan file in generate_rank_evolution_parallel_20260331.

## Problem
Investigation of staging runs c4057835 and eb62d393 revealed the parallel generate-rank pipeline is structurally working (generate → swiss iterations fire correctly, variants are generated and ranked) but two bugs are causing data loss and reduced ranking quality. First, `MergeRatingsAgent` writes match results to `evolution_arena_comparisons` during the run loop, but variants aren't persisted to `evolution_variants` until after the loop ends — FK constraint failures silently drop all comparisons involving freshly generated variants. Second, LLM calls time out at 60s with no retry, causing ranking failures that leave some runs with very few matches (17 vs 153 for a better-behaved run).

## Phased Execution Plan

### Phase 1: Data Collection (complete)
- [x] Query recent evolution runs to understand status, stop reasons, and cost
- [x] Query evolution_agent_invocations to verify generate + swiss + merge iteration pattern
- [x] Query evolution_logs to check for errors and warnings
- [x] Check evolution_variants for persisted/synced stats

### Phase 2: Deep Analysis (complete)
- [x] Cross-reference invocation patterns against expected generate → swiss loop
- [x] Identify FK violation root cause in MergeRatingsAgent
- [x] Identify LLM timeout root cause and impact
- [x] Investigate muHistory identical values — confirmed expected behavior (Swiss pairs new high-sigma variants only, not a bug we're fixing now)

### Phase 3: Issue Resolution

### Bug 1: FK Violation — MergeRatingsAgent writes arena comparisons before variants are persisted

**Root cause:** `MergeRatingsAgent` inserts rows into `evolution_arena_comparisons` (with `entry_a`/`entry_b` FKing `evolution_variants.id`) during the iteration loop. New variants are only persisted to `evolution_variants` in `finalizeRun` after the loop ends. Any comparison involving a freshly generated variant hits a FK constraint violation and is silently dropped (caught by the best-effort try/catch at `MergeRatingsAgent.ts:301-318`, logged as warn).

**Relevant code:**
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts:280-318` — bulk insert + best-effort error handling
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts:394-400` — MergeRatingsAgent called during loop
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:234` — variant upsert (only after loop ends)
- `supabase/migrations/20260322000007_evolution_prod_convergence.sql:202-204` — FK definition

**Chosen fix (Option A):** Drop the FK constraints on `entry_a`/`entry_b` via a new migration. The FKs are not used by any queries (no JOIN on `entry_a`/`entry_b` to fetch variant details exists anywhere). Referential integrity is application-enforced. `VariantEntity.ts:65` already explicitly deletes `evolution_arena_comparisons` rows when a variant is deleted (the FK's `ON DELETE CASCADE` is therefore redundant and safe to remove).

**Note on test suite:** Some existing tests call `supabase.from('evolution_variants').delete()` directly (bypassing `VariantEntity`) — this is a pre-existing test isolation pattern unrelated to the FK fix. The FK removal does not affect this behavior.

**Migration to write:** `supabase/migrations/20260409000001_drop_arena_comparisons_fks.sql`

This file must be created as part of Phase 3 implementation. Content:
```sql
-- Drop FK constraints that prevented in-run arena comparison writes.
-- MergeRatingsAgent writes evolution_arena_comparisons during the loop,
-- but new variants are only persisted to evolution_variants in finalizeRun.
-- Referential integrity is enforced at the application layer (VariantEntity.ts:65).
-- No queries JOIN entry_a/entry_b to fetch variant details, so these FKs provide
-- no query benefit. VariantEntity.ts:65 already does explicit deletion of
-- evolution_arena_comparisons rows on variant delete, making ON DELETE CASCADE redundant.
ALTER TABLE evolution_arena_comparisons DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_a_fkey;
ALTER TABLE evolution_arena_comparisons DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_b_fkey;

-- Rollback: re-add as NOT VALID to skip validating existing rows (some may be orphaned):
-- First delete orphaned rows (comparisons referencing variant IDs not in evolution_variants):
--   DELETE FROM evolution_arena_comparisons
--   WHERE entry_a NOT IN (SELECT id FROM evolution_variants)
--      OR entry_b NOT IN (SELECT id FROM evolution_variants);
-- Then re-add constraints:
-- ALTER TABLE evolution_arena_comparisons ADD CONSTRAINT evolution_arena_comparisons_entry_a_fkey
--   FOREIGN KEY (entry_a) REFERENCES evolution_variants(id) ON DELETE CASCADE NOT VALID;
-- ALTER TABLE evolution_arena_comparisons ADD CONSTRAINT evolution_arena_comparisons_entry_b_fkey
--   FOREIGN KEY (entry_b) REFERENCES evolution_variants(id) ON DELETE CASCADE NOT VALID;
```

**Known limitation:** After FK removal, if a run is killed/aborts mid-loop (before `finalizeRun`), comparison rows written during the loop for not-yet-persisted variants become orphaned in `evolution_arena_comparisons`. This is acceptable — orphaned rows have no query impact (no JOIN on entry_a/entry_b), and arena sync only backfills `prompt_id` (no new inserts). Out of scope for this fix.

**Post-migration step:** Run `npm run db:types` after migration to regenerate `src/lib/database.types.ts` (removes now-incorrect FK metadata from generated types).

**Deployment order:** Migration and classifyErrors.ts change are independent — deploy migration first, then code.

**Tests to add:**
- [x] `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — The nominal success path (mock DB returns no error, `arenaRowsWritten` equals row count) is **already covered** at line 134-157. No new test needed — verify this existing test still passes. Do NOT modify the existing error-handling test at line 159-177.
- [ ] Manual: after deploying migration, trigger a staging run and verify no `arena_comparisons insert failed` warnings in logs

---

### Bug 2: LLM 60s timeout — classified as non-transient, bypasses retry logic

**Root cause:** `createLLMClient.ts` already has `MAX_RETRIES=3` with exponential backoff, but the internal 60s timeout creates `new Error('LLM call timeout (60s)')`. `isTransientError()` in `classifyErrors.ts` does not match this message (no `'llm call timeout'` pattern), so it returns `false` and the retry loop exits immediately on attempt 0 — hence `totalAttempts=1` in logs.

**Relevant code:**
- `evolution/src/lib/shared/classifyErrors.ts` — `isTransientError()` missing timeout pattern
- `evolution/src/lib/pipeline/infra/createLLMClient.ts:76` — creates `Error('LLM call timeout (60s)')`
- `evolution/src/lib/pipeline/infra/createLLMClient.ts:114` — `if (!isTransientError(error) || attempt === MAX_RETRIES)`

**Fix (one line in `classifyErrors.ts`):** Add to the message checks:
```typescript
if (msg.includes('llm call timeout')) return true;
```

This makes the in-process 60s timeout retryable (up to 3 retries with 1s/2s/4s backoff), matching the intent of the existing retry infrastructure.

**Tests to add:**
- [x] `evolution/src/lib/shared/classifyErrors.test.ts` — add test: `isTransientError(new Error('LLM call timeout (60s)'))` returns `true`. Call the real `isTransientError` function (no mocking). No case-sensitivity test needed — `isTransientError` already calls `.toLowerCase()` internally before all pattern checks.
- [x] **NEW FILE** `evolution/src/lib/pipeline/infra/createLLMClient.retry.test.ts` — separate test file (NOT `createLLMClient.test.ts` which mocks `isTransientError` module-wide via `jest.mock()` hoisting): test that LLM call throws `Error('LLM call timeout (60s)')` on attempt 1, succeeds on attempt 2. Import and use REAL `classifyErrors.isTransientError` (no mock). Use `jest.useFakeTimers()` — advance timers past BOTH the 60s `PER_CALL_TIMEOUT_MS` (the Promise.race timeout) AND the 1s backoff to avoid hanging. Structure mock provider to reject on attempt 1, resolve on attempt 2. Verify the mock LLM is called twice (retry fired).

## Testing

### Unit Tests
- [x] `evolution/src/lib/shared/classifyErrors.test.ts` — add: `isTransientError(new Error('LLM call timeout (60s)'))` returns `true` (real function, no mocking)
- [x] **NEW FILE** `evolution/src/lib/pipeline/infra/createLLMClient.retry.test.ts` — separate file to avoid jest.mock() hoisting in existing test; tests LLM timeout retry with real `isTransientError` and fake timers; verifies mock LLM called twice (attempt 1 fails, attempt 2 succeeds)
- [x] `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — Nominal success path already covered at line 134-157. No new test needed — verify existing test still passes.

### Integration Tests
- [x] None required — existing MergeRatingsAgent and LLM client unit tests cover the changes. No full pipeline integration test harness exists currently.

### E2E Tests
- [x] None required (no UI changes)

### Manual Verification
- [ ] After deploying FK migration to staging, trigger a run and verify no `arena_comparisons insert failed` warnings in logs

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/architecture.md` — no update needed (pipeline behavior unchanged)
- [x] `evolution/docs/data_model.md` — updated entry_a/entry_b FK notation (migration 20260409000001)
- [x] `evolution/docs/metrics.md` — no update needed
- [x] `evolution/docs/arena.md` — updated entry_a/entry_b FK notation and description
- [x] `evolution/docs/rating_and_comparison.md` — no update needed
- [x] `evolution/docs/strategies_and_experiments.md` — no update needed
- [x] `evolution/docs/logging.md` — no update needed
- [x] `evolution/docs/entities.md` — updated FK cascade tree and relationship table (DB FK removed)
- [x] `evolution/docs/agents/overview.md` — no update needed
- [x] `evolution/docs/cost_optimization.md` — no update needed
- [x] `docs/feature_deep_dives/evolution_metrics.md` — no update needed

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
