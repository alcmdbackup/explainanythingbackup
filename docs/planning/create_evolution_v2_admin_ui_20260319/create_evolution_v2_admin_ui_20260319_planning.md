# Create Evolution V2 Admin UI Plan

## Background
Restore the evolution admin dashboard and supporting pages that were deleted in PR #736 (V1 cleanup). PR #736 correctly identified that V1 code referenced dropped V2 schema columns, but over-corrected by deleting the entire admin UI instead of surgically updating it. This project reverts PR #736's deletions, updates restored code to work with the current V2 schema, and removes only code that truly cannot work with V2.

## Requirements (from GH Issue #742)
1. Revert file deletions from PR #736 to restore the previous working admin UI
2. Update restored server actions to use V2 schema (strategy_config_id FK, no config JSONB column on runs, arena table renames)
3. Restore pages: evolution-dashboard, runs, variants, invocations, arena; rebuild strategies and prompts with RegistryPage
4. Remove code referencing dropped V1 columns/tables that cannot be adapted to V2
5. Reuse existing V2 shared components (EntityDetailHeader, EntityTable, MetricGrid, RegistryPage, etc.)
6. Ensure all restored pages pass lint, tsc, build with unit tests
7. Update visualization.md and admin_panel.md docs

## Problem
The evolution admin UI was entirely deleted in PR #736 to fix staging errors caused by V1 code referencing dropped V2 schema columns. This left the EvolutionSidebar linking to 7 non-existent pages (dashboard, runs, strategies, prompts, invocations, variants, arena). The V2 schema is a clean-slate rewrite — many columns/tables the old UI relied on no longer exist (checkpoints, phase, total_cost_usd, elo_attribution, etc.). Restoring the UI requires selectively reverting deletions, adapting queries to the V2 schema, and rebuilding CRUD pages using V2 patterns.

## Design Decisions
1. **Cost computation**: Create a SQL helper view/function to SUM invocation costs per run, rather than duplicating the query in every action
2. **Dashboard metrics**: Query `run_summary` JSONB directly via Postgres JSON operators — no convenience columns
3. **Strategy/prompt pages**: Rebuild using the V2 `RegistryPage` pattern instead of restoring V1 custom pages

## Options Considered

### Option A: Full git revert of PR #736 + surgical fixes
- Revert all 130 deleted files, then fix each one for V2 compatibility
- Pro: Preserves all original test coverage and edge case handling
- Con: 40+ files are pure V1 dead code that would need immediate re-deletion; massive diff churn

### Option B (chosen): Selective restore + rebuild
- Git-restore only the ~31 files classified as RESTORE/REWRITE
- Rebuild strategy/prompt CRUD pages using RegistryPage pattern (~150 lines each)
- Rewrite dashboard and run pages to use run_summary JSONB
- Skip all V1-only dead code (agent details, budget tab, timeline tab, attribution, etc.)
- Pro: Clean result, minimal dead code, uses V2 patterns throughout
- Con: Loses some V1 features (detailed agent execution views, budget comparison, checkpoint lineage)

### Option C: Build entirely from scratch
- Ignore old code, build all pages fresh using V2 patterns
- Pro: Cleanest possible result
- Con: Massive effort, loses battle-tested UI code for variants/invocations/lineage

## Phased Execution Plan

### Phase 1: Server Actions Foundation
**Goal**: Create the server action layer that all pages depend on.

**1a. Create `totalCostForRun` SQL helper**
- Add a Postgres function or view: `SELECT run_id, SUM(cost_usd) as total_cost_usd FROM evolution_agent_invocations GROUP BY run_id`
- Migration file: `supabase/migrations/YYYYMMDD_evolution_run_cost_view.sql`

