# Eliminate Collapsible Pattern Evolution UI Plan

## Background
The evolution UI uses "click to expand" patterns on entity list pages that hide important information behind extra clicks. These patterns should be removed from list pages, with expanded content moved to corresponding detail page Overview tabs. Additionally, list views lack upstream source columns, and entities need inline rename support on both list and detail views.

## Requirements

### 1. Eliminate collapsible patterns on list pages
- **Prompts list**: Remove expandable row showing runs → prompt detail already has a Runs tab via `RelatedRunsTab`
- **Experiments list**: Remove chevron toggle showing run counts/summary → move to experiment detail Overview tab
- **Arena topic**: Remove expandable entry row → create new arena entry detail page (none exists)

### 2. Add rename capability (list view AND detail view)
- **Experiments**: Create `renameExperimentAction`, add rename UI to both list page and detail page
- **Prompts**: Add rename UI to detail page; verify list page edit dialog already supports rename inline (action exists)
- **Strategies**: Add rename UI to both list page and detail page (action exists) — may defer to other branch

### 3. Add source columns to list views
- **Runs list**: + experiment name, + strategy name
- **Invocations list**: + experiment name, + strategy name
- **Variants list**: + invocation source, + run source, + strategy source

## Problem
List pages use expandable rows that require clicks to see important data. This pattern is inconsistent — some pages have it, others don't. The expanded content belongs on detail pages. Meanwhile, list views don't show what generated each entity upstream, making it hard to trace lineage. Entities also can't be renamed from their detail pages.

## Options Considered
1. **Remove collapsibles and add detail page links** — Make rows clickable to navigate to detail pages where the content lives in the Overview tab. Simplest approach.
2. **Replace collapsibles with hover tooltips** — Show summary on hover. Rejected: still hides info and doesn't work on mobile.
3. **Show all info inline in the table** — Too much data for table rows; makes tables unwieldy.

**Chosen: Option 1** — Remove expandable rows, make rows link to detail pages, move expanded content to detail Overview tabs.

### Source Column Data Fetching Strategy

The `getEvolutionRunsAction` currently uses the `get_non_archived_runs` RPC which returns `SETOF evolution_runs` (raw table rows only, no JOINed data). Two approaches:

1. **Modify the RPC** to return a wider type with JOINed experiment/strategy names. Requires a new migration.
2. **Post-fetch enrichment** — after fetching runs, batch-fetch experiment/strategy names in parallel using the IDs already present on the runs. No migration needed.

**Chosen: Option 2 (post-fetch enrichment)** — Avoids RPC schema changes. Collect unique `experiment_id` and `strategy_config_id` values from the fetched runs, batch-fetch names via simple `.in()` queries, then merge into the response. This pattern also applies to invocations and variants (which use direct Supabase `.select()` queries — nested selects return nested objects that need flattening, so post-fetch enrichment is cleaner).

**Important: empty-array guard** — `supabase.in('id', [])` generates invalid SQL (`IN ()`). All enrichment code must guard with `if (ids.length > 0)` before each `.in()` call. When the array is empty, skip the query and use an empty lookup map.

### Rename UI Pattern

`EntityDetailHeader` is a pure presentational component (accepts `title` as readonly string, `actions` slot). Two approaches:

1. **Extend EntityDetailHeader** with optional `onRename` callback — when provided, renders a pencil icon next to the title that triggers an inline edit mode (text input + save/cancel).
2. **Separate RenameDialog component** — pencil icon in `actions` slot opens a modal dialog.

**Chosen: Option 1 (extend EntityDetailHeader)** — Simpler UX, fewer clicks. Add optional `onRename?: (newName: string) => Promise<void>` prop. When set, title becomes click-to-edit with inline text input. For list views, add a pencil icon per row that opens a small inline edit or modal.

**Client component boundary:** `EntityDetailHeader` currently has no `'use client'` directive but all current consumers are already client components. Adding `onRename` with `useState` for edit mode requires adding `'use client'` to the file. This is safe since all consumers already render it from client component trees. Update the file's top comment to reflect it is now a client component.

## Phased Execution Plan

### Phase 1: Remove collapsible from Prompts list
- Remove `expandedPromptId`, `promptRuns`, `promptRunsLoading` state from `prompts/page.tsx`
- Remove `togglePromptRuns` function and expanded row rendering
- Make prompt rows link to `/admin/evolution/prompts/[promptId]`
- Note: Prompt detail page already has a Runs tab via `RelatedRunsTab` — no new content needed on the detail page
- **Tests:**
  - Create `prompts/page.test.tsx` — test that rows render as links, no expand state exists
  - Verify `RelatedRunsTab.test.tsx` already covers the runs display on detail page
- Run lint/tsc/build

