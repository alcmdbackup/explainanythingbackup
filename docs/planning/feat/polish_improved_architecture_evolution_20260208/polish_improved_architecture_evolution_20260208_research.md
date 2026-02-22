# Polish Improved Architecture Evolution Research

## Problem Statement
Polish and improve the evolution framework architecture: clean up code quality, fix known gaps between design and implementation, improve observability, and harden the pipeline for production reliability.

## Requirements
1. **Articles tab blank on /explorer** — Fix the blank Articles tab under the unified explorer
2. **Mandatory short names for prompts and strategies** — Both prompts and strategy configs need user-facing short names
3. **Remove quality scores from evolution dashboard** — Strip quality score references from the evolution dashboard
4. **Explorer dropdowns show 5 most recent** — Strategy and prompt dropdowns should show 5 most recent items instead of forcing ID search; searchable by ID or short name
5. **Drill into runs from /explorer** — Clicking a run row in explorer should navigate to the run detail page
6. **Start Run section in evolution dash** — New UI section to initiate runs with mandatory prompt + strategy selection

## High Level Summary

Six issues researched across the evolution UI. Root causes identified for all items — most are UI-only changes, one is a query bug, and one requires a new DB column + migration.

---

## 1. Articles Tab Blank on /explorer

**Root cause**: Pagination (`.range()`) applied BEFORE conditional filters in `unifiedExplorerActions.ts`.

**Files**:
- `src/lib/services/unifiedExplorerActions.ts` lines 309-320 — article view query applies `.range()` then `.in()` filters
- Same bug in Task view (lines 389-398)
- Run view does it correctly (lines 242-248) — uses `applyRunFilters()` before pagination

**Fix**: Move `.range()` after all `.in()` filters, matching the Run view pattern.

---

## 2. Prompt & Strategy Short Names

**Strategies already have naming**: `evolution_strategy_configs` table has `name` (user-editable), `label` (auto-generated), `description` columns. `StrategyConfigRow` type in `strategyConfig.ts:23-44` exposes all three. Just need to enforce `name` is non-empty.

**Prompts have optional title only**:
- `article_bank_topics` table: has `prompt` (full text), `title` (optional), `difficulty_tier`, `domain_tags`
- `PromptMetadata` interface (`types.ts:304-313`): `title` is `string | null`
- `promptRegistryActions.ts:25-53`: `getPromptsAction` selects `title` but it's nullable
- Explorer label resolution (`unifiedExplorerActions.ts:835-874`): falls back to `prompt.slice(0, 80)` when no title

**What's needed**:
- Make `title` mandatory on `article_bank_topics` (or add a `short_name` column)
- Enforce non-empty title in `createPromptAction` and `updatePromptAction` validation
- Strategy: enforce `name` non-empty in create/update actions
- Explorer + dropdowns: display title/name instead of truncated prompt text or raw IDs

---

## 3. Quality Scores to Remove

**Evolution runs page** (`evolution/page.tsx`):
- Lines 108-155: `QualityComparison` component showing before/after dimension scores
- Lines 353-358: Conditional render in `VariantPanel`
- Data from `getEvolutionComparisonAction` in `contentQualityActions.ts:242-320`

**Compare page** (`run/[runId]/compare/page.tsx`):
- Lines 15-33: `QualityRadar` dynamic component (Recharts radar chart)
- Lines 136-148: Quality scores section, conditional on `data.qualityScores`
- Data from `getEvolutionRunComparisonAction` in `evolutionVisualizationActions.ts:712-800`

**Server actions feeding quality data**:
- `contentQualityActions.ts` — `EvolutionComparison` interface (lines 232-240), `getEvolutionComparisonAction` (lines 242-320)
- `evolutionVisualizationActions.ts` — `qualityScores` field in `ComparisonData` (line 144), extraction from `allCritiques` (lines 756-776)

---

## 4. Explorer Dropdowns

**Current implementation**: Text inputs (`MultiInput` component, `explorer/page.tsx:203-221`) accepting comma-separated IDs. Filter state is raw strings (`promptFilter`, `strategyFilter` at lines 289-293), parsed via `.split(',')` in `buildFilters()` (lines 318-330).