**1b. Restore + update `evolutionActions.ts`**
- Git-restore from `4f518a16^:evolution/src/services/evolutionActions.ts`
- Remove references to: `total_cost_usd` column (use cost view/subquery), `estimated_cost_usd`, `cost_estimate_detail`, `cost_prediction`, `current_iteration`, `continuation_count`, `phase` column, `evolution_checkpoints`, `elo_attribution`, `config` JSONB on runs, `get_non_archived_runs` RPC, `DEFAULT_EVOLUTION_CONFIG`, `EvolutionRunConfig`
- Update: use `strategy_config_id` FK for strategy lookup, read `run_summary` JSONB for iterations/phase/stop reason, use `adminAction()` wrapper if not already, update status CHECK to V2 values (pending|claimed|running|completed|failed|cancelled)
- Exported functions needed: `getEvolutionRunsAction`, `getEvolutionRunByIdAction`, `getEvolutionVariantsAction`, `getEvolutionRunSummaryAction`, `getEvolutionCostBreakdownAction`, `getEvolutionRunLogsAction`, `killEvolutionRunAction`, `listVariantsAction`, `queueEvolutionRunAction`, `archiveRunAction`, `unarchiveRunAction`

**1c. Restore + update `variantDetailActions.ts`**
- Git-restore from pre-deletion
- Remove `elo_attribution` references from variant queries
- Minor: should be mostly compatible with V2 schema

**1d. Restore + update `arenaActions.ts`**
- Git-restore from pre-deletion
- Update: `evolution_arena_elo` table → query `evolution_arena_entries` directly (mu, sigma, elo_rating, match_count)
- Remove any `hall_of_fame` references (should already be renamed)
- Update `ArenaEloEntry` type to match merged schema

**1e. Create `strategyRegistryActionsV2.ts` (new)**
- New file using `adminAction()` wrapper
- Actions: `getStrategiesAction`, `getStrategyDetailAction`, `createStrategyAction`, `updateStrategyAction`, `cloneStrategyAction`, `archiveStrategyAction`, `deleteStrategyAction`, `getStrategiesPeakStatsAction`
- Uses `evolution_strategy_configs` table, V2StrategyConfig type, hashStrategyConfig from lib/v2/strategy.ts

**1f. Create `promptRegistryActionsV2.ts` (new)**
- New file using `adminAction()` wrapper
- Actions: `getPromptsAction` (already in experimentActionsV2), `getPromptDetailAction`, `createPromptAction`, `updatePromptAction`, `archivePromptAction`, `deletePromptAction`
- Uses `evolution_arena_topics` table

