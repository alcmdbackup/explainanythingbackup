# Further Refinements To Evolution Infra Research

## Problem Statement
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
10. **Auto re-ranking on insertion**: Currently the entire comparison/ranking flow is manual (no DB triggers, crons, or webhooks). Need to implement automatic re-ranking when new articles are added to the hall of fame — `runBankComparisonAction` equivalent triggered automatically after `feedHallOfFame()`.

### Current State of Auto-Ranking (research finding)
- Adding articles → just creates rows in `article_bank_entries` + `article_bank_elo` — no side effects
- Evolution runs → only queued manually via admin UI
- After run completes → triggers quality eval on winning variant (`triggerPostEvolutionEval`), but does NOT queue further runs or comparisons
- Bank comparisons/ranking → manually triggered via `runBankComparisonAction`
- No database triggers, crons, or webhooks watching `article_bank_topics` for new rows

## High Level Summary

Research identified all code locations for each of the 10 requirements. The changes span UI components, server actions, types, database tables, scripts, tests, and documentation. The largest change by scope is the "article bank" → "hall of fame" rename (~25 source files, 4 DB tables, route restructure). The most architecturally significant change is auto re-ranking after hall of fame insertion, which requires adding a `runBankComparisonAction` call inside `feedHallOfFame()` in the pipeline finalization sequence.

---

## Detailed Findings

### 1. Z-Index Bug — Menus Behind Cards

**Root cause**: The evolution admin pages use **native HTML `<select>` elements** (no z-index control) instead of Radix UI Select (which uses z-50 portals). Parent card containers create stacking contexts that trap the native dropdowns.

**Affected components**:

| Component | File | Lines | Issue |
|-----------|------|-------|-------|
| Prompt dropdown (StartRunCard) | `src/app/admin/quality/evolution/page.tsx` | 168 | Native `<select>`, no z-index |
| Strategy dropdown (StartRunCard) | `src/app/admin/quality/evolution/page.tsx` | 175 | Native `<select>`, no z-index |
| Date range filter | `src/app/admin/quality/evolution/page.tsx` | 539-549 | Native `<select>`, no z-index |
| Status filter | `src/app/admin/quality/evolution/page.tsx` | 539-549 | Native `<select>`, no z-index |
| Topic select (GenerateArticleDialog) | `src/app/admin/quality/article-bank/page.tsx` | 375 | Native `<select>` |
| Model select (GenerateArticleDialog) | `src/app/admin/quality/article-bank/page.tsx` | 407 | Native `<select>` |
| Strategy filter (VariantsTab) | `src/components/evolution/tabs/VariantsTab.tsx` | 99-106 | Native `<select>` |
| SearchableMultiSelect dropdown | `src/app/admin/quality/explorer/page.tsx` | 273 | Uses z-30, but lower than z-50 |

**Card containers causing the overlap** (all use `bg-[var(--surface-elevated)]`):
- StartRunCard: `src/app/admin/quality/evolution/page.tsx:159`
- Variant Panel: `src/app/admin/quality/evolution/page.tsx:302`
- Summary Cards: `src/app/admin/quality/evolution/page.tsx:71-77`

**Existing z-index pattern**: z-50 for modals/dialogs/Radix, z-30 for explorer custom dropdown, z-10 for sticky headers, no z-index for native selects.

**Select styling class** (line 155): `const selectClass = 'px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-sm font-ui';`

---

### 2. Pipeline Type — Current Definition and Explorer Usage

**Type definition**: `src/lib/evolution/types.ts:301`
```typescript
export type PipelineType = 'full' | 'minimal' | 'batch';
```
Currently a **union type**, not an enum.

**Explorer page pipeline type filter**: `src/app/admin/quality/explorer/page.tsx`
- Line 595-599: Text input field for pipeline types (comma-separated)
- Line 448: Parsing: `pipelineFilter.split(',').map(s => s.trim()).filter(Boolean)`
- Line 449: Cast to `ExplorerFilters['pipelineTypes']`

**Server-side**: `src/lib/services/unifiedExplorerActions.ts`
- Line 19: `pipelineTypes?: PipelineType[];` in ExplorerFilters interface
- Line 204: `.in('pipeline_type', filters.pipelineTypes)` filter application
- Lines 870-876: Pipeline type label resolution in `resolveDimensionLabels`

---

### 3. Quality Scores Section — Location

**File**: `src/app/admin/quality/page.tsx`
- Line 2: Header — "content quality evaluation scores page"
- Lines 210-268: Quality scores table (tab-based, "Article Scores" tab)

**Quick link to it from evolution dashboard**: `src/app/admin/evolution-dashboard/page.tsx`
- Lines 206-209: Card labeled "Quality Scores" linking to `/admin/quality`

---

### 4. "Runs" Label → "Start Pipeline"

