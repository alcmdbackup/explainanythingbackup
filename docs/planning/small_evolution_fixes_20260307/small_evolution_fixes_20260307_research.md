# Small Evolution Fixes Research

## Problem Statement
A few small fixes for the evolution dashboard. This project addresses several UX and functionality gaps in the evolution admin UI including strategy archiving, experiment strategy selection, arena cost-based filtering, invocation detail linking, and strategy creation form improvements.

## Requirements (from GH Issue #667)
- [ ] Should be able to archive strategies and hide them from appropriate places
- [ ] Should be able to select from pre-defined strategies in "start experiment" - these should explain key settings when selected. Remove ability to define net new strategy/group (select existing instead), creating a new strategy should be done from strategies tab.
- [ ] Experiment should only let you add matching strategies with same cost budget
- [ ] Update "create strategy" from strategy overview page so it is like "create run" from "start experiment". Get rid of pipeline type and iterations option (we run until we hit limit). Also add a field for cost limit for that strategy.
- [ ] No invocation details page is linked from invocation overview tab in evolution dashboard
- [ ] Arena should only compare strategies with similar cost limits against each other. Should start with a default filter.

## User Clarifications
- **Iterations**: Keep the field in StrategyConfig, just default to 50 (the max cap) in the create strategy form. Don't remove from interface or hash.
- **Experiment runs per strategy**: Allow user to set # of runs per strategy (default 1, min 1). Multiple runs of the same strategy enable statistical significance testing.
- **Experiment review screen**: Show per-strategy subtotal (budget × runs) and total cost across all runs, plus max budget cap ($10) for reference.

## High Level Summary

Research across 12 agents (3 rounds of 4) reveals that much of the infrastructure already exists but needs wiring together. Strategy archiving DB schema exists but isn't enforced in all selection flows. The experiment form builds per-run configs inline instead of selecting existing strategies. The invocations list page links agent names to detail pages but the user expects more prominent links. Arena has cost data on entries but no filtering UI. The strategy creation form includes pipeline_type and iterations fields — pipeline_type should be removed, iterations should default to 50.

## Key Findings

### 1. Strategy Archiving — Infrastructure Exists, Enforcement Incomplete
- **DB column already exists**: `evolution_strategy_configs.status` with CHECK `('active', 'archived')` — migration `20260207000007`
- **CRUD actions exist**: `archiveStrategyAction()`, `deleteStrategyAction()` in `strategyRegistryActions.ts`
- **UI exists**: Strategy list page has archive button, status filter dropdown, StatusBadge component
- **GAP**: Archived strategies are NOT filtered out when:
  - Queuing runs (`queueEvolutionRunAction` — no status check)
  - Creating experiment runs (`addRunToExperimentAction` — no status check)
  - Analytics queries (`costAnalyticsActions.ts`, `eloBudgetActions.ts`)
  - Strategy selection UIs outside the strategy list page

### 2. Experiment Strategy Selection — Inline Config, Not Strategy Selection
- **Current flow**: ExperimentForm is a 3-step wizard (Setup → Runs → Review)
- **Step 2 builds config inline**: Per-run generationModel, judgeModel, enabledAgents toggles via `RunFormState`
- **No strategy picker**: Strategies are auto-created via `resolveOrCreateStrategyFromRunConfig()` at run add time
- **Budget is experiment-level**: Single `budgetPerRun` value applied to all runs
- **New flow**: Replace step 2 with strategy selection from existing active strategies, filtered by budget compatibility
- **Runs per strategy**: Allow setting count (default 1) to enable statistical significance testing
- **Review screen**: Show per-strategy subtotal and total cost with max budget cap reference

### 3. Strategy Creation Form — Simplify + Add budgetCapUsd
- **Current form fields**: name, description, pipelineType, generationModel, judgeModel, iterations, enabledAgents, singleArticle
- **Remove from form**: `pipelineType` selector (always `full`)
- **Default iterations to 50**: Keep in StrategyConfig interface and hash, just set default to 50 in form
- **Add**: `budgetCapUsd` field (cost limit for the strategy)
- **StrategyConfig interface** (`strategyConfig.ts`): Currently has `iterations: number` but NOT `budgetCapUsd`
- **budgetCapUsd already partially supported**: `evolutionActions.ts:179` reads `strategyConfig?.budgetCapUsd` with fallback
- **Form utilities**: `strategyFormUtils.ts` has `formToConfig()` and `rowToForm()` — need to add budgetCapUsd, remove pipelineType from FormState
- **EMPTY_FORM** in `strategies/page.tsx`: Currently defaults iterations to 3, needs to change to 50

### 4. Invocation Detail Linking — Links Exist But May Be Hard to Find
- **Invocations list page** (`src/app/admin/evolution/invocations/page.tsx`): Agent name column IS linked to detail page via `buildInvocationUrl(inv.id)`
- **Invocation detail page** (`src/app/admin/evolution/invocations/[invocationId]/page.tsx`): Fully implemented
- **Timeline tab** has "View Details →" link in expanded agent panels
- **Fix needed**: Add a dedicated "View" link column or button to make detail navigation more prominent

