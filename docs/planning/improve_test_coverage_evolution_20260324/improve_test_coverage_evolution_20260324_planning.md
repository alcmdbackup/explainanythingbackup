# Improve Test Coverage Evolution Plan

## Background
The evolution dashboard currently has ~1,401 test cases across 94+ test files (~79% file coverage). While breadth is reasonable, critical gaps exist: 8 source files have zero tests, many page-level tests are shallow (presence-only, no interactions), integration tests miss key workflows (arena comparisons, full experiment lifecycle, metrics recomputation), and E2E tests cover only ~56% of admin pages with almost no tab-content or filter-interaction validation.

## Requirements (from GH Issue #NNN)
Comprehensive coverage of all evolution admin pages, tabs, actions, and services — including unit, integration, and E2E tests across all evolution dashboard components.

## Problem
The evolution dashboard has significant test coverage gaps that create risk for regressions. Eight source files have zero test coverage, including the metricsActions server actions (2 actions with stale-recomputation logic), the entityRegistry singleton (8 exports with validation), and two detail pages. Existing page tests are predominantly shallow — verifying DOM presence without testing user interactions, filter changes, tab content, or error states. Integration tests lack coverage of critical end-to-end workflows like the full experiment lifecycle and arena comparison pipeline.

## Options Considered

1. **Bottom-up: New test files first, then deepen existing** — Create all 8 missing test files, then systematically deepen shallow tests. Ensures no blind spots remain before improving quality.
2. **Top-down: E2E first, then unit/integration** — Start with E2E coverage for missing pages, then backfill unit and integration tests. Catches user-visible issues first.
3. **Risk-prioritized: Critical paths first** — Address highest-risk gaps first (metricsActions, entityRegistry, experiment lifecycle integration), then fill remaining gaps. Maximizes safety per hour invested.

**Chosen approach:** Option 3 (risk-prioritized), organized into 8 phases that can each be independently implemented, tested, and committed.

## Phased Execution Plan

### Phase 1: Missing Unit Test Files — Server Actions & Core (HIGH PRIORITY)
Create test files for the most critical untested code.

**New files:**
1. `evolution/src/services/metricsActions.test.ts` (~30 tests)
   - `getEntityMetricsAction`: admin auth, UUID validation, valid entityType, DB read success, stale row detection → recomputation → fresh read, DB errors on initial/fresh read
   - `getBatchMetricsAction`: admin auth, empty entityIds/metricNames early return, valid batch fetch, Map→Record conversion, DB errors
   - Mock pattern: `createTableAwareMock()` from service-test-mocks.ts, mock `recomputeStaleMetrics`

2. `evolution/src/lib/core/entityRegistry.test.ts` (~25 tests)
   - Lazy init: null until first `getEntity()`, singleton pattern (same instance on repeat calls)
   - All 6 entity types instantiated correctly (run, strategy, experiment, variant, invocation, prompt)
   - `validateEntityRegistry()`: duplicate metric detection, propagation source entity validation, source metric validation, dynamic prefix allowance
   - `getAllEntityMetricDefs()`, `getEntityListViewMetrics()`, `getEntityMetricDef()`, `isValidEntityMetricName()`
   - `_resetRegistryForTesting()` resets singleton

3. `evolution/src/lib/core/agents/GenerationAgent.test.ts` (~8 tests)
   - `name` and `executionDetailSchema` properties
   - `execute()` delegates to `generateVariants()` with correct params
   - Feedback forwarding (present and absent)
   - Error propagation (BudgetExceededError)
   - Mock: `jest.mock('../../pipeline/loop/generateVariants')`

4. `evolution/src/lib/core/agents/RankingAgent.test.ts` (~10 tests)
   - `name` and `executionDetailSchema` properties
   - `execute()` delegates to `rankPool()` with all 9 parameters
   - Map instances preserved (ratings, matchCounts, cache)
   - RankResult structure validation
   - Mock: `jest.mock('../../pipeline/loop/rankVariants')`

### Phase 2: Missing Component & Page Test Files (HIGH PRIORITY)
Create test files for untested UI components and pages.

**New files:**
5. `evolution/src/components/evolution/EvolutionErrorBoundary.test.tsx` (~6 tests)
   - Renders error.message text
   - Renders "Try again" button
   - Calls reset() on button click
   - Styled with status-error color

6. `evolution/src/components/evolution/EntityDetailPageClient.test.tsx` (~15 tests)
   - Loading state: breadcrumb with "Loading...", skeleton placeholders
   - Success state: breadcrumb with title, EntityDetailHeader with all config props, EntityDetailTabs, tab content via renderTabContent
   - Error state: error message display, toast.error called, "Entity not found" fallback
   - Reload callback clears error and retries
   - Rename handler calls config.onRename and reloads
   - Tab switching via useTabState
   - Mock: child components, useTabState, sonner toast

