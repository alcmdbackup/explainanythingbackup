# Adhoc Evolution Testing Plan

## Background
Exploratory testing of the evolution admin dashboard revealed 51 issues across 15+ pages. This plan fixes all 48 unique issues (after deduplicating F28≈F15, F39≈F38, F44≈F8) and adds comprehensive test coverage to prevent regressions.

## Requirements (from exploratory testing)
Fix all unique issues from the research doc, organized into 6 incremental phases with tests interleaved per phase:
- Phase 1: 5 critical bugs (F32, F1/F3, F19, F38, F24/F43) + tests for each fix
- Phase 2: 5 critical UX issues (F34/F47, F21, F16, F5/F23/F50, F4) + tests for each fix
- Phase 3: 5 high-priority bugs (F31, F2, F26, F22, F35) + tests for each fix
- Phase 4: 6 high-priority UX issues (F37, F36/F45, F10, F33, F40/F46, F11) + tests for each fix
- Phase 5: 15 minor issues (F6, F7, F9, F12, F13, F14, F17, F18, F20, F25, F27, F29, F30, F42, F51) + tests
- Phase 6: 3 structural UX (F41, F48, F49) + tests
- Phase 7: Remaining test coverage (E2E regression suite, accessibility suite, ESLint rule)

## Problem
The evolution admin dashboard has multiple broken features, missing navigation links, empty data fields, accessibility gaps, and misleading filters. The experiment detail page is completely inaccessible (404), the "Hide test content" filter is systematically broken, and failed runs provide no diagnostic information. These issues make the dashboard unreliable for monitoring and analyzing evolution pipeline runs.

## Options Considered
1. **Fix all issues in one pass** — Fastest but risky; hard to test incrementally
2. **Phase by severity with interleaved tests** — Fix critical bugs first, write tests alongside each fix (chosen)
3. **Phase by page** — Fix all issues on one page at a time; risks leaving critical bugs unfixed

Option 2 selected: phased by severity with tests written alongside each fix ensures regressions are caught immediately.

## Verified File Paths

Key files confirmed via filesystem inspection (architecture reviewer validated):

