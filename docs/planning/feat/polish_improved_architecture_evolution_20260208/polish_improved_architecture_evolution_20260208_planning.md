# Polish Improved Architecture Evolution Plan

## Background
Polish and improve the evolution framework architecture: clean up code quality, fix known gaps between design and implementation, improve observability, and harden the pipeline for production reliability.

## Problem
The evolution explorer has a blank Articles tab, no way to drill into runs, and forces users to search by ID. Variants and strategies lack human-readable short names. The dashboard shows quality scores that aren't useful, and there's no way to start a run with a specific prompt+strategy from the UI.

## Requirements
1. Fix blank Articles tab on /explorer
2. Add mandatory short names to prompts and strategy configs
3. Remove quality scores from evolution dashboard
4. Explorer dropdowns: show 5 most recent strategies/prompts, searchable by ID or short name
5. Drill into runs from /explorer
6. New "Start Run" section in evolution dashboard (prompt + strategy as required inputs)

## Options Considered

### Prompt short names
- **Option A**: Make existing `title` column mandatory — already exists, minimal migration
- **Option B**: Add separate `short_name` column — cleaner semantics but new column
- **Chosen**: Option A — `title` already serves this purpose, just enforce NOT NULL + non-empty

### Explorer dropdowns
- **Option A**: Radix Select (existing `src/components/ui/select.tsx`) — not searchable
- **Option B**: Custom combobox with search input + dropdown — more work but matches requirements
- **Chosen**: Option B — text input with dropdown results, shows 5 recent by default

### Start Run location
- **Option A**: New section on evolution-dashboard page — most discoverable
- **Option B**: Modal dialog accessible from dashboard — less disruptive to layout
- **Chosen**: Option A — dedicated card section on the dashboard

## Phased Execution Plan

### Phase 1: Bug fix — Articles tab + Task tab query ordering
**Files modified:**
- `src/lib/services/unifiedExplorerActions.ts` — move `.range()` after filters for article (lines 309-320) and task (lines 389-398) views

**What to do:**
- Article view: apply `.in('agent_name', ...)` and `.in('id', ...)` filters BEFORE `.range()`
- Task view: apply `.in('agent_name', ...)` filter BEFORE `.range()`
- Match the Run view pattern (lines 242-248) which correctly orders filters before pagination

### Phase 2: Remove quality scores from evolution UI
**Files modified:**
- `src/app/admin/quality/evolution/page.tsx` — remove `QualityComparison` component (lines 108-155) and its render in `VariantPanel` (lines 353-358), remove `getEvolutionComparisonAction` import/call
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — remove `QualityRadar` dynamic import (lines 15-33), remove quality scores section (lines 136-148)

**Not removing** (still used elsewhere):
- `contentQualityActions.ts` — `getEvolutionComparisonAction` stays (may be used by other pages)
- `evolutionVisualizationActions.ts` — `qualityScores` field stays in `ComparisonData` type (backward compat)

### Phase 3: Drill into runs from /explorer
**Files modified:**
- `src/app/admin/quality/explorer/page.tsx`:
  - Run table rows: wrap run ID cell in `<Link href={/admin/quality/evolution/run/${row.id}}>` (around line 680)
  - Article table rows: wrap `run_id` cell in `<Link>` (around line 752)
  - Task table rows: wrap `run_id` cell in `<Link>` (around line 812)
  - Add `import Link from 'next/link'`

### Phase 4: Prompt & strategy mandatory short names
**New migration:**
- `supabase/migrations/YYYYMMDD_enforce_prompt_title.sql`:
  - Backfill NULL titles: `UPDATE article_bank_topics SET title = LEFT(prompt, 60) WHERE title IS NULL`
  - `ALTER TABLE article_bank_topics ALTER COLUMN title SET NOT NULL`
  - `ALTER TABLE article_bank_topics ADD CONSTRAINT title_not_empty CHECK (LENGTH(TRIM(title)) > 0)`
- Strategy `name` column is already NOT NULL — just add CHECK: `ALTER TABLE strategy_configs ADD CONSTRAINT name_not_empty CHECK (LENGTH(TRIM(name)) > 0)`

**Files modified:**
- `src/lib/services/promptRegistryActions.ts` — enforce non-empty `title` in create/update validation
- `src/lib/services/strategyRegistryActions.ts` — enforce non-empty `name` in create/update validation
- `src/lib/evolution/types.ts` — change `PromptMetadata.title` from `string | null` to `string`
- `src/lib/services/unifiedExplorerActions.ts` — use `title` instead of `prompt.slice(0, 80)` in label resolution

### Phase 5: Explorer dropdowns (prompt + strategy pickers)
**Files modified:**
- `src/lib/services/strategyRegistryActions.ts` — add `limit` param to `getStrategiesAction()`
- `src/lib/services/promptRegistryActions.ts` — add `limit` param to `getPromptsAction()`
- `src/app/admin/quality/explorer/page.tsx`:
  - Replace `MultiInput` for prompt/strategy filters with searchable combobox
  - Load 5 most recent on mount via registry actions with `limit: 5`
  - On search input: filter loaded items client-side by ID or name/prompt text
  - On select: populate filter with selected ID
  - Allow multi-select (comma-separated IDs still supported)

### Phase 6: Start Run section on evolution dashboard
**Files modified:**
- `src/app/admin/evolution-dashboard/page.tsx`:
  - New `StartRunCard` component with:
    - Prompt dropdown (required) — loads from `getPromptsAction({ limit: 10, status: 'active' })`
    - Strategy dropdown (required) — loads presets from `getStrategyPresetsAction()` + recent from `getStrategiesAction({ limit: 5, status: 'active' })`
    - Budget override input (optional)
    - "Queue Run" button → `queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd })`
    - Success: toast with link to run detail page

## Testing

### Unit tests to add/modify
- `src/lib/services/unifiedExplorerActions.test.ts` — fix existing article/task view tests to verify filters apply before pagination
- `src/lib/services/promptRegistryActions.test.ts` — test mandatory title validation, test `limit` parameter
- `src/lib/services/strategyRegistryActions.test.ts` — test mandatory name validation, test `limit` parameter

### Manual verification on stage
- Navigate to /explorer → Articles tab → confirm data appears
- Check prompt titles display in explorer and dropdowns
- Confirm quality scores removed from evolution runs page and compare page
- Test explorer dropdowns show 5 recent, search works by name and ID
- Click run ID in all three explorer tabs → confirm navigation to run detail
- Use Start Run section on dashboard → queue + verify run appears in runs list

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/evolution_framework.md` — Update Prompt primitive to note mandatory title
- `docs/feature_deep_dives/evolution_pipeline.md` — No changes expected
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Remove quality score references, add run drill-down from explorer
- `docs/feature_deep_dives/elo_budget_optimization.md` — No changes expected
- `docs/feature_deep_dives/comparison_infrastructure.md` — No changes expected
