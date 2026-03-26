# Adhoc Evolution Testing Plan

## Background
Exploratory testing with 16 parallel Playwright agents found 67 issues across the evolution admin dashboard. This plan fixes the 5 P0 critical bugs and 22 P1 medium issues (bugs + UX).

## Requirements (from GH Issue #826)
- Fix all P0 critical bugs (5 items)
- Fix all P1 medium bugs (9 items) and medium UX issues (13 items)
- Run lint, tsc, build, and unit tests after each phase
- Write unit tests for fixed code

## Problem
The evolution admin dashboard has broken row actions, incorrect cost calculations, field name mismatches, inconsistent error handling, and numerous UX issues that degrade the admin experience.

## Options Considered
1. **Fix all 67 issues** — too large for one project; P2 (accessibility + polish) deferred to a follow-up
2. **Fix P0 only** — leaves many visible UX issues unfixed
3. **Fix P0 + P1** — best balance of impact vs scope (27 fixes across ~20 files)

**Chosen: Option 3** — Fix P0 + P1 (27 items). P2 accessibility and polish tracked separately.

## Phased Execution Plan

### Phase 1: P0 Critical Bugs (5 fixes)

**1a. Row action buttons navigate instead of acting**
- File: `evolution/src/components/evolution/EntityTable.tsx`
- Fix: In the cell rendering loop (line 93-96), skip the `<Link>` wrapper for the last column when `getRowHref` is provided and row actions exist. Add `e.preventDefault()` as defense-in-depth in `RegistryPage.tsx:118`.
- Test: Verify Edit/Archive/Delete buttons on prompts and strategies pages open dialogs instead of navigating.

**1b. Strategy budget field name mismatch**
- File: `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx`
- Fix: Line 27 interface and line 80 conditional — change `budgetCapUsd` to `budgetUsd`.
- Test: Unit test that config with `budgetUsd: 2.0` renders the budget row.

**1c. Strategy 404 leaks raw DB error**
- File: `evolution/src/services/strategyRegistryActions.ts`
- Fix: Line ~90 — check for PGRST116 (no rows) error and throw `new Error('Strategy not found')` instead of raw error.
- Test: Unit test that non-existent strategy ID returns friendly error.

**1d. Dashboard cost metrics use mismatched populations**
- File: `evolution/src/services/evolutionVisualizationActions.ts`
- Fix: Lines 88-105 — apply the same test-content and archived filters to the cost query as statusQuery. Compute avgCost from filtered totals only.
- Test: Unit test that cost query respects filterTest flag.

**1e. Dashboard Recent Runs hardcodes budget/explanation**
- File: `src/app/admin/evolution-dashboard/page.tsx`
- Fix: Lines 70-80 — fetch `budget_cap_usd` and `explanation_id` in the recentQuery (add to select), map actual values instead of hardcoded 0/null.
- Also: Update `evolutionVisualizationActions.ts` recentQuery select to include these fields.
- Test: Verify dashboard shows actual budget and explanation values.

### Phase 2: P1 Medium Bugs (9 fixes)

**2a. "Hide test content" inconsistent on Experiments/Strategies**
- Files: `src/app/admin/evolution/experiments/page.tsx`, `src/app/admin/evolution/strategies/page.tsx`
- Fix: Add join-based filtering on strategy name containing `[TEST]` for experiments (via runs→strategies), and direct name filter for strategies.
- Test: Verify filtering works when checkbox is checked.

**2b. Prompt cross-link shows raw UUID, links to list**
- File: `src/app/admin/evolution/runs/[runId]/page.tsx`
- Fix: Line 81-83 — fetch prompt name via a lookup (the run already has `prompt_id`; add a query for the prompt name). Change href to `/admin/evolution/prompts/${run.prompt_id}`.
- Test: Verify prompt link shows name and navigates to detail.

**2c. Inconsistent 404 handling (runs and arena)**
- Files: `src/app/admin/evolution/runs/[runId]/page.tsx:58-59`, `src/app/admin/evolution/arena/[topicId]/page.tsx:95-100`
- Fix: Replace inline error divs with proper error states that include breadcrumb navigation and "Back to Evolution Dashboard" link, matching the pattern in `not-found.tsx`.
- Test: Navigate to non-existent run/arena ID, verify navigation back is available.

**2d. Duplicate "Runs" column on strategies list**
- File: `src/app/admin/evolution/strategies/page.tsx`
- Fix: Line 41 — remove the `run_count` entry from `baseColumns` since `createMetricColumns('strategy')` already provides it.
- Test: Verify strategies table has exactly one "Runs" column.

**2e. Dashboard status counts include archived but Recent Runs doesn't**
- File: `evolution/src/services/evolutionVisualizationActions.ts`
- Fix: Line 74 statusQuery — add `.eq('archived', false)` to match recentQuery's filter.
- Test: Verify status counts exclude archived runs.

