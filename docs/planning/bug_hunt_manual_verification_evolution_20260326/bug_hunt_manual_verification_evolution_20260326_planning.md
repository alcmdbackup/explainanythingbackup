# Bug Hunt Manual Verification Evolution Plan

## Background
Manual verification of the evolution admin UI using Playwright MCP revealed 40 bugs across all evolution admin pages. The bugs span data integrity, filter logic, UI/UX, and accessibility.

## Requirements
Fix all 40 bugs discovered during the Playwright manual verification crawl (documented in `_progress.md`). Prioritize data integrity (CRITICAL) first, then work down to accessibility (LOW).

## Problem
The evolution admin UI has multiple categories of bugs:
1. **Data integrity**: Cost metrics never persist at run level because finalization metrics writes fail silently. Elo history is truncated. Ranking invocations incorrectly show "failed".
2. **Filter logic**: "Hide test content" filter is inconsistent — metric cards ignore it, plain "Test" names bypass it, stale experiments aren't handled.
3. **UI/UX**: UUIDs shown instead of human-readable names, truncated columns, match count discrepancies, hardcoded iteration filters, inconsistent date formats.
4. **Accessibility**: Flash of empty state, missing aria attributes, no alt text on lineage graph, empty column headers during loading.

## Root Cause Analysis

### Cost propagation failure chain
1. `persistRunResults.ts:260` — catch block swallows metrics write errors, only logs warning
2. `runIterationLoop.ts:218` — same pattern for execution metrics during iteration loop
3. Run-level `cost` metric IS defined during execution (registry.ts line 66, written in runIterationLoop.ts line 211), but the catch block at line 218 swallows the write error — so the cost metric never lands in `evolution_metrics`
4. `propagateMetrics` (lines 302-336) queries for `sourceMetric: 'cost'` from `sourceEntity: 'run'` — but since the source metric was never written (swallowed error), propagation produces $0 silently
5. **Root cause to investigate**: WHY does `writeMetric` fail? Possible causes: DB constraint violation, missing table row, permission error, or network timeout. Must diagnose before fixing.
6. Note: Invocation-level cost exists in `evolution_agent_invocations.cost_usd` column but is NOT part of the metrics registry pipeline — it's a direct column, not a metric entity. The `get_run_total_cost` RPC and `evolution_run_costs` view can aggregate it as a fallback.

### Elo history truncation
1. `persistRunResults.ts:83` — `muHistory` explicitly reduced: `result.muHistory.map((arr) => arr[0] ?? 0)` — each iteration's top-K mu array is flattened to just the top-1 value
2. In `runIterationLoop.ts:194-195`, `muHistory.push(muValues)` stores top-K mu values per iteration as `number[][]`, but these are **anonymous** (no variant IDs attached) — they're just sorted descending mu values
3. `evolutionVisualizationActions.ts:176` — reads the already-truncated `muHistory` from `run_summary` JSONB
4. EloTab component gets either empty data (if no iterations completed) or single-line data (top-1 only)
5. **Key constraint**: To enable per-variant Elo charts, the iteration loop must be modified to store variant IDs alongside mu values, not just anonymous mu arrays

### Invocation status
1. Invocations use a boolean `success` column (not a status enum like runs)
2. The invocation list renders `✓` or `✗` based on this boolean
3. `EvolutionStatusBadge` is only used for run/experiment status — invocations have their own rendering
4. Ranking invocations fail due to "Budget exceeded during ranking" but the parent run still completes