**Sidebar nav item**: `src/components/admin/EvolutionSidebar.tsx:8`
```typescript
{ href: '/admin/quality/evolution', label: 'Runs', icon: '🔄', testId: 'evolution-sidebar-nav-pipeline-runs' }
```

**Start run card on page**: `src/app/admin/quality/evolution/page.tsx`
- Line 163: Heading `Start New Run`
- Line 196: Button label `'Start Run'`

---

### 5. Data Points at Top of Dashboard

**Ops Dashboard stat cards**: `src/app/admin/quality/evolution/dashboard/page.tsx`
- Lines 120-126: Four stat cards: "Active Runs", "Queue Depth", "7d Success Rate", "Monthly Spend"
- Lines 70-80: `StatCard` component definition

**Overview Dashboard stat cards**: `src/app/admin/evolution-dashboard/page.tsx`
- Lines 140-175: Six stat cards: "Last Completed Run", "7d Success Rate", "Monthly Spend", "Article Bank Size", "Avg Elo/$", "Failed Runs"

---

### 6. Ops Dashboard Tab — Contents and Consolidation Target

**Sidebar entry**: `src/components/admin/EvolutionSidebar.tsx:9`
```typescript
{ href: '/admin/quality/evolution/dashboard', label: 'Ops Dashboard', icon: '📈', testId: 'evolution-sidebar-nav-ops-dashboard' }
```

**Ops Dashboard page**: `src/app/admin/quality/evolution/dashboard/page.tsx`
- Lines 20-38: `RunsChart` component (dynamic import)
- Lines 40-56: `SpendChart` component (dynamic import)
- Lines 120-126: Stat cards (Active Runs, Queue Depth, 7d Success Rate, Monthly Spend)
- Lines 128-138: Two chart cards (Runs Over Time, Daily Spend)
- Lines 140-182: Recent Runs table

**Overview page (consolidation target)**: `src/app/admin/evolution-dashboard/page.tsx`
- Lines 140-175: Stat cards
- Lines 177-212: Quick Links section with cards to sub-pages

---

### 7. Date Filtering — Current Implementations

**Two implementations exist**:

**A. Main evolution page** (`src/app/admin/quality/evolution/page.tsx`):
- Lines 27-44: `DateRange` type with presets `'7d' | '30d' | '90d' | 'all'`
- Lines 539-549: Native `<select>` dropdown with 4 options
- Only passes `startDate` to server (no end date)

**B. Explorer page** (`src/app/admin/quality/explorer/page.tsx`):
- Lines 398-399: State: `dateFrom`, `dateTo` as strings
- Lines 600-617: Two `<input type="date">` fields (From/To)
- Lines 444-454: `buildFilters()` — uses fallback dates `2000-01-01`/`2099-12-31`

**Server-side** (`src/lib/services/unifiedExplorerActions.ts`):
- Lines 193-209: `applyRunFilters()` — `.gte('created_at', from)` and `.lte('created_at', to)`
- Line 19: `dateRange?: { from: string; to: string }` in ExplorerFilters

---

### 8. Article Bank → Hall of Fame Rename Scope

**Database (4 tables — need migration)**:
- `article_bank_topics` → `hall_of_fame_topics`
- `article_bank_entries` → `hall_of_fame_entries`
- `article_bank_comparisons` → `hall_of_fame_comparisons`
- `article_bank_elo` → `hall_of_fame_elo`

**Route structure (Next.js file moves)**:
- `src/app/admin/quality/article-bank/page.tsx` → `src/app/admin/quality/hall-of-fame/page.tsx`
- `src/app/admin/quality/article-bank/[topicId]/page.tsx` → `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx`

**Server actions** (`src/lib/services/articleBankActions.ts`):
- 15+ exported function names (e.g., `getBankTopicsAction` → `getHallOfFameTopicsAction`)
- 5+ type exports (e.g., `BankTopicWithStats` → `HallOfFameTopicWithStats`)
- 50+ `.from('article_bank_*')` Supabase calls

**Other services with table references**:
- `src/lib/services/promptRegistryActions.ts` — 9 references to `article_bank_topics`
- `src/lib/services/unifiedExplorerActions.ts` — 4 references
- `src/lib/services/evolutionVisualizationActions.ts` — variable name `articleBankSize`, table refs
- `src/lib/services/evolutionActions.ts` — 1 reference

**UI components**:
- `src/components/admin/EvolutionSidebar.tsx:14` — label, href, testId
- `src/app/admin/evolution-dashboard/page.tsx` — stat card label "Article Bank Size", quick link card

**Pipeline core**:
- `src/lib/evolution/core/pipeline.ts` — comments + 20+ table references in `feedHallOfFame()` and `autoLinkPrompt()`
- `src/lib/evolution/types.ts:303` — comment about table name
- `src/lib/evolution/comparison.ts` — comment