**2f. Arena leaderboard null crash risk on mu/sigma**
- File: `src/app/admin/evolution/arena/[topicId]/page.tsx`
- Fix: Lines 173-174 — add null guards: `entry.mu != null ? entry.mu.toFixed(1) : 'N/A'` (same for sigma).
- Test: Unit test with null mu/sigma doesn't crash.

**2g. Whitespace-only prompt names accepted**
- File: `evolution/src/services/arenaActions.ts`
- Fix: In `createPromptSchema`, add `.refine(v => v.trim().length > 0, 'Name cannot be only whitespace')` to the name field.
- Test: Unit test that `"   "` is rejected.

**2h. Redundant "Experiment" breadcrumb**
- File: `src/app/admin/evolution/experiments/[experimentId]/page.tsx`
- Fix: Line 26 — remove `{ label: 'Experiment' }` from breadcrumb items array.
- Test: Visual verification (3 segments instead of 4).

### Phase 3: P1 Medium UX (13 fixes)

**3a. Table columns truncated**
- Files: `src/app/admin/evolution/runs/page.tsx`, `strategies/page.tsx`, `prompts/page.tsx`
- Fix: Add `overflow-x-auto` wrapper with horizontal scroll indicator on tables. Reduce low-value columns. On strategies, the truncation of Label column (max-w-[200px]) should be increased to `max-w-[350px]`.

**3b. Experiment name truncated in header**
- File: `src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.tsx`
- Fix: Lines 46-48 — add `min-w-0 flex-shrink-0` or `truncate` with title tooltip on the heading.

**3c. Leaderboard rank positional not Elo-based**
- File: `src/app/admin/evolution/arena/[topicId]/page.tsx`
- Fix: Line 160 — compute rank from Elo-sorted order rather than current sort position. Store Elo-based rank as a property before sorting.

**3d. Default sort direction always ascending**
- File: `src/app/admin/evolution/arena/[topicId]/page.tsx`
- Fix: Line 54 — change `setSortDir('asc')` to `setSortDir('desc')`.

**3e. Null costs sort to top in descending**
- File: `src/app/admin/evolution/arena/[topicId]/page.tsx`
- Fix: Lines 36-47 — change null handling to always push nulls to bottom regardless of sort direction.

**3f. Variant preview single-expand (accordion)**
- File: `evolution/src/components/evolution/tabs/VariantsTab.tsx`
- Fix: Line 26 — change `useState<string | null>` to `useState<Set<string>>` and update toggle logic to add/remove from set.

**3g. Run detail missing cost metric**
- Root cause: Cost metrics may not be written for test runs that had $0 cost. Verify the metrics tab queries `evolution_metrics` correctly. If cost=0 is valid, show "$0.00" instead of omitting.

**3h. No Runs tab on strategy detail**
- File: `src/app/admin/evolution/strategies/[strategyId]/page.tsx`
- Fix: Add a "Runs" tab that queries `evolution_runs` filtered by `strategy_id` and renders a RunsTable.

**3i. Invocations "Run ID" column links to invocation detail**
- Root cause: Same as 1a — EntityTable wraps all cells in Link. Already fixed by Phase 1a approach. Alternatively, add a dedicated `render` function for the Run ID column that renders its own Link to the run detail page.

**3j. Wizard review doesn't show selected prompt**
- File: `src/app/admin/evolution/_components/ExperimentForm.tsx`
- Fix: Lines 440-445 — add a "Prompt" row to the review summary showing the selected prompt name.

**3k. Wizard stepper labels not clickable**
- File: `src/app/admin/evolution/_components/ExperimentForm.tsx`
- Fix: Lines 177-192 — make completed step labels clickable with `onClick={() => setStep(i)}` when `i < step`.

**3l. Logs expanded context disconnected from row**
- File: `evolution/src/components/evolution/tabs/LogsTab.tsx`
- Fix: Lines 211-218 — render context as an inline `<tr>` with `<td colSpan>` immediately below the clicked row instead of after the table.

**3m. Match history component unused on variant detail**
- File: `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`
- Fix: Add a "Match History" tab that renders the existing `VariantMatchHistory` component. Wire up the backing server action `getVariantMatchHistoryAction` to return actual data.

## Testing
- Run `npm run lint`, `npx tsc --noEmit`, `npm run build` after each phase
- Run `npm test` for unit tests after each phase
- Run affected E2E specs: `admin-prompt-registry.spec.ts`, `admin-strategy-registry.spec.ts`, `admin-evolution.spec.ts`
- Manual verification via Playwright MCP for visual changes

## Documentation Updates
The following docs may need updates after implementation:
- `evolution/docs/visualization.md` — if new tabs added (Runs tab on strategy, Match History on variant)
- `evolution/docs/reference.md` — if new server actions added
- `evolution/docs/entities.md` — if new UI routes documented