7. `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx` (~10 tests)
   - Loading state
   - Success: breadcrumb, header with strategy name, status badge (active/archived)
   - 3 tabs render (Metrics, Configuration, Logs)
   - Config tab renders StrategyConfigDisplay + optional description
   - Error/not found state
   - Mock: `getStrategyDetailAction`, follow existing page test pattern

8. `src/app/admin/evolution/prompts/[promptId]/page.test.tsx` (~8 tests)
   - Loading state
   - Success: breadcrumb, header, MetricGrid (Status, Created), prompt text in pre block
   - EntityMetricsTab with correct entityType/entityId
   - Error/not found state
   - Mock: `getPromptDetailAction`, follow existing page test pattern

### Phase 3: Deepen Shallow Component Tests (MEDIUM PRIORITY)
Add missing scenarios to existing test files with < 5 test cases.

**Enhance existing files:**
9. `evolution/src/components/evolution/tabs/MetricsTab.test.tsx` (3 → ~18 tests)
   - Top Variants table: rendering, rank numbering, baseline marker, mu formatting
   - Strategy Effectiveness table: sorting by avgMu, count display
   - Cost by Agent table: agent/calls/cost columns, formatCost
   - Metric grid: all 8 metrics with edge values (0, null, large numbers)
   - Loading pulse animation, dependency refetch on runId change

10. `evolution/src/components/evolution/tabs/RelatedRunsTab.test.tsx` (2 → ~10 tests)
    - Column rendering (4 columns: id truncated, status badge, cost "$X.XX"/"-", created date)
    - Multiple runs display, row click navigation via buildRunUrl
    - Fetch failure handling, null evolution_runs array
    - Status badge integration (correct status prop)

11. `evolution/src/components/evolution/VariantDetailPanel.test.tsx` (3 → ~8 tests)
    - All metadata fields display
    - Match count, creation timestamp
    - Navigation to parent variants

12. `evolution/src/components/evolution/tabs/LogsTab.test.tsx` (8 → ~14 tests)
    - Filter interaction: apply level filter, search by message, filter by variant ID
    - Pagination: next/previous page
    - Log entry entity-type badges display
    - Expandable JSON context viewer

### Phase 4: Deepen Shallow Page Tests (MEDIUM PRIORITY)
Add interactions, error states, and filter testing to existing page tests.

**Enhance existing files:**
13. Dashboard page test (4 → ~10 tests): auto-refresh, error state, metric value accuracy, empty state message
14. Start experiment page test (3 → ~8 tests): form step navigation, strategy selection, submission
15. Runs list page test (6 → ~12 tests): filter change handlers, pagination, error states
16. Strategies list page test (6 → ~12 tests): create/edit/clone/archive dialog workflows, toast verification
17. Prompts list page test (6 → ~10 tests): CRUD dialog interactions, form validation
18. Invocations list page test (6 → ~10 tests): seeded data display, pagination, detail navigation
19. Variants list page test (7 → ~12 tests): filter interactions, agent name filter, winner filter
20. Arena list page test (7 → ~10 tests): status filter interaction, topic navigation

### Phase 5: Deepen Server Action Tests (MEDIUM PRIORITY)
Add edge cases and missing scenarios to existing action tests.

**Enhance existing files:**
21. `logActions.test.ts` (9 → ~16 tests): filter combinations (level + variant + search), case sensitivity, unknown entity types, null filters, message truncation
22. `arenaActions.test.ts` (20 → ~28 tests): pagination (limit/offset), Elo edge cases (negative, zero, very high), entry count with zero entries, archived entry handling
23. `evolutionActions.test.ts` (24 → ~30 tests): pagination boundaries (offset ≥ total, limit=0), archive/unarchive idempotency
24. `experimentActions.test.ts` (21 → ~27 tests): batch partial failure, filter combinations, empty experiment handling
25. `costAnalytics.test.ts` (19 → ~25 tests): invalid date formats, negative costs, precision rounding, batch size validation

### Phase 6: New Integration Tests (HIGH PRIORITY)
Create integration tests for critical untested workflows.

**New files:**
26. `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` (~8 tests)
    - Insert metrics with stale=true → call getEntityMetricsAction → verify recomputation triggered → verify fresh values returned
    - SKIP LOCKED concurrent safety (two requests, only one recomputes)
    - Propagated metrics: run finalization → strategy aggregate update

27. `src/__tests__/integration/evolution-experiment-full-lifecycle.integration.test.ts` (~6 tests)
    - Create experiment → add runs → mark runs completed → verify auto-completion via RPC
    - Cancel experiment → verify pending/claimed/running runs cancelled, completed unchanged
    - Strategy aggregate updates cascade correctly

28. `src/__tests__/integration/evolution-arena-comparison.integration.test.ts` (~6 tests)
    - Sync variants to arena → create comparisons → verify Elo updates
    - Multi-prompt arena isolation (entries scoped to correct prompt)
    - Over-limit rejection (201 entries vs 200 limit)

29. `src/__tests__/integration/evolution-cost-cascade.integration.test.ts` (~5 tests)
    - Create invocations with costs → verify run total via RPC → verify strategy aggregate update
    - Null cost handling (total_cost unchanged)

