# Small UI Fixes Evolution Dash Plan

## Background
Small UX fixes for the evolution dashboard area. The Runs and Experiments list pages use different layouts than the rest of the evolution admin. This project standardizes them on EntityListPage, improves visual appeal, adds model dropdowns to strategy creation, adds test content filtering to Runs, and fixes E2E test cleanup gaps for evolution entities.

## Requirements (from GH Issue #796)
- Runs and experiment history tables overview lists in evolution dash different than rest - let's use standardized list view.
- Let's make the standardized list view more visually appealing.
- Strategy creation should have dropdown of available models.
- (Added) Runs page should filter out `[TEST]` content by default.
- (Added) E2E tests must clean up evolution entities; add ESLint rule to enforce cleanup.

## Problem
The evolution admin area has 15 pages but uses 3 different list patterns: EntityListPage (variants, arena, invocations), RunsTable direct (runs), and ExperimentHistory card-divs (experiments). The Runs and Experiments pages look and behave differently from the standardized pages. Additionally, the Runs page doesn't filter test content, and E2E tests leave `[TEST]`/`[E2E]` entities in the database because global teardown doesn't clean evolution tables.

## Options Considered

### List Standardization
- **Option A: Add `renderTable` prop to EntityListPage** — Allow passing a custom table component (e.g., RunsTable) while reusing EntityListPage's filter bar, pagination, and header. Keeps RunsTable's budget progress bars intact.
- **Option B: Use EntityTable with custom column renderers** — Implement budget viz as custom `render` functions in ColumnDef. Simpler (no EntityListPage refactor) but may not replicate RunsTable's specialized row-level rendering.
- **Recommendation: Option A** — RunsTable has complex row-level features (budget bars, cost warnings, compact mode) that don't map cleanly to ColumnDef renderers. A `renderTable` prop is a cleaner abstraction.

### Visual Improvements
- **Option A: Adopt Card/paper-texture pattern** — Wrap EntityListPage in Card component with paper-texture, move filters to CardHeader, use CardContent for table. Matches ExperimentHistory's look.
- **Option B: Lighter CSS-only improvements** — Keep current div structure, add shadow-warm-md, header backgrounds, larger padding. Less disruptive but less visually distinctive.
- **Recommendation: Option A** — Card/paper-texture pattern is already established in ExperimentHistory and ExperimentForm. Consistency across the evolution area matters.

### Test Cleanup Enforcement
- **Option A: Import-based ESLint rule** — If spec imports supabase or test-data-factory, require afterAll. Catches ~90% of cases, zero false positives. Comment opt-out for read-only tests.
- **Option B: Entity-creation detection** — Detect `.insert()`, `.upsert()`, `createTest*()` AST patterns. More precise but can't catch UI-based creation (form submissions).
- **Recommendation: Option A** — Simpler, catches all current violations, matches existing eslint-rules/ pattern.

## Phased Execution Plan

### Phase 1: Model Dropdown + Test Content Filtering (quick wins)
**Files modified:**
- `src/app/admin/evolution/strategies/page.tsx` — Change generationModel/judgeModel fields from `type: 'text'` to `type: 'select'`. Map `MODEL_OPTIONS` to the required `{ label, value }[]` format: `options: MODEL_OPTIONS.map(m => ({ label: m, value: m }))`. Add `import { MODEL_OPTIONS } from '@/lib/utils/modelOptions'`. Consider adding a placeholder option `{ label: 'Select a model...', value: '' }` as the first entry so no model is pre-selected.
- `evolution/src/services/evolutionActions.ts` — Add `filterTestContent?: boolean` param to `getEvolutionRunsAction`. **Important**: `strategy_name` is NOT a column on `evolution_runs` — it's enriched post-query via a separate batch fetch from `evolution_strategies`. Therefore, PostgREST `.not().ilike()` cannot filter on it directly. Two approaches:
  - **Approach A (subquery)**: First query strategy IDs matching `[TEST]%` names, then exclude those runs: `.not('strategy_id', 'in', testStrategyIds)`.
  - **Approach B (post-fetch JS filter)**: Filter out runs with `[TEST]` strategy names after enrichment. Simpler but breaks pagination counts.
  - **Recommendation: Approach A** — preserves accurate pagination. Add a preliminary query: `const { data: testStrategies } = await ctx.supabase.from('evolution_strategies').select('id').ilike('name', '%[TEST]%')`, then `.not('strategy_id', 'in', `(${testIds.join(',')})`)` on the main runs query.
