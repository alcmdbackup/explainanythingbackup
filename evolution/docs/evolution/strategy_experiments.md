# Strategy Experiments

Systematic experimentation layer using fractional factorial design to explore the evolution pipeline's strategy search space and find Elo-optimal configurations under cost constraints.

## Overview

The strategy experiment system uses Taguchi L8 orthogonal arrays to test 5 pipeline configuration factors in just 8 runs, then analyzes main effects and interactions to determine which factors matter most. Results flow to existing dashboards automatically via the standard `finalizePipelineRun()` path.

## Methodology

### Fractional Factorial Design

Instead of testing all possible combinations (which would require 2^5 = 32 runs), an L8 orthogonal array tests 5 factors at 2 levels in only 8 runs while maintaining statistical balance. Each factor appears at each level exactly 4 times, and all column pairs are orthogonal (dot product = 0), enabling clean separation of main effects.

### Single-Round Design

Each experiment runs a single L8 screening round, then analyzes results. For further exploration, create a new experiment with adjusted factors. This flat model (`Experiment → Run`) avoids the complexity of multi-round orchestration.

### Factors

| Factor | Low | High | What it tests |
|--------|-----|------|---------------|
| Generation model | deepseek-chat | gpt-5-mini | Cost vs quality of text generation |
| Judge model | gpt-5-nano | gpt-4.1-nano | Does better judgment improve selection pressure? |
| Iterations | 3 | 8 | More refinement cycles vs diminishing returns |
| Editor | iterativeEditing | treeSearch | Which editing approach produces better results? |
| Support agents | off | on | Is the full agent suite (debate, evolution, etc.) worth the cost? |

## CLI Usage

```bash
# Preview the experiment plan
npx tsx scripts/run-strategy-experiment.ts plan --round 1

# Execute all 8 runs
npx tsx scripts/run-strategy-experiment.ts run --round 1 \
  --prompt "Explain how blockchain technology works"

# Re-analyze completed results
npx tsx scripts/run-strategy-experiment.ts analyze --round 1

# Check experiment status
npx tsx scripts/run-strategy-experiment.ts status

# Round 2 with refined factors
npx tsx scripts/run-strategy-experiment.ts plan --round 2 \
  --vary "iterations=3,5,8,12" \
  --lock "genModel=deepseek-chat"
```

## Analysis

After runs complete, the analysis engine computes:

1. **Main Effects**: `avg(Elo | factor=high) - avg(Elo | factor=low)` for both Elo and Elo/$
2. **Factor Ranking**: Sorted by absolute effect magnitude
3. **Interaction Effects**: Columns 6-7 of L8 estimate A×C and A×E interactions
4. **Recommendations**: Lock negligible factors, expand important ones, flag significant interactions

## Automated Experiment System

In addition to the CLI, experiments can be run automatically via the admin UI and a cron-driven state machine.

### Architecture

The automated system uses a 6-state machine driven by a per-minute cron job (`/api/cron/experiment-driver`). Each invocation processes one state transition per active experiment:

| State | Transition | Next State |
|-------|-----------|------------|
| `pending` | Experiment created | `running` |
| `running` | All runs terminal, all failed | `failed` |
| `running` | All runs terminal, some completed | `analyzing` |
| `analyzing` | Some runs completed | `completed` |
| `analyzing` | All runs failed | `failed` |

### Factor Registry

The `FACTOR_REGISTRY` (`factorRegistry.ts`) provides type-safe factor definitions that delegate to existing codebase sources (model schemas, agent lists, pricing data). Each factor type supports:

- `validate(value)` — validates against the authoritative source
- `getValidValues()` — returns all allowed values
- `orderValues(values)` — sorts by cost (models by input price, iterations ascending)
- `expandAroundWinner(winner)` — returns 3 levels bracketing the winning value for Round 2+

### Admin UI

The optimization dashboard (`/admin/quality/optimization`) includes an "Experiments" tab with:

- **ExperimentForm**: Factor toggle checkboxes with Low/High dropdowns populated from the registry, client-side fast-fail + debounced server validation, budget configuration, and prompt selection from the prompt library
- **ExperimentStatusCard**: Real-time status with auto-refresh (15s), run progress bars, budget usage
- **ExperimentHistory**: Collapsible list of past experiments with lazy-loaded run counts. Each row links to the experiment detail page.

### Experiment Detail Page

The experiment detail page (`/admin/quality/optimization/experiment/[experimentId]`) provides a comprehensive view of a single experiment. Server component fetches status via `getExperimentStatusAction`, then renders:

