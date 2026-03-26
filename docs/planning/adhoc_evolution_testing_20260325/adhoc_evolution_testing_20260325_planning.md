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
- Files: `evolution/src/components/evolution/EntityTable.tsx`, `evolution/src/components/evolution/RegistryPage.tsx`
- Root cause: EntityTable wraps every cell in `<Link>` (line 94). RegistryPage appends a synthetic `_actions` column. Buttons inside the Link trigger navigation because `e.stopPropagation()` doesn't prevent `<a>` default behavior in Next.js App Router (which uses client-side navigation via onClick, not native anchor behavior).
- Fix approach: Add a `skipLink?: boolean` property to `ColumnDef`. RegistryPage sets `skipLink: true` on the actions column. EntityTable checks `col.skipLink` and skips the `<Link>` wrapper for those columns. Additionally, add `e.preventDefault()` in RegistryPage.tsx:118 as defense-in-depth.
- Files modified: `EntityTable.tsx` (add skipLink check in cell render), `RegistryPage.tsx` (set skipLink on actions column + add preventDefault)
- Test: Update `admin-prompt-registry.spec.ts` to verify Edit button opens dialog (not navigates). The existing test at lines 58-71 already asserts this — run it to confirm the fix works. Also verify `admin-strategy-registry.spec.ts` action buttons.
- Side effect: This also fixes 3i (invocations Run ID column) since any column can now opt out of Link wrapping.

**1b. Strategy budget field name mismatch**
- File: `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx`
- Fix: Line 27 interface and line 80 conditional — change `budgetCapUsd` to `budgetUsd`. The DB stores V2StrategyConfig (from `schemas.ts:283`) which uses `budgetUsd`. The old `StrategyConfig` interface in `hashStrategyConfig.ts` uses `budgetCapUsd` but is only used by the hashing function, not by StrategyConfigDisplay (verified: StrategyConfigDisplay is only rendered from strategy detail page which passes `config` from the `evolution_strategies.config` JSONB column, which is always V2StrategyConfig).
- Test: Unit test that config with `budgetUsd: 2.0` renders the budget row. Also verify no other callers pass the old `budgetCapUsd` shape via `grep -r budgetCapUsd`.

**1c. Strategy 404 leaks raw DB error**
- File: `evolution/src/services/strategyRegistryActions.ts`
- Fix: Line ~90 — check specifically for `error.code === 'PGRST116'` (no rows found) and throw `new Error('Strategy not found')`. For all other error codes (RLS failures, connection errors, etc.), throw a generic `new Error('Failed to load strategy')` to avoid masking real failures while still sanitizing the message. Do NOT catch-all as 'not found'.
- Test: Unit test that (a) non-existent strategy ID returns "Strategy not found", (b) other Supabase errors return generic message, not raw DB text. Existing test at `strategyRegistryActions.test.ts:200-214` asserts `success === false` — verify it still passes.

**1d. Dashboard cost metrics use mismatched populations**
- File: `evolution/src/services/evolutionVisualizationActions.ts`
- Root cause: The `evolution_run_costs` view only has `run_id` and `total_cost_usd` columns — it does NOT have `archived`, `strategy_id`, or other filter columns. Cannot apply filters directly to this view.
- Fix approach: Instead of querying `evolution_run_costs` separately, compute cost from the same `evolution_runs` query used for status counts. Join `evolution_runs` with `evolution_run_costs` via `run_id`, then apply the same test-content and archived filters. Alternatively, query `evolution_agent_invocations` directly with a run_id IN clause from the filtered run set.
- Simpler approach: After the filtered statusQuery returns run IDs, query `evolution_run_costs` with `.in('run_id', filteredRunIds)` to get costs only for the filtered population. This ensures numerator and denominator match.
- Test: Unit test that cost totals only include runs matching the current filters (not archived, not test content when filtered).

**1e. Dashboard Recent Runs hardcodes budget/explanation**
- Files: `src/app/admin/evolution-dashboard/page.tsx`, `evolution/src/services/evolutionVisualizationActions.ts`
- Fix requires 4 changes:
  1. `evolutionVisualizationActions.ts` line 80: add `budget_cap_usd` and `explanation_id` to the recentQuery `.select()` clause
  2. `evolutionVisualizationActions.ts` DashboardData interface (~line 16-23): add `budget_cap_usd` and `explanation_id` to the `recentRuns` type
  3. `evolutionVisualizationActions.ts` line 130-137: map these new fields in the return object
  4. `evolution-dashboard/page.tsx` lines 70-80: replace `budget_cap_usd: 0` with `r.budget_cap_usd ?? 0` and `explanation_id: null` with `r.explanation_id ?? null`