- `src/app/admin/evolution/runs/page.tsx` — Add `filterTestContent` state (default `true`). Add "Hide test content" checkbox to filter bar. Pass `filterTestContent` to action. **Guard for empty testIds**: If no test strategies exist, skip the `.not()` clause entirely (empty `IN ()` is invalid PostgREST syntax).

**Tests:**
- Update `evolution/src/services/strategyRegistryActionsV2.test.ts` if schema validation changes
- Add unit test for `getEvolutionRunsAction` with `filterTestContent` verifying the subquery approach
- FormDialog already supports `type: 'select'` and has existing tests for it — no FormDialog test changes needed

### Phase 2: EntityListPage Visual Improvements
**Files modified:**
- `evolution/src/components/evolution/EntityListPage.tsx` — Wrap in Card/CardContent, move filters to CardHeader, add paper-texture. **Important downstream impact**: RegistryPage (used by Prompts, Strategies) renders its own breadcrumb + title + header-action above EntityListPage. To avoid visual disconnect, EntityListPage should accept an optional `showHeader?: boolean` prop (default `true`). When `false` (as RegistryPage will pass), skip the CardHeader/title rendering and let RegistryPage handle it. RegistryPage will be updated to pass `showHeader={false}` and wrap its own header inside the Card.
- `evolution/src/components/evolution/RegistryPage.tsx` — Update to pass `showHeader={false}` to EntityListPage. Move RegistryPage's own breadcrumb + title + header-action into the Card structure so it visually integrates with the Card wrapper.
- `evolution/src/components/evolution/EntityTable.tsx` — Add `bg-[var(--surface-elevated)]` to `<thead>`. Increase row padding from `py-1.5` to `py-2`. Enhance sort indicator: change from `opacity-0 group-hover:opacity-50` to `text-[var(--text-muted)] group-hover:text-[var(--accent-gold)]`. Add `shadow-warm-sm` to table wrapper. **Note**: This affects all 6+ pages using EntityTable — intentional global visual refresh.
- Pagination: increase button padding to `px-3 py-1.5`, add `border border-[var(--border-default)]` and `hover:bg-[var(--surface-elevated)]` to non-active buttons.

**Tests:**
- Update `evolution/src/components/evolution/EntityListPage.test.tsx` — Adjust for Card wrapper DOM structure, test `showHeader` prop
- Update `evolution/src/components/evolution/EntityTable.test.tsx` — **Explicitly update CSS class assertions** (e.g., line 70 asserts `hover:bg-[var(--surface-secondary)]` which may change with new row padding/hover classes). Update all hardcoded class string assertions to match new styling.
- Smoke-check existing E2E tests for variants, arena, invocations pages to confirm visual changes don't break Playwright selectors (these use `data-testid` not CSS selectors, so likely safe)

### Phase 3: Standardize Runs Page on EntityListPage
**Files modified:**
- `evolution/src/components/evolution/EntityListPage.tsx` — Add optional `renderTable` prop with concrete type signature:
  ```typescript
  renderTable?: (props: {
    items: T[];
    loading: boolean;
    emptyMessage?: string;
    emptySuggestion?: string;
  }) => ReactNode;
  ```
  When `renderTable` is provided, call it instead of rendering `<EntityTable>`. The custom renderer receives only the data props — it brings its own column definitions, row click handlers, and specialized rendering. This keeps the prop simple and avoids forcing RunsTable's `RunsColumnDef` to conform to EntityTable's `ColumnDef`.
  **Also make `columns` optional**: Change `columns: ColumnDef<T>[]` to `columns?: ColumnDef<T>[]` in EntityListPageProps. When `renderTable` is provided, `columns` is not needed and callers should not be forced to pass `columns={[]}`. Add a runtime check: if neither `columns` nor `renderTable` is provided, throw a dev-mode error.
