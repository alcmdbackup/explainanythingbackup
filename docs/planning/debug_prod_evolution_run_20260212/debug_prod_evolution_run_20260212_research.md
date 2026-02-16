# Debug Prod Evolution Run Research

## Problem Statement
In production, evolution run 50140d27 never finished running and was never entered in the hall of fame. 5 iterations ran which was supposed to be the max.

## Requirements (from GH Issue #423)
- Investigate why production evolution run 50140d27 did not complete
- Determine why the run was not entered in the hall of fame despite 5 iterations running (which should be the max)
- Identify the root cause and fix the bug preventing run completion and hall of fame entry

## High Level Summary

### Root Cause: Vercel Serverless Timeout

Run `50140d27-7c68-47e6-bf63-f2a448d6c2c8` was killed by Vercel's serverless function timeout after ~4 minutes of execution. The process died silently during iteration 5's calibration agent — no error was logged, no cleanup ran, and the run is permanently stuck in `running` status.

### Key Findings

1. **Run is stuck in `running` status** — started at 00:07:47 UTC, last activity at 00:11:53 UTC (~4 min), never completed or failed
2. **0 variants persisted** — variants only write to `content_evolution_variants` during `finalizePipelineRun()` which never executed
3. **0 hall of fame entries** — `feedHallOfFame()` is called inside `finalizePipelineRun()` which never executed
4. **No error captured** — `error_message` is null, no error-level logs exist. Process was killed externally (not a code exception)
5. **`maxIterations` was 15, not 5** — run config is `{}` (empty), so `DEFAULT_EVOLUTION_CONFIG.maxIterations: 15` applies. The run completed 5 iterations before being killed, not because it reached max
6. **`runner_id` is null** — suggests the run was triggered via `triggerEvolutionRunAction` (admin UI), which doesn't set runner_id or heartbeat interval

### Execution Path

