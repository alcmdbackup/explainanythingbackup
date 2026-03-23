# Find Bugs Evolution Plan

## Background
Deep scan of the evolution system on main branch identified 15 high-priority bugs across pipeline execution, arena sync, cost tracking, experiment lifecycle, and admin UI. These bugs range from silent Elo corruption and race conditions to type mismatches and missing server-side validation. This plan addresses all confirmed bugs in priority order.

## Requirements (from GH Issue #769)
- Full system scan of all evolution subsystems: pipeline execution, arena sync, admin UI, cost tracking, experiments, and strategies
- Fix all confirmed critical and high-severity bugs
- Update stale documentation post-consolidation migration

## Problem
The evolution system has 15 confirmed bugs found by 32 agents across 8 scanning rounds. The most critical are: (1) concurrent run limit race condition allowing excess runners, (2) silent Elo corruption where LLM errors in ranking produce fake draws that corrupt ratings without logging, (3) muHistory type mismatch where the pipeline produces `number[][]` but the Zod schema expects `number[]`, breaking run summary parsing. Additional high-severity bugs include experiment auto-completion without checking sibling runs, DeepSeek pricing at 2x actual cost, and missing server-side budget validation.

## Options Considered

### Approach A: Fix all 15 bugs in a single branch
- Pros: One PR, one review cycle
- Cons: Large diff, hard to review, risk of regressions

### Approach B: Fix in 4 phases by subsystem (Chosen)
- Pros: Incrementally testable, smaller diffs, easier review
- Cons: More commits, but each is self-contained
- Phases: Pipeline core → Finalization → Experiments/Admin → Schema/Docs

### Approach C: Only fix critical bugs, defer high
- Pros: Fastest
- Cons: Leaves known issues that will compound

## Phased Execution Plan

### Phase 1: Pipeline Core (Bugs #1, #2, #5)

**Bug #1: Concurrent run limit race condition**
- File: `evolution/src/lib/pipeline/claimAndExecuteRun.ts:85-100`
- Fix: Modify the `claim_evolution_run` RPC to enforce concurrency atomically. Use `pg_advisory_xact_lock` inside the RPC to serialize claim attempts:
  ```sql
  -- MUST drop old 2-arg overload first to avoid function-not-unique errors
  -- (new 3-arg version with DEFAULT would be ambiguous with old 2-arg version)
  DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);

  CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL, p_max_concurrent INT DEFAULT 5)
  RETURNS SETOF evolution_runs AS $$
  BEGIN
    -- Advisory lock serializes all claim attempts (global lock, acceptable bottleneck for <=5 runners)
    PERFORM pg_advisory_xact_lock(hashtext('evolution_claim'));

    -- Atomic count check inside the lock
    IF (SELECT count(*) FROM evolution_runs WHERE status IN ('claimed', 'running')) >= p_max_concurrent THEN
      RETURN;
    END IF;

    -- Existing SKIP LOCKED claim logic
    RETURN QUERY
    UPDATE evolution_runs SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
    WHERE id = (
      SELECT id FROM evolution_runs
      WHERE status = 'pending' AND (p_run_id IS NULL OR id = p_run_id)
      ORDER BY created_at ASC LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  ```
- Migration: `supabase/migrations/20260322000001_fix_claim_concurrent_limit.sql` with rollback comment:
  ```sql
  -- ROLLBACK: DROP FUNCTION claim_evolution_run(TEXT, UUID, INT);
  -- Then re-create original 2-arg version from 20260315000001
  ```
- Callers to update: Remove client-side count check from `claimAndExecuteRun.ts`. Update `processRunQueue.ts` and CLI scripts to pass `p_max_concurrent` from env var. The API route at `src/app/api/evolution/run/route.ts` also calls the core function and needs the parameter threaded through.
- Test: Update `claimAndExecuteRun.test.ts` to verify mock RPC receives `p_max_concurrent` param. Integration test: call RPC twice concurrently with limit=1, verify second returns empty.