| Reference in plan | Actual path |
|-------------------|-------------|
| Experiment server actions | `evolution/src/services/experimentActions.ts` (NOT experimentActionsV2.ts) |
| Strategy registry actions | `evolution/src/services/strategyRegistryActions.ts` (NOT V2 suffix) |
| Variant detail actions | `evolution/src/services/variantDetailActions.ts` ✓ |
| Pipeline finalize + arena sync | `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (NOT flat finalize.ts or arena.ts) |
| Pipeline generate | `evolution/src/lib/pipeline/loop/generateVariants.ts` |
| Pipeline rank | `evolution/src/lib/pipeline/loop/rankVariants.ts` |
| Pipeline setup | `evolution/src/lib/pipeline/setup/` |
| Experiment detail page route | `src/app/admin/evolution/experiments/[experimentId]/page.tsx` ✓ (exists — bug is in action, not routing) |
| Evolution layout | `src/app/admin/layout.tsx` (shared admin layout; no evolution-specific layout.tsx) |
| Arena sync integration test | `src/__tests__/integration/evolution-sync-arena.integration.test.ts` ✓ |
| Existing experiment wizard E2E | `src/__tests__/e2e/specs/09-admin/admin-experiment-wizard.spec.ts` ✓ |
| ESLint rules directory | `eslint-rules/` with `index.js` registry (plugin namespace: `flakiness`) |
| Existing `TableSkeleton` | `evolution/src/components/evolution/TableSkeleton.tsx` ✓ (reuse, don't create new) |
| persistRunResults sync code | `arena_match_count: 0` hardcoded at line 391 — confirmed root cause of F38 |
| persistRunResults agent_name | `agent_name: v.strategy` at line 201 — already set; F24/F43 bug is likely in the query/UI side |

## Phased Execution Plan

### Phase 1: Critical Bugs (data correctness + broken features)

**F32 — Experiment detail 404**
- The page route EXISTS at `src/app/admin/evolution/experiments/[experimentId]/page.tsx` — the bug is NOT a missing route
- Investigate `getExperimentAction` in `evolution/src/services/experimentActions.ts` — likely a query error, RLS policy issue, or the action returns an error that the page doesn't handle gracefully
- Check RLS: all evolution tables use deny-all + service_role_all bypass. Verify the server action uses the service role client
- Also check if the experiment ID format from the list page matches what the detail page expects (short ID vs full UUID)
- Test: unit test for `getExperimentAction` with a valid experiment ID

**F1/F3 — "Hide test content" filter broken**
- Root cause: `EntityListPage` passes filtered count but `renderTable` or `RegistryPage` receives unfiltered items
- Check `EntityListPage` component — compare `items` passed to `renderTable` vs items used for count
- Fix: ensure the same filtered dataset feeds both the count display and the table renderer
- Affected pages: Runs, Experiments, Strategies, Variants, Invocations
- **Test (unit)**: extend `EntityListPage.test.tsx` — when hideTestContent=true, items passed to renderTable exclude test items AND count matches filtered length

**F19 — Failed runs don't show error message**
- In run detail page component, check if `error_message` is fetched from the run row
- Add an error banner/alert below the status badge when `status === 'failed'` and `error_message` exists
- Style as a red/destructive alert with the full error text
- File: `src/app/admin/evolution/runs/[runId]/page.tsx` or its client component
- **Test (unit)**: failed run with error_message renders error banner; completed run does not

**F38 — Arena match count always 0**
- **Root cause confirmed**: `evolution/src/lib/pipeline/finalize/persistRunResults.ts` line 391 hardcodes `arena_match_count: 0`
- Fix: compute actual match count from the run's match history for each variant being synced
- Count matches where the variant's ID appears as `winnerId` or `loserId` in the `matchHistory` array
- **Concurrent sync atomicity**: check if `sync_to_arena` RPC uses additive semantics (`arena_match_count + EXCLUDED.arena_match_count`) or plain overwrite for the count. If overwrite, change the RPC to use additive increment: `arena_match_count = evolution_variants.arena_match_count + EXCLUDED.arena_match_count`. This prevents two concurrent syncs from overwriting each other's counts. Check the RPC in `supabase/migrations/` for the `ON CONFLICT` clause.
- **Test (integration)**: extend `src/__tests__/integration/evolution-sync-arena.integration.test.ts` — verify `arena_match_count` > 0 after sync with match data; also test that a second sync for the same variant ADDS to the count rather than overwriting
- **Test (unit)**: verify match count computation logic

**F24/F43 — Strategy/Agent fields empty on variants**
- `persistRunResults.ts` line 201 already sets `agent_name: v.strategy` — the finalization code is correct
- The bug is likely in the UI query: check `evolution/src/services/variantDetailActions.ts` — verify `agent_name` is in the select clause
- Also check the Variants tab component — verify it reads and displays the `agent_name` field
- **Test (unit)**: extend `VariantsTab.test.tsx` (at `evolution/src/components/evolution/tabs/VariantsTab.test.tsx`) — verify Strategy column renders agent_name

### Phase 2: Critical UX (navigation + workflow gaps)

**F34/F47 — Experiment and Strategy list rows not clickable**
- Experiments: add clickable ID/name cells with links to `/admin/evolution/experiments/[id]` (F32 must be fixed first)
- Strategies: add clickable name cells with links to `/admin/evolution/strategies/[id]`
- Follow the pattern used by Runs list (link in ID cell) and Arena list (link in every cell)
- Files: experiment and strategy list page components or their `RegistryPageConfig` definitions
- **Test (E2E)**: add to existing `admin-evolution-experiment-lifecycle.spec.ts` — verify experiment row links to detail

**F21 — No cross-links from run detail to related entities**
- Add `EntityLink` chips to `EntityDetailHeader` on the run detail page
- Links: Strategy (name + link), Experiment (if present, name + link), Prompt (if present, name + link)
- Data: the run row already has `strategy_id`, `experiment_id`, `prompt_id` FKs
- File: run detail page component — add cross-links array to the header
- **Test (unit)**: extend `EntityDetailHeader.test.tsx` — verify cross-links render with correct hrefs

**F16 — No "runs per strategy" control in wizard**
- Add a number input (min 1, max 5) next to each strategy checkbox in the step 2 UI
- Update the "N selected, M total runs" counter to reflect count × selected strategies
- Pass the per-strategy count to `addRunToExperimentAction` calls on confirm
- **Server-side validation**: `addRunToExperimentAction` accepts one run at a time — a client can call it N times. Fix: check experiment's current run count before adding; reject if count >= 20 (matching existing schema max). This caps total runs per experiment server-side regardless of how many times the action is called.
- File: `src/app/admin/evolution/start-experiment/page.tsx` (ExperimentForm component) + `evolution/src/services/experimentActions.ts` (server-side cap)
- **Test (unit)**: verify counter updates; verify server action rejects when experiment has >= 20 runs
- **Test (E2E)**: extend existing `admin-experiment-wizard.spec.ts` at `src/__tests__/e2e/specs/09-admin/admin-experiment-wizard.spec.ts` (NOT create new file)

**F5/F23/F50 — Loading skeletons for all evolution pages**
- **Reuse existing** `TableSkeleton` component (already in `evolution/src/components/evolution/TableSkeleton.tsx`)
- Extend it for full-page skeleton (header + table skeleton combo) if needed
- Add `loading.tsx` files to each evolution route directory for Next.js streaming
- Note: the evolution section uses `src/app/admin/layout.tsx` (shared admin layout), so `loading.tsx` files go in individual route dirs
- Files: `src/app/admin/evolution/runs/loading.tsx`, `src/app/admin/evolution/experiments/loading.tsx`, etc.
- **Test (E2E)**: verify skeleton appears briefly before content on slow-loading pages

**F4 — Column headers invisible to screen readers**
- Investigate `RegistryPage` table rendering in `evolution/src/components/evolution/RegistryPage.tsx`
- Headers likely use a non-accessible rendering method (CSS or custom elements without text nodes)
- Fix: ensure column header text is rendered as actual text nodes inside `<th>` elements
- **Test (unit)**: extend `RegistryPage.test.tsx` — all column headers render with accessible text content

### Phase 3: High-Priority Bugs

**F31 — Experiment filter missing Running/Completed statuses**
- Update the status filter from `['Active', 'Cancelled', 'All']` to `['All', 'Draft', 'Running', 'Completed', 'Cancelled']`
- Ensure the server action query in `evolution/src/services/experimentActions.ts` maps these to the actual DB status values
- File: experiment list page component, filter configuration
- **Test (unit)**: verify filter options include all lifecycle states

**F2 — Duplicate "Cost" column on Runs list**
- Identify which two column definitions both use "Cost" as the label
- Rename or merge: if one is from base columns and one from metrics, rename the metric one to "Metric Cost" or remove the duplicate
- File: runs list page component or `RunsTable` column config
- **Test (unit)**: add to `RunsTable.test.tsx` — all column headers have unique labels

**F26 — Strategy filter dropdown has empty option**
- Find where variant strategy names are collected for the filter dropdown
- Add `.filter(Boolean)` or null check to remove empty/undefined strategy names
- File: `evolution/src/components/evolution/tabs/VariantsTab.tsx`
- **Test (unit)**: add to `evolution/src/components/evolution/tabs/VariantsTab.test.tsx` — no empty options in dropdown

**F22 — Tabs use button role instead of tab/tablist ARIA**
- Add `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` to the existing `EntityDetailTabs` component
- Prefer fixing in-place over adding a new dependency (Radix/headless-ui) — audit bundle size impact first if considering a library
- Add arrow key navigation between tabs
- File: `evolution/src/components/evolution/EntityDetailTabs.tsx`
- Note: `EntityDetailPageClient` is the consumer wrapper — may also need updating
- **Test (unit)**: extend `EntityDetailTabs.test.tsx` — verify tablist/tab/tabpanel ARIA roles and arrow key navigation

**F35 — Arena item count race condition**
- Arena Topics page initially shows "0 items" then updates to correct count
- Ensure data fetching completes before rendering count, or show a loading state for the count
- File: arena list page component
- **Test (unit)**: verify loading state shown before data arrives

### Phase 4: High-Priority UX Polish

**F37 — Raw markdown in arena leaderboard content column**
- Strip markdown heading markers using regex `/^#{1,6}\s+/` (handles `#` through `######`)
- Show only the first line (title) truncated with ellipsis
- File: arena topic detail page component
- **Test (unit)**: `stripMarkdownTitle("# Title") → "Title"`, `"## Sub" → "Sub"`, `"No heading" → "No heading"`, `"### Multi" → "Multi"`

