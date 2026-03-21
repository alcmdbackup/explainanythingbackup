# Strategy Experiments

> **Deprecated:** The L8/factorial design was planned but never implemented in production. All experiments use the `manual` design. See [experimental_framework.md](experimental_framework.md) for the current metrics framework with bootstrap CIs and per-agent cost breakdowns.

Manual experimentation system for comparing evolution pipeline configurations. Users create experiments with individually configured runs, then analyze per-run Elo and cost metrics.

## Overview

The experiment system allows admins to compare pipeline configurations by creating experiments with individually configured runs. Each run can use a different model, judge, iteration count, agent selection, or budget. Results are analyzed via `computeManualAnalysis()` which produces per-run Elo/cost comparison tables. Results flow to existing dashboards automatically via the standard `finalizePipelineRun()` path.

## Manual Experiment Workflow

### 1. Create Experiment

`createManualExperimentAction()` creates an experiment with `design: 'manual'` and `factor_definitions: {}`:

- Select a prompt from the prompt registry
- Set experiment name and total budget
- Experiment starts in `pending` state

### 2. Configure Runs

The **ExperimentForm** uses a strategy picker: users select one or more existing strategies (from the strategy registry) and set a per-strategy run count. Each strategy's `budgetCapUsd` is used as the run budget. The experiment's total budget is capped at `MAX_EXPERIMENT_BUDGET_USD` ($10.00).

Each run's strategy config is pre-registered via `upsertStrategy()` at creation time, so strategies appear immediately in the leaderboard.

### 3. Start Experiment

`startManualExperimentAction()` transitions the experiment to `running` state and queues all configured runs.

### 4. Run Execution

Runs are picked up by the batch runner (`evolution/scripts/evolution-runner.ts`) or triggered via admin UI. The batch runner claims pending runs via `claim_evolution_run` RPC and executes the V2 pipeline.

### 5. Analysis

`computeManualAnalysis()` produces a simple per-run comparison:

- Per-run Elo (from `run_summary` via `extractTopElo`)
- Per-run cost
- Per-run Elo/$ (relative to 1200 baseline)
- Warnings for incomplete runs

No main effects, factor rankings, or recommendations — just raw per-run metrics for direct comparison.

## Budget Constraints

- **MAX_RUN_BUDGET_USD** = $1.00 — hard cap per individual run
- **MAX_EXPERIMENT_BUDGET_USD** = $10.00 — hard cap per experiment
- Budget is set at experiment creation and enforced when adding runs

## Admin UI

### Experiment Management

The Analysis dashboard (`/admin/evolution/analysis`) includes an "Experiments" tab with:

- **ExperimentForm**: Strategy picker with per-strategy run count, prompt selection from the prompt library
- **ExperimentStatusCard**: Real-time status with auto-refresh (15s), run progress bars, budget usage
- **ExperimentHistory**: List of past experiments showing experiment rows with links to detail pages and inline rename capability. Each row links to the experiment detail page and supports renaming the experiment in place.

Additional pages for experiment management:
- `/admin/evolution/experiments` — Standalone experiments listing page
- `/admin/evolution/start-experiment` — Dedicated experiment creation page

### Experiment Detail Page

The experiment detail page (`/admin/evolution/experiments/[experimentId]`) provides a comprehensive view of a single experiment. Server component fetches status via `getExperimentStatusAction`, then renders:

- **ExperimentOverviewCard**: Name, status badge (with animated pulse for active states), truncated ID (click-to-copy), budget progress bar, runs/target metadata grid, cancel button for active experiments, error message display
- **ExperimentDetailTabs**: Client tab bar with 3 lazy-rendered tabs:
  - **Analysis**: Per-run comparison table showing Elo, cost, and Elo/$ for each run
  - **Runs**: Flat table of all runs, fetched via `getExperimentRunsAction`. Each run links to its detail page via `buildRunUrl()`. Displays status, Elo, cost, and creation date.
  - **Report**: Auto-generated LLM analysis report. Cached in `resultsSummary.report`. For terminal experiments without a report, offers a "Generate Report" button. For existing reports, shows markdown sections with model/timestamp metadata and a "Regenerate" option.

### LLM Report Generation