**Server actions already support ordering**:
- `getStrategiesAction()` (`strategyRegistryActions.ts:32-59`): ordered by `last_used_at` desc
- `getPromptsAction()` (`promptRegistryActions.ts:25-55`): ordered by `created_at` desc
- Both return ALL items — need `limit` parameter for "5 most recent"

**Available UI components**: Radix `Select` in `src/components/ui/select.tsx`. Not currently used in explorer.

**What's needed**:
- Add optional `limit` param to both registry actions
- Replace `MultiInput` with searchable combobox (search by ID or name/prompt text)
- Show 5 most recent by default, full list on search

---

## 5. Drill Into Runs from /explorer

**Run IDs already present in all explorer data**:
- `ExplorerRunRow.id` (lines 38-52)
- `ExplorerArticleRow.run_id` (lines 54-67)
- `ExplorerTaskRow.run_id` (lines 69-79)

**Run detail URL pattern**: `/admin/quality/evolution/run/[runId]`

**Current state**: None of the three tables (Run, Article, Task) have click handlers or `<Link>` navigation. Run IDs displayed truncated (`row.id.substring(0,8)`).

**What's needed**: Wrap run ID cells in `<Link href={...}>` — purely UI change, no backend work.

---

## 6. Start Run Section

**Current queue flow** (`evolutionActions.ts:66-147`):
- `queueEvolutionRunAction` accepts optional `explanationId`, `promptId`, `strategyId`, `budgetCapUsd`
- Validates `promptId` against `article_bank_topics` (lines 79-87)
- Validates `strategyId` against `evolution_strategy_configs` (lines 91-102), uses strategy's budget if no override
- Inserts run with `prompt_id` and `strategy_config_id` FKs

**Existing queue dialog** (`evolution/page.tsx:159-226`): Only has explanation ID + budget cap inputs. NO prompt or strategy selection.

**Strategy presets available**: `getStrategyPresetsAction()` (lines 408-417) returns Economy/Balanced/Quality presets.

**What's needed for new "Start Run" section on dashboard**:
- Prompt dropdown (required) — from `getPromptsAction()`, show title or truncated prompt
- Strategy dropdown (required) — presets + custom strategies from `getStrategiesAction()`
- Budget cap override (optional, defaults from strategy)
- Call `queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd })` — no explanationId needed
- Optionally auto-trigger via `triggerEvolutionRunAction` after queue

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/evolution_framework.md
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/comparison_infrastructure.md

## Code Files Read
- src/lib/services/unifiedExplorerActions.ts (explorer server actions, filters, queries)
- src/app/admin/quality/explorer/page.tsx (explorer UI, filter inputs, tables)
- src/lib/evolution/types.ts (TextVariation, PromptMetadata, PipelineType)
- src/lib/evolution/core/strategyConfig.ts (StrategyConfigRow, hash, label)
- src/lib/services/strategyRegistryActions.ts (strategy CRUD, presets)
- src/lib/services/promptRegistryActions.ts (prompt CRUD)
- src/lib/services/evolutionActions.ts (queue, trigger, variants, apply winner)
- src/lib/evolution/core/pipeline.ts (persistVariants, finalize)
- src/lib/services/contentQualityActions.ts (EvolutionComparison, quality scores)
- src/lib/services/evolutionVisualizationActions.ts (dashboard data, comparison data)
- src/app/admin/evolution-dashboard/page.tsx (main dashboard)
- src/app/admin/quality/evolution/page.tsx (runs management, queue dialog)
- src/app/admin/quality/evolution/dashboard/page.tsx (ops dashboard)
- src/app/admin/quality/evolution/run/[runId]/page.tsx (run detail)
- src/app/admin/quality/evolution/run/[runId]/compare/page.tsx (compare page)
- src/components/ui/select.tsx (Radix Select component)
- supabase/migrations/ (evolution_strategy_configs, evolution_variants schemas)
- src/lib/evolution/agents/generationAgent.ts (variant strategy assignment)
