# Testing Out Latest Evolution Updates Research

## Problem Statement
Run the full evolution pipeline locally and on staging to validate all recent changes work correctly together. Test new features on the evolution pipeline and dashboard to ensure they function properly end-to-end. This includes validating the recent over-budget handling and max-iterations fixes, as well as any new dashboard features.

## Requirements (from GH Issue #434)
- Run all evolution-related unit and integration tests to validate correctness
- Run evolution-local.ts with --full --mock and --full with real LLM, check all agents execute, budget/iteration stops work
- Test new features on the evolution pipeline and dashboard

## High Level Summary

Two bugs discovered while investigating why runs `61333094` and `6267637e` show no data on the dashboard despite being in "running" status for 27+ minutes.

### Bug 1: Supervisor config validation throws on low maxIterations (Root Cause)

**Location:** `src/lib/evolution/core/supervisor.ts:97-104` (`PoolSupervisor.validateConfig()`)

The supervisor enforces `maxIterations > expansion.maxIterations` (default 8) and `maxIterations >= expansionMaxIterations + plateauWindow + 1` (default 12). When a strategy specifies `iterations: 3`, the resolved config has `maxIterations: 3` but `expansion.maxIterations: 8`. The supervisor constructor throws immediately:

```
maxIterations (3) must be > expansionMaxIterations (8)
```

This throw happens at line 842 of `pipeline.ts` — AFTER the run status is set to 'running' (line 834) but BEFORE any agent runs. Since no agent executes, `markRunFailed()` is never called.

**Reproduction:** Queue any run with a strategy that has `iterations <= 8` (the default `expansion.maxIterations`). The run will be stuck in "running" forever with 0 data.

### Bug 2: triggerEvolutionRunAction doesn't mark run as failed on error

**Location:** `src/lib/services/evolutionActions.ts:623-624`

The catch block returns `{ success: false, error }` to the client but never updates the run's DB status. The run stays in 'running' status permanently. The batch runner (`evolution-runner.ts`) likely has its own error handling that marks runs as failed, but the inline trigger path does not.

```typescript
// Current (broken):
catch (error) {
  return { success: false, error: handleError(error, 'triggerEvolutionRunAction', { runId }) };
}

// Should also mark the run as failed in DB
```

### Investigation Timeline

1. Navigated to `/admin/quality/evolution/run/61333094` → "Run not found" (truncated UUID)
2. Found full UUID `61333094-0525-455d-8e6d-b734dd2cb719` from list page → page loads but all tabs empty
3. Confirmed 0 checkpoints, 0 log entries, 0 agent invocations, 0 variants
4. No evolution runner process running (`ps aux | grep evolution` = empty)
5. No GitHub Actions batch runs on Feb 14 (last was Feb 9)
6. Traced code path: Start Pipeline → `queueEvolutionRunAction` → `triggerEvolutionRunAction` → `executeFullPipeline`
7. Found `executeFullPipeline` sets status='running' at line 834, then `new PoolSupervisor()` at line 842 throws on config validation
8. Error propagates to `triggerEvolutionRunAction` catch block which doesn't update DB status

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/reference.md
- docs/evolution/architecture.md
- docs/evolution/README.md
- docs/evolution/cost_optimization.md
- docs/evolution/data_model.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/visualization.md
- docs/evolution/hall_of_fame.md

## Code Files Read
- `src/app/admin/quality/evolution/page.tsx` — Start Pipeline UI, handleStart(), run table with truncated IDs
- `src/lib/services/evolutionActions.ts` — queueEvolutionRunAction, triggerEvolutionRunAction (catch block bug), getEvolutionRunByIdAction
- `src/lib/evolution/core/pipeline.ts` — executeFullPipeline (status='running' before supervisor), runAgent (has markRunFailed)
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor.validateConfig() (throws on low maxIterations)
- `src/lib/evolution/index.ts` — preparePipelineRun, resolveConfig
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG (expansion.maxIterations: 8)
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail page, data fetching, tab structure