**Bug #2: Silent Elo corruption from LLM errors**
- Files: `evolution/src/lib/pipeline/loop/rankVariants.ts:159-173` AND `evolution/src/lib/shared/computeRatings.ts`
- Fix: The corruption path is: `makeCompareCallback` → `compareWithBiasMitigation` → `run2PassReversal` → LLM call. The fix must intercept at THREE points:
  1. **In `makeCompareCallback()` (rankVariants.ts:168)**: Log the error via run logger before returning empty string. Add error counter.
  2. **In triage rating update (rankVariants.ts:350-362)**: The current `isDraw` condition at line 351 is `match.confidence === 0 || match.winnerId === match.loserId`. Change this to EXCLUDE confidence-0 from draw handling:
     ```typescript
     // Skip rating update entirely for failed comparisons (confidence 0 = both LLM passes failed)
     if (match.confidence === 0) {
       // No rating change — this was a failed comparison, not a real draw
       continue;
     }
     const isDraw = match.winnerId === match.loserId;
     if (isDraw || match.result === 'draw') {
       const [newA, newB] = updateDraw(entrantRating, oppRating);
       // ...
     }
     ```
  3. **In fine-ranking rating update (rankVariants.ts:467-481)**: Apply the SAME confidence-0 skip. The current code at line 471 treats `confidence < 0.3` as draw. Change to:
     ```typescript
     // Skip rating update for total failures (confidence 0)
     if (match.confidence === 0) continue;
     // Treat low-confidence (0 < confidence < 0.3) as draw (existing behavior)
     if (match.confidence < 0.3 || match.result === 'draw') {
       const [newA, newB] = updateDraw(...);
     }
     ```
  4. Track consecutive error count in both triage and fine-ranking loops. If >3 consecutive confidence-0 results, log error and break ranking early with `converged: false`.
- The key insight: confidence 0.0 means "both LLM passes failed" (total failure per aggregateWinners). We separate this from legitimate low-confidence draws (0 < confidence < 0.3) which should still update ratings.
- Test: Add tests in `rankVariants.test.ts`:
  - Mock LLM to throw → verify no rating change for that match (triage path)
  - Mock LLM to throw → verify no rating change (fine-ranking path)
  - 4 consecutive errors → ranking breaks early

**Bug #5: DeepSeek pricing 2x mismatch**
- File: `evolution/src/lib/pipeline/infra/createLLMClient.ts:21`
- Fix: Remove hardcoded `MODEL_PRICING` map entirely. Import `getModelPricing` from `src/config/llmPricing.ts` instead. Replace `calculateCost()` with `calculateLLMCost()` from the shared module for consistent rounding (6 decimal places).
- Test: Add test verifying pipeline pricing matches global config for all supported models including deepseek-chat

### Phase 2: Finalization (Bugs #3, #8, #9, #11, #12, #14)

> **Note:** Bug #14 moved from Phase 3 to Phase 2 since both #8 and #14 modify `persistRunResults.ts` finalization logic. Keeping them in the same phase avoids merge conflicts.

**Bug #3: muHistory type mismatch**
- Files: `evolution/src/lib/types.ts:684` (Zod schema) AND `evolution/src/services/evolutionVisualizationActions.ts:145` (consumer)
- Fix: Update the **schema** to accept `number[][]`, not flatten the data. The pipeline correctly produces per-iteration top-K mu values (`number[][]`), and this data is valuable for convergence visualization. Changes:
  1. Update `EvolutionRunSummaryV3Schema` at line 684 to accept BOTH formats for backward compatibility with existing DB rows:
     ```typescript
     muHistory: z.union([
       z.array(z.array(z.number())),  // New format: number[][] (top-K per iteration)
       z.array(z.number()).transform(arr => arr.map(v => [v]))  // Legacy: number[] → wrap each as [v]
     ]).pipe(z.array(z.array(z.number())).max(100)),
     ```
     This handles three cases: (a) new V3 rows with `number[][]` pass directly, (b) old V3 rows with `number[]` are auto-wrapped as `[[v1], [v2], ...]`, (c) V1/V2 rows are first transformed by their respective schema branches then hit this same union.
  2. Update `EvolutionRunSummary` interface at line 646: `muHistory: number[][]`
  3. Update `evolutionVisualizationActions.ts` consumer at line 145: `return (summary.muHistory ?? []).map((mus, i) => ({ iteration: i + 1, mu: mus[0] ?? 0 }))` — take top-1 for the chart
  4. Update V1→V3 and V2→V3 transforms to wrap legacy `number[]` values as `[value]` per entry: `.transform(arr => arr.map(v => [v + 3 * DEFAULT_SIGMA]))`