**1g. Rewrite `evolutionVisualizationActions.ts`**
- New file (don't restore old — too many checkpoint dependencies)
- Actions: `getEvolutionDashboardDataAction` (aggregate from runs + invocations), `getEvolutionRunEloHistoryAction` (from run_summary.muHistory), `getEvolutionRunLineageAction` (from variants + parent_variant_id)
- Remove: all checkpoint-based actions, buildVariantsFromCheckpoint, budget comparison

**Verify**: lint, tsc pass for all new/restored action files. Unit tests for each action.

### Phase 2: Restore Core Components
**Goal**: Bring back UI components that pages depend on.

**2a. Git-restore reusable components**
From `4f518a16^`, restore these to `evolution/src/components/evolution/`:
- `AutoRefreshProvider.tsx` + test — polling context (no schema deps)
- `EloSparkline.tsx` + test — tiny Recharts sparkline (no schema deps)
- `VariantCard.tsx` + test — variant info card (no schema deps)
- `RunsTable.tsx` + test — runs table display (update: remove Est. column, phase column; add run_summary-based columns)
- `TextDiff.tsx` + test — word-level diff (no schema deps)
- `InputArticleSection.tsx` + test — input variant display (no schema deps)
- `ElapsedTime.tsx` + test — live elapsed time (no schema deps)
- `LineageGraph.tsx` + test — D3 DAG visualization (no schema deps)
- `VariantDetailPanel.tsx` + test — inline variant detail (remove elo_attribution refs)

**2b. Git-restore variant sub-components**
- `variant/VariantContentSection.tsx` + test
- `variant/VariantLineageSection.tsx` + test
- `variant/VariantMatchHistory.tsx` + test

**2c. Git-restore tab components (restore-class only)**
- `tabs/LineageTab.tsx` + test — uses variant parent_variant_id (compatible)
- `tabs/VariantsTab.tsx` + test — remove elo_attribution, StepScoreBar refs

**2d. Rewrite tab components**
- `tabs/EloTab.tsx` — rewrite to use `run_summary.muHistory` instead of checkpoint snapshots
- `tabs/MetricsTab.tsx` — rewrite to use `run_summary` JSONB fields (totalIterations, matchStats, topVariants, etc.)

**2e. Update component barrel export**
- Add restored components to `evolution/src/components/evolution/index.ts`

**Verify**: lint, tsc, build pass. Unit tests for all restored/rewritten components.

### Phase 3: Admin Pages — Dashboard + Runs
**Goal**: Restore the most important pages first.

**3a. Rewrite `evolution-dashboard/page.tsx`**
- New page using V2 data from `getEvolutionDashboardDataAction`
- Show: active runs count, queue depth, success rate, monthly spend, recent runs table
- Metrics from: COUNT/status queries on evolution_runs, SUM from cost view, run_summary JSONB
- Use: MetricGrid, RunsTable, AutoRefreshProvider (15s poll)

**3b. Restore + update `runs/page.tsx`**
- Git-restore, update to use V2 `getEvolutionRunsAction`
- Remove: phase column, Est. column, cost estimate accuracy
- Add: budget_cap_usd column, stop_reason from run_summary
- Use: EntityListPage or custom layout with RunsTable

**3c. Restore + update `runs/[runId]/page.tsx`**
- Git-restore, update to use V2 actions
- Reduce tabs: Overview (MetricGrid from run_summary), Elo (muHistory chart), Lineage (variant DAG), Variants (table), Logs (from evolution_run_logs)
- Remove: Timeline tab (checkpoint-dependent), Budget tab (dropped)
- Use: EntityDetailHeader, EntityDetailTabs, MetricGrid

**3d. Rewrite `runs/[runId]/RunMetricsTab.tsx`**
- Use run_summary JSONB: totalIterations, durationSeconds, matchStats, topVariants, strategyEffectiveness
- Use agent invocations for per-agent cost breakdown
- Use: MetricGrid

**3e. Add error boundaries**
- Restore `runs/error.tsx` and `runs/[runId]/error.tsx`

**Verify**: lint, tsc, build. Navigate to dashboard and runs pages. Unit tests.

### Phase 4: Admin Pages — Variants + Invocations
**Goal**: Restore entity browsing pages (mostly compatible with V2).

**4a. Restore `variants/page.tsx`** — variant list with filters
**4b. Restore `variants/[variantId]/page.tsx`** + `VariantDetailContent.tsx` — remove elo_attribution display
**4c. Restore `invocations/page.tsx`** — invocation list
**4d. Restore `invocations/[invocationId]/page.tsx`** + detail components — execution_detail JSONB display

All git-restored from `4f518a16^`, with import path fixes and V1 column removal.

**Verify**: lint, tsc, build. Unit tests for all restored pages.

### Phase 5: Admin Pages — Strategies + Prompts (RegistryPage)
**Goal**: Build CRUD pages using the V2 RegistryPage pattern.

**5a. Build `strategies/page.tsx`**
- Use RegistryPage with:
  - Columns: name, label, pipeline_type, status, run_count, avg_final_elo, created_by, last_used_at
  - Filters: status (active/archived), created_by, pipeline_type
  - FormDialog fields: name, description, generationModel, judgeModel, iterations
  - Row actions: edit, clone, archive/unarchive, delete
- Server actions from `strategyRegistryActionsV2.ts`

**5b. Build `strategies/[strategyId]/page.tsx`**
- Use EntityDetailHeader + EntityDetailTabs
- Tabs: Config (StrategyConfigDisplay), Metrics (MetricGrid with strategy aggregates), Runs (RelatedRunsTab)

**5c. Build `prompts/page.tsx`**
- Use RegistryPage with:
  - Columns: title, prompt (truncated), difficulty_tier, domain_tags, status, created_at
  - Filters: status (active/archived), difficulty_tier
  - FormDialog fields: title, prompt (textarea), difficulty_tier (select), domain_tags (text)
  - Row actions: edit, archive/unarchive, delete

**5d. Build `prompts/[promptId]/page.tsx`**
- Use EntityDetailHeader + EntityDetailTabs
- Tabs: Overview (prompt text, metadata), Runs (RelatedRunsTab filtered by prompt_id)

**Verify**: lint, tsc, build. Unit tests.

### Phase 6: Admin Pages — Arena
**Goal**: Restore arena pages updated for merged elo schema.

**6a. Restore + update `arena/page.tsx`**
- Update: query `evolution_arena_entries` directly for elo data (no separate elo table)
- Show: topic list with entry counts, elo ranges, total cost

**6b. Restore + update `arena/[topicId]/page.tsx`**
- Update: leaderboard reads mu/sigma/elo_rating from entries table
- Tabs: Leaderboard, Cost vs Rating scatter, Match History, Text Diff

**6c. Restore + update `arena/entries/[entryId]/page.tsx`**
- Minor updates: read elo from entry row directly

**6d. Restore `arena/arenaBudgetFilter.ts`** — budget tier filtering utility

**Verify**: lint, tsc, build. Unit tests.

### Phase 7: Cleanup + Polish
**Goal**: Remove dead V1 code, ensure everything works end-to-end.

**7a. Delete V1-only files** that were NOT restored:
- Verify no imports reference: PhaseIndicator, AttributionBadge, StepScoreBar, ActionChips, all agentDetails/*, BudgetTab, TimelineTab, LogsTab (old), RelatedVariantsTab, experimentActions.ts (old), eloBudgetActions.ts, costAnalyticsActions.ts, experimentHelpers.ts, experimentReportPrompt.ts, strategyResolution.ts

**7b. Update EvolutionSidebar** if any route changes needed

**7c. Full check suite**: lint, tsc, build, unit tests, integration tests

**7d. Manual verification on local dev**:
- Navigate every page in the sidebar
- Verify data loads on each page
- Test CRUD operations on strategies and prompts
- Verify runs list shows cost correctly
- Verify arena leaderboard works

### Phase 8: Documentation + Tests
**Goal**: Update docs and ensure test coverage.

**8a. Update `evolution/docs/evolution/visualization.md`**
- Remove references to deleted V1 tabs/components (Timeline, Budget, AgentDetails)
- Update pages table to reflect V2 reality
- Update server actions list
- Update component list

**8b. Update `docs/feature_deep_dives/admin_panel.md`**
- Update routes section
- Update evolution dashboard patterns section

**8c. Write/update unit tests** for all new/modified files
- Target: every server action, every page component, every rewritten tab

**8d. Update integration tests** if any touch evolution admin

## Testing

### Unit Tests (per phase)
- Phase 1: Server action tests (mock Supabase, verify queries, test error handling)
- Phase 2: Component tests (render, props, user interaction)
- Phase 3-6: Page tests (render with mock data, tab switching, CRUD flows)

### Integration Tests
- Verify server actions against real Supabase (existing integration test patterns)

### Manual Verification on Stage
- [ ] Dashboard loads with stats and recent runs
- [ ] Runs list shows runs with cost, status, strategy name
- [ ] Run detail shows metrics, elo chart, lineage graph, variants list
- [ ] Variants list and detail pages work
- [ ] Invocations list and detail pages work
- [ ] Strategies CRUD (create, edit, clone, archive, delete)
- [ ] Prompts CRUD (create, edit, archive, delete)
- [ ] Arena topic list and leaderboard work
- [ ] All sidebar links resolve (no 404s)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - Major update: remove V1 components/tabs, update pages/actions/components lists for V2
- `docs/feature_deep_dives/admin_panel.md` - Update routes, sidebar items, evolution dashboard patterns
- `evolution/docs/evolution/reference.md` - Update key files section with new action files
- `evolution/docs/evolution/data_model.md` - Verify server action file references
- `evolution/docs/evolution/arena.md` - Update admin UI section (merged elo schema)
- `evolution/docs/evolution/experimental_framework.md` - Verify metrics UI references
- `docs/docs_overall/design_style_guide.md` - No changes expected
- `evolution/docs/evolution/rating_and_comparison.md` - No changes expected
- `evolution/docs/evolution/architecture.md` - No changes expected (pipeline docs, not UI)
- `docs/feature_deep_dives/server_action_patterns.md` - No changes expected
