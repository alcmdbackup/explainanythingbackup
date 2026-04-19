# Multi Iteration Strategy Support Evolution Progress

## Phase 1: Schema & Data Model Foundation
### Work Done
- Defined `IterationConfig` Zod schema (agentType, budgetPercent, maxAgents)
- Extended `strategyConfigSchema` with `iterationConfigs[]`, removed `iterations` and `maxVariantsToGenerateFromSeedArticle`
- Updated `evolutionConfigSchema` with `iterationConfigs[]`
- Updated hash function to include iterationConfigs, label shows "2×gen + 3×swiss"
- Updated buildRunContext mapping
- Migrated 25 files from old format
- 14 new schema edge case tests

### Issues Encountered
- 25 files needed mechanical migration from `iterations: N` to `iterationConfigs[]`
- Floating-point tolerance needed for budget sum validation (0.01)

## Phase 2: Seed Variant Decoupling
### Work Done
- Removed seed from pool — no longer competes in ranking
- Moved seed generation to pre-iteration setup in claimAndExecuteRun
- Seed cost charged to run-level budget
- Removed reusedFromSeed filtering, optimistic-concurrency UPDATE
- Added is_seed field to ArenaEntry, seed badge on arena leaderboard
- Removed seedVariantRank/seedVariantElo from run summary

## Phase 3: Variant Storage Fixes
### Work Done
- `generation` field now stores `v.iterationBorn` (was `v.version` = always 0)
- Generated variants set `parentIds: [seedVariantId]` via GenerateFromSeedInput
- seedVariantId plumbed through agent input

## Phase 4: Per-Iteration Orchestrator Loop
### Work Done
- Replaced nextIteration() oracle with config-driven for-loop over iterationConfigs[]
- Created `createIterationBudgetTracker` with IterationBudgetExceededError
- Two-layer budget: run tracker (safety net) + iteration tracker (stops iteration only)
- reserve() checks run first then iteration (prevents masking)
- Per-iteration stop reasons: iteration_budget_exceeded/converged/no_pairs/complete
- iterationResults[] on EvolutionResult
- Snapshots enhanced with stopReason, budgetAllocated, budgetSpent
- 8 new budget tracker tests

## Phase 5: Strategy Creation Wizard UI
### Work Done
- Created 2-step wizard at /admin/evolution/strategies/new
- Step 1: name, models, temperature, budget, advanced settings
- Step 2: iteration config with % allocation, cost projections, budget bars
- Split evenly button, add/remove iterations, allocation bar
- Strategies list page: "New" navigates to wizard, FormDialog kept for quick edit
- 16 new wizard tests

## Phase 6: Strategy Detail & Config Display
### Work Done
- StrategyConfigDisplay: new Iterations section with agent type badges
- Strategy detail: new Variants tab (joins through runs)
- StrategyEntity: added variants to detailTabs

## Phase 7: Run Detail Per-Iteration Visibility
### Work Done
- Timeline tab redesigned as consolidated iteration view with summary cards
- Budget bars, stop reason badges, key stats, collapsible Gantt detail
- Variants tab: Iteration + Parent columns, iteration filter
- Cost Estimates tab: iteration filter, per-iteration summary section

## Phase 8: Arena & Variant Surface Changes
### Work Done
- Arena leaderboard: Iteration + Parent columns, seed badge
- ArenaEntry: generation + parent_variant_id fields
- Variants list: Parent column
- Variant detail: Parent Variant in MetricGrid

## Final Verification
- tsc: 0 errors
- lint: 0 errors (only pre-existing warnings)
- build: success
- tests: 153 suites, 2155 tests, all passing
