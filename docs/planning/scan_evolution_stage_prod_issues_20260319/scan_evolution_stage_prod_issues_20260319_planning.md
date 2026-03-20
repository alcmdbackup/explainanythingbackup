# Scan Evolution Stage Prod Issues Plan

## Background
Scan the evolution pipeline for discrepancies and bugs between staging and production environments, investigate failures, and fix identified issues.

## Requirements (from GH Issue #735)
Look for mismatches between tables in production and stage, and what the code is relying on for evolution. Use prod supabase query tool to query production. Otherwise, look for any/all types of bugs that could result from our recent migration to evolution V2.

## Problem
The V2 migration (20260315000001) dropped 16 V1 tables and recreated 10 clean V2 tables with simplified schemas. The V2 pipeline runner/finalize/arena code is clean. However, some V2 code paths still reference V1 artifacts (status values, dead table queries), and test infrastructure (helpers, integration tests) uses V1 column names that cause PostgREST 400 errors on INSERT.

## Scope — V2 Only
A separate PR is deprecating ALL V1 code (V1 services, V1 admin UI, V1 tests). This project fixes ONLY V2 code paths and shared test infrastructure.

**In scope (V2 execution path + test infra):**
- EvolutionRunStatus type (shared by V2)
- evolutionRunnerCore.ts (V2 runner entry point)
- evolutionActions.ts queueEvolutionRunAction (V2 run queueing)
- costEstimator.ts (called by V2 pipeline)
- Test helpers used by V2 integration tests
- Arena integration tests (test V2 arena actions)
- Deferred scripts cleanup

**Out of scope (V1 — handled by deprecation PR):**
- experimentActions.ts (V1 — replaced by experimentActionsV2.ts)
- arenaActions.ts V1 column names (V1 arena pages)
- eloBudgetActions.ts (V1 dashboard)
- costAnalyticsActions.ts (V1 cost accuracy)
- evolutionVisualizationActions.ts V1 queries (V1 admin pages) — **confirm** the deprecation PR covers getEvolutionDashboardAction's continuation_pending reference (line 261), since this powers the V2 dashboard landing page
- All V1 UI components and E2E tests
- V1 documentation updates

**PR coordination**: This PR stubs V1-only test helper functions (not deletes) to avoid import breakage. Either PR can merge first without breaking CI.

## Key Technical Note
- **INSERT/UPDATE with non-existent columns → PostgREST 400 error** (hard failure)
- **SELECT with non-existent columns → returns null** (silent)

## Phased Execution Plan

**Regression gate after each phase**: `npx tsc --noEmit` + phase-specific tests. After Phase 3, run `npm test` (full unit suite).

### Phase 1: Fix EvolutionRunStatus type and V2 runner status filters
**Goal**: Align TypeScript types with V2 DB CHECK constraint. Fix V2 runner.

**V2 CHECK**: `status IN ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled')`

**Files to modify:**
- `evolution/src/lib/types.ts:639` — Change to: `'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'`. Adds `cancelled` (was missing), removes `paused` and `continuation_pending` (not in V2).
  - **tsc impact**: `EvolutionStatusBadge.tsx` uses `Record<EvolutionRunStatus, string>` for STATUS_STYLES/STATUS_ICONS — removing union members makes existing keys invalid, and adding `cancelled` requires a new key. Fix: update EvolutionStatusBadge.tsx to (1) remove `paused` and `continuation_pending` keys, (2) add `cancelled` key with appropriate styling (e.g., same as `failed`), (3) update the render ternary (line ~56) to remove the `continuation_pending` special case. Update EvolutionStatusBadge.test.tsx ALL_STATUSES array to match the new 6-value union.
- `evolution/src/services/evolutionRunnerCore.ts:70-78` — Remove `continuation_count` access and isResume guard. V2 has no resume; claim RPC only returns pending runs. Simplify to just use the claimed run directly.
- `evolution/src/services/evolutionRunnerCore.ts:145` — Remove `'continuation_pending'` from markRunFailed status filter. Keep `['pending', 'claimed', 'running']`.
- `evolution/src/services/evolutionRunnerCore.ts:148-160` — Delete dead `cleanupRunner()` function (never called, references V1 `continuation_timeout` concept).
- `evolution/src/services/evolutionActions.ts:605` — Remove `'continuation_pending'` from kill action status filter. Keep `['pending', 'claimed', 'running']`.
- `evolution/src/services/evolutionActions.ts:15-36` — Update `EvolutionRun` interface to match V2 columns. Keep phantom V1 fields as **required with zero-value defaults in consuming code** (not optional — optional breaks strict-mode consumers). The fields remain typed as-is: `phase: string`, `total_cost_usd: number`, etc. Supabase SELECT returns `null` for non-existent columns, and existing consumers already handle falsy values (display `—` or `0`). Add V2 fields: `pipeline_version: string`, `runner_id: string | null`, `run_summary: Record<string, unknown> | null`, `last_heartbeat: string | null`, `config: Record<string, unknown>`. This is the minimal change — V1 field removal from the interface is deferred to the V1 deprecation PR where the consumers (RunsTable.tsx, runs/page.tsx, RelatedRunsTab.tsx, testUtils.ts) are also updated.