The run was likely triggered from the admin UI via `triggerEvolutionRunAction` (server action). This action:
- Does NOT set `runner_id` (matches DB showing null)
- Does NOT set up a heartbeat interval (unlike the cron runner)
- Does NOT have `maxDuration` configured (unlike cron route's `maxDuration = 300`)
- Runs `executeFullPipeline` synchronously inside the server action, subject to Vercel's serverless timeout

**OR** it was triggered by the cron runner (`/api/cron/evolution-runner`), which has `maxDuration = 300` (5 min) — matching the ~4 min runtime before timeout. The cron runner claims the run with `runner_id`, but the run's null `runner_id` could indicate a bug or timing issue.

### Why the Watchdog Didn't Clean Up

The watchdog cron (`/api/cron/evolution-watchdog`) runs every 15 min and marks runs with `last_heartbeat > 10 min ago` as failed. The watchdog SHOULD have caught this run. Possible reasons it didn't:
- The run may have been very recent (Feb 14 00:07 UTC) and the watchdog hasn't had time to trigger yet
- The watchdog cron may not be receiving proper `CRON_SECRET` authorization
- The watchdog may be failing silently

### Architecture Issue

The fundamental problem is that `triggerEvolutionRunAction` runs the entire evolution pipeline synchronously inside a Vercel serverless function. Evolution runs with default config (15 iterations, 12 agents) take much longer than any serverless timeout allows (60-300s depending on plan/config). The cron runner route has the same issue — it configures `maxDuration = 300` but the pipeline can take 10+ minutes for 15 iterations.

### Missing Migration

The `evolution_agent_invocations` table (migration `20260212000001`) has NOT been deployed to production. This doesn't affect run completion but prevents the admin UI from showing per-agent-per-iteration detail views.

## Production Database State (run 50140d27)

| Field | Value |
|-------|-------|
| **id** | `50140d27-7c68-47e6-bf63-f2a448d6c2c8` |
| **status** | `running` (STUCK) |
| **phase** | `EXPANSION` |
| **current_iteration** | 5 |
| **total_variants** | 0 |
| **variants_generated** | 0 |
| **total_cost_usd** | 0 |
| **estimated_cost_usd** | 0.1053 |
| **budget_cap_usd** | 5 |
| **error_message** | null |
| **runner_id** | null |
| **runner_agents_completed** | 15 |
| **explanation_id** | null |
| **prompt_id** | `d238f561-138a-4669-9320-6afb2add75c7` |
| **strategy_config_id** | `0706470b-ac6c-41ad-9e75-bb30aa298f1e` |
| **pipeline_type** | `full` |
| **source** | `prompt:d238f561-138a-4669-9320-6afb2add75c7` |
| **config** | `{}` |
| **started_at** | `2026-02-14T00:07:47.739Z` |
| **last_heartbeat** | `2026-02-14T00:11:53.438Z` |
| **completed_at** | null |
| **run_summary** | null |

### Iteration Log Timeline

| Iter | Time | Agents | Pool Size | Cost |
|------|------|--------|-----------|------|
| 1 | 00:08:36 | generation (2 variants), calibration (4 matches), proximity | 1→3 | ~$0.029 |
| 2 | 00:09:19 | generation (3 variants), calibration (15 matches), proximity | 3→6 | ~$0.135 |
| 3 | 00:09:51 | generation (3 variants), calibration (12 matches), proximity | 6→9 | ~$0.235 |
| 4 | 00:11:00 | generation (3 variants), calibration (15 matches), proximity | 9→12 | ~$0.361 |
| 5 | 00:11:30 | generation (3 variants), calibration (in progress...) | 12→15 | ~$0.363+ |
| **DEAD** | 00:11:53 | Last activity — calibration LLM calls stopped | 15 | — |

- 260 total log entries: 214 debug, 45 info, 1 warn, 0 error
- Only warning: "Format rejected" for structural_transform (no section headings)

## Code Flow Analysis

### How Runs Complete (pipeline.ts)

```
executeFullPipeline:
  for loop (up to maxIterations=15):
    → supervisor.shouldStop() — checks plateau/budget/iterations
    → run agents (generation, calibration, proximity in EXPANSION)
    → persistCheckpoint (updates last_heartbeat)

  AFTER loop exits:
    → update status='completed'
    → finalizePipelineRun():
        1. buildRunSummary + persist run_summary
        2. persistVariants → content_evolution_variants
        3. persistAgentMetrics → evolution_run_agent_metrics
        4. linkStrategyConfig
        5. autoLinkPrompt
        6. feedHallOfFame → hall_of_fame_entries + hall_of_fame_elo
```

### What Happens on Vercel Timeout

When Vercel kills the function:
- No catch/finally block runs
- No error is thrown — process is terminated
- Run stays in `running` status forever
- No variants are persisted (only done in finalizePipelineRun)
- No hall of fame entry is created
- The watchdog should eventually mark it `failed` but provides no recovery

### triggerEvolutionRunAction vs Cron Runner

| Aspect | triggerEvolutionRunAction | Cron Runner |
|--------|--------------------------|-------------|
| Entry point | Server action (admin UI) | `/api/cron/evolution-runner` GET |
| `maxDuration` | NOT configured (plan default) | `300` (5 min) |
| runner_id | NOT set | Set during claim |
| Heartbeat interval | NOT set up | 30s interval |
| Error handling | try/catch returns error | try/catch marks run failed |

### queueEvolutionRunAction Config Gap

The queue action only copies `enabledAgents` and `singleArticle` from the strategy config to the run config. It does NOT copy `iterations`, `generationModel`, `judgeModel`, or other strategy settings. So even if a strategy specifies `iterations: 5`, the pipeline uses the default `maxIterations: 15`.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/debugging_skill.md
- docs/feature_deep_dives/error_handling.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/request_tracing_observability.md

### Evolution Docs
- docs/evolution/README.md
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/hall_of_fame.md
- docs/evolution/reference.md

## Code Files Read
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator, finalizePipelineRun, feedHallOfFame
- `src/app/api/cron/evolution-runner/route.ts` — Cron runner (maxDuration=300, heartbeat)
- `src/app/api/cron/evolution-watchdog/route.ts` — Watchdog (stale heartbeat > 10 min)
- `src/lib/services/evolutionActions.ts` — Server actions (triggerEvolutionRunAction, queueEvolutionRunAction)
- `src/lib/evolution/index.ts` — preparePipelineRun, createDefaultAgents
- `vercel.json` — Cron config (runner: 5min, watchdog: 15min)