- **ExperimentOverviewCard**: Name, status badge (with animated pulse for active states), truncated ID (click-to-copy), budget progress bar, runs/target/convergence/created metadata grid, factor definitions table, cancel button for active experiments, error message display
- **ExperimentDetailTabs**: Client tab bar with 3 lazy-rendered tabs:
  - **Analysis**: Experiment analysis card showing main effects table (sorted by absolute effect magnitude), factor rankings, recommendations, and warnings.
  - **Runs**: Flat table of all runs, fetched via `getExperimentRunsAction`. Each run links to its detail page via `buildRunUrl()`. Displays status, Elo, cost, L8 row assignment, and creation date.
  - **Report**: Auto-generated LLM analysis report. Cached in `resultsSummary.report`. For terminal experiments without a report, offers a "Generate Report" button. For existing reports, shows markdown sections with model/timestamp metadata and a "Regenerate" option.

### LLM Report Generation

When an experiment reaches a terminal state (`completed`, `failed`), the cron driver auto-generates an analysis report via `callLLM` using `gpt-4.1-nano`. The prompt is built by `buildExperimentReportPrompt()` which includes experiment metadata, factor definitions, and analysis results. Report generation is fire-and-forget — failures don't block experiment state transitions. Reports can be manually regenerated via `regenerateExperimentReportAction`.

### Strategy Pre-Registration

Experiments pre-register strategy configs at run creation time via `resolveOrCreateStrategyFromRunConfig()`. This ensures strategies appear immediately in the strategy leaderboard (rather than waiting for `linkStrategyConfig` at run completion). Each run's `strategy_config_id` is set before pipeline execution begins, with `created_by: 'experiment'`.

The atomic INSERT-first pattern in `strategyResolution.ts` eliminates TOCTOU race conditions when multiple concurrent runs share the same strategy config hash.

### Database Tables

- `evolution_experiments` — Experiment metadata, budget, state machine status, factor definitions, design, analysis results
- `evolution_runs.experiment_id` — FK linking runs directly to their experiment

### Validation Pipeline

`experimentValidation.ts` chains: factor registry validation → L8 design generation → config resolution → strategy config validation → run config validation → cost estimation. Rejects <2 factors, 0 prompts, or >10 prompts.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/run-strategy-experiment.ts` | CLI orchestrator (plan/run/analyze/status) |
| `evolution/src/experiments/evolution/factorial.ts` | L8/full-factorial design generation, factor mapping |
| `evolution/src/experiments/evolution/analysis.ts` | Main effects, interactions, ranking, recommendations |
| `evolution/src/experiments/evolution/factorRegistry.ts` | Type-safe factor registry delegating to codebase sources |
| `evolution/src/experiments/evolution/experimentValidation.ts` | Multi-stage validation pipeline for experiment configs |
| `evolution/src/services/experimentActions.ts` | Server actions: start, status, list, cancel, validate experiments |
| `src/app/api/cron/experiment-driver/route.ts` | Cron-driven state machine for automated experiment progression |
| `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` | Admin UI for configuring and starting experiments |
| `src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx` | Real-time experiment monitoring |
| `src/app/admin/quality/optimization/_components/ExperimentHistory.tsx` | Past experiment listing with expandable detail |
| `src/app/admin/quality/optimization/experiment/[experimentId]/page.tsx` | Experiment detail server page |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` | Status, budget, factors overview |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.tsx` | Tab bar (Analysis, Runs, Report) |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentAnalysisCard.tsx` | Main effects, rankings, recommendations |
| `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx` | Flat run table with links |
| `src/app/admin/quality/optimization/experiment/[experimentId]/ReportTab.tsx` | LLM-generated experiment report |
| `evolution/src/services/experimentHelpers.ts` | Shared helpers (extractTopElo) |
| `evolution/src/services/experimentReportPrompt.ts` | Report prompt builder and model config |
| `experiments/strategy-experiment.json` | CLI experiment state (gitignored) |

## State File

Experiment state is persisted to `experiments/strategy-experiment.json` after each run completes. This enables resume on failure — the `run` command skips already-completed rows. Failed runs can be retried with `--retry-failed`.

## Related Documentation

- [Cost Optimization](./cost_optimization.md) — Budget tracking, adaptive allocation, Pareto analysis
- [Reference](./reference.md) — CLI commands, configuration, database schema
- [Data Model](./data_model.md) — Database tables used by the pipeline
- [Architecture](./architecture.md) — Core pipeline execution flow