**F36/F45 — Elo values inconsistently formatted**
- Create `formatElo(value: number): string` helper that rounds to integers using `Math.round()`
- Place in `evolution/src/lib/shared/computeRatings.ts` alongside existing `toEloScale()`
- Apply consistently in: arena leaderboard, variant detail, run variants tab
- **Test (unit)**: add `formatElo.test.ts` co-located with `computeRatings.test.ts` in `evolution/src/lib/shared/`

**F10 — Dashboard shows test runs that list pages hide**
- Add the same `[TEST]` strategy name filter to the dashboard's recent runs query
- Or add a "Hide test content" toggle to the dashboard matching other pages
- File: dashboard page component, data fetching action
- **Test (E2E)**: extend `admin-evolution-dashboard.spec.ts` — verify test runs are hidden by default

**F33 — 404 pages lose evolution sidebar layout**
- The evolution section uses the shared admin layout at `src/app/admin/layout.tsx` — there is NO evolution-specific layout.tsx
- Option A: Create `src/app/admin/evolution/layout.tsx` that wraps children with the evolution sidebar, then add `src/app/admin/evolution/not-found.tsx`
- Option B: Add error boundary/not-found handling in the individual page components
- Option A is cleaner — extract the existing sidebar into the new layout
- **Test (E2E)**: navigate to invalid evolution URL, verify sidebar remains