- `src/app/admin/evolution/runs/page.tsx` — Refactor to use `<EntityListPage>` with `renderTable` that renders `<RunsTable runs={items} columns={getBaseColumns()} loading={loading} />`. Move filter state into EntityListPage's `onFilterChange` pattern. **Note**: Convert from 0-indexed pagination (current: `page` starts at 0) to EntityListPage's 1-indexed pagination (`page` starts at 1).

**Tests:**
- Update `evolution/src/components/evolution/EntityListPage.test.tsx` — Test `renderTable` prop renders custom content instead of EntityTable
- Verify `evolution/src/components/evolution/RunsTable.test.tsx` still passes (RunsTable itself is unchanged)

### Phase 4: Standardize Experiments Page on EntityListPage
**Files modified:**
- `src/app/admin/evolution/experiments/page.tsx` — Replace ExperimentHistory with EntityListPage using `renderTable` (same pattern as Phase 3). The custom renderer handles experiment-specific row rendering (status dot, name link, run count, date).
- `src/app/admin/evolution/_components/ExperimentHistory.tsx` — Deprecate. Features migrate as follows:
  - **StatusDot** → EvolutionStatusBadge in a custom column renderer
  - **Cancel button** → **Not migrated to EntityListPage**. EntityListPage has no row-action concept (only RegistryPage does). Two options:
    - **Option A**: Use RegistryPage instead of EntityListPage for experiments, adding cancel as a `RowAction`. But experiments aren't a CRUD registry page — overkill.
    - **Option B (recommended)**: Include the cancel button directly in the custom `renderTable` renderer's row markup. The renderer already has full control over row HTML, so it can render a cancel button inline just like ExperimentHistory does today. No EntityListPage API change needed.
  - **Filter dropdown (active/cancelled/all)** → FilterDef select
  - **"Hide test content" checkbox** → FilterDef checkbox
  - **Refresh button** → Not migrated (EntityListPage has no refresh). If needed, add a refresh button in the `actions` slot of EntityListPage.
- **Note on ExperimentHistory cancel logic bug**: Current code shows cancel for `TERMINAL_STATUSES` (completed/failed) but NOT cancelled — meaning you can "cancel" an already-completed experiment. Preserve current behavior for now; fix in a separate ticket.

**Tests:**
- Update or remove `src/app/admin/evolution/_components/ExperimentHistory.test.tsx`
- Add unit test for experiments page verifying EntityListPage renders with experiment data

### Phase 5: E2E Test Cleanup
**Files modified:**
- `src/__tests__/e2e/setup/global-teardown.ts` — Add Step 5b (after line ~225): evolution table cleanup in FK order. **`evolution_metrics` does not exist — removed from sequence.** Correct FK-safe order:
  ```
  1. evolution_arena_comparisons  (leaf — no name column, clean by prompt_id/run_id)
  2. evolution_logs               (leaf — no name column, clean by run_id from test runs)
  3. evolution_agent_invocations  (leaf — clean by run_id from test runs)
  4. evolution_variants           (child — clean by run_id from test runs)
  5. evolution_runs               (parent — clean by strategy_id from test strategies)
  6. evolution_experiments        (root — .ilike('name', '[TEST]%') and '[E2E]%')
  7. evolution_strategies         (root — .ilike('name', '[TEST]%') and '[E2E]%')
  8. evolution_prompts            (root — .ilike('title', '[TEST]%') and '[E2E]%')
  ```
  **Cleanup strategy for tables without name columns**: First query test strategy/experiment IDs by name pattern, then query test run IDs by those strategy IDs, then delete leaf tables by run_id. Wrap entire block in try/catch matching existing teardown error handling pattern.
  Also add cleanup for `llmCallTracking` entries created by evolution system user UUID `00000000-0000-4000-8000-000000000001`.

- `src/__tests__/e2e/specs/09-admin/admin-strategy-crud.spec.ts` — Add afterAll: query `evolution_strategies` by `.ilike('name', '[E2E] Test Strategy%')` and delete matches.

