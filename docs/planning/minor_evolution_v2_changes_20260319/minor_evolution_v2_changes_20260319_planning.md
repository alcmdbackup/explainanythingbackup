# Minor Evolution V2 Changes Plan

## Background
The evolution V2 pipeline's evolve phase adds variants to the pool that never get properly triaged/ranked (they skip the `newEntrantIds` tracking), and the file naming in the V2 pipeline could be clearer. This project disables the evolve agent from the V2 pipeline and explores renaming key files to improve codebase readability.

## Requirements (from GH Issue #NNN)
1. Disable the evolve agent from the main evolution V2 pipeline (`evolve-article.ts`)
2. Rename key files for clarity
3. Remove duplicate heartbeat between `evolutionRunnerCore.ts` and `runner.ts`
4. Remove dead code: `evolutionRunClient.ts` and potentially `/api/evolution/run` route

## Problem
The V2 pipeline has several clarity and correctness issues: (1) the evolve phase adds variants that never get triaged since they miss `newEntrantIds` tracking, (2) file names like `evolve-article.ts`, `runner.ts`, and `evolve.ts` don't reflect what they actually do, (3) there's a duplicate heartbeat in both the orchestrator and executor, and (4) the direct-trigger client (`evolutionRunClient.ts`) is dead code with zero callers.

## Agreed Decisions

### Folder structure after refactor
```
v2/
  ├── singleRunLifecycle.ts          — thin orchestrator: claim→setup→loop→finalize→cleanup (~120 lines)
  ├── setup/
  │   ├── setup-run.ts               — build RunContext (infra + config + content) (~80 lines)
  │   ├── strategy.ts                — hash-based find-or-create for strategy configs
  │   └── seed-article.ts            — generate initial article from prompt
  ├── pipeline/
  │   ├── pipeline-loop.ts           — generate → rank iteration loop (~290 lines)
  │   ├── generate.ts                — create new text variants via 3 strategies
  │   ├── rank.ts                    — triage + Swiss fine-ranking
  │   └── extract-feedback.ts        — extract improvement feedback from rankings
  ├── finalize/
  │   └── finalize-run.ts            — persist results to DB (~200 lines)
  ├── shared/
  │   ├── cost-tracker.ts            — reserve-before-spend budget enforcement
  │   ├── llm-client.ts              — LLM call wrapper with cost tracking
  │   ├── run-logger.ts              — structured logging to DB
  │   ├── invocations.ts             — create/update agent invocation records
  │   ├── arena.ts                   — load/sync arena entries
  │   ├── types.ts                   — all V2 type definitions
  │   └── errors.ts                  — V2 error classes
  ├── experiments.ts                 — experiment management (outside pipeline flow)
  └── index.ts                       — barrel exports
```

### File renames / moves
| Before | After |
|---|---|
| `evolutionRunnerCore.ts` (services/) | `v2/singleRunLifecycle.ts` |
| `runner.ts` | merged into `singleRunLifecycle.ts` + `setup/setup-run.ts` |
| `evolve-article.ts` | `pipeline/pipeline-loop.ts` |
| `generate.ts` | `pipeline/generate.ts` |
| `rank.ts` | `pipeline/rank.ts` |
| `evolve.ts` | `pipeline/extract-feedback.ts` |
| `finalize.ts` | `finalize/finalize-run.ts` |
| `strategy.ts` | `setup/strategy.ts` |
| `seed-article.ts` | `setup/seed-article.ts` |
| `cost-tracker.ts` | `shared/cost-tracker.ts` |
| `llm-client.ts` | `shared/llm-client.ts` |
| `run-logger.ts` | `shared/run-logger.ts` |
| `invocations.ts` | `shared/invocations.ts` |
| `arena.ts` | `shared/arena.ts` |
| `types.ts` | `shared/types.ts` |
| `errors.ts` | `shared/errors.ts` |
| New file | `setup/setup-run.ts` |

### Other changes
- Disable evolve agent from V2 pipeline loop
- Remove duplicate heartbeat (consolidate into single location)
- Remove `evolutionRunClient.ts` (dead code, zero callers)
- Evaluate whether `/api/evolution/run` route is still needed

## Phased Execution Plan

### Phase 1: Disable evolve agent
- Remove the evolve phase from `evolve-article.ts` main loop
- Update tests in `evolve-article.test.ts`

### Phase 2: Consolidate runner.ts + evolutionRunnerCore.ts
- Merge `runner.ts` logic into new `singleRunLifecycle.ts`
- Extract setup into `setup/setup-run.ts` with `RunContext` interface
- Remove duplicate heartbeat, duplicate `markRunFailed`, duplicate error handling
- Delete `runner.ts` and `evolutionRunnerCore.ts`
- Update tests

### Phase 3: Reorganize into folder structure
- Create `setup/`, `pipeline/`, `finalize/`, `shared/` folders
- Move files per the rename/move table above
- Move test files alongside their source files
- Update all imports across codebase
- Update barrel exports in `index.ts`

### Phase 4: Dead code removal
- Remove `evolution/src/services/evolutionRunClient.ts` and its test
- Evaluate `/api/evolution/run` route — remove if no other callers exist
- Remove route test if route is removed

### Phase 5: Documentation updates
- Update file references in evolution docs

## Testing
- Update existing tests for renamed/merged files
- Verify pipeline-loop tests pass without evolve phase
- Run lint, tsc, build after each phase
- Run full unit test suite after phase 3 (reorganization)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/reference.md` - May need updates to reflect evolve agent removal and file renames
- `evolution/docs/evolution/data_model.md` - File path references may change
- `evolution/docs/evolution/architecture.md` - Pipeline flow description may change
- `evolution/docs/evolution/cost_optimization.md` - File references may change
- `evolution/docs/evolution/rating_and_comparison.md` - File references may change
- `evolution/docs/evolution/experimental_framework.md` - File references may change
- `evolution/docs/evolution/strategy_experiments.md` - File references may change
- `evolution/docs/evolution/agents/overview.md` - Agent interaction table may change
- `evolution/docs/evolution/agents/generation.md` - File references may change
- `evolution/docs/evolution/visualization.md` - File references may change
