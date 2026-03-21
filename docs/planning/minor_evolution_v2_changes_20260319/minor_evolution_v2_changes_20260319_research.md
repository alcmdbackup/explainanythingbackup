# Minor Evolution V2 Changes Research

## Problem Statement
The evolution V2 pipeline's evolve phase adds variants to the pool that never get properly triaged/ranked (they skip the `newEntrantIds` tracking), and the file naming in the V2 pipeline could be clearer. This project disables the evolve agent from the V2 pipeline and explores renaming key files to improve codebase readability.

## Requirements (from GH Issue #NNN)
1. Disable the evolve agent from the main evolution V2 pipeline (`evolve-article.ts`)
2. Explore renaming key files in `evolution/src/lib/v2/` to make the codebase easier to understand

## High Level Summary

### Evolve Phase Bug
The evolve phase in `evolve-article.ts` adds variants to the pool after `rankPool()` has already run. These variants are added to `newVariantIds` but that array resets at the start of each iteration. So in the next iteration, `rankPool()` only triages variants from that iteration's generate phase — evolve variants from the previous iteration sit in the pool unrated and never get properly assessed unless incidentally matched.

### Current File Structure (V2 pipeline)
The V2 call chain is:
```
evolutionRunnerCore.ts (146 lines) — claim + infra setup + delegate
  → runner.ts (196 lines) — fetch config, resolve content, call loop, finalize
    → evolve-article.ts (320 lines) — main generate→rank→evolve iteration loop
      → generate.ts, rank.ts, evolve.ts, finalize.ts
```

Key findings:
- **`evolve-article.ts`** — misleading name; it's the entire pipeline loop orchestrator
- **`runner.ts`** — vague name; it's a single-run executor
- **`evolve.ts`** — very misleading; it extracts feedback from rankings, doesn't evolve anything
- **`evolutionRunnerCore.ts`** — overlap with `runner.ts`: duplicate heartbeat, duplicate `markRunFailed`, duplicate error handling
- **`evolutionRunClient.ts`** — dead code, zero callers in codebase. Client-side fetch wrapper for `/api/evolution/run` that nothing imports.

### Overlap Between evolutionRunnerCore.ts and runner.ts
Both files:
- Start their own heartbeat interval (duplicate)
- Have their own `markRunFailed` helper
- Have their own error catch + cleanup logic
- Create infra (split awkwardly — core creates cost tracker/LLM, runner creates logger)

### Refactoring Opportunity
The two-file split (core + runner) can be consolidated and restructured into a symmetric 4-file architecture:
- `singleRunLifecycle.ts` (~120 lines) — thin orchestrator: claim → setup → loop → finalize → cleanup
- `setup-run.ts` (~80 lines) — build RunContext from a claimed run (all infra + config + content)
- `pipeline-loop.ts` (~290 lines) — pure generate → rank iteration loop
- `finalize-run.ts` (~200 lines) — rename of existing `finalize.ts`, persist results to DB

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