- `src/__tests__/e2e/specs/09-admin/admin-prompt-registry.spec.ts` — Add afterAll: query `evolution_prompts` by `.ilike('title', '[E2E] Test Prompt%')` and hard-delete (not just archive).

- `src/__tests__/e2e/specs/09-admin/admin-experiment-wizard.spec.ts` — Add afterAll: **Entity ID capture strategy**: The spec knows the experiment name pattern (`[E2E] Wizard Test {timestamp}`). In afterAll, query `evolution_experiments` by `.ilike('name', '[E2E] Wizard Test%')` to get experiment IDs, then query `evolution_runs` by experiment_id to get run IDs, then delete in FK order: runs → experiments. Alternatively, store the timestamp from `beforeAll` and use it for a precise name match.

- `evolution/src/testing/evolution-test-helpers.ts` — Add `evolution_logs` AND `evolution_arena_comparisons` to `cleanupEvolutionData()`, before the existing `evolution_agent_invocations` deletion (both are leaf tables).

**New files:**
- `eslint-rules/require-test-cleanup.js` — Rule: specs importing `@supabase/supabase-js`, `test-data-factory`, or `evolution-test-helpers` must have `test.afterAll` or `adminTest.afterAll`. Known limitation: specs creating entities purely via UI form submissions (no DB imports) won't be caught — document in rule JSDoc. Comment opt-out supported: `// eslint-disable-next-line flakiness/require-test-cleanup`.
- `eslint-rules/require-test-cleanup.test.js` — RuleTester valid/invalid cases

**Config changes:**
- `eslint-rules/index.js` — Add `'require-test-cleanup': require('./require-test-cleanup')` to rules export
- `eslint.config.mjs` — Register `flakiness/require-test-cleanup: 'error'` for spec files

**Tests:**
- Run `node eslint-rules/require-test-cleanup.test.js` to verify rule
- Run full E2E suite to verify cleanup works
- Verify no `[TEST]`/`[E2E]` evolution entities remain after test run

## Testing

### Unit Tests (per phase)
- Phase 1: FormDialog select rendering, getEvolutionRunsAction filterTestContent
- Phase 2: EntityListPage Card wrapper, EntityTable header styling
- Phase 3: EntityListPage renderTable prop
- Phase 4: Experiments page with EntityListPage
- Phase 5: ESLint rule valid/invalid cases

### Integration Tests
- Verify filterTestContent excludes runs with `[TEST]` strategy names

### E2E Tests
- Verify strategy creation shows model dropdown (not free text)
- Verify runs page shows "Hide test content" checkbox
- Verify all evolution admin list pages render correctly after visual changes
- Run full E2E suite after cleanup changes to confirm no test pollution

### Manual Verification on Staging
- Check all evolution list pages render correctly with new Card styling
- Confirm model dropdown shows correct options
- Confirm `[TEST]` runs are hidden by default on runs page
- Verify no `[TEST]`/`[E2E]` entities persist after E2E run

## Rollback Plan
Each phase is committed separately. Phases are independent enough for selective revert:
- **Phase 1** (model dropdown + filterTestContent): Fully independent, revert commit only
- **Phase 2** (visual improvements): Revert EntityListPage + EntityTable + RegistryPage styling commits. All consumers revert simultaneously.
- **Phase 3** (runs standardization): Revert runs page + renderTable prop. EntityListPage's renderTable prop can stay (unused = no impact).
- **Phase 4** (experiments standardization): Revert experiments page, restore ExperimentHistory.
- **Phase 5** (test cleanup): ESLint rule + global teardown are additive — safe to keep even if other phases revert. Per-spec afterAll blocks are also safe to keep.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` — Update EntityListPage description to reflect Card wrapper, renderTable prop, and visual changes
- `evolution/docs/evolution/architecture.md` — No changes expected (model dropdown doesn't change data flow)
- `docs/docs_overall/testing_overview.md` — Add Rule 16: "E2E specs that import database tools must have afterAll cleanup" with reference to ESLint enforcement