- Test: Add tests verifying: (a) `number[][]` passes Zod validation, (b) legacy `number[]` auto-wraps to `number[][]`, (c) V1/V2 auto-migration produces correct `number[][]` format.

**Bug #8: Silent error swallowing in finalization**
- File: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:176-185,253-263`
- Fix:
  1. Variant upsert (line 176-185): Re-throw if error is NOT a duplicate key conflict. Log and continue only for `23505` (unique_violation) which indicates an acceptable race.
  2. Arena sync (line 253-263): Add 1 retry with 2s delay. The `sync_to_arena` RPC uses `ON CONFLICT DO UPDATE`, so retries are idempotent and safe. If retry also fails, log error with structured context (run_id, prompt_id, entry count) but do not re-throw (arena sync is non-critical).
- Test: Mock Supabase to return error → verify re-throw for non-duplicate errors. Mock retry → verify 2nd attempt is made.

**Bug #9: buildRunSummary includes arena entries**
- File: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:121`
- Fix: Create a shallow copy of `result` with the filtered pool before calling `buildRunSummary`. Since `EvolutionResult` contains a `Map` (ratings), use spread for plain objects and pass the Map by reference (it's read-only in buildRunSummary):
  ```typescript
  const filteredResult = { ...result, pool: localPool };
  const runSummary = buildRunSummary(filteredResult, durationSeconds);
  ```
  This is safe because `buildRunSummary` only reads from `pool` and `ratings` (the Map). It does not mutate them.
- Test: Add test with mix of arena + local variants → verify summary only includes local variant stats.

**Bug #11: Empty local pool incorrectly fails run**
- File: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:109-118`
- Fix: If `localPool.length === 0` but `result.pool.length > 0` (arena-only), mark run as completed with `stopReason: 'arena_only'` instead of failed. Log both pool sizes for debugging.
- Test: Add test for arena-only pool → run status = 'completed', not 'failed'

**Bug #12: syncToArena winner hardcoded to 'a' + draw entry normalization**
- File: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:245-251`
- Fix: The winner='a' hardcoding is correct by construction (entry_a = winnerId). Add clarifying comment. Additionally, normalize draw entries to consistent order (entry_a < entry_b lexicographically) to prevent duplicate match records with swapped IDs:
  ```typescript
  const matches = matchHistory
    .filter((m) => m.confidence > 0) // Skip failed comparisons (confidence 0)
    .map((m) => {
      if (m.result === 'draw') {
        // Normalize draw entries to sorted order to prevent duplicates
        const [first, second] = [m.winnerId, m.loserId].sort();
        return { entry_a: first, entry_b: second, winner: 'draw', confidence: m.confidence };
      }
      // entry_a = winnerId, so winner is always 'a' by construction
      return { entry_a: m.winnerId, entry_b: m.loserId, winner: 'a' as const, confidence: m.confidence };
    });
  ```
- Test: Add test verifying draw entries are sorted. Add test verifying non-draw winner='a' invariant.

**Bug #14: Cancel-finalize race condition**
- File: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:132`
- Fix: Thread `runnerId` through to `finalizeRun()` by adding it as a parameter (it's available from `claimAndExecuteRun.ts` where `options.runnerId` is set). Add `.eq('runner_id', runnerId)` to the status update. Check affected row count:
  ```typescript
  const { data, error, count } = await db
    .from('evolution_runs')
    .update({ status: 'completed', ... })
    .eq('id', runId)
    .in('status', ['claimed', 'running'])
    .eq('runner_id', runnerId)
    .select('id', { count: 'exact' });

  if (count === 0) {
    logger?.warn('Finalization aborted: run status changed externally (likely killed)', { phaseName: 'finalize' });
    return; // Skip variant persistence
  }
  ```
- Test: Mock DB update returning count=0 → verify variants NOT persisted and warning logged

### Phase 3: Experiments & Admin (Bugs #4, #6, #7, #10)

**Bug #4: Experiment auto-completion without sibling check**
- File: `evolution/src/lib/pipeline/finalize/persistRunResults.ts:200-212`
- Fix: Create an RPC `complete_experiment_if_done(p_experiment_id UUID, p_completed_run_id UUID)`:
  ```sql
  CREATE OR REPLACE FUNCTION complete_experiment_if_done(p_experiment_id UUID, p_completed_run_id UUID)
  RETURNS VOID AS $$
  BEGIN
    UPDATE evolution_experiments
    SET status = 'completed', updated_at = now()
    WHERE id = p_experiment_id
      AND status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM evolution_runs
        WHERE experiment_id = p_experiment_id
          AND id != p_completed_run_id
          AND status IN ('pending', 'claimed', 'running')
      );
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
  ```
- Migration: `supabase/migrations/20260322000002_fix_experiment_auto_completion.sql` with rollback comment
- Replace the blind update in persistRunResults.ts with `await db.rpc('complete_experiment_if_done', { p_experiment_id: run.experiment_id, p_completed_run_id: runId })`
- Test: Unit test with mock RPC call. Integration test: create experiment with 2 runs, finalize run 1 → verify experiment still 'running'. Finalize run 2 → verify experiment 'completed'.

**Bug #6: No server-side budget validation**
- File: `evolution/src/services/experimentActionsV2.ts` (action wrapper) AND `evolution/src/lib/pipeline/manageExperiments.ts:42-80`
- Fix:
  1. Add Zod schema to `addRunToExperimentAction` input: `{ experimentId: z.string().uuid(), config: { strategy_id: z.string().uuid(), budget_cap_usd: z.number().positive().max(10) } }`
  2. Add DB-level CHECK constraint via migration: `ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap CHECK (budget_cap_usd > 0 AND budget_cap_usd <= 10)`
  3. In `addRunToExperiment()`, query existing runs' total budget and reject if adding this run would exceed $10 total per experiment
- Migration: `supabase/migrations/20260322000003_add_budget_check_constraint.sql` with rollback: `ALTER TABLE evolution_runs DROP CONSTRAINT chk_budget_cap`
- Test: Unit test for Zod rejection of budget > 10. Integration test for CHECK constraint violation.

**Bug #7: Partial experiment creation no rollback**
- Files: `evolution/src/services/experimentActionsV2.ts` (new action) AND `src/app/admin/evolution/_components/ExperimentForm.tsx:110-128`
- Fix: Create `createExperimentWithRunsAction` in `evolution/src/services/experimentActionsV2.ts` (server action layer, NOT client component). This action:
  1. Accepts `{ name, promptId, runs: Array<{ strategy_id, budget_cap_usd }> }` with Zod validation
  2. Creates the experiment via `createExperiment()`
  3. Loops to add all runs via `addRunToExperiment()`
  4. If any run insertion fails, deletes the experiment and all created runs, then throws
  5. Returns the experiment ID on success
  6. Export from `experimentActionsV2.ts` alongside existing actions (no breaking changes to existing exports)
- Update `ExperimentForm.tsx` to import and call the single batch action instead of looping
- Test: Add test block in existing `evolution/src/services/experimentActionsV2.test.ts` for `createExperimentWithRunsAction` — test partial failure → cleanup, test success path. E2E test in `src/__tests__/e2e/specs/09-admin/admin-experiment-wizard.spec.ts` for the full wizard flow.

**Bug #10: Missing pagination in getEvolutionRunsAction**
- File: `evolution/src/services/evolutionActions.ts:177-239`
- Fix: Follow the existing pattern from `listVariantsAction` (same file, line ~420) which already returns `{ items, total }`. Add `limit` (default 50, max 200) and `offset` (default 0) to input. Use `.range(offset, offset + limit - 1)` with `{ count: 'exact' }`. Return `{ items: EvolutionRun[], total: number }`.
- Update `src/app/admin/evolution/runs/page.tsx` to consume the new return shape and add pagination controls (following the pattern in other list pages).
- Test: Add test in `evolutionActions.test.ts` for pagination with offset/limit and total count

### Phase 4: Schema & Documentation (Bug #13, #15, Docs)

**Bug #13: Missing indexes for arena queries**
- Migration: `supabase/migrations/20260322000004_add_arena_indexes.sql`
  ```sql
  -- supabase:disable-transaction
  -- ^^^ Required: CONCURRENTLY cannot run inside a transaction.
  -- Supabase migrations run in transactions by default; this directive disables it.
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_variants_arena_leaderboard
    ON evolution_variants (prompt_id, mu DESC)
    WHERE synced_to_arena = true AND archived_at IS NULL;
  -- ROLLBACK: DROP INDEX IF EXISTS idx_variants_arena_leaderboard;
  ```
- Test: Run `EXPLAIN ANALYZE` on arena leaderboard query to verify index scan (manual verification on stage, not automatable in unit tests). Add integration test that queries arena entries and verifies non-empty result (functional correctness, not performance).

**Bug #15: Missing ON DELETE on evolution_explanation_id FK**
- Migration: `supabase/migrations/20260322000005_fix_explanation_fk.sql`
  ```sql
  -- First, discover and drop the actual constraint name (may be auto-generated)
  -- The consolidation migration at 20260321000002 line 30 creates it inline without a name,
  -- so Postgres auto-generates a name like 'evolution_variants_evolution_explanation_id_fkey'.
  -- Use DO block to handle any name:
  DO $$
  DECLARE
    constraint_name TEXT;
  BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'evolution_variants'::regclass
      AND confrelid = 'evolution_explanations'::regclass;

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE evolution_variants DROP CONSTRAINT %I', constraint_name);
    END IF;
  END $$;

  -- Step 2: Add new constraint as NOT VALID (no lock on existing rows)
  ALTER TABLE evolution_variants
    ADD CONSTRAINT evolution_variants_evolution_explanation_id_fkey
    FOREIGN KEY (evolution_explanation_id) REFERENCES evolution_explanations(id)
    ON DELETE SET NULL
    NOT VALID;

  -- Step 3: Validate separately (takes SHARE UPDATE EXCLUSIVE, allows reads/writes)
  ALTER TABLE evolution_variants
    VALIDATE CONSTRAINT evolution_variants_evolution_explanation_id_fkey;
  -- ROLLBACK: DROP CONSTRAINT evolution_variants_evolution_explanation_id_fkey;
  --           ADD CONSTRAINT without ON DELETE (restore original behavior)
  ```
- This two-step approach (NOT VALID then VALIDATE) minimizes lock duration for production safety.
- Test: Integration test that creates an evolution_explanation, creates a variant referencing it, deletes the explanation, and verifies variant.evolution_explanation_id is now NULL.

**Documentation updates** (5 stale docs):
- `evolution/docs/evolution/data_model.md` — Remove evolution_arena_entries section, add 11 new columns to evolution_variants (mu, sigma, prompt_id, synced_to_arena, arena_match_count, generation_method, model, cost_usd, archived_at, evolution_explanation_id), update entity relationships, update sync_to_arena RPC description
- `evolution/docs/evolution/architecture.md` — Update file references: `arena.ts` → `buildRunContext.ts` (loadArenaEntries) and `persistRunResults.ts` (syncToArena). Update key file table.
- `evolution/docs/evolution/arena.md` — Rewrite to reflect consolidated schema (evolution_variants with synced_to_arena=true). Update function locations and query patterns.
- `evolution/docs/evolution/reference.md` — Update file inventory: remove arena.ts, add buildRunContext.ts and persistRunResults.ts arena functions
- `evolution/docs/evolution/rating_and_comparison.md` — Remove evolution_arena_entries references

## Pre-deployment Verification

Before merging to main (which triggers automatic migration deployment via supabase-migrations.yml):
1. Test all migrations against local Supabase instance: `supabase db reset && supabase migration up`
2. Verify each migration has a rollback comment
3. Run `npm test` (unit), `npm run test:integration` (integration), and `npm run test:e2e -- --grep "evolution"` (E2E) locally
4. Verify no existing tests are broken by the changes

## Rollback Strategy

Each migration file includes a rollback comment. If a migration fails:
1. Bug #1 RPC: Restore original claim_evolution_run from 20260315000001
2. Bug #4 RPC: Drop complete_experiment_if_done function (no existing behavior changes)
3. Bug #6 CHECK: `ALTER TABLE evolution_runs DROP CONSTRAINT chk_budget_cap`
4. Bug #13 INDEX: `DROP INDEX IF EXISTS idx_variants_arena_leaderboard`
5. Bug #15 FK: Drop and re-add constraint without ON DELETE clause

TypeScript changes are backward-compatible — the code handles both old and new schemas gracefully via Zod union transforms and null coalescing.

## Testing

### Unit Tests (new/modified)
- `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — mock RPC receives p_max_concurrent, concurrent claims rejected
- `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — LLM error → no rating change (confidence 0 skips updateDraw), 4 consecutive errors → early break
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — muHistory number[][] passes Zod, arena filtering in summary, empty local pool → completed not failed, error re-throw for non-duplicate, winner mapping comment, runner_id check count=0 → skip persistence
- `evolution/src/lib/pipeline/manageExperiments.test.ts` — budget Zod rejection >$10, sibling run check
- `evolution/src/services/experimentActionsV2.test.ts` — createExperimentWithRunsAction partial failure cleanup
- `evolution/src/services/evolutionActions.test.ts` — pagination params, return shape {items, total}
- `evolution/src/lib/pipeline/infra/createLLMClient.test.ts` — pricing matches global config for all models

### Integration Tests
> **Note:** Integration test files MUST use `.integration.test.ts` suffix per `jest.integration.config.js` testMatch pattern. Files without this suffix are silently ignored by `npm run test:integration`.

- `src/__tests__/integration/evolution-claim.integration.test.ts` — call claim_evolution_run RPC twice concurrently with limit=1, verify second returns empty
- `src/__tests__/integration/evolution-experiment-completion.integration.test.ts` — complete_experiment_if_done RPC with NOT EXISTS check
- `src/__tests__/integration/evolution-budget-constraint.integration.test.ts` — CHECK constraint rejects budget > $10

### E2E Tests
- `src/__tests__/e2e/specs/09-admin/admin-evolution-v2.spec.ts` — runs list pagination (verify page controls, total count)
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — verify arena leaderboard loads correctly post-migration
- `src/__tests__/e2e/specs/09-admin/admin-experiment-wizard.spec.ts` — new spec for experiment creation flow (success + partial failure)

### Cross-Phase Regression Test
After all 4 phases are complete, run the full test suite before creating PR:
```bash
npm test && npm run test:integration && npm run test:e2e -- --grep "evolution|arena"
```

### Manual Verification on Stage
- Run evolution pipeline and verify muHistory appears as 2D array in run detail charts
- Create experiment with 3 strategies, verify auto-completion only after all runs done
- Verify arena leaderboard query performance with `EXPLAIN ANALYZE`
- Attempt to create run with budget > $10 via direct API call → verify rejection

## Documentation Updates
The following docs were identified as relevant and need updates:
- `evolution/docs/evolution/data_model.md` — Remove dropped table, add new columns, update RPCs
- `evolution/docs/evolution/architecture.md` — Fix file references
- `evolution/docs/evolution/arena.md` — Rewrite for consolidated schema
- `evolution/docs/evolution/reference.md` — Update file inventory
- `evolution/docs/evolution/rating_and_comparison.md` — Remove stale table references
