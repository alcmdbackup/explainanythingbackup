# Eliminate Collapsible Pattern Evolution UI Research

## Problem Statement
The evolution UI uses "click to expand" patterns on entity list pages that hide important information behind extra clicks. These should be removed from list pages, with the expanded content moved to the corresponding detail page's Overview tab. Additionally, list views lack upstream source columns (experiment, strategy, run, invocation), and entities (experiments, prompts, strategies) need inline rename support.

## Requirements

### 1. Eliminate collapsible patterns on list pages
- **Prompts list** (`src/app/admin/evolution/prompts/page.tsx`): Remove expandable row that shows "Runs using this prompt" — move to prompt detail Overview tab
- **Experiments list** (`src/app/admin/evolution/analysis/_components/ExperimentHistory.tsx`): Remove chevron toggle that shows run counts, results summary, errors — move to experiment detail Overview tab
- **Arena topic** (`src/app/admin/evolution/arena/[topicId]/page.tsx`): Remove expandable entry row that shows entry detail panel — move to arena entry detail page

**Excluded:** Strategies (handled by another branch), all detail pages

### 2. Add rename capability
- **Experiments**: No update action exists — need new `renameExperimentAction` in `experimentActions.ts`
- **Prompts**: `updatePromptAction` already supports title updates — just need detail page UI
- **Strategies**: `updateStrategyAction` already supports name updates — just need detail page UI (may be handled by other branch)

### 3. Add source columns to list views
- **Runs list**: Add experiment name and strategy name columns
- **Invocations list**: Add experiment name and strategy name columns
- **Variants list**: Add invocation source, run source, and strategy source columns

## High Level Summary

### Collapsible Pattern Inventory

| Page | File | State Variable | Expanded Content |
|------|------|---------------|-----------------|
| Prompts list | `src/app/admin/evolution/prompts/page.tsx` | `expandedPromptId` (string\|null) | Nested runs table (run ID, explanation, status, cost, iterations) |
| Experiments list | `src/app/admin/evolution/analysis/_components/ExperimentHistory.tsx` | `expanded` (boolean per-row) | Run counts, results summary, error messages |
| Arena topic | `src/app/admin/evolution/arena/[topicId]/page.tsx` | `expandedId` (string\|null) | `<EntryDetail>` component in colspan row |

### Rename Capability

Rename must be available on **both** the list view and the detail view for each entity.

| Entity | Name Column | DB Constraint | Update Action | List Page | Detail Page |
|--------|------------|---------------|---------------|-----------|-------------|
| Experiments | `name` TEXT NOT NULL | No min length, no unique | ❌ Must create | `ExperimentHistory.tsx` | `ExperimentDetailContent.tsx` |
| Prompts | `title` TEXT NOT NULL | CHECK LENGTH(TRIM(title)) > 0 | ✅ `updatePromptAction` | `prompts/page.tsx` (has `PromptFormDialog` with edit) | `prompts/[promptId]/page.tsx` |
| Strategies | `name` TEXT NOT NULL | CHECK LENGTH(TRIM(name)) > 0 | ✅ `updateStrategyAction` | `strategies/page.tsx` (has edit dialog) | `StrategyDetailContent.tsx` |

**Prompts list** already has a `PromptFormDialog` with title editing via `handleUpdate` → `updatePromptAction`. Need to verify this is accessible inline (e.g., pencil icon per row).
**Strategies list** already has an edit dialog via `handleUpdate` → `updateStrategyAction`. Same — verify inline accessibility. May defer to other branch.
**Experiments list** has no edit capability anywhere — need new action + UI on both list and detail.

### List View Source Columns

**FK chain:** All three list views connect to experiment and strategy via `evolution_runs`:
```
invocations/variants
    ↓ run_id (FK)
evolution_runs
    ├→ experiment_id (FK) → evolution_experiments.name
    └→ strategy_config_id (FK) → evolution_strategy_configs.name
```

| List View | Server Action | Current Columns | New Columns Needed |
|-----------|--------------|----------------|-------------------|
| Runs | `getEvolutionRunsAction` (`evolutionActions.ts:319`) | ID, explanation, status, phase, variants, cost, est cost, budget, duration, created | + experiment name, + strategy name |
| Invocations | `listInvocationsAction` (`evolutionVisualizationActions.ts:1461`) | agent, run ID, iteration, status, cost, created | + experiment name, + strategy name |
| Variants | `listVariantsAction` (`evolutionActions.ts:666`) | ID, run ID, agent, Elo, matches, generation, winner, created | + invocation source, + run source, + strategy name |

**Interface changes needed:**
- `EvolutionRun` already has `experiment_id` and `strategy_config_id` — just need to join for names
- `InvocationListEntry` has `run_id` — needs join through runs for experiment/strategy names
- `VariantListEntry` has `run_id` — needs join through runs for strategy; invocation source needs reverse lookup

**Variants → Invocation source:** No direct FK from `evolution_variants` to `evolution_agent_invocations`. The link is indirect (variant created by an agent invocation, but the variant stores `agent_name` not `invocation_id`). May need to match by `run_id + agent_name + iteration` or accept that this column shows the agent name (already present).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/strategy_experiments.md

## Code Files Read
- `src/app/admin/evolution/prompts/page.tsx` — prompts list with expandable rows
- `src/app/admin/evolution/analysis/_components/ExperimentHistory.tsx` — experiment history with chevron toggle
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — arena topic with expandable entries
- `evolution/src/services/experimentActions.ts` — experiment actions (no update/rename)
- `evolution/src/services/promptRegistryActions.ts` — prompt actions (updatePromptAction exists)
- `evolution/src/services/strategyRegistryActions.ts` — strategy actions (updateStrategyAction exists)
- `evolution/src/services/evolutionActions.ts` — runs/variants list actions
- `evolution/src/services/evolutionVisualizationActions.ts` — invocations list action
