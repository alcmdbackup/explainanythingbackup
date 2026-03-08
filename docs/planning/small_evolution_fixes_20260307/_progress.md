# small_evolution_fixes_20260307 Progress

## Phase 1: StrategyConfig + Strategy Form Updates
### Work Done
- Added `budgetCapUsd?: number` to `StrategyConfig` (excluded from hash)
- Updated `labelStrategyConfig()` to show "Budget: $X.XX"
- Updated `diffStrategyConfigs()` to compare budgetCapUsd
- Added budgetCapUsd validation to `validateStrategyConfig()` (>= $0.01, <= MAX_RUN_BUDGET_USD)
- Removed `pipelineType` from FormState, added `budgetCapUsd`
- Updated strategy form: removed pipeline selector, added budget cap input, default iterations=50
- Updated StrategyConfigDisplay to show budget in Execution column
- Updated presets: Economy=$0.25, Balanced=$0.50, Quality=$1.00, all 50 iterations
- Tests: 95 passing (strategyConfig, configValidation, strategyFormUtils)

## Phase 2: Strategy Archiving Enforcement
### Work Done
- `getStrategiesAction()` defaults status to 'active' when no filter; accepts 'all' to show everything
- `queueEvolutionRunAction` fetches strategy status and rejects archived strategies
- Updated strategies page to explicitly pass 'all' when "All" filter selected
- Tests: 43 passing (evolutionActions)

## Phase 3: Experiment Form Redesign
### Work Done
- Rewrote ExperimentForm: strategy picker replaces inline model/agent config
- Strategies filtered by budgetCapUsd vs budgetPerRun (ineligible greyed out)
- Per-strategy runs count with subtotals, $10 max experiment budget
- Submit loops over selected strategies × runsCount
- Marked runFormUtils.ts as legacy

## Phase 4: Invocation Detail Linking
### Work Done
- Added "View →" link column to invocations table (7 columns total)

## Phase 5: Arena Budget Tier Filtering
### Work Done
- Added `run_budget_cap_usd: number | null` to ArenaEloEntry
- Added `budget_cap_usd` to runs batch fetch in getArenaLeaderboardAction
- Added budget tier filter dropdown to arena page (All / ≤$0.25 / $0.25–$0.50 / $0.50–$1.00)
- filteredLeaderboard applied to both table and scatter chart
- Tests: 43 passing (arenaActions)

## Phase 6: Documentation Updates
### Work Done
- Updated strategy_experiments.md, arena.md, cost_optimization.md, reference.md, data_model.md

## Final Quality Gates
- tsc: 0 errors
- lint: 0 errors (pre-existing warnings only)
- build: success
- All tests: 181 passing across 5 suites
