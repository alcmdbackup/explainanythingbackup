# Sanity Check Cost Infra and Add Cost Estimate to Start Pipeline Progress

## Phase 1: Server action + StartRunCard integration
### Work Done
- Added `estimateRunCostWithAgentModels`, `computeCostPrediction`, `refreshAgentCostBaselines` exports to `src/lib/evolution/index.ts`
- Added `estimateRunCostAction` server action to `src/lib/services/evolutionActions.ts` with:
  - UUID validation for strategyId
  - Range validation for budgetCapUsd (0.01-100) and textLength (100-100000)
  - Dynamic import of estimation module (matches existing pattern)
  - Strategy config fetch → RunCostConfig mapping
- Updated `StartRunCard` in `src/app/admin/quality/evolution/page.tsx` with:
  - Debounced (500ms) cost estimate on strategy selection
  - Estimated cost display with confidence badge (high/medium/low)
  - Budget exceeded warning
  - Low-confidence info message for cold-start
  - Collapsible per-agent cost breakdown with bar chart
- Added 7 unit tests covering: valid estimate, invalid UUID, out-of-range budget, textLength clamping, strategy not found, cold-start passthrough

### Issues Encountered
- Workflow hook required symlink from `docs/planning/feat/...` to actual planning folder (branch name includes `feat/` prefix but folder didn't)
- `todos_created` prerequisite needed manual setting since `TodoWrite` tool not available (using `TaskCreate` instead)

### User Clarifications
None needed — implementation followed the approved plan.

## Phase 2: Store estimate at queue time + migration
### Work Done
- Created migration `supabase/migrations/20260210000001_add_cost_estimate_columns.sql` adding `cost_estimate_detail` and `cost_prediction` JSONB columns
- Updated `queueEvolutionRunAction` to compute and persist estimate at queue time (graceful — queue succeeds even if estimation fails)
- Added 2 unit tests for cost estimation at queue time

## Phase 3: Compute delta at completion + refresh baselines
### Work Done
- Modified `finalizePipelineRun()` to compute `CostPrediction` when `cost_estimate_detail` exists
- Calls `refreshAgentCostBaselines(30)` non-blocking after prediction
- Added 2 unit tests for prediction computation
- All 27 pipeline tests pass

## Phase 4: Surface estimate vs actual in existing UI
### Work Done
- Extended `BudgetData` interface with `estimate` and `prediction` fields
- Updated `getEvolutionRunBudgetAction` to fetch and return cost estimate/prediction data
- Added "Estimated vs Actual" comparison panel to `BudgetTab` with delta badges, per-agent bars, confidence badge
- Added `estimated_cost_usd` to `EvolutionRun` interface and "Est." column to runs table with color-coded accuracy
- Fixed TypeScript `typeof` narrowing issue in `queueEvolutionRunAction` (extracted `QueueStrategyConfig` type alias)
- Added 3 unit tests for budget action estimate/prediction fields

## Phase 5: Strategy accuracy aggregates
### Work Done
- Created `src/lib/services/costAnalyticsActions.ts` with `getStrategyAccuracyAction()`
- Computes avg delta %, std dev per strategy from completed runs
- Updated `StrategyDetailRow` to display accuracy stats with color-coded error badges
- Added accuracy data loading to strategy registry page (parallel with existing calls)
- Added 3 unit tests for strategy accuracy

## Phase 6: Cost Review panel on optimization dashboard
### Work Done
- Added `getCostAccuracyOverviewAction()` to `costAnalyticsActions.ts` — delta trend, per-agent accuracy, confidence calibration, outliers
- Created `CostAccuracyPanel` component with Recharts line chart, accuracy table, confidence cards, outlier links
- Added "Cost Accuracy" tab to optimization dashboard
- Added 2 unit tests for overview action

## Phase 7: Documentation updates
### Work Done
- Updated `elo_budget_optimization.md` — Added pre-run estimate UI, cost prediction, accuracy dashboard sections
- Updated `evolution_pipeline.md` — Added cost prediction and baseline refresh to pipeline completion flow
- Updated `evolution_framework.md` — Added cost estimate at queue time and prediction at completion to data flow
- Updated `evolution_pipeline_visualization.md` — Updated BudgetTab description, added estimated vs actual section, added cost analytics actions section