- Test: Verify dashboard shows actual budget values and explanation IDs. Run `npx tsc --noEmit` to catch any type mismatches in the chain.

### Phase 2: P1 Medium Bugs (9 fixes)

**2a. "Hide test content" inconsistent on Experiments/Strategies**
- Files: `src/app/admin/evolution/experiments/page.tsx`, `src/app/admin/evolution/strategies/page.tsx`
- Fix: Add join-based filtering on strategy name containing `[TEST]` for experiments (via runs→strategies), and direct name filter for strategies.
- Test: Verify filtering works when checkbox is checked.

**2b. Prompt cross-link shows raw UUID, links to list**
- File: `src/app/admin/evolution/runs/[runId]/page.tsx`
- Fix: Line 81-83 — expand the `getEvolutionRunByIdAction` server action to also fetch the prompt name by joining/selecting from `evolution_prompts` via `prompt_id` (follows existing pattern where `strategy_name` is already fetched inline). Then use the prompt name as the link label and `/admin/evolution/prompts/${run.prompt_id}` as the href (the prompts detail route exists at `src/app/admin/evolution/prompts/[promptId]/page.tsx`).
- Test: Verify prompt link shows name and navigates to detail.

**2c. Inconsistent 404 handling (runs and arena)**
- Files: `src/app/admin/evolution/runs/[runId]/page.tsx:58-59`, `src/app/admin/evolution/arena/[topicId]/page.tsx:95-100`
- Note: Both are client components (`'use client'`) so they cannot call Next.js `notFound()` (which requires server components). The fix must stay within client-side rendering.
- Fix: Replace the inline error divs with a shared `NotFoundCard` component that renders breadcrumb navigation, "Back to Evolution Dashboard" link, and a descriptive message — matching the visual style of the existing `not-found.tsx` but rendered client-side. Create `evolution/src/components/evolution/NotFoundCard.tsx` as a reusable component.
- Test: Navigate to non-existent run/arena ID, verify navigation back link is present.

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
- Fix: Use `.trim().min(1)` (more idiomatic than `.refine()`) on the name field in `createPromptSchema` (line ~213), `createTopicSchema` (line ~51), and `updatePromptSchema` (line ~218) — all three schemas need the same fix.
- Test: Unit test that `"   "` is rejected for all three schemas.

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
- Root cause: Current sort uses ascending comparator + `.reverse()` for descending. Null handling (`return 1` for null-a) works in ascending but reverses to wrong position after `.reverse()`.
- Fix: Rewrite sort to use a direction-aware comparator instead of sort-then-reverse. The comparator should multiply by `dir === 'desc' ? -1 : 1` and handle nulls BEFORE the direction multiplier so nulls always go to the bottom:
  ```ts
  const mult = sortDir === 'desc' ? -1 : 1;
  sorted.sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // nulls always last
    if (bv == null) return -1;
    if (typeof av === 'string') return mult * av.localeCompare(bv as string);
    return mult * ((av as number) - (bv as number));
  });
  ```
  Remove the `.reverse()` call.

**3f. Variant preview single-expand (accordion)**
- File: `evolution/src/components/evolution/tabs/VariantsTab.tsx`
- Fix: Line 26 — change `useState<string | null>` to `useState<Set<string>>` and update toggle logic to add/remove from set. Also update line ~48 (`setExpandedId(match.id)`) to use `setExpandedIds(new Set([match.id]))`.
- Test: Unit test that multiple variants can be expanded simultaneously.

**3g. Run detail missing cost metric**
- Root cause: Cost metrics may not be written for test runs that had $0 cost. Verify the metrics tab queries `evolution_metrics` correctly. If cost=0 is valid, show "$0.00" instead of omitting.

