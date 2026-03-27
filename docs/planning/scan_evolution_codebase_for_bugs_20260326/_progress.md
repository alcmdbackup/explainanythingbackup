# Scan Evolution Codebase For Bugs — Progress

## Phase 1: Critical Pipeline Fixes (C1, C2, C3) ✅
- C1: Fixed `fineResult!.converged` null dereference in rankVariants.ts with `?.converged ?? false` + warn log
- C2: Added inline monthly cache check to LLM spending gate fast-path
- C3: Added `else` clause logging for non-budget generation failures in runIterationLoop.ts
- Tests: All 101 tests pass

## Phase 2: Silent UI Error Swallowing (H1, H2) ✅
- H1: Added `toast.error()` on fetch failure in 5 admin pages (arena, runs, variants, invocations, experiments)
- H2: Added error toasts to ExperimentForm for prompts/strategies load failures
- Added toast imports to arena, variants, invocations pages
- Tests: 88 tests pass (6 new error toast tests added to existing test files)

## Phase 3: Metrics Stale Invalidation (H3, H4) ✅
- H3: Created migration `20260326000002_expand_stale_trigger.sql` using CREATE OR REPLACE FUNCTION
- H4: Removed elo-only whitelist in `recomputeMetrics.ts`, updated mock to include all 7 finalization metrics
- Updated test assertions from 4 to 7 metrics, added H4-specific test
- Tests: 10 tests pass

## Phase 4: Arena-Only Summary + Draw Handling (H5, H7) ✅
- H5: Arena-only runs now call `buildRunSummary()` for full summary with matchStats, topVariants
- H7: Added `confidence < 0.3` draw check in triage (consistent with fine-ranking)
- Tests: 89 tests pass (new tests for both fixes)

## Phase 5: Entity Delete + Heartbeat (H6, H8, M11) ✅
- H6: Expanded TODO comment in Entity.ts explaining transactional delete limitation
- H8: Already addressed by C3 fix (no additional change needed)
- M11: Added runner_id parameter to startHeartbeat(), added ownership check + mismatch warning
- Tests: 144 tests pass

## Phase 6: Schema Drift (M3, M4, M5) ✅
- M3: Added comment documenting conditional NOT NULL migration for strategy_id (kept nullable for safety)
- M4: Added `model` and `evolution_explanation_id` to variant schema
- M5: Added `best_final_elo` and `worst_final_elo` to strategy fullDbSchema
- Tests: 181 tests pass

## Phase 7: Server Action Error Handling (M2, M7, M8) ✅
- M2: Added error destructuring + warn log for `get_run_total_cost` RPC
- M7: Added null check for `prompt_id` in arena topic counting, `userId` in cost analytics
- M8: Added error logging for batch update failures in cost backfill
- Tests: 100 tests pass

## Phase 8: Type Safety + Race Condition (M1, M6, M12) ✅
- M1: Upgraded variant loss log from warn to error with variantCount
- M6: Replaced `as unknown as` double cast with explicit select + single cast in 3 locations
- M12: Added error_message to DashboardData type, select query, and mapping
- Tests: 112 tests pass

## Phase 9: Cache + Timeout Cleanup (M9, M10) ✅
- M9: Fixed FIFO/LRU comment in computeRatings.ts (3 locations)
- M10: Added setTimeout handle cleanup in createLLMClient.ts and generateSeedArticle.ts
- Tests: 105 tests pass

## Phase 10: Final Verification ✅
- Lint: 0 errors (2 pre-existing warnings)
- TSC: 0 errors
- Build: Success
- All tests: 4849 passed, 275 suites, 0 failures