**Unit test updates (same phase):**
- Update any test mocks that use `continuation_count` or `continuation_pending`

**Test gate**: `npx tsc --noEmit && npm test -- --testPathPattern="evolutionRunnerCore|evolutionActions"`

### Phase 2: Fix evolution_runs INSERT in queueEvolutionRunAction
**Goal**: Fix V2 run queueing (currently broken — PostgREST 400 on INSERT with non-existent columns).

**V2 evolution_runs columns**: id, explanation_id, prompt_id, experiment_id, strategy_config_id, config, status, pipeline_version, runner_id, error_message, run_summary, last_heartbeat, archived, created_at, completed_at.

**Files to modify:**
- `evolution/src/services/evolutionActions.ts:315-335` — In queueEvolutionRunAction:
  - Remove the entire evolution_explanations insert block (lines 315-327). This code inserts into evolution_explanations and assigns the ID to evolution_explanation_id on the run INSERT. The table still exists but the V2 evolution_runs has no evolution_explanation_id column, so line 335 causes a hard PostgREST 400 error on every successful evo-explanation insert.
  - Remove from INSERT row: `budget_cap_usd`, `estimated_cost_usd`, `cost_estimate_detail`, `source`, `evolution_explanation_id` — none exist in V2. All cause PostgREST 400 on INSERT.
  - Note: `budgetCap` variable (line 225) is still computed and stored in `config.budgetCapUsd` via buildRunConfig (line 284). The budget guard (lines 275-280) still works — it just no longer persists as a top-level column.
  - Keep: `config`, `explanation_id`, `prompt_id`, `strategy_config_id`
  - Cost estimation is still called at queue time — results are returned to the UI for display but no longer persisted to the runs table.

**Unit test updates (same phase):**
- `evolution/src/services/evolutionActions.test.ts` — Update mock INSERT data. Remove evolution_explanations mocks.

**Test gate**: `npx tsc --noEmit && npm test -- --testPathPattern="evolutionActions"`

### Phase 3: Stub costEstimator dropped table queries
**Goal**: Remove dead network calls to non-existent evolution_agent_cost_baselines table.

**Files to modify:**
- `evolution/src/lib/core/costEstimator.ts:85-123` — `getAgentBaseline()`: Return null immediately. Add comment: `// V2: evolution_agent_cost_baselines dropped. Heuristic fallback used.`
- `evolution/src/lib/core/costEstimator.ts:318-411` — `refreshAgentCostBaselines()`: Return `{ updated: 0, errors: [] }` immediately.

**Behavioral notes:**
- Cost estimation confidence will always be 'low' (no baselines available)
- llmClient.ts preloadOutputRatios() becomes a no-op (falls back to default ratio)
- estimateRunCostWithAgentModels() still works via heuristic calculation

**Unit test updates (same phase):**
- `evolution/src/lib/core/costEstimator.test.ts` — Update tests for stubbed functions

**Test gate**: `npx tsc --noEmit && npm test -- --testPathPattern="costEstimator"`
**Cross-phase regression**: `npm test` (full unit suite)

### Phase 4: Fix shared test helpers for V2 schema
**Goal**: Fix test infrastructure so integration tests can run against V2 schema.