### Phase 2: Remove collapsible from Experiments list
- `ExperimentHistory.tsx` is a component embedded in the analysis page; the standalone list is `src/app/admin/evolution/experiments/page.tsx` — modify both if needed
- Remove `expanded`, `detail`, `detailLoading` state from `ExperimentHistory.tsx`
- Remove chevron toggle and expanded content block
- Make experiment rows link to `/admin/evolution/experiments/[experimentId]`
- Ensure experiment detail Overview tab shows run counts, results summary, errors (content that was in the expanded row)
- **Tests:**
  - Update `ExperimentHistory.test.tsx` (if exists) — remove expand/collapse assertions, add link assertions
  - Add regression test on experiment detail page verifying run counts and summary are visible
- Run lint/tsc/build

### Phase 3: Create Arena entry detail page + remove collapsible
- **New page**: Create `/admin/evolution/arena/entries/[entryId]/page.tsx` with:
  - `EntityDetailHeader` with entry metadata (method, model, Elo ± CI)
  - Content section (article text)
  - Metadata section (run link, strategy, cost, created date)
  - Match history (if applicable)
- **Data fetching**: Create `getArenaEntryDetailAction` or reuse existing arena actions
- Remove `expandedId` state from `arena/[topicId]/page.tsx`
- Remove expanded `<EntryDetail>` row
- Make entry rows link to `/admin/evolution/arena/entries/[entryId]`
- **Tests:**
  - Create `arena/entries/[entryId]/page.test.tsx` — test entry detail rendering
  - Create `arena/[topicId]/page.test.tsx` — test rows render as links, no expand state
- Run lint/tsc/build

### Phase 4: Add rename capability (list + detail views)

**Server action:**
- Create `renameExperimentAction` in `experimentActions.ts`:
  - Validate experiment ID as UUID (use existing pattern from other actions)
  - Validate name: `trim()`, reject empty string (match `updatePromptAction` pattern which checks non-empty)
  - `requireAdmin` guard (match existing experiment actions)
  - Simple `UPDATE evolution_experiments SET name = $1 WHERE id = $2`
  - Allow rename on any status including archived (name is metadata, not operational state)

**Detail view rename (EntityDetailHeader extension):**
- Add optional `onRename?: (newName: string) => Promise<void>` prop to `EntityDetailHeader`
- When `onRename` is set, render pencil icon next to title → click enters inline edit mode (text input + save/cancel buttons)
- Wire up on:
  - Experiment detail (`ExperimentDetailContent.tsx`) → `renameExperimentAction`
  - Prompt detail (`prompts/[promptId]/page.tsx`) → `updatePromptAction` (pass only title field)
  - Strategy detail (`StrategyDetailContent.tsx`) → `updateStrategyAction` (pass only name field) — if not handled by other branch

**List view rename:**
- Add pencil icon button per row that triggers inline edit or small popover:
  - Experiments list (`ExperimentHistory.tsx` and `experiments/page.tsx`) → `renameExperimentAction`
  - Prompts list (`prompts/page.tsx`) → existing `PromptFormDialog` already has title editing; verify it's accessible via a pencil icon without opening full form
  - Strategies list — defer to other branch

**Tests:**
- `renameExperimentAction.test.ts`:
  - Success: valid UUID + non-empty name → returns updated experiment
  - Validation: empty name after trim → rejects with error
  - Validation: invalid UUID → rejects
  - Not found: valid UUID but nonexistent → returns error
  - Auth: non-admin → rejects (mock requireAdmin)
- `EntityDetailHeader.test.tsx` — add tests for rename mode: pencil icon renders when `onRename` provided, click enters edit mode, save calls `onRename`, cancel exits edit mode, empty input shows validation error
- Run lint/tsc/build

### Phase 5: Add source columns to Runs list
- **Data fetching** (post-fetch enrichment in `getEvolutionRunsAction`):
  - After fetching runs via `get_non_archived_runs` RPC, collect unique `experiment_id` and `strategy_config_id` values
  - Batch-fetch experiment names: `supabase.from('evolution_experiments').select('id, name').in('id', experimentIds)`
  - Batch-fetch strategy names: `supabase.from('evolution_strategy_configs').select('id, name').in('id', strategyIds)`
  - Build lookup maps, merge `experiment_name` and `strategy_name` into response
  - Handle nulls gracefully (runs without experiment/strategy show "—")
- Extend `EvolutionRun` interface with `experiment_name?: string | null` and `strategy_name?: string | null`
- Add "Experiment" and "Strategy" columns to runs page table — render as links to detail pages
- **Tests:**
  - Update `runs/page.test.tsx` (if exists) or create — test new columns render, null values show "—"
  - Update `evolutionActions.test.ts` — test enrichment logic with mock data
- Run lint/tsc/build