30. `src/__tests__/integration/evolution-visualization-data.integration.test.ts` (~5 tests)
    - Dashboard metrics aggregation from multiple runs
    - Elo history extraction from run_summary
    - Lineage graph construction from variants

### Phase 7: Deepen E2E Tests (MEDIUM PRIORITY)
Add tab content validation and filter interaction to existing E2E specs.

**Enhance existing specs:**
31. `admin-evolution-runs.spec.ts` (4 → ~8 tests): tab content validation (click each tab, verify content loads), filter result verification
32. `admin-evolution-logs.spec.ts` (1 → ~4 tests): apply level filter and verify filtered results, search by message text
33. `admin-evolution-invocations.spec.ts` (1 → ~4 tests): seed invocation data, verify row display, navigate to detail
34. `admin-evolution-dashboard.spec.ts` (2 → ~5 tests): metric value assertions, recent runs table row data

**New E2E specs:**
35. `admin-evolution-variants.spec.ts` (~5 tests): variants list page load, filter by agent/winner, navigate to detail, detail page tabs (content, metrics, lineage)
36. `admin-evolution-experiments-list.spec.ts` (~4 tests): experiments list page, status filter, navigate to detail, experiment detail tabs
37. `admin-evolution-invocation-detail.spec.ts` (~4 tests): invocation detail page, success/failed badge, metrics display, logs tab

### Phase 8: Test Infrastructure Improvements (LOW PRIORITY)
Improve test helpers and factories for maintainability.

38. Add `createTestArenaComparison()` to evolution-test-data-factory.ts
39. Add `createTestEvolutionLog()` to evolution-test-data-factory.ts
40. Add `createTestBudgetEvent()` to evolution-test-data-factory.ts
41. Add `mockLlmError()`, `mockLlmTimeout()` to v2MockLlm.ts
42. Migrate 3 E2E specs (runs, strategy-crud, prompt-registry) from direct Supabase inserts to factory functions
43. Standardize on `[TEST_EVO]` prefix across all evolution E2E tests

## Testing

This project IS the testing — all deliverables are test files. Verification approach:

**Per-phase verification:**
- Run `npm test -- <new-test-file>` after each new file
- Run `npm run lint` and `npx tsc --noEmit` after each phase
- Run `npm run build` after phases with page changes

**Final verification:**
- `npm test -- evolution/` — all evolution unit tests pass
- `npm run test:integration:evolution` — all evolution integration tests pass
- `npm run test:e2e:evolution` — all evolution E2E tests pass
- `npm run test:coverage -- evolution/` — verify coverage improvement

**Expected test count increase:**
- Current: ~1,401 test cases
- Target: ~1,750+ test cases (~25% increase)
- New test files: 14
- Enhanced test files: 21

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - Update test statistics (unit/integration/E2E counts)
- `docs/feature_deep_dives/testing_setup.md` - Update test counts, add new test file paths to directory listing
- `docs/docs_overall/environments.md` - Reference for test environment config (no changes needed)
- `evolution/docs/architecture.md` - Reference for evolution pipeline architecture (no changes needed)
- `docs/feature_deep_dives/evolution_logging.md` - No changes needed
- `docs/feature_deep_dives/evolution_metrics.md` - Add note about metricsActions test coverage

## Key Files Modified/Created

### New Test Files (14)
- `evolution/src/services/metricsActions.test.ts`
- `evolution/src/lib/core/entityRegistry.test.ts`
- `evolution/src/lib/core/agents/GenerationAgent.test.ts`
- `evolution/src/lib/core/agents/RankingAgent.test.ts`
- `evolution/src/components/evolution/EvolutionErrorBoundary.test.tsx`
- `evolution/src/components/evolution/EntityDetailPageClient.test.tsx`
- `src/app/admin/evolution/strategies/[strategyId]/page.test.tsx`
- `src/app/admin/evolution/prompts/[promptId]/page.test.tsx`
- `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts`
- `src/__tests__/integration/evolution-experiment-full-lifecycle.integration.test.ts`
- `src/__tests__/integration/evolution-arena-comparison.integration.test.ts`
- `src/__tests__/integration/evolution-cost-cascade.integration.test.ts`
- `src/__tests__/integration/evolution-visualization-data.integration.test.ts`
- `src/__tests__/e2e/specs/09-admin/admin-evolution-variants.spec.ts`

### Enhanced Test Files (21)
- MetricsTab, RelatedRunsTab, VariantDetailPanel, LogsTab (component deepening)
- Dashboard, start-experiment, runs, strategies, prompts, invocations, variants, arena page tests (page deepening)
- logActions, arenaActions, evolutionActions, experimentActions, costAnalytics (action deepening)
- admin-evolution-runs, logs, invocations, dashboard E2E specs (E2E deepening)
- evolution-test-data-factory.ts, v2MockLlm.ts (infrastructure)