**Files to modify:**
- `evolution/src/testing/evolution-test-helpers.ts`:
  - `cleanupEvolutionData()`:
    - Line 100: Remove `evolution_checkpoints` delete (table dropped)
    - Lines 85-95: Remove `evolution_explanation_id` collection from evolution_runs (column doesn't exist in V2, SELECT returns null)
    - Lines 112-115: Remove `evolution_explanations` delete and the `evolutionExplanationsTableExists` guard (V1-only cleanup path)
  - `createTestEvolutionRun()`:
    - Remove the entire evolution_explanations code path (lines ~225-248): the `evolutionExplanationsTableExists()` guard, `createTestEvolutionExplanation()` call, and `evolution_explanation_id` row assignment
    - Remove `budget_cap_usd` from INSERT row — causes PostgREST 400
    - Update JSDoc to remove "dual-column coexistence" reference
  - `createTestEvolutionExplanation()`: Stub to return undefined (not delete — V1 tests may still import it until deprecation PR lands)
  - `createTestCheckpoint()` (lines 321-368): Stub to return undefined (same reason)
  - `assertEvolutionExplanationSync()`: Stub to return void (same reason — avoids import breakage in evolution-explanations.integration.test.ts until V1 deprecation PR)
- `src/__tests__/integration/evolution-actions.integration.test.ts`:
  - Line 138: Remove `budget_cap_usd` assertion (column removed in Phase 2). Remove or rewrite the 'uses custom budget cap' test case — budget is now in config JSONB.

**Blast radius**: This helper is imported by ~7 integration test files. The changes make it V2-compatible. Stubbing (not deleting) V1-only functions avoids import breakage in V1 tests that will be removed by the deprecation PR.

**Sequencing note**: If the V1 deprecation PR lands first, the stubs become dead code and can be deleted. If this PR lands first, the stubs keep V1 tests importable (though their assertions may fail — expected).

**Test gate**: `npm run test:integration` (run ALL integration tests to verify no regressions). Expected: V1-specific tests (evolution-explanations) may still fail on assertion — this is expected and will be resolved by the deprecation PR.

### Phase 5: Fix arena integration tests for V2 schema
**Goal**: Arena integration tests pass against V2 schema.

**V2 column mappings:**
- `evolution_arena_elo` (DROPPED) → mu/sigma/elo_rating on `evolution_arena_entries`
- `evolution_arena_entries`: `total_cost_usd` → `cost_usd`, `evolution_run_id` → `run_id`, `evolution_variant_id` → `variant_id`, `deleted_at` → `archived_at`, `metadata` → removed
- `evolution_arena_comparisons`: `entry_a_id` → `entry_a`, `entry_b_id` → `entry_b`, `winner_id` (UUID) → `winner` (TEXT: 'a'/'b'/'draw'), `judge_model` → removed, `dimension_scores` → removed

**Files to modify:**
- `src/__tests__/integration/arena-actions.integration.test.ts`:
  - **cleanupAll()**: Remove `evolution_arena_elo` deletes, remove `evolution_checkpoints` delete. Fix comparisons cleanup to use `entry_a`/`entry_b`.
  - **insertEntry()** helper: Rename `total_cost_usd` → `cost_usd`, `evolution_run_id` → `run_id`, `evolution_variant_id` → `variant_id`. Remove `metadata`.
  - **insertComparison()** helper: Rename `entry_a_id` → `entry_a`, `entry_b_id` → `entry_b`, change `winner_id` (UUID) → `winner` (TEXT). Remove `judge_model`, `dimension_scores`.
  - **insertEvolutionRun()** helper: Remove `budget_cap_usd` from INSERT (not in V2).
  - **insertElo()** helper: Delete entirely (table dropped).
  - **Test 3** (Elo init): Verify mu/sigma on arena_entries directly.
  - **Test 4** (soft-delete cascade): Remove elo assertions, verify entries cleanup.
  - **Test 5** (topic cascade): Remove elo assertions.
  - **Test 8** (generation methods): Query elo_rating from arena_entries directly.
  - **Test 9** (mu/sigma CI): Insert mu/sigma into arena_entries, verify retrieval.

**Test gate**: `npm run test:integration -- --testPathPattern="arena-actions"`

### Phase 6: Cleanup deferred scripts
**Goal**: Remove dead V1 scripts.

**Files to delete:**
- `scripts/query-elo-baselines.ts` — V1 script, references evolution_arena_elo
- `evolution/scripts/deferred/` — Delete directory contents (4 scripts reference evolution_arena_elo, none deployed).
  - **Exception**: Check if `evolution/scripts/run-evolution-local.ts` imports from `./deferred/lib/arenaUtils`. If so, either inline the needed function or update the import before deleting.

**Verification**: `grep -r "deferred" .github/ evolution/deploy/ evolution/scripts/run-evolution-local.ts` to confirm no CI/cron/script references.

**Test gate**: `npm run lint && npx tsc --noEmit`

### Phase 7: Full verification
**Goal**: Confirm everything works together.

**Steps:**
1. Run full check suite: `npm run lint && npx tsc --noEmit && npm run build && npm test && npm run test:integration`
2. If `.env.prod.readonly` is available, query prod feature_flags table and compare with dev

## Testing

### Unit tests to modify (per phase):
- **Phase 1**: evolutionRunnerCore.test.ts, evolutionActions.test.ts (status mocks)
- **Phase 2**: evolutionActions.test.ts (V2 INSERT columns)
- **Phase 3**: costEstimator.test.ts (stubbed functions)

### Test infrastructure to fix:
- **Phase 4**: evolution-test-helpers.ts (V2 column alignment)

### Integration tests to rewrite:
- **Phase 5**: arena-actions.integration.test.ts (V2 schema)

### Manual verification:
- Queue a test evolution run and verify it completes (validates Phase 2 fix)
- Verify cost estimation returns heuristic values (validates Phase 3)

## Documentation Updates
Not in scope — V1 docs will be rewritten by the deprecation PR. V2 docs (evolution/docs/evolution/) are already accurate for the V2 pipeline code.