### 5. Arena Cost-Based Filtering — Data Available, No Filter UI
- **Cost data already in leaderboard**: `ArenaEloEntry` has `total_cost_usd`, `run_cost_usd`, `elo_per_dollar`
- **No cost filter UI exists**: Topic detail page renders all entries unfiltered
- **`budget_cap_usd` available on runs**: Already in `evolution_runs` table but NOT exposed in `getArenaLeaderboardAction`
- **Recommended approach**: Add `run_budget_cap_usd` to `ArenaEloEntry`, add client-side budget tier dropdown
- **Budget tiers**: e.g., All / ≤$0.25 / $0.25–$0.50 / $0.50–$1.00
- **Default filter**: Start with a sensible default (e.g., most common budget tier or "All")
- **Comparison action** (`runArenaComparisonAction`) accepts topicId only — no entry filtering; display-only filtering is simplest MVP

### 6. StrategyConfig Interface — budgetCapUsd Addition
- **Current interface**: `generationModel`, `judgeModel`, `agentModels?`, `iterations`, `enabledAgents?`, `singleArticle?`
- **Add**: `budgetCapUsd?: number` — optional field for cost limit
- **Hash**: Exclude `budgetCapUsd` from hash (like `agentModels`) since it's a runtime constraint, not a config identity field
- **Config flow**: `StrategyConfig.budgetCapUsd` → `EvolutionRunConfig.budgetCapUsd` via `extractStrategyConfig()`
- **Presets**: Update 3 built-in presets (Economy $0.25, Balanced $0.50, Quality $1.00) with budgetCapUsd values

## Wireframe: New Experiment Flow

### Step 1: Setup (mostly unchanged)
- Experiment name, prompt selection, budget per run ($)
- Button: "Next: Select Strategies →"

### Step 2: Select Strategies (REPLACES old inline config)
- Header: "Select strategies to compare (budget: $X/run)"
- Subheader: "Only showing strategies with matching budget ≤ $X"
- Checkbox list of active strategies, each with StrategyConfigDisplay (3-column: Models, Execution, Agents)
- Strategies with budget > experiment's budgetPerRun greyed out with "BUDGET MISMATCH"
- Link: "Need a new strategy? Create one from the Strategies tab →"
- Footer: "Selected: N strategies · M runs · Est. $X.XX total"

### Step 3: Review (enhanced)
- Name, prompt summary
- Per-strategy rows with: strategy name, gen model, judge, budget
- Runs/strategy spinner per row (min 1, default 1) — allows duplicate runs for significance
- Per-strategy subtotal: budget × runs
- Summary box: total runs, total cost, max budget cap ($10.00)
- Start Experiment button (disabled if total exceeds max)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md

## Code Files Read
- `evolution/src/services/strategyRegistryActions.ts` — Strategy CRUD (archive/delete exist, getStrategiesAction has status filter)
- `evolution/src/lib/core/strategyConfig.ts` — StrategyConfig type (iterations: number, no budgetCapUsd), hashStrategyConfig, StrategyConfigRow
- `evolution/src/services/evolutionActions.ts` — queueEvolutionRunAction, buildRunConfig reads strategyConfig?.budgetCapUsd
- `evolution/src/services/experimentActions.ts` — addRunToExperimentAction, createManualExperimentAction
- `evolution/src/services/arenaActions.ts` — getArenaLeaderboardAction (doesn't expose budget_cap_usd), ArenaEloEntry type
- `evolution/src/lib/core/arenaIntegration.ts` — syncToArena, loadArenaEntries
- `evolution/src/lib/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig, MAX_RUN_BUDGET_USD
- `evolution/src/lib/types.ts` — EvolutionRunConfig (includes budgetCapUsd), PipelineType
- `evolution/src/lib/core/configValidation.ts` — validateStrategyConfig, validateRunConfig
- `evolution/src/services/strategyResolution.ts` — resolveOrCreateStrategyFromRunConfig (INSERT-first atomic)
- `src/app/admin/evolution/strategies/page.tsx` — StrategyDialog with EMPTY_FORM (iterations: 3), archive/delete buttons, status filter
- `src/app/admin/evolution/strategies/strategyFormUtils.ts` — FormState (includes pipelineType, iterations), formToConfig, rowToForm
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — 3-step wizard, budgetPerRun, RunFormState per run
- `src/app/admin/evolution/analysis/_components/runFormUtils.ts` — RunFormState (generationModel, judgeModel, enabledAgents)
- `src/app/admin/evolution/analysis/_components/StrategyConfigDisplay.tsx` — 3-column config display component (reusable)
- `src/app/admin/evolution/start-experiment/page.tsx` — Experiment start page wrapper
- `src/app/admin/evolution/invocations/page.tsx` — Agent name linked via buildInvocationUrl, filters for runId/agent/success
- `src/app/admin/evolution/invocations/[invocationId]/page.tsx` — Full invocation detail page
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — Arena topic detail, leaderboard (no cost filtering), scatter chart
- `src/app/admin/evolution/arena/page.tsx` — Arena topic list with showArchived toggle pattern
- `evolution/src/lib/utils/evolutionUrls.ts` — buildInvocationUrl, buildRunUrl
- `src/app/admin/evolution-dashboard/page.tsx` — Main dashboard (no invocations quick link)
- `supabase/migrations/20260207000007_strategy_lifecycle.sql` — status column, created_by CHECK
- `supabase/migrations/20260205000005_add_strategy_configs.sql` — strategy_configs table

## Open Questions (Resolved)
1. ~~When removing iterations from strategy form~~ → Keep iterations, default to 50
2. ~~Arena cost filtering server-side vs client-side~~ → Client-side display filtering for MVP
3. ~~Invocation linking issue~~ → Add more prominent "View" link/button column