When an experiment reaches a terminal state (`completed`, `failed`), the cron driver auto-generates an analysis report via `callLLM` using `gpt-4.1-nano`. The prompt is built by `buildExperimentReportPrompt()` which includes experiment metadata and analysis results. Report generation is fire-and-forget — failures don't block experiment state transitions. Reports can be manually regenerated via `regenerateExperimentReportAction`.

## Strategy Pre-Registration

All run-creation paths (including experiments) call `upsertStrategy()` before inserting a run. This ensures `strategy_id` is always set (NOT NULL) and strategies appear immediately in the strategy leaderboard. For experiments, `created_by: 'experiment'` is set on the strategy row.

The atomic INSERT-first pattern in `upsertStrategy()` (`lib/v2/strategy.ts`) eliminates TOCTOU race conditions when multiple concurrent runs share the same strategy config hash.

## Database Tables

- `evolution_experiments` — Experiment metadata, budget, state machine status, design (`'manual'`), analysis results. `pre_archive_status TEXT` stores the status before archiving (for restore). Status CHECK includes `'archived'`.
- `evolution_runs.experiment_id` — FK linking runs directly to their experiment

## Server Actions

7 V2 actions in `evolution/src/services/experimentActionsV2.ts`:

| Action | Purpose |
|--------|---------|
| `createExperimentAction` | Create a new experiment for a prompt |
| `addRunToExperimentAction` | Add a run to an experiment (auto-transitions draft→running) |
| `getExperimentAction` | Get experiment detail with runs and computed metrics |
| `listExperimentsAction` | List experiments with optional status filter |
| `getPromptsAction` | List active prompts for experiment creation |
| `getStrategiesAction` | List active strategies for experiment creation |
| `cancelExperimentAction` | Cancel experiment + bulk-fail pending/claimed/running runs via RPC |

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/services/experimentActionsV2.ts` | 7 V2 server actions for experiment lifecycle |
| `evolution/src/lib/v2/experiments.ts` | `createExperiment`, `addRunToExperiment`, `computeExperimentMetrics` |
| `src/app/admin/evolution/_components/ExperimentForm.tsx` | Admin UI for configuring experiments |
| `src/app/admin/evolution/_components/ExperimentStatusCard.tsx` | Experiment status card |
| `src/app/admin/evolution/_components/ExperimentHistory.tsx` | Past experiment listing |
| `src/app/admin/evolution/experiments/page.tsx` | Experiment list page |
| `src/app/admin/evolution/experiments/[experimentId]/page.tsx` | Experiment detail page |
| `src/app/admin/evolution/experiments/[experimentId]/ExperimentOverviewCard.tsx` | Status, budget overview |
| `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx` | Per-run comparison table |
| `src/app/admin/evolution/experiments/[experimentId]/RunsTab.tsx` | Run table with links |
| `src/app/admin/evolution/experiments/[experimentId]/ReportTab.tsx` | Experiment report tab |
| `src/app/admin/evolution/start-experiment/page.tsx` | Experiment creation wizard |

## Legacy: L8/Taguchi System (Deprecated)

> **Deprecated as of March 4-5, 2026.** The original experiment system used Taguchi L8 orthogonal arrays (fractional factorial design) to test 5 pipeline factors in 8 runs. This system has been fully replaced by manual experiments. The following files have been deleted:
>
> - `evolution/src/experiments/evolution/factorial.ts` — L8 array generation, factor mapping
> - `evolution/src/experiments/evolution/factorRegistry.ts` — Type-safe factor registry
> - `evolution/src/experiments/evolution/experimentValidation.ts` — Multi-stage validation pipeline
> - `scripts/run-strategy-experiment.ts` — CLI orchestrator (plan/run/analyze/status)
>
> The DB migration `20260304000003` added `'manual'` to the `design` CHECK constraint on `evolution_experiments`, alongside the legacy `'L8'` and `'full-factorial'` values.

## Related Documentation

- [Cost Optimization](./cost_optimization.md) — Budget tracking, Pareto analysis
- [Reference](./reference.md) — Configuration, database schema
- [Data Model](./data_model.md) — Database tables used by the pipeline
- [Architecture](./architecture.md) — Core pipeline execution flow