**Scripts** (consider renaming files):
- `scripts/add-to-bank.ts`
- `scripts/run-bank-comparison.ts`
- `scripts/lib/bankUtils.ts`

**Tests (8+ files)**:
- `src/lib/services/articleBankActions.test.ts`
- `src/__tests__/integration/article-bank-actions.integration.test.ts`
- `src/__tests__/e2e/specs/09-admin/admin-article-bank.spec.ts`
- `src/components/admin/EvolutionSidebar.test.tsx`
- `src/components/admin/AdminSidebar.test.tsx`
- `src/components/admin/SidebarSwitcher.test.tsx`
- `src/lib/services/promptRegistryActions.test.ts`
- `src/lib/services/unifiedExplorerActions.test.ts`
- `src/lib/services/runTriggerContract.test.ts`
- `src/app/admin/evolution-dashboard/page.test.tsx`

**Documentation (3 files)**:
- `docs/feature_deep_dives/evolution_pipeline.md` — script refs, table names
- `docs/feature_deep_dives/comparison_infrastructure.md` — title, tables, paths, headings
- `docs/docs_overall/architecture.md` — references

**NOT renamed**: `promptBankConfig.ts` and `run-prompt-bank*.ts` — these are the Prompt Bank (different system).

---

### 9–10. Auto-Insert Top 3 + Auto Re-Ranking

**Current auto-insertion**: `feedHallOfFame()` already exists in `src/lib/evolution/core/pipeline.ts:507-624`. It:
1. Gets top 3 variants via `ctx.state.getTopByRating(3)`
2. Resolves topic_id (from prompt_id, explanation title, or creates new)
3. Upserts into `article_bank_entries` with `generation_method: 'evolution_winner'` (rank 1) or `'evolution_top3'` (rank 2-3)
4. Initializes `article_bank_elo` with Elo = 1200

**`finalizePipelineRun()` call order** (`pipeline.ts:374-411`):
1. `persistVariants()` → `content_evolution_variants`
2. `persistAgentMetrics()` → `evolution_run_agent_metrics`
3. `linkStrategyConfig()` → `strategy_configs`
4. `autoLinkPrompt()` → resolve `prompt_id`
5. `feedHallOfFame()` → insert top 3 into bank ← **currently the last step**

**What's missing**: After `feedHallOfFame()`, no comparison/ranking is triggered. The gap:
- `runBankComparisonAction()` (`articleBankActions.ts:335-495`) does Swiss-style pairwise comparisons
- It requires: `topicId`, `judgeModel` (default `gpt-4.1-nano`), `rounds` (1-10)
- Flow: fetch entries → Swiss-pair by Elo → `compareWithBiasMitigation()` → update Elo → persist
- Elo formula: standard K=32, confidence-weighted scoring

**`feedHallOfFame()` returns the `topicId`** it resolved/created, which is exactly what `runBankComparisonAction` needs as input.

**Comparison logic** (`src/lib/evolution/comparison.ts:67-119`):
- 2-pass A/B reversal for position bias mitigation
- Order-invariant SHA-256 cache
- Returns `{ winner: 'A'|'B'|'TIE', confidence: 0-1, turns: 2 }`

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_framework.md
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/outline_based_generation_editing.md

## Code Files Read
- src/app/admin/quality/evolution/page.tsx — main evolution page (start run, filters, runs table)
- src/app/admin/quality/evolution/dashboard/page.tsx — ops dashboard (stat cards, charts, recent runs)
- src/app/admin/evolution-dashboard/page.tsx — overview dashboard (stat cards, quick links)
- src/app/admin/quality/explorer/page.tsx — unified explorer (filters, view modes, tables)
- src/app/admin/quality/article-bank/page.tsx — article bank topic list
- src/app/admin/quality/article-bank/[topicId]/page.tsx — topic detail (leaderboard, comparisons)
- src/app/admin/quality/page.tsx — quality scores page
- src/components/admin/EvolutionSidebar.tsx — sidebar navigation
- src/components/evolution/tabs/VariantsTab.tsx — variant table with strategy filter
- src/components/ui/select.tsx — Radix UI Select (z-50)
- src/lib/evolution/types.ts — PipelineType union type
- src/lib/evolution/core/pipeline.ts — finalizePipelineRun, feedHallOfFame, autoLinkPrompt
- src/lib/evolution/comparison.ts — compareWithBiasMitigation
- src/lib/services/articleBankActions.ts — bank CRUD, comparison, Elo updates
- src/lib/services/unifiedExplorerActions.ts — explorer filters, date range handling
- src/lib/services/promptRegistryActions.ts — prompt CRUD (references article_bank_topics)
- src/lib/services/evolutionVisualizationActions.ts — dashboard data, articleBankSize
- src/lib/services/evolutionActions.ts — run trigger
- supabase/migrations/20260201000001_article_bank.sql — 4 table definitions
- Multiple test files across services, components, integration, and E2E
