# Find Bugs Evolution Progress

## Phase 1: Pipeline Core (Bugs #1, #2, #5) ✅
### Work Done
- Bug #1: Created migration `20260322000001_fix_claim_concurrent_limit.sql` with advisory lock. Removed client-side count check from `claimAndExecuteRun.ts`, now passes `p_max_concurrent` to RPC.
- Bug #2: Fixed silent Elo corruption in `rankVariants.ts` — confidence-0 matches skip rating updates in both triage and fine-ranking. Added consecutive error tracking (>3 → early break).
- Bug #5: Removed hardcoded `MODEL_PRICING` from `createLLMClient.ts`, now imports `getModelPricing` from shared `src/config/llmPricing.ts`. DeepSeek pricing corrected from $0.27/$1.10 to $0.14/$0.28.
- All 51 tests pass (46 existing + 5 new).

## Phase 2: Finalization (Bugs #3, #8, #9, #11, #12, #14) ✅
### Work Done
- Bug #3: Updated `EvolutionRunSummary.muHistory` type from `number[]` to `number[][]`. Added `z.union` in Zod schema for backward compat. Updated V1→V3 and V2→V3 transforms. Updated visualization consumer.
- Bug #8: Variant upsert now re-throws non-23505 errors. Arena sync retries once with 2s delay.
- Bug #9: `buildRunSummary` now receives filtered `localPool` instead of full result.
- Bug #11: Arena-only pool (localPool=0, total pool>0) marks run as completed with `stopReason: 'arena_only'`.
- Bug #12: Draw entries normalized to sorted order. Confidence-0 matches filtered from arena sync.
- Bug #14: Added `runnerId` param to `finalizeRun`. Status update checks `runner_id` and verifies affected rows > 0.
- All 27 tests pass (16 existing + 11 new).

## Phase 3: Experiments & Admin (Bugs #4, #6, #7, #10) ✅
### Work Done
- Bug #4: Created migration `20260322000002_fix_experiment_auto_completion.sql` with `complete_experiment_if_done` RPC using NOT EXISTS check. Updated `persistRunResults.ts` to call RPC.
- Bug #6: Added Zod schema to `addRunToExperimentAction` (budget_cap_usd: positive, max 10). Created migration `20260322000003_add_budget_check_constraint.sql`.
- Bug #7: Created `createExperimentWithRunsAction` in `experimentActionsV2.ts` with rollback on failure. Updated `ExperimentForm.tsx` to use batch action.
- Bug #10: Added `limit`/`offset` params to `getEvolutionRunsAction`, returns `{ items, total }`. Updated runs page with pagination controls.
- All 75 tests pass (53 existing + 22 new).

## Phase 4: Schema & Docs (Bugs #13, #15, 5 docs) ✅
### Work Done
- Bug #13: Created migration `20260322000004_add_arena_indexes.sql` with CONCURRENTLY index on `(prompt_id, mu DESC)` where `synced_to_arena=true`.
- Bug #15: Created migration `20260322000005_fix_explanation_fk.sql` with ON DELETE SET NULL using NOT VALID + VALIDATE approach.
- Updated 5 evolution docs to reflect consolidated schema.

## Verification
- 144 tests pass across 7 test suites
- tsc: only 1 pre-existing error (expect-type module)
- lint: clean
- build: success
