# Further Refinements To Evolution Infra Plan

## Background
Polish and refine the evolution infrastructure UI/UX across multiple pages: fix z-index bugs on prompt/strategy menus, add pipeline type enum with pre-selected explorer dropdown values, remove redundant sections (quality scores, data points, ops dashboard tab), consolidate dashboard views, improve date filtering with preset dropdowns, rename "article bank" to "hall of fame" throughout UI and code, and implement automatic top-3 variant insertion into the hall of fame with re-ranking when evolution runs complete.

## Requirements (from GH Issue #379)

### Bug Fixes
1. **Z-index bug**: Menus for prompts/strategies show up behind cards — should be in front

### UI Renames & Removals
2. **Pipeline type enum**: Store pipeline types in an enum somewhere; pre-selected values in dropdown under Explorer
3. **Remove quality scores section** entirely from evolution dashboard
4. **Rename "Runs" to "Start Pipeline"**
5. **Remove data points at the top** of the dashboard
6. **Consolidate "Ops Dashboard"**: Merge graphs from ops dashboard into "Overview" tab, then remove the ops dashboard tab entirely (redundant)

### Explorer Improvements
7. **Date filtering**: Replace date range with a dropdown: "Last 1 Day", "Last Week", "Last Month", "Custom Date Range". Custom date range should accept freeform dates like today's implementation.

### Article Bank → Hall of Fame
8. **Rename "Article Bank" to "Hall of Fame"** in both UI and code
9. **Auto-insert top 3**: When any evolution run finishes, automatically add the top 3 articles to the hall of fame
10. **Auto re-ranking on insertion**: Trigger automatic comparison/re-ranking when new articles are added to the hall of fame (currently entirely manual)

## Problem
The evolution admin UI has accumulated UX debt: dropdown menus render behind cards (z-index), the sidebar has redundant entries (Ops Dashboard duplicates Overview, Quality Scores is unrelated), naming is inconsistent ("Runs" vs "Start Pipeline", "Article Bank" vs the conceptual "Hall of Fame"), and the explorer lacks preset date filters. Most critically, new hall of fame entries are never automatically compared/ranked — an admin must manually trigger comparisons after every pipeline run.

## Options Considered

### Auto re-ranking approach
- **Option A**: Call `runBankComparisonAction` from `feedHallOfFame()` — rejected because it requires `requireAdmin()` auth
- **Option B** (chosen): Extract comparison logic into `runBankComparisonInternal()` (no auth gate), call it from `feedHallOfFame()` with dynamic import to avoid circular deps
- **Option C**: DB trigger on `article_bank_entries` INSERT — rejected, too complex and hard to test

### Article Bank rename approach
- **Option A** (chosen): DB migration with `ALTER TABLE RENAME`, code sweep with file renames
- **Option B**: Create new tables + backfill — rejected, unnecessarily complex for a rename

### Z-index fix approach
- **Option A**: Convert all native `<select>` to Radix UI Select — rejected, too much churn for the fix
- **Option B** (chosen): Add `relative z-10` to parent wrappers + bump SearchableMultiSelect from z-30 to z-50

## Phased Execution Plan

### Phase 1: Quick UI Fixes (Reqs 1, 3, 4, 5)

**Req 1 — Z-index**:
- `src/app/admin/quality/explorer/page.tsx:273` — `z-30` → `z-50`
- `src/app/admin/quality/evolution/page.tsx` — `relative z-10` on select parents
- `src/app/admin/quality/article-bank/page.tsx` — `relative z-10` on select parents
- `src/components/evolution/tabs/VariantsTab.tsx` — `relative z-10` on filter parent

**Req 3 — Remove Quality Scores**:
- `src/components/admin/EvolutionSidebar.tsx` — remove nav item + activeOverride
- `src/app/admin/evolution-dashboard/page.tsx` — remove QuickLinkCard

**Req 4 — Rename Runs → Start Pipeline**:
- `EvolutionSidebar.tsx:8` — `label: 'Start Pipeline'`
- `evolution/page.tsx:163` — `Start New Pipeline`
- `evolution/page.tsx:196` — `'Start Pipeline'`

**Req 5 — Remove stat cards**:
- `evolution-dashboard/page.tsx:140-175` — delete stat cards grid + StatCard + derived stats
- `evolution/dashboard/page.tsx:120-126` — delete stat cards

**Tests**: Update `EvolutionSidebar.test.tsx`, `evolution-dashboard/page.test.tsx`

### Phase 2: Explorer Improvements (Reqs 2, 7)

