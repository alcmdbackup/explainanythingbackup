# Fix Test Filtering Evolution Further Plan

## Background
The evolution admin dashboard pages use PostgREST `!inner` joins to filter out test content (runs/variants/invocations linked to strategies with `[TEST]` in their name). On staging, these queries fail with HTTP 300 (PGRST201) because there are two FK constraints from `evolution_runs.strategy_id` → `evolution_strategies.id`, making the relationship ambiguous. The dashboard overview page was also missing the filter entirely.

## Requirements
1. Fix: evolution dashboard overview page missing test content filter entirely (done Phase 1)
2. Fix: all `!inner` join queries that fail due to ambiguous FK
3. Drop duplicate legacy FK constraint `evolution_runs_strategy_config_id_fkey`
4. Add regression tests to prevent future breakage

## Problem
PostgREST cannot resolve `evolution_strategies!inner(name)` when two FK constraints point from `evolution_runs.strategy_id` to `evolution_strategies.id`. The legacy FK `evolution_runs_strategy_config_id_fkey` predates the migration history; the new FK `fk_runs_strategy` was added in migration `20260324000001`. PostgREST returns HTTP 300, the Supabase client treats this as an error, and the page silently shows 0 results.

## Options Considered

### Option A: Disambiguate the FK in `!inner` join syntax
- Change `evolution_strategies!inner(name)` → `evolution_strategies!fk_runs_strategy(name)`
- Pros: Minimal code change, keeps single-query pattern
- Cons: Fragile — ties code to FK constraint names, still depends on PostgREST schema cache

### Option B: Two-step query (fetch test IDs, then exclude) ← **Chosen**
- Step 1: Query `evolution_strategies` for IDs where `name ilike '%[TEST]%'`
- Step 2: Exclude those IDs using `.not('strategy_id', 'in', '(id1,id2,...)')`
- Pros: No FK dependency, no PostgREST schema cache issues, works regardless of constraint state
- Cons: Extra query per action call (but test strategy count is always small)

### Option C: Drop the duplicate FK only
- Just drop `evolution_runs_strategy_config_id_fkey` via migration
- Pros: Fixes root cause at DB level
- Cons: Doesn't protect against future ambiguity, PostgREST cache delay risk

**Decision: Option B + drop the duplicate FK (Option C) for defense in depth.**

## Phased Execution Plan

### Phase 1: Dashboard Overview Filter ✅ (Complete)
- Added `filterTestContent` parameter to `getEvolutionDashboardDataAction`
- Added "Hide test content" checkbox to dashboard page (default: checked)
- Added unit tests

### Phase 2: Replace !inner Joins with Two-Step Queries ✅ (Complete)
- `getEvolutionRunsAction` — replaced `!inner` join with test strategy ID lookup
- `listVariantsAction` — replaced nested `!inner` join with test run ID lookup
- `listInvocationsAction` — replaced nested `!inner` join with test run ID lookup
- `getEvolutionDashboardDataAction` — replaced `!inner` joins with strategy ID exclusion
- Updated all corresponding tests

### Phase 3: Drop Duplicate FK Constraint
- Add migration to drop `evolution_runs_strategy_config_id_fkey`
- Keep only `fk_runs_strategy` (the one from `20260324000001`)

### Phase 4: Add Integration Test
- Add integration test that verifies the filter queries work end-to-end against real Supabase
- Test should create a test strategy + run, verify filter excludes them, clean up

## Testing

### Unit Tests (Updated in Phase 2)
- `evolutionVisualizationActions.test.ts` — test for `filterTestContent: true` path
- `evolutionActions.test.ts` — test for strategy ID exclusion approach
- `invocationActions.test.ts` — test for run ID exclusion approach
- `page.test.tsx` (dashboard) — checkbox default state + filter param passing

### Integration Test (Phase 4)
- Test `getEvolutionRunsAction` with `filterTestContent: true` against real DB
- Verify it returns data (not 0 results) when non-test runs exist
- Verify it excludes runs linked to `[TEST]` strategies

## Documentation Updates
- `docs/docs_overall/testing_overview.md` — no changes needed (already documents `[TEST]` convention)
- `evolution/docs/architecture.md` — no changes needed (describes pipeline, not admin UI)