### Phase 6: Add source columns to Invocations list
- **Data fetching** (post-fetch enrichment in `listInvocationsAction`):
  - After fetching invocations, collect unique `run_id` values
  - Batch-fetch runs: `supabase.from('evolution_runs').select('id, experiment_id, strategy_config_id').in('id', runIds)`
  - Then batch-fetch experiment/strategy names using the same pattern as Phase 5
  - Build lookup maps, merge into response
  - Handle nulls (invocations for runs without experiment/strategy show "—")
- Extend `InvocationListEntry` with `experiment_name?: string | null`, `strategy_name?: string | null`
- Add "Experiment" and "Strategy" columns to invocations page table — render as links
- **Tests:**
  - Update `invocations/page.test.tsx` (if exists) or create — test new columns render
  - Update `evolutionVisualizationActions.test.ts` — test enrichment logic
- Run lint/tsc/build

### Phase 7: Add source columns to Variants list
- **Data fetching** (post-fetch enrichment in `listVariantsAction`):
  - After fetching variants, collect unique `run_id` values
  - Batch-fetch runs for `strategy_config_id` (and `experiment_id` if desired)
  - Batch-fetch strategy names
  - Build lookup maps, merge into response
  - Handle nulls
- For "invocation source": No direct FK from variants to invocations. Use existing `agent_name` column which is already displayed — drop "invocation source" from scope since it duplicates `agent_name` and has no clean FK path
- For "run source": `run_id` is already displayed — make it a link column if not already
- Extend `VariantListEntry` with `strategy_name?: string | null`
- Add "Strategy" column to variants page table — render as link
- **Tests:**
  - Update `variants/page.test.tsx` (if exists) or create — test new column renders
  - Update `evolutionActions.test.ts` — test enrichment logic
- Run lint/tsc/build

## Testing

### Unit Tests (per phase, listed above)
| Phase | Test File | New/Update | Key Assertions |
|-------|-----------|------------|----------------|
| 1 | `prompts/page.test.tsx` | Create | Rows render as links, no expand state |
| 2 | `ExperimentHistory.test.tsx` | Update | No expand/collapse, rows are links |
| 2 | Experiment detail test | Create/update | Run counts + summary visible in Overview |
| 3 | `arena/entries/[entryId]/page.test.tsx` | Create | Entry detail renders metadata, content |
| 3 | `arena/[topicId]/page.test.tsx` | Create | Rows are links, no expand state |
| 4 | `renameExperimentAction.test.ts` | Create | 5 cases: success, empty name, bad UUID, not found, auth |
| 4 | `EntityDetailHeader.test.tsx` | Update | Rename mode: pencil, edit, save, cancel, validation |
| 5 | `runs/page.test.tsx` | Create/update | Experiment + Strategy columns, null → "—" |
| 5 | `evolutionActions.test.ts` | Update | Enrichment with mock batch-fetch |
| 6 | `invocations/page.test.tsx` | Create/update | Experiment + Strategy columns |
| 6 | `evolutionVisualizationActions.test.ts` | Update | Enrichment with mock batch-fetch |
| 7 | `variants/page.test.tsx` | Create/update | Strategy column |
| 7 | `evolutionActions.test.ts` | Update | Enrichment with mock batch-fetch |

### Regression Tests
- Prompt detail page: verify Runs tab still works after list page collapsible removal
- Experiment detail page: verify Overview tab shows content that was previously in the collapsible
- Arena entry detail page: verify all content from `<EntryDetail>` is present

### Manual Verification
- Navigate each list page → confirm no expandable rows
- Click entity row → confirm navigation to detail page
- On detail page → confirm all previously-expanded content is visible
- Rename from list view → confirm name updates immediately
- Rename from detail view → confirm title updates inline
- Source columns → confirm links navigate to correct detail pages
- Source columns with null values → confirm "—" is displayed

### NOT in scope
- `InvocationDetailClient.test.tsx` — tests detail-page collapsibles (OutputVariantsSection), not list-page collapsibles. No changes needed.

## Rollback Plan
All changes are UI-only with one new server action (`renameExperimentAction`). Rollback is a simple git revert. No database migrations, no RPC changes, no schema modifications. The post-fetch enrichment pattern adds no new DB dependencies. The `EntityDetailHeader` `onRename` prop is optional and backward-compatible.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` — Update component table (remove collapsible references, add new arena entry detail page, add source columns, document EntityDetailHeader rename support)
- `evolution/docs/evolution/architecture.md` — No changes expected
- `evolution/docs/evolution/README.md` — Add arena entry detail page to route table
- `evolution/docs/evolution/data_model.md` — Document new interface fields (experiment_name, strategy_name on list entries)
- `evolution/docs/evolution/strategy_experiments.md` — Update ExperimentHistory description (no collapsible), add renameExperimentAction to actions table