**Req 2 — Pipeline type dropdown**:
- `src/lib/evolution/types.ts` — add `PIPELINE_TYPES` constant array
- `explorer/page.tsx` — replace `MultiInput` with `SearchableMultiSelect` for pipeline types
- Change `pipelineFilter` state from `string` to `string[]`, update `buildFilters()`

**Req 7 — Date presets**:
- `explorer/page.tsx` — add `DatePreset` type: `'last1d' | 'last7d' | 'last30d' | 'custom'`
- Add preset `<select>` dropdown; preset selection auto-computes from/to
- "Custom" reveals existing `<input type="date">` fields

### Phase 3: Consolidate Ops Dashboard → Overview (Req 6)

1. Copy `RunsChart` + `SpendChart` + `ChartSkeleton` from `dashboard/page.tsx` into `evolution-dashboard/page.tsx`
2. Add charts + Recent Runs table below Quick Links in Overview
3. Delete `src/app/admin/quality/evolution/dashboard/page.tsx`
4. Remove Ops Dashboard from sidebar + QuickLinkCard + Dashboard link button on evolution page
5. Update tests

### Phase 4: Auto Re-Ranking (Reqs 9, 10)

**Req 9**: Verify `feedHallOfFame()` tests pass — no code changes needed.

**Req 10**:
1. `src/lib/services/articleBankActions.ts` — extract `runBankComparisonInternal()` (no auth gate)
2. `src/lib/evolution/core/pipeline.ts` — after insertion loop in `feedHallOfFame()`, dynamically import and call `runBankComparisonInternal(topicId, 'gpt-4.1-nano', 1)` in try/catch (non-fatal)
3. Tests: mock import in `hallOfFame.test.ts`, unit test for `runBankComparisonInternal`

### Phase 5: Rename Article Bank → Hall of Fame (Req 8)

1. **DB migration**: `ALTER TABLE article_bank_* RENAME TO hall_of_fame_*` (4 tables + indexes + constraints)
2. **Route rename**: `article-bank/` → `hall-of-fame/`
3. **Actions rename**: `articleBankActions.ts` → `hallOfFameActions.ts` (15+ functions, 5+ types, 50+ table refs)
4. **All consumers** (~25 files): EvolutionSidebar, evolution-dashboard, pipeline.ts, promptRegistryActions, unifiedExplorerActions, evolutionVisualizationActions, evolutionActions, types.ts, comparison.ts
5. **Scripts**: rename `add-to-bank.ts`, `run-bank-comparison.ts`, `lib/bankUtils.ts`
6. **UI text**: all user-facing "Article Bank" → "Hall of Fame"
7. **Tests** (~10 files): rename + update mocks/assertions
8. **Docs** (4 files): evolution_pipeline.md, comparison_infrastructure.md, evolution_framework.md, architecture.md
- **NOT renamed**: `promptBankConfig.ts`, `run-prompt-bank*.ts` (separate Prompt Bank system)

## Testing

### Per-phase verification
- After each phase: `npm run lint && npx tsc --noEmit && npm run build`
- Run affected unit tests per phase (listed above)

### New tests to write
- Date preset computation logic (Phase 2)
- `runBankComparisonInternal` unit test (Phase 4)
- `feedHallOfFame` calls re-ranking after insert (Phase 4)

### Existing tests to update
- `EvolutionSidebar.test.tsx` — Phases 1, 3, 5
- `evolution-dashboard/page.test.tsx` — Phases 1, 3, 5
- `articleBankActions.test.ts` → `hallOfFameActions.test.ts` — Phases 4, 5
- `hallOfFame.test.ts` — Phase 4, 5
- Integration + E2E tests — Phase 5

### Final verification
- Full test suite: `npx jest --passWithNoTests`
- E2E: `npm run test:e2e` (if available)
- Manual: navigate all admin pages, verify no broken links

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/evolution_pipeline.md` - pipeline completion flow, hall of fame auto-insertion, table names, script refs
- `docs/feature_deep_dives/evolution_framework.md` - hall of fame rename, pipeline type enum
- `docs/feature_deep_dives/elo_budget_optimization.md` - dashboard consolidation changes
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` - dashboard/UI restructuring
- `docs/feature_deep_dives/comparison_infrastructure.md` - article bank → hall of fame rename (title, tables, paths, headings)
- `docs/feature_deep_dives/outline_based_generation_editing.md` - any bank references renamed
- `docs/docs_overall/architecture.md` - table names in DB schema section