### Dashboard filter
1. `getEvolutionDashboardDataAction` already accepts `filterTestContent` and applies it to BOTH statusQuery and recentQuery
2. The filter uses `.ilike('strategy_name', '%[TEST]%')` which only matches `[TEST]` prefix
3. Bug 2 (metrics don't respect filter) and Bug 6 (plain "Test" bypassed) are the **same root cause**: the filter predicate is too narrow
4. Fix the filter predicate once → both bugs are resolved

## Phased Execution Plan

### Phase 1: CRITICAL — Data Integrity (Bugs 1, 3, 4, 5)

**1a. Diagnose and fix metrics write failure (Bugs 1, 4)**
- **Step 1 — Diagnose (timebox: 2 hours)**: Add detailed error logging to the catch blocks at `persistRunResults.ts:259-261` and `runIterationLoop.ts:217-219` to capture the actual error (type, message, stack). Run a local evolution run and inspect the error.
- **Step 2 — Fix root cause**: Based on diagnosis, fix why `writeMetric` fails (e.g., missing row, constraint violation, schema mismatch). The catch-and-warn pattern is a resilience feature — do NOT change it to throw, as that would break finalization and prevent run completion.
- **Fallback if diagnosis stalls**: If root cause is not reproducible within 2 hours, skip directly to Step 3 (cost fallback) and file a separate issue for root cause investigation.
- **Step 3 — Add cost fallback**: If metrics write cannot be made reliable, add a fallback in `getEvolutionDashboardDataAction` and run detail queries to use the `evolution_run_costs` view / `get_run_total_cost` RPC (which aggregate directly from `evolution_agent_invocations.cost_usd`) when metrics-based cost is $0.
- **Step 4 — Verify propagation**: Once run-level cost metric is written successfully, verify `propagateMetrics` chain works (run → strategy → experiment).
- Files: `evolution/src/lib/pipeline/finalize/persistRunResults.ts`, `evolution/src/lib/pipeline/loop/runIterationLoop.ts`, `evolution/src/services/evolutionVisualizationActions.ts`
- Test: Integration test extending `evolution-cost-cascade.integration.test.ts` that verifies a completed run has non-zero cost in both `evolution_metrics` table AND the fallback `evolution_run_costs` view
- Regression test: Verify that if writeMetric fails, the run still completes (catch block remains intact)

**1b. Fix ranking invocation status display (Bug 3)**
- The invocations list uses a boolean `success` column, NOT `EvolutionStatusBadge`. Do NOT modify the badge component.
- Files: `evolution/src/services/invocationActions.ts` (query), invocations list page component (rendering)
- Change: Add a `failure_reason` or `error_type` field to the invocation query. When `success=false`, check if the error contains "budget exceeded" and render "⚠ budget exceeded" instead of generic "✗ failed"
- Alternative simpler fix: Add a tooltip on the ✗ icon that shows the invocation's error message
- Test: Unit test for invocation row rendering with budget-exceeded error vs. genuine failure

**1c. Fix Elo history storage and display (Bug 5)**
- **Scope decision**: Full per-variant Elo tracking requires modifying `runIterationLoop.ts` to store `{variantId, mu}` pairs instead of anonymous `number[]`. This is a structural change to the iteration loop data model.
- **Minimum viable fix**: Keep top-K storage but stop truncating to top-1. Change `persistRunResults.ts:83` from `arr[0] ?? 0` to keep the full `number[][]` array. This gives top-K Elo values per iteration (enough for a multi-line "Top K Elo" chart).
- **Full fix (if time allows)**: Modify `runIterationLoop.ts:194-195` to push `{variantId: string, mu: number}[]` instead of `number[]`. Update `RunSummarySchema` type.
- **Note**: The V3 `EvolutionRunSummarySchema` (schemas.ts line 615-618) already has a union type that accepts both `number[]` and `number[][]` with a `.transform()` for backwards compat. This schema work is already done — no schema changes needed.
- Files requiring changes:
  - `evolution/src/lib/pipeline/finalize/persistRunResults.ts:83` — stop truncating muHistory (the only pipeline change needed)
  - `evolution/src/services/evolutionVisualizationActions.ts:159-178` — update `getEvolutionRunEloHistoryAction` to handle `number[][]` muHistory and return multi-point `EloHistoryPoint[]`. The `EloHistoryPoint` type needs to change from `{iteration, mu}` to `{iteration, mus: number[]}` for multi-line chart support.
  - `evolution/src/components/evolution/tabs/EloTab.tsx` — render multi-line chart for top-K (one line per rank position)
  - Test fixtures (~13 files referencing muHistory, grep to identify all) — update mock shapes where needed
- Test: Update existing `EloTab.test.tsx` to cover both legacy single-line and new multi-line data formats

### Phase 2: CRITICAL + HIGH — Filter/Display Logic (Bugs 2, 6, 7, 8, 9, 10, 11, 12)

**2a. Fix "Hide test content" filter predicate (Bugs 2 AND 6 — same root cause)**
- Bug 2 and Bug 6 share the same root cause: the filter uses `.ilike('strategy_name', '%[TEST]%')` which only matches `[TEST]` bracketed prefix. The dashboard action already applies this filter to BOTH metric counts and table rows — the issue is the predicate itself, not where it's applied.
- Files (all 7 locations using the `%[TEST]%` filter predicate):
  - `evolution/src/services/evolutionVisualizationActions.ts`
  - `evolution/src/services/evolutionActions.ts`
  - `evolution/src/services/experimentActions.ts`
  - `evolution/src/services/strategyRegistryActions.ts`
  - `evolution/src/services/invocationActions.ts`
  - `evolution/src/services/arenaActions.ts`
  - Consider extracting a shared `buildTestContentFilter(query)` helper to avoid 7 copies of the same predicate logic
- Change: Extend filter to match multiple test patterns using `.or()`:
  - `[TEST]` prefix (existing)
  - Case-insensitive exact match "test" as strategy/experiment name
  - Timestamp-based auto-generated names matching pattern `*-\d{13}-*` (e.g., "nav2-1774498767678-strat")
- **Avoid false positives**: Do NOT match any string starting with "test" — that would hide legitimate content like "Testing strategies for climate change". Match only: exact "test"/"Test", `[TEST]*` prefix, and timestamp-pattern names.
- Test: Unit test for filter function with patterns: `[TEST] foo`, `test`, `Test`, `nav2-1774498767678-strat`, `Testing climate change` (should NOT be filtered)
- Also update existing `evolution-test-content-filter.integration.test.ts` to cover new patterns

**2c. Stale experiment detection (Bug 7)**
- Files: `evolution/src/services/experimentActions.ts`, experiment list component
- Change: Add staleness indicator — if experiment status is "running" and last_updated > 1 hour ago, show "stale" badge
- Test: Unit test for staleness calculation

**2d. Handle empty/null names (Bugs 8, 9)**
- Files: Arena page component, variants list component
- Change: Display fallback text ("Untitled" / "N/A") when name/agent fields are NULL
- Test: Unit test for null name rendering

**2e. Match count clarification (Bug 10)**
- Files: `evolution/src/components/evolution/tabs/VariantsTab.tsx`, `tabs/MetricsTab.tsx`
- Change: Clarify labels — "Run Matches: 12" vs "Arena Matches: 37" or add tooltip explaining the difference
- Test: Snapshot test for match count display

**2f. Add missing counts to Metrics tab (Bug 11)**
- Files: `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` or `RunMetricsTab.tsx`
- Change: Query and display invocations count, iterations count, comparisons count alongside variants count
- Test: Unit test for counts section rendering

**2g. Add invocations page filters (Bug 12)**
- Files: Invocations list page component
- Change: Add agent type filter, success/failure filter, run ID filter to match other list pages
- Test: Unit test for filter controls rendering and state

### Phase 3: MEDIUM — UI/UX (Bugs 13-27)

**3a. Human-readable names instead of UUIDs (Bugs 13, 16, 27)**
- Files: Dashboard component, RunsTable, EntityDetailHeader
- Change: Join/fetch explanation title or prompt name for display; fall back to truncated UUID only if no name exists
- Test: Unit test for name resolution

**3b. Column width and truncation fixes (Bug 14)**
- Files: Dashboard table styles
- Change: Set min-width on "Created" column, use responsive date format (show year only if different)
- Test: Visual regression or snapshot test

**3c. Lineage graph improvements (Bug 15)**
- Files: `evolution/src/components/evolution/LineageGraph.tsx`
- Change: When all variants are Gen 0, show "All initial variants — no evolution lineage" message instead of misleading flat graph
- Test: Unit test for Gen-0-only case

**3d. Experiment name deduplication (Bug 17)**
- Files: Experiment creation logic
- Change: Auto-append incrementing suffix when duplicate name detected (e.g., "March 26, 2026 - B (2)")
- Test: Unit test for name generation

**3e. Variant rank display spacing (Bug 18)**
- Files: `evolution/src/components/evolution/tabs/VariantsTab.tsx`
- Change: Add spaces: `#1 ★ 8bf778` or use separate rank/winner columns
- Test: Snapshot test

**3f. Date format consistency (Bug 20)**
- Files: Shared date formatting utility
- Change: Create unified `formatDate` and `formatDateTime` helpers; use `formatDateTime` on detail/list views, `formatDate` on dashboards
- Test: Unit test for formatters

**3g. Log iteration filter dynamic population (Bug 22)**
- Files: `evolution/src/components/evolution/tabs/LogsTab.tsx`
- Current behavior: `Math.max(logs.reduce(...maxIteration), 20)` — uses max iteration from logs OR 20, whichever is greater. The fallback 20 is the issue.
- Change: Remove the fallback 20. Use `Math.max(logs.reduce(...maxIteration), 1)` so dropdown shows only iterations that exist in the data. Alternatively, accept the run's actual `max_iterations` config as the upper bound.
- Test: Unit test with run that had 3 iterations — dropdown should show 1-3, not 1-20

**3h. Dashboard pagination or "View all" (Bug 23)**
- Files: Dashboard component
- Change: Add "View all runs →" link below the table that navigates to /admin/evolution/runs
- Test: Unit test for link rendering

**3i. Remaining MEDIUM fixes (Bugs 19, 21, 24, 25, 26)**
- Bug 19: Duration "—" for older entries — accept as expected (retroactive data not available)
- Bug 21: Auto-generated test names not caught by filter — address with Bug 6 filter improvements
- Bug 24: Filter placeholder text — minor copy fix
- Bug 25: Empty arena topics — add "hide empty topics" toggle or filter
- Bug 26: Empty winner link — render "—" when variant is not winner

### Phase 4: LOW — Accessibility/Polish (Bugs 28-40)

**4a. Loading state improvements (Bugs 28, 29)**
- Files: `evolution/src/components/evolution/EntityListPage.tsx`, `TableSkeleton.tsx`
- Change: Show loading skeleton until data is ready; suppress item count during loading; ensure column headers render immediately
- Test: Unit test for loading state

**4b. Aria attributes (Bugs 30, 31, 32)**
- Files: Sidebar nav component, `EvolutionStatusBadge.tsx`, `EntityDetailTabs.tsx`
- Change: Add `aria-current="page"` on active nav link, `aria-label` on status badges, fix `aria-selected` on tabs
- Test: Accessibility audit snapshot

**4c. Lineage graph alt text (Bug 33)**
- Files: `LineageGraph.tsx`
- Change: Add descriptive `alt` text: "Lineage graph showing N variants across M generations"
- Test: Unit test for alt text

**4d. Minor polish (Bugs 34-40)**
- Bug 34: Show full UUID in tooltip on copy button
- Bug 35: Add `aria-hidden="true"` to breadcrumb separators
- Bug 36: Show "No entries yet" message for empty arena topics
- Bug 37: Verify ConfirmDialog exists on Delete/Cancel (likely already exists, just needs verification)
- Bug 38: Replace unicode triangles with CSS/SVG arrows in pagination
- Bug 39: Memoize D3 lineage component to prevent excessive re-renders
- Bug 40: Investigate sequential Supabase queries — parallelize where possible with Promise.all

## Testing

### Unit Tests (new or updated)
- **Cost fallback rendering**: Test that dashboard/run detail uses `evolution_run_costs` view when metrics-based cost is $0
- **Filter logic**: Test filter function with all patterns (`[TEST]`, `test`, `Test`, `nav2-*-strat`, `Testing climate change`)
- **Invocation row rendering**: Test `✗ failed` vs `⚠ budget exceeded` based on error message content
- **EloTab (update existing `EloTab.test.tsx`)**: Update mock data shape from `{iteration, mu}` to handle both legacy `number[]` and new `number[][]` muHistory formats
- **Loading states**: Test that item count is suppressed and column headers render during loading
- **Accessibility attributes**: Test aria-current, aria-label on status badges, aria-selected on tabs
- **Date formatting helpers**: Test unified formatDate/formatDateTime (check if `evolution/src/lib/utils/formatters.test.ts` already covers this)
- All new component behaviors per phase

### Regression Tests (critical for Phase 1)
- **Finalization resilience**: Test that when `writeMetric` throws, the catch block logs a warning but the run still completes successfully (do NOT remove catch block)
- **Schema backwards compatibility**: Test that existing `number[]` muHistory data in run_summary JSONB is handled correctly alongside new `number[][]` format
- **Existing test suites**: Run full `npm run test` to verify no existing tests break, especially:
  - `evolution-cost-cascade.integration.test.ts` — cost view/RPC still works
  - `evolution-test-content-filter.integration.test.ts` — update for new filter patterns
  - `EvolutionStatusBadge.test.tsx` — no changes needed (badge not modified)
  - All ~13 test files referencing muHistory (grep to identify) — update mock shapes where needed

### Integration Tests
- **Cost propagation**: Extend `evolution-cost-cascade.integration.test.ts` to verify a completed run has non-zero cost in BOTH `evolution_metrics` table AND `evolution_run_costs` fallback view
- **Dashboard filter**: Verify metric card counts change when filter is toggled (same predicate applied to both)

### E2E Tests (automated, for CRITICAL bugs)
- **Prerequisite**: No Playwright test runner is currently configured. Add `@playwright/test` as a dev dependency and create `playwright.config.ts` with the project's dev server URL. Alternatively, use the existing integration test infrastructure with `fetch` + DOM assertions if Playwright setup is too heavy.
- Add e2e tests for bugs 1-5 to prevent re-introduction:
  - Test 1 (Bug 1): Navigate to run detail → verify cost is non-zero
  - Test 2 (Bug 2/6): Toggle "Hide test content" → verify metric card counts change
  - Test 3 (Bug 3): Navigate to invocations → verify budget-exceeded shows appropriate indicator (not generic ✗)
  - Test 4 (Bug 4): Navigate to run detail → Logs tab → verify no "Finalization metrics write failed" warning on new runs
  - Test 5 (Bug 5): Navigate to run detail → Elo tab → verify chart renders with data (not "No Elo history available")
- Location: `src/__tests__/e2e/evolution-admin-critical.e2e.test.ts` (new file)

### Manual Verification
- Re-run Playwright MCP crawl after fixes using a **structured checklist** matching all 40 bugs from `_progress.md`
- For each bug: navigate to the specific page, verify the fix, screenshot before/after
- Document results in `_progress.md` with pass/fail per bug

## Rollback Plan
- Phase 1a (metrics error handling): The catch-and-warn pattern is preserved, so no rollback needed — we're fixing the root cause of writeMetric failure, not changing error handling behavior
- Phase 1c (Elo history schema): Schema migration functions provide backwards compat for `number[]` → `number[][]`. If issues arise, revert the persistRunResults.ts change and the schema migration handles both formats
- Phase 2a (filter predicate): If false positives reported, narrow the filter back to `[TEST]` only — single-line change
- General: All changes are additive (fallbacks, new fields, wider filters) — revert any individual phase without affecting others

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/metrics.md` - Cost metric definitions, fallback to cost_usd view
- `evolution/docs/visualization.md` - Admin UI visualization changes, Elo chart updates
- `evolution/docs/cost_optimization.md` - Cost tracking fixes and fallback strategy
- `evolution/docs/rating_and_comparison.md` - Elo history schema changes (number[] → number[][])
