# Small Evolution Fixes Plan

## Background
A few small fixes for the evolution dashboard. This project addresses several UX and functionality gaps in the evolution admin UI including strategy archiving, experiment strategy selection, arena cost-based filtering, invocation detail linking, and strategy creation form improvements.

## Requirements (from GH Issue #667)
- [ ] Should be able to archive strategies and hide them from appropriate places
- [ ] Should be able to select from pre-defined strategies in "start experiment" - these should explain key settings when selected. Remove ability to define net new strategy/group (select existing instead), creating a new strategy should be done from strategies tab.
- [ ] Experiment should only let you add matching strategies with same cost budget
- [ ] Update "create strategy" from strategy overview page so it is like "create run" from "start experiment". Get rid of pipeline type and iterations option (we run until we hit limit). Also add a field for cost limit for that strategy.
- [ ] No invocation details page is linked from invocation overview tab in evolution dashboard
- [ ] Arena should only compare strategies with similar cost limits against each other. Should start with a default filter.

## User Clarifications
- Keep iterations in StrategyConfig, default to 50 in the form
- Allow setting # of runs per strategy in experiment (for statistical significance)
- Show per-strategy subtotal and total cost on review screen

## Problem
The evolution admin UI has several disconnected gaps: strategies can't be archived from all relevant surfaces, the experiment form forces users to build configs inline instead of reusing existing strategies, the arena leaderboard doesn't filter by cost so expensive and cheap runs compete unfairly, invocation detail pages exist but aren't linked prominently, and the strategy creation form exposes unnecessary fields (pipelineType) while missing critical ones (budgetCapUsd).

## Options Considered

### Strategy archiving enforcement
- **Option A**: Server-side filtering — add `status = 'active'` filter to all strategy queries. Chosen — simplest, prevents archived strategies from appearing anywhere.
- **Option B**: Client-side filtering only — fragile, easy to miss surfaces.

### Experiment strategy selection
- **Option A**: Replace inline config with strategy picker + runs-per-strategy spinner. Chosen — reuses existing strategies, simpler UX, enables controlled comparison.
- **Option B**: Keep inline config but add strategy template dropdown. Rejected — still creates ad-hoc strategies.

### Arena cost filtering
- **Option A**: Client-side budget tier dropdown. Chosen — no server changes, immediate UX improvement.
- **Option B**: Server-side filtering with modified `getArenaLeaderboardAction`. Rejected for MVP — more complex, can add later.

### StrategyConfig.budgetCapUsd
- **Option A**: Add optional `budgetCapUsd` to StrategyConfig, exclude from hash. Chosen — doesn't break existing hashes, runtime constraint not identity.
- **Option B**: Store budget only at run level. Rejected — need it at strategy level for experiment budget matching.

### Hash dedup interaction with budgetCapUsd
- Since `budgetCapUsd` is excluded from hash, two strategies with same models/iterations but different budgets share the same `config_hash`. The `createStrategyCore` promote-existing logic would match by hash and update the existing row.
- **Mitigation**: This is acceptable behavior — strategies are identified by their pipeline config (models, agents, iterations), not budget. Budget is a runtime constraint. Users who want different budgets for the same config just set different budgetCapUsd on the same strategy, or create separate named strategies (which get distinct IDs despite matching hashes due to hash dedup creating vs updating).
- **Note**: Presets with budgetCapUsd will match existing preset strategies by hash and update them — this is intentional (retroactively adds budget values to existing presets).

## Phased Execution Plan

### Phase 1: StrategyConfig + Strategy Form Updates
**Goal**: Add budgetCapUsd to StrategyConfig, simplify strategy creation form.