**F40/F46 — Empty sections shown as default views**
- Variant detail: change default tab from "Metrics" to "Content" (the `useTabState` default parameter)
- Arena topic detail: hide "Evolution Metrics" section when no metrics exist (conditional render)
- Files: variant detail page, arena topic detail page
- **Test (unit)**: verify default tab is "content"; verify metrics section hidden when empty

**F11 — Sidebar bottom items overlap**
- Add `overflow-y-auto` to the sidebar navigation container
- Ensure "Back to Admin" link has fixed bottom positioning with proper padding/margin above it
- File: evolution sidebar component (currently inline in pages, to be extracted into layout per F33)
- **Test (visual)**: screenshot comparison at various viewport heights

### Phase 5: Minor Issues (batch)

**F6 — Default experiment filter "Active" is confusing**
- Change default from "Active" to "All" so users see all experiments on first visit

**F7 — Strategy Label column verbose multi-line**
- Truncate label to single line with `text-overflow: ellipsis` and full text in `title` attribute tooltip

**F8/F44 — Breadcrumb root inconsistent across pages**
- Standardize breadcrumb root to "Evolution" across all pages
- Audit all page components: currently "Dashboard" (most pages), "Evolution" (arena), "Variants" (variant detail)
- Use consistent root link text "Evolution" pointing to `/admin/evolution-dashboard`
- **Test (unit)**: add breadcrumb root assertion to each page component test

**F9 — Delete action on Prompts lacks destructive styling**
- Add `danger: true` to the Delete row action in the prompts `RegistryPageConfig`

**F12 — Wizard validation errors shown before interaction**
- Move validation message display behind a `submitted` state flag
- Only show messages after user clicks "Next" for the first time

**F13 — No inline "create new prompt" in wizard**
- Add a "Create new prompt" option at the bottom of the prompt radio list
- Opens a dialog (not inline form) for name + prompt text with **validation**: max 2000 chars for prompt text, max 200 chars for name (matching DB constraints)
- Sanitize input: trim whitespace, reject empty strings

