# Minor Evolution V2 Changes Research

## Problem Statement
The evolution V2 pipeline's evolve phase adds variants to the pool that never get properly triaged/ranked (they skip the `newEntrantIds` tracking), and the file naming in the V2 pipeline could be clearer. This project disables the evolve agent from the V2 pipeline and explores renaming key files to improve codebase readability.

## Requirements (from GH Issue #NNN)
1. Disable the evolve agent from the main evolution V2 pipeline (`evolve-article.ts`)
2. Explore renaming key files in `evolution/src/lib/v2/` to make the codebase easier to understand

## High Level Summary

### Evolve Phase Bug
The evolve phase in `evolve-article.ts` adds variants to the pool after `rankPool()` has already run. These variants are added to `newVariantIds` but that array resets at the start of each iteration. So in the next iteration, `rankPool()` only triages variants from that iteration's generate phase — evolve variants from the previous iteration sit in the pool unrated and never get properly assessed unless incidentally matched.

### Current File Structure (post PR #740 rebase)
PR #740 moved `v2/` → `pipeline/` and `core/` → `shared/`. The call chain is now:
```
services/evolutionRunnerCore.ts (146 lines) — claim + infra setup + delegate
  → pipeline/runner.ts (196 lines) — fetch config, resolve content, call loop, finalize
    → pipeline/evolve-article.ts (267 lines) — main generate→rank→evolve iteration loop
      → pipeline/generate.ts, pipeline/rank.ts, pipeline/evolve.ts, pipeline/finalize.ts
```

`pipeline/` is flat with 18 source files — no subfolder organization.

Key findings:
- **`evolve-article.ts`** — misleading name; it's the entire pipeline loop orchestrator (now 267 lines after PR #740 extracted `executePhase()` helper)
- **`runner.ts`** — vague name; it's a single-run executor
- **`evolve.ts`** — very misleading; it extracts feedback from rankings, doesn't evolve anything
- **`evolutionRunnerCore.ts`** — overlap with `runner.ts`: duplicate heartbeat, duplicate `markRunFailed`, duplicate error handling
- **`evolutionRunClient.ts`** — already deleted by PR #740
- **`/api/evolution/run` route** — still exists, used by admin UI manual trigger only; batch runner imports `executeV2Run` directly

### Overlap Between evolutionRunnerCore.ts and runner.ts
Both files:
- Start their own heartbeat interval (duplicate — confirmed still present after rebase)
- Have their own `markRunFailed` helper
- Have their own error catch + cleanup logic
- Create infra (split awkwardly — core creates cost tracker/LLM, runner creates logger)

### Callers of runner.ts and evolutionRunnerCore.ts
- `evolution/scripts/evolution-runner.ts` — batch runner, imports `executeV2Run` directly
- `evolution/scripts/evolution-runner-v2.ts` — same
- `src/app/api/evolution/run/route.ts` — admin trigger, imports `claimAndExecuteEvolutionRun`
- `pipeline/index.ts` — barrel re-exports `executeV2Run`

### Refactoring Opportunity
The two-file split (core + runner) can be consolidated and restructured into a symmetric 4-file architecture with descriptive verb-based names:
- `claimAndExecuteRun.ts` (~120 lines) — thin orchestrator: claim → setup → loop → finalize → cleanup
- `setup/buildRunContext.ts` (~80 lines) — build RunContext from a claimed run
- `loop/runIterationLoop.ts` (~290 lines) — pure generate → rank iteration loop
- `finalize/persistRunResults.ts` (~200 lines) — rename of existing `finalize.ts`, persist results to DB

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/visualization.md

## Code Files Read
- `evolution/src/services/evolutionRunnerCore.ts` (146 lines)
- `evolution/src/lib/v2/runner.ts` (196 lines)
- `evolution/src/lib/v2/evolve-article.ts` (320 lines)
- `evolution/src/lib/v2/evolve.ts`
- `evolution/src/lib/v2/generate.ts`
- `evolution/src/lib/v2/rank.ts` (609 lines)
- `evolution/src/lib/v2/finalize.ts` (204 lines)
- `evolution/src/lib/v2/strategy.ts`
- `evolution/src/lib/v2/cost-tracker.ts`
- `evolution/src/lib/v2/llm-client.ts`
- `evolution/src/lib/v2/run-logger.ts`
- `evolution/src/lib/v2/invocations.ts`
- `evolution/src/lib/v2/seed-article.ts`
- `evolution/src/lib/v2/arena.ts`
- `evolution/src/lib/v2/experiments.ts`
- `evolution/src/lib/v2/types.ts`
- `evolution/src/lib/v2/errors.ts`
- `evolution/src/lib/v2/index.ts`
- `evolution/src/services/experimentActionsV2.ts`
- `evolution/src/services/evolutionRunClient.ts` (dead code)
- `src/app/api/evolution/run/route.ts`