**Files modified:**
- `evolution/src/lib/core/strategyConfig.ts` — Add `budgetCapUsd?: number` to `StrategyConfig` interface
- `evolution/src/lib/core/strategyConfig.ts` — Ensure `budgetCapUsd` excluded from `hashStrategyConfig()` (already excluded since it's not in the hash fields list)
- `evolution/src/lib/core/strategyConfig.ts` — Update `labelStrategyConfig()` to include budget when present (e.g., `"| Budget: $0.50"`)
- `evolution/src/lib/core/strategyConfig.ts` — Update `diffStrategyConfigs()` to compare budgetCapUsd if present (note: existing test at line 254-269 hardcodes expected diff count — update to account for new field)
- `evolution/src/lib/core/configValidation.ts` — Add optional budgetCapUsd validation to `validateStrategyConfig()`: when present, must be >= 0.01 and <= MAX_RUN_BUDGET_USD (align min with client-side and addRunToExperimentAction validation). Note: `validateRunConfig()` already validates `EvolutionRunConfig.budgetCapUsd` (line 80-85) — no change needed there.
- `src/app/admin/evolution/strategies/strategyFormUtils.ts` — Add `budgetCapUsd: number` to `FormState`, remove `pipelineType`, update `formToConfig()` to include budgetCapUsd, update `rowToForm()` to read from `row.config.budgetCapUsd`
- `src/app/admin/evolution/strategies/page.tsx` — Remove pipelineType selector from form, change `EMPTY_FORM.iterations` from 3 to 50, add budgetCapUsd number input (min: 0.01, max: 1.00, step: 0.01), remove PIPELINE_OPTIONS, add HTML min/max constraints on budgetCapUsd input for client-side validation
- `src/app/admin/evolution/analysis/_components/StrategyConfigDisplay.tsx` — Show budgetCapUsd in Execution column as `"Budget: $X.XX"` when present
- `evolution/src/services/strategyRegistryActions.ts` — Update `getStrategyPresetsAction` presets with budgetCapUsd values (Economy: $0.25, Balanced: $0.50, Quality: $1.00). Note: preset iterations values (2, 3, 5) should be updated to 50 to match the new default.

**Tests:**
- Update `strategyConfig.test.ts` — verify budgetCapUsd excluded from hash, update `diffStrategyConfigs` test expected diff count
- Update `strategyFormUtils.test.ts` — add budgetCapUsd round-trip test, verify pipelineType removal from formToConfig output
- Update `configValidation.test.ts` — add test for budgetCapUsd validation (negative, NaN, > MAX rejected; valid values accepted; absent values pass)
- Run lint, tsc, build after phase

### Phase 2: Strategy Archiving Enforcement
**Goal**: Ensure archived strategies are hidden from all selection UIs and queries.

**Files modified:**
- `evolution/src/services/strategyRegistryActions.ts` — `getStrategiesAction()`: change default status filter to `'active'` when no filter provided (currently returns all statuses). Strategy list page explicitly passes status filter so it will still show archived when the dropdown is set to "archived" or "all".
- `src/app/admin/evolution/strategies/page.tsx` — Verify archive button works, confirm status filter dropdown shows archived when selected
- `evolution/src/services/evolutionActions.ts` — `queueEvolutionRunAction`: after fetching strategy by ID (line 166-176) and BEFORE the budget estimation block (line 184+), add status check: `if (strategy.status === 'archived') throw new Error('Cannot queue run with archived strategy')`. Must add `status` to the select query (currently only selects `id, config`). Placing the check before estimation avoids unnecessary LLM cost estimation calls for archived strategies.

**Note on experiment archiving enforcement**: `addRunToExperimentAction` (Phase 3) does NOT take a strategy_config_id — it takes raw config fields and resolves/creates the strategy via `resolveOrCreateStrategyFromRunConfig()` by hash. Archive enforcement here is handled by the experiment form (Phase 3) which only shows active strategies. The server action creates strategies via hash dedup — if an archived strategy matches by hash, it would be promoted/reused. This is acceptable since the config is identical; the strategy's archival was about hiding it from selection, not invalidating its config.

**Tests:**
- Unit test: `evolutionActions.test.ts` — queueEvolutionRunAction rejects archived strategy. Must update mock to include `status` field in the strategy select response.
- Unit test: `strategyRegistryActions.test.ts` — verify getStrategiesAction defaults to active filter
- Run lint, tsc, build after phase

### Phase 3: Experiment Form Redesign
**Goal**: Replace inline run config with strategy selection + runs-per-strategy.

**Key design decisions:**
- The existing `addRunToExperimentAction` takes raw config fields (`{generationModel, judgeModel, enabledAgents?, budgetCapUsd}`), NOT a strategy_config_id. The form must extract these fields from the selected strategy's config and pass them to the action.
- Each call to `addRunToExperimentAction` creates a new explanation row for the prompt text. With N runs per strategy, this creates N explanations. This is by design (each run evolves independently).
- Budget enforcement in `addRunToExperimentAction` is sequential: it reads `total_budget_usd`, checks against MAX, then updates. Since calls are sequential in the submit loop (awaited one by one), there is no race condition. Concurrent form submissions could race, but admin-only access makes this acceptable.
- Client-side budget validation (total cost vs MAX_EXPERIMENT_BUDGET_USD) prevents most over-budget submissions. Server-side check in `addRunToExperimentAction` catches any that slip through.

**Files modified:**
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — Complete rewrite of Steps 2 and 3:
  - **New imports**: `getStrategiesAction` from `strategyRegistryActions.ts`, `StrategyConfigDisplay` from same directory, `StrategyConfigRow` type
  - **New state**: Replace `runs: RunFormState[]` with `strategies: StrategyConfigRow[]` (fetched on mount), `selectedStrategies: Map<string, { strategy: StrategyConfigRow, runsCount: number }>` (user selections). Update `Step` type from `'setup' | 'runs' | 'review'` to `'setup' | 'strategies' | 'review'` and update STEPS array labels accordingly. Change button text from "Next: Configure Runs" to "Next: Select Strategies".
  - **Step 2 (Select Strategies)**:
    - Fetch active strategies via `getStrategiesAction({ status: 'active' })`
    - Filter: strategies with `budgetCapUsd <= budgetPerRun` or no budgetCapUsd set (backward compat — show with "No cost cap" indicator so user is aware)
    - Render checkbox list with `StrategyConfigDisplay` expanded for each
    - Grey out mismatched strategies with "BUDGET MISMATCH" label (disabled checkbox)
    - Link: "Need a new strategy? Create one from the Strategies tab →" pointing to `/admin/evolution/strategies`
    - Footer: "Selected: N strategies · M runs · Est. $X.XX total"
  - **Step 3 (Review)**:
    - Per-strategy row: strategy name, gen model, judge, budget
    - Runs/strategy number input (min 1, default 1) per row — allows duplicate runs
    - Per-strategy subtotal: budgetPerRun × runsCount
    - Summary box: total runs (sum of all runsCount), total cost, max budget cap ($10)
    - Disable "Start Experiment" if total cost > MAX_EXPERIMENT_BUDGET_USD ($10)
  - **handleSubmit**:
    - Create experiment via `createManualExperimentAction`
    - For each selected strategy, loop runsCount times:
      - Extract `{generationModel, judgeModel, enabledAgents}` from strategy.config
      - Call `addRunToExperimentAction({ experimentId, config: { ...extracted, budgetCapUsd: budgetPerRun } })`
      - Note: the strategy's own `budgetCapUsd` is used only for filtering/display in the form; the experiment's `budgetPerRun` is what gets passed to each run. Add a code comment to prevent future confusion.
      - Calls are sequential (awaited) to avoid budget race conditions
    - Start experiment via `startManualExperimentAction`
- `src/app/admin/evolution/analysis/_components/runFormUtils.ts` — Keep file (no other imports found), but it becomes unused by ExperimentForm. Add `// Legacy: previously used by ExperimentForm inline config. Kept for potential future use.` comment.

**Tests:**
- Unit test: `ExperimentForm.test.tsx` — strategy filtering by budget (strategies with budgetCapUsd > budgetPerRun are disabled)
- Unit test: `ExperimentForm.test.tsx` — runs-per-strategy cost calculation (budgetPerRun × sum of runsCount = total)
- Unit test: `ExperimentForm.test.tsx` — submit disabled when total cost > MAX_EXPERIMENT_BUDGET_USD
- Unit test: `ExperimentForm.test.tsx` — handleSubmit calls addRunToExperimentAction N times per strategy
- Manual: full experiment creation flow — select 2 strategies, 2 runs each, verify 4 runs queued
- Run lint, tsc, build after phase

### Phase 4: Invocation Detail Linking
**Goal**: Make invocation detail links more prominent.

**Files modified:**
- `src/app/admin/evolution/invocations/page.tsx` — Add a dedicated "View →" link column at the end of the table row, styled as accent-gold text link using `buildInvocationUrl(inv.id)`. Position after the existing columns (agent, run, iteration, cost, status).

**Tests:**
- Manual: verify clicking "View →" navigates to correct invocation detail page
- Run lint, tsc, build after phase

### Phase 5: Arena Budget Tier Filtering
**Goal**: Add cost-based filtering to arena leaderboard.

**Files modified:**
- `evolution/src/services/arenaActions.ts` — Update `ArenaEloEntry` interface: add `run_budget_cap_usd: number | null`
- `evolution/src/services/arenaActions.ts` — `getArenaLeaderboardAction`: add `budget_cap_usd` to the `evolution_runs` batch fetch select (currently: `'id, total_cost_usd, strategy_config_id, experiment_id'` → add `budget_cap_usd`). Update the `runMap` type annotation (line 330) to include `budget_cap_usd`. Update the mapping at line 337 to include `budget_cap_usd`. Assign to each entry's `run_budget_cap_usd`.
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — Add budget tier filter:
  - State: `const [budgetFilter, setBudgetFilter] = useState<string>('all')`
  - Budget tiers: `All` / `≤$0.25` / `$0.25–$0.50` / `$0.50–$1.00`
  - Filter logic: use `run_budget_cap_usd` when available. Entries without budget data (null `run_budget_cap_usd`, e.g., oneshot/manual entries) appear only in "All" tier.
  - Place `<select>` dropdown above leaderboard table near "Run Comparison" button
  - Default to "All"
  - Also filter scatter chart data to match active filter

**Tests:**
- Unit test: `arenaActions.test.ts` — `getArenaLeaderboardAction` populates `run_budget_cap_usd` from runs query
- Unit test in `src/app/admin/evolution/arena/[topicId]/page.test.tsx` (or co-located helper): budget tier filter logic (entries with null budget only in "All", entries with $0.30 budget appear in "$0.25–$0.50" tier)
- Manual: verify filter hides/shows correct entries, scatter chart updates
- Run lint, tsc, build after phase

## Testing

### Unit Tests
- `evolution/src/lib/core/strategyConfig.test.ts` — budgetCapUsd excluded from hash, diffStrategyConfigs updated
- `evolution/src/lib/core/configValidation.test.ts` — budgetCapUsd validation in validateStrategyConfig
- `src/app/admin/evolution/strategies/strategyFormUtils.test.ts` — budgetCapUsd round-trip, pipelineType removed
- `evolution/src/services/strategyRegistryActions.test.ts` — getStrategiesAction defaults to active
- `evolution/src/services/evolutionActions.test.ts` — archived strategy rejection on queue (update mock to include status)
- `src/app/admin/evolution/analysis/_components/ExperimentForm.test.tsx` — strategy filtering, cost calc, submit loop
- `evolution/src/services/arenaActions.test.ts` — run_budget_cap_usd populated in leaderboard response

### Per-Phase Quality Gates
After each phase: run `npm run lint`, `npx tsc --noEmit`, `npm run build`, and phase-specific unit tests before proceeding to next phase.

### Manual Verification
- Create strategy with budgetCapUsd from strategies page (iterations defaults to 50, no pipelineType field)
- Archive a strategy, verify it disappears from experiment strategy selection
- Create experiment: select 2 strategies, set 2 runs each, verify total cost shows correctly
- Start experiment, verify 4 runs are queued
- Arena: switch budget tier filter, verify leaderboard updates
- Invocations list: verify "View →" link navigates to detail page

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/visualization.md` - invocation linking, arena cost filter
- `evolution/docs/evolution/arena.md` - cost-based filtering UI, budget tier dropdown
- `evolution/docs/evolution/cost_optimization.md` - strategy budgetCapUsd field, updated presets
- `evolution/docs/evolution/strategy_experiments.md` - experiment strategy selection redesign, runs-per-strategy, review screen
- `evolution/docs/evolution/data_model.md` - StrategyConfig.budgetCapUsd, strategy archiving enforcement
- `evolution/docs/evolution/reference.md` - updated strategy form fields (no pipelineType, iterations=50 default, budgetCapUsd)
