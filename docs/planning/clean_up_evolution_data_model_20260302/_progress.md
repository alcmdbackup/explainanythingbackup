# Clean Up Evolution Data Model Progress

## Block 1: Database Migration
### Work Done
- Created `supabase/migrations/20260303000001_flatten_experiment_model.sql`
- Adds `experiment_id` FK+index on `evolution_runs`
- Backfills experiment_id from rounds chain
- Adds `design` and `analysis_results` to `evolution_experiments`
- Backfills statuses to 6-state model
- Drops `current_round`, `max_rounds`, `batch_run_id`
- Drops `evolution_experiment_rounds` and `evolution_batch_runs` tables

## Block 2: Server-Side Code
### Work Done
- **experimentActions.ts**: Removed batch/round creation from `startExperimentAction`. Set `experiment_id` on runs directly. Simplified `getExperimentStatusAction` to query runs by `experiment_id`. Updated `ExperimentStatus` interface (removed `rounds[]`, `maxRounds`, `currentRound`; added `runCounts`, `design`, `analysisResults`). Updated `cancelExperimentAction` to filter by `experiment_id`. Updated `ExperimentSummary` (removed `currentRound`, `maxRounds`). Updated `ExperimentRun` (removed `roundNumber`). Updated `TERMINAL_EXPERIMENT_STATES` to `['completed', 'failed', 'cancelled']`. Removed `maxRounds` from `StartExperimentInput`.
- **experimentReportPrompt.ts**: Removed `rounds` from `ExperimentReportInput`. Replaced "ROUND-BY-ROUND ANALYSIS" with "ANALYSIS RESULTS" reading from experiment directly.
- **experiment-driver/route.ts**: Renamed `handleRoundRunning`→`handleRunning`, `handleRoundAnalyzing`→`handleAnalyzing`. Deleted `handlePendingNextRound` (~200 lines). Simplified to 2 active states (`running`, `analyzing`). Analysis always terminal (completed/failed). Updated `ExperimentRow` (removed `max_rounds`, `current_round`; added `design`). Updated `writeTerminalState` to query runs by `experiment_id`.

## Block 3: UI Components + Delete Batch Infrastructure
### Work Done
- Deleted: `RoundsTab.tsx`, `RoundAnalysisCard.tsx`, `run-batch.ts`, `batchRunSchema.ts`, `batchRunSchema.test.ts`, `evolutionBatchActions.ts`, `evolutionBatchActions.test.ts`, `evolution-batch.yml`
- Created: `ExperimentAnalysisCard.tsx` (renamed from RoundAnalysisCard, accepts `experiment` prop)
- Updated: `ExperimentDetailTabs.tsx` (Analysis/Runs/Report tabs), `RunsTab.tsx` (flat table), `ExperimentOverviewCard.tsx` (6-state, run counts), `ExperimentStatusCard.tsx` (6-state, run progress), `ExperimentHistory.tsx` (6-state, run counts), `ExperimentForm.tsx` (removed maxRounds), `ReportTab.tsx` (6-state terminal), `evolution/page.tsx` (replaced BatchDispatchButtons with RunNextPendingButton)
- Updated: `backfill-prompt-ids.ts` (removed `batch_run_id`, simplified origin)

## Block 4: Tests
### Work Done
- Renamed `RoundAnalysisCard.test.tsx` → `ExperimentAnalysisCard.test.tsx`
- Updated all 10 experiment test files for flat model
- Updated `experimentActions.test.ts` (~38 tests): removed round/batch mocks, updated interfaces
- Updated `route.test.ts` (~14 tests): removed pending_next_round/convergence tests, added running→analyzing→completed path
- Updated `experimentReportPrompt.test.ts` (4 tests): removed rounds from input
- Updated all UI tests: ExperimentDetailTabs, RunsTab, ExperimentOverviewCard, ExperimentHistory, ReportTab, ExperimentForm
- Result: 280/281 suites pass (1 pre-existing sandbox failure)

## Block 5: Documentation
### Work Done
- Updated `data_model.md`: Added `experiment_id` to Run description, added flatten migration
- Updated `strategy_experiments.md`: Rewrote to 6-state model, single-round design, updated tabs and file references
- Updated `cost_optimization.md`: Removed batch configuration section, batch CLI docs, batch files from key files
- Updated `environments.md`: Removed Evolution Batch Runner workflow section
- Updated `reference.md`: Removed batch workflow reference

## Block 6: Final Verification
### Work Done
- lint: clean (0 errors)
- tsc: clean (0 errors)
- build: clean
- unit tests: 280/281 pass (1 pre-existing sandbox failure in run-strategy-experiment.test.ts)
- integration tests: pre-existing env var failures (missing Supabase creds in local env)