**3h. No Runs tab on strategy detail**
- File: `src/app/admin/evolution/strategies/[strategyId]/page.tsx`
- Fix: Add a "Runs" tab that uses the existing `listEvolutionRunsAction` (from `evolutionActions.ts`) with a `strategy_id` filter parameter. Render results using the existing `RunsTable` component.
- Test: Update `admin-strategy-detail.spec.ts` to verify the new Runs tab appears and loads data.

**3i. Invocations "Run ID" column links to invocation detail**
- No code changes needed — already fixed by Phase 1a `skipLink` approach. The invocations page can add `skipLink: true` to the Run ID column if it should link to the run instead. Alternatively, the Run ID column's `render` function can return its own `<Link>` to the run detail page, which will be the only link in that cell since the outer Link is skipped.
- Verify: After 1a is done, confirm invocations list Run ID column behavior is correct.

**3j. Wizard review doesn't show selected prompt**
- File: `src/app/admin/evolution/_components/ExperimentForm.tsx`
- Fix: Lines 440-445 — add a "Prompt" row to the review summary showing the selected prompt name.

**3k. Wizard stepper labels not clickable**
- File: `src/app/admin/evolution/_components/ExperimentForm.tsx`
- Fix: Lines 177-192 — make completed step labels clickable with `onClick={() => setStep(i)}` when `i < step`.

**3l. Logs expanded context disconnected from row**
- File: `evolution/src/components/evolution/tabs/LogsTab.tsx`
- Fix: Move the expanded context rendering from after the `</table>` (lines 211-218) into the `tbody` map. After each `<tr>` for a log entry, conditionally render a second `<tr>` with `<td colSpan={5}>` containing the context JSON when that row's ID matches `expandedId`. This requires restructuring the `.map()` return to use `<Fragment>` wrapping both the data row and the optional context row.
- Also add a highlight background (`bg-[var(--surface-elevated)]`) to the selected row.

**3m. Match history component unused on variant detail**
- File: `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`
- Note: `VariantMatchHistory` component exists at `evolution/src/components/evolution/variant/VariantMatchHistory.tsx`. The backing server action `getVariantMatchHistoryAction` exists in `evolution/src/services/variantDetailActions.ts` but currently returns `[]` (stub).
- Fix: (a) Wire `getVariantMatchHistoryAction` to query `evolution_arena_comparisons` where `entry_a = variantId OR entry_b = variantId`. (b) Add a "Matches" tab to VariantDetailContent that renders VariantMatchHistory with actual data.
- Test: Unit test for the server action returning comparison data.

## Testing

### Per-Phase Checks
- Run `npm run lint`, `npx tsc --noEmit`, `npm run build` after each phase
- Run `npm test` for unit tests after each phase
- Commit each phase separately for selective revert capability

### Affected E2E Specs (verified file names)
- `src/__tests__/e2e/specs/09-admin/admin-prompt-registry.spec.ts` — Phase 1a (row actions)
- `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — Phase 1a, 2d (duplicate column)
- `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` — Phase 1d/1e (dashboard)
- `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` — Phase 3c/3d/3e (arena sort)
- `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` — Phase 2h (breadcrumb)

### E2E Spec Updates Required
- Phase 1a: Run existing `admin-prompt-registry.spec.ts` and `admin-strategy-registry.spec.ts` — they should now PASS (currently they may navigate away). If DOM structure changes break selectors, update accordingly.
- Phase 3h: Add test assertions for "Runs" tab in strategy detail E2E spec
- Phase 3m: Add test assertions for "Matches" tab in variant detail E2E spec (if spec exists)
- Phase 3d: Verify arena E2E spec sort assertions still pass with descending default

### Integration Tests
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — Phase 1d changes the dashboard query; verify this test passes or update it

## Rollback Plan
- Each phase is committed separately so individual phases can be reverted via `git revert <commit>`
- Phase 1 (P0) should be deployed first; if it causes regressions, revert and investigate before proceeding to Phase 2/3
- The `skipLink` property added to `ColumnDef` in Phase 1a is additive (defaults to false) — no existing code is broken if the commit is reverted
- Phase 3 (UX) items are all independent — any single fix can be reverted without affecting others

## Documentation Updates
The following docs may need updates after implementation:
- `evolution/docs/visualization.md` — new tabs added (Runs tab on strategy, Match History on variant)
- `evolution/docs/reference.md` — if new server actions added
- `evolution/docs/entities.md` — if new UI routes documented