**F14 — Wizard step indicator has no labels**
- Add text labels ("Setup", "Strategies", "Review") below or alongside step line segments

**F17 — Test strategies visible in wizard**
- Filter out strategies whose name contains `[TEST]` in the wizard's strategy list

**F18 — No "select all" for strategies**
- Add a "Select all" / "Deselect all" checkbox above the strategy list in step 2

**F20 — UUIDs truncated, not copyable**
- Make truncated UUIDs clickable to copy full value to clipboard
- Use `navigator.clipboard.writeText()` with **fallback** for non-secure contexts: create a hidden `<textarea>`, select text, use `document.execCommand('copy')`, then remove the element
- Add a copy icon and toast notification "Copied to clipboard"
- Files: `EntityDetailHeader` or a shared `CopyableId` component

**F25 — "View" vs "Full" variant actions confusing**
- Rename "View" to "Preview" (inline expand) and "Full" to "Detail"

**F27 — No indicator that variant data is from failed run**
- Show a yellow/amber banner on the variants tab when the parent run status is "failed"

**F29 — Iteration filter hardcoded to 1-20**
- Dynamically compute iteration options from actual log data or from run's `totalIterations`
- **Fallback**: if `totalIterations` is null/undefined, show max 20 with a note "showing default range"

**F30 — Log timestamps missing date**
- Use `Intl.DateTimeFormat` with **fixed locale** `'en-US'` to avoid hydration mismatches between server and client
- Format: "Mar 24, 4:12 PM" when date differs from today; "4:12 PM" when same day

**F42 — Arena cost column shows "—" for all entries**
- Root cause: `persistRunResults.ts` doesn't pass `cost_usd` during arena sync
- Fix: compute per-variant cost from invocation data or set to null with "N/A" display
- If cost data genuinely unavailable at variant level, show "N/A" (not remove column — avoid breaking change)

**F51 — No keyboard shortcuts**
- Defer to future iteration — not blocking any workflow

### Phase 6: Structural UX Improvements

**F41 — No column sorting on arena leaderboard**
- Add clickable column headers with ascending/descending sort toggle
- Client-side sort (data already loaded)

**F48 — Strategy list table too wide (12 columns)**
- Reduce to essential columns: Name, Label, Pipeline, Status, Runs, Avg Elo, Created
- Move secondary columns to strategy detail page

**F15/F28 — Excessive Fast Refresh / HMR rebuild loops (dev-mode only)**
- Defer investigation — note for future DX improvement

### Phase 7: Regression Test Suite

Tests for phases 1-6 are interleaved above. This phase adds the remaining cross-cutting test coverage.

#### 7a. New E2E Specs

All new specs go in `src/__tests__/e2e/specs/09-admin/` with `@evolution` tag. All specs **MUST** include:
- `beforeAll` seed data using **inline `createClient` from `@supabase/supabase-js`** (matching the convention used by all 7 existing evolution E2E specs — do NOT use `evolution-test-data-factory.ts` which is unused in existing E2E context)
- `afterAll` cleanup using FK-safe deletion order (comparisons → logs → invocations → variants → runs → experiments → strategies → prompts). The `flakiness/require-test-cleanup` ESLint rule catches `@supabase/supabase-js` imports, which enforces this.
- Tag both `@evolution` AND `@critical` for specs covering Phase 1-2 fixes (so they run on PRs to main via `chromium-critical` project, not just production)
- Do NOT use `test.describe.configure({ mode: 'serial' })` on `@critical` tagged specs since the `chromium-critical` project runs `fullyParallel` — use independent seed data per test instead

**`admin-evolution-filter-consistency.spec.ts`** (`@evolution @critical`):
- Seed: strategies with and without `[TEST]` in name, runs linked to each
- test: Runs page with "Hide test content" checked shows 0 items AND 0 table rows
- test: Unchecking filter shows correct count matching visible rows
- test: Filter consistent on Experiments, Strategies, Variants, Invocations

