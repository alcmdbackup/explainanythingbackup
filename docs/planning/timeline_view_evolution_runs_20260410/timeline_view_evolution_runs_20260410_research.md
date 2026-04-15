# Timeline View Evolution Runs Research

## Problem Statement
Add a Timeline tab to evolution run detail pages showing a Gantt-style view of agent invocations grouped by iteration. Parallel generate agents are shown as stacked rows starting at the same x-position. Each bar links to the invocation detail page and shows duration. The run outcome (stop reason, winner, cost, match stats) is displayed below the chart.

## Requirements (from GH Issue #953)
- Tab called "timeline" on the run detail page
- Shows which agent invocations were run for each iteration
- Parallel agents shown visually as parallel (stacked rows, same x-position)
- Easy to click through to individual agent invocation detail pages
- Shows how long different things took and how they influenced overall run time
- Shows the final outcome of the run

## High Level Summary

### Data available in `evolution_agent_invocations`
Every invocation row has:
- `created_at` — timestamp when agent started; drives x-axis position
- `duration_ms` — wall-clock time for the agent; drives bar width
- `iteration` — which iteration (0-indexed); present since V2 schema
- `execution_order` — order within iteration; written since parallel pipeline (20260331)
- `agent_name` — `GenerateFromSeedArticleAgent`, `SwissRankingAgent`, `MergeRatingsAgent`
- `success`, `cost_usd`, `error_message`

Existing `listInvocationsAction` in `invocationActions.ts` returns all these fields with a configurable limit (max 200). Sufficient for any run (typical runs: 20–50 invocations).

### Parallel execution pattern (from architecture.md)
Generate iterations: N `GenerateFromSeedArticleAgent` invocations run in parallel (same iteration, close `created_at` timestamps), followed by 1 `MergeRatingsAgent`. Swiss iterations: 1 `SwissRankingAgent` followed by 1 `MergeRatingsAgent`. Inferring iteration type from agent names is sufficient.

### Run outcome data
`run_summary` JSONB on `evolution_runs` (V3 schema) contains: `stopReason`, `totalIterations`, `durationSeconds`, `topVariants`, `baselineRank`, `matchStats`. Already fetched with the run object on the detail page.

### Existing tab structure
Run detail page (`src/app/admin/evolution/runs/[runId]/page.tsx`) uses `EntityDetailTabs` + a `TABS` array. Adding a new tab requires: importing the component, adding to `TABS`, rendering in the switch block. The `run` object is already in scope.

### No backfill needed
All required columns exist on every run since V2 (20260322). Fields that may be null on very old runs (`duration_ms`, `execution_order`) degrade gracefully: null `duration_ms` → minimum-width bar; null `iteration` → "Setup" group.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/visualization.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/metrics.md
- evolution/docs/logging.md
- docs/feature_deep_dives/evolution_metrics.md

## Code Files Read
- `src/app/admin/evolution/runs/[runId]/page.tsx`
- `evolution/src/services/invocationActions.ts`
- `evolution/src/services/evolutionActions.ts` (EvolutionRun type, run_summary)
- `evolution/src/components/evolution/tabs/SnapshotsTab.tsx` (reference pattern)
- `evolution/src/components/evolution/tabs/EloTab.tsx` (reference pattern)
- `evolution/src/lib/utils/evolutionUrls.ts`
- `evolution/src/components/evolution/index.ts`
- `evolution/src/lib/types.ts` (EvolutionRunSummary)
- `supabase/migrations/20260331000001_evolution_parallel_pipeline_schema.sql`
