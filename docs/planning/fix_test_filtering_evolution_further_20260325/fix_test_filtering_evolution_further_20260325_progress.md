# Fix Test Filtering Evolution Further Progress

## Phase 1: Dashboard Overview Filter (Complete)
### Work Done
- Added `filterTestContent` parameter to `getEvolutionDashboardDataAction`
- Added "Hide test content" checkbox to dashboard page (default: checked)
- Inner join filtering on status counts, recent runs, and cost aggregation
- Added 3 unit tests for page component, 1 for action

## Phase 2: Replace !inner Joins with Two-Step Queries (Complete)
### Work Done
- Diagnosed root cause via direct PostgREST queries against staging
- Found HTTP 300 (PGRST201) due to ambiguous FK: `evolution_runs_strategy_config_id_fkey` + `fk_runs_strategy`
- Replaced all `!inner` join queries with two-step approach:
  - `getEvolutionRunsAction` — fetch test strategy IDs, exclude via `.not('strategy_id', 'in', ...)`
  - `listVariantsAction` — fetch test strategy IDs → test run IDs, exclude via `.not('run_id', 'in', ...)`
  - `listInvocationsAction` — same pattern as variants
  - `getEvolutionDashboardDataAction` — same pattern for status, recent, and cost queries
- Updated all corresponding unit tests (98 tests pass across 5 suites)

### Issues Encountered
- `createTableAwareMock` uses sequential call counting — had to carefully match query creation order
- Dashboard action cost query order preserved for non-filter path to keep existing tests passing

## Phase 3: Drop Duplicate FK Constraint (Complete)
### Work Done
- Added migration `20260325000001_drop_duplicate_strategy_fk.sql`
- Drops legacy `evolution_runs_strategy_config_id_fkey`, keeps only `fk_runs_strategy`

## Phase 4: Integration Tests (Complete)
### Work Done
- Added `evolution-test-content-filter.integration.test.ts` with 4 tests:
  1. Two-step filter excludes test runs and keeps real runs
  2. Filter returns all runs when no test strategies match pattern
  3. PostgREST inner join with explicit FK hint does not return HTTP 300
  4. Plain `.not(strategy_id)` filter works without FK dependency
- All 4 integration tests pass against real Supabase staging DB