**`admin-evolution-navigation.spec.ts`** (`@evolution @critical`):
- Seed: experiment, strategy, run, prompt — all linked
- test: experiment list rows link to experiment detail pages
- test: strategy list rows link to strategy detail pages
- test: run detail header shows cross-links to strategy/experiment/prompt
- test: 404 within evolution area preserves sidebar layout
- test: breadcrumb root consistently says "Evolution"

**`admin-evolution-error-states.spec.ts`** (`@evolution`):
- Seed: failed run with error_message populated
- test: failed run detail shows error message text
- test: failed run variants tab shows warning banner
- test: empty metrics tab shows appropriate empty state

**`admin-evolution-arena-detail.spec.ts`** (`@evolution`):
- Seed: prompt with arena entries having varied ratings and match counts
- test: leaderboard shows rounded Elo values (integers)
- test: content column strips markdown `#` prefix
- test: entries show non-zero match counts
- test: leaderboard columns are sortable

**Extend existing `admin-experiment-wizard.spec.ts`** (NOT create duplicate):
- test: validation errors hidden until first "Next" click
- test: runs-per-strategy spinner works
- test: step indicator shows labels

#### 7b. Accessibility E2E Spec

**`admin-evolution-accessibility.spec.ts`** (`@evolution`):
Uses Playwright accessibility snapshots:
- test: all table columnheaders on Strategies page have text content
- test: all table columnheaders on Prompts page have text content
- test: all table columnheaders on Arena/Variants/Invocations have text
- test: run detail tabs have role="tablist" with role="tab" children

#### 7c. ESLint Rule

**Create early in Phase 3** (before F2 duplicate column fix) so it catches the issue and prevents recurrence:

**`eslint-rules/no-duplicate-column-labels.js`** + `eslint-rules/no-duplicate-column-labels.test.js`:
- Register in `eslint-rules/index.js` under the `flakiness` plugin namespace (matches existing rules like `no-networkidle`, `no-silent-catch`, etc.)
- Detect duplicate `header` or `label` string literals in array expressions assigned to column-like variables
- **Limitation**: static analysis only — won't catch dynamically composed columns (spread, conditional). The unit test for column uniqueness in `RunsTable.test.tsx` is the runtime safety net for those cases.
- Test file follows existing pattern: `eslint-rules/no-duplicate-column-labels.test.js`

**Also update `eslint-rules/require-test-cleanup.js`**:
- Add `'evolution-test-data-factory'` to the `DB_IMPORT_PATTERNS` array (currently only has `@supabase/supabase-js`, `test-data-factory`, `evolution-test-helpers`). This ensures any future E2E spec using the factory is caught by the cleanup enforcement rule.

### Test Execution Order

1. **Per phase (1-6)**: after fixing each issue, run its unit test immediately. After completing the phase:
   - `npm test -- --testPathPattern=evolution` (unit tests)
   - `npm run test:integration` with `--testPathPattern=evolution` (integration — uses jest.integration.config.js)
   - `npm run test:e2e -- --grep="@evolution"` (existing E2E suite for regression)
2. **After Phase 7**: run all new E2E specs + accessibility spec + existing suite to verify no false positives
3. **Final**: `npm run test:all` + `npm run test:e2e` (full suite)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/visualization.md` — Update for loading skeletons (reusing TableSkeleton), tab ARIA changes, evolution layout.tsx extraction
- `evolution/docs/entities.md` — Update entity cross-link patterns, breadcrumb conventions
- `evolution/docs/strategies_and_experiments.md` — Update wizard workflow (runs-per-strategy, inline prompt creation, filter options)
- `evolution/docs/arena.md` — Update arena sync data flow (match count fix, cost propagation)
- `evolution/docs/reference.md` — Update key file reference for new layout.tsx, loading.tsx files, CopyableId component
- `docs/docs_overall/testing_overview.md` — Update test statistics with new E2E specs (5 new + 1 accessibility) and new ESLint rule
- `docs/feature_deep_dives/testing_setup.md` — Add evolution accessibility test patterns, document `@critical` tagging for Phase 1-2 E2E specs
