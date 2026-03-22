# Minor Evolution V2 Changes Plan

## Background
The evolution V2 pipeline's evolve phase adds variants to the pool that never get properly triaged/ranked (they skip the `newEntrantIds` tracking), and the file naming in the V2 pipeline could be clearer. This project disables the evolve agent from the V2 pipeline and explores renaming key files to improve codebase readability.

## Requirements (from GH Issue #NNN)
1. Disable the evolve agent from the V2 pipeline (`pipeline/evolve-article.ts`)
2. Rename and reorganize pipeline files for clarity
3. Remove duplicate heartbeat between `evolutionRunnerCore.ts` and `pipeline/runner.ts`
4. Remove dead code (note: `evolutionRunClient.ts` already deleted by PR #740)

## Problem
The V2 pipeline has several clarity and correctness issues: (1) the evolve phase adds variants that never get triaged since they miss `newEntrantIds` tracking, (2) file names like `evolve-article.ts`, `runner.ts`, and `evolve.ts` don't reflect what they actually do, (3) there's a duplicate heartbeat in both the orchestrator and executor, and (4) the flat `pipeline/` directory has 18 files with no organizational structure.

## Agreed Decisions

### Folder structure after refactor
```
evolution/src/lib/pipeline/
  ├── claimAndExecuteRun.ts            — thin orchestrator: claim→setup→loop→finalize→cleanup (~120 lines)
  │
  ├── setup/
  │   ├── buildRunContext.ts            — build RunContext (infra + config + content + arena load) (~130 lines)
  │   ├── findOrCreateStrategy.ts       — hash-based find-or-create for strategy configs
  │   └── generateSeedArticle.ts        — generate initial article from prompt
  │
  ├── loop/
  │   ├── runIterationLoop.ts           — generate → rank iteration loop (~290 lines)
  │   ├── generateVariants.ts           — create new text variants via 3 strategies
  │   ├── rankVariants.ts               — triage + Swiss fine-ranking
  │   ├── extractFeedback.ts            — extract improvement feedback from rankings
  │   └── buildPrompts.ts              — shared prompt templates
  │
  ├── finalize/
  │   └── persistRunResults.ts          — persist results to DB + sync to arena (~244 lines)
  │
  ├── infra/
  │   ├── trackBudget.ts                — reserve-before-spend budget enforcement
  │   ├── createLLMClient.ts            — LLM call wrapper with cost tracking
  │   ├── createRunLogger.ts            — structured logging to DB
  │   ├── trackInvocations.ts           — create/update agent invocation records
  │   ├── types.ts                      — all V2 type definitions
  │   └── errors.ts                     — V2 error classes
  │
  ├── manageExperiments.ts              — experiment management (outside pipeline flow)
  └── index.ts                          — barrel exports
```

### File renames / moves (from current `pipeline/` flat structure)
| Before (current) | After |
|---|---|
| `services/evolutionRunnerCore.ts` | `pipeline/claimAndExecuteRun.ts` |
| `pipeline/runner.ts` | merged into `claimAndExecuteRun.ts` + `setup/buildRunContext.ts` |
| `pipeline/evolve-article.ts` | `pipeline/loop/runIterationLoop.ts` |
| `pipeline/generate.ts` | `pipeline/loop/generateVariants.ts` |
| `pipeline/rank.ts` | `pipeline/loop/rankVariants.ts` |
| `pipeline/evolve.ts` | `pipeline/loop/extractFeedback.ts` |
| `pipeline/prompts.ts` | `pipeline/loop/buildPrompts.ts` |
| `pipeline/finalize.ts` | `pipeline/finalize/persistRunResults.ts` |
| `pipeline/strategy.ts` | `pipeline/setup/findOrCreateStrategy.ts` |
| `pipeline/seed-article.ts` | `pipeline/setup/generateSeedArticle.ts` |
| `pipeline/cost-tracker.ts` | `pipeline/infra/trackBudget.ts` |
| `pipeline/llm-client.ts` | `pipeline/infra/createLLMClient.ts` |
| `pipeline/run-logger.ts` | `pipeline/infra/createRunLogger.ts` |
| `pipeline/invocations.ts` | `pipeline/infra/trackInvocations.ts` |
| `pipeline/arena.ts` | split: `loadArenaEntries()` → `setup/buildRunContext.ts`, `syncToArena()` → `finalize/persistRunResults.ts` |
| `pipeline/types.ts` | `pipeline/infra/types.ts` |
| `pipeline/errors.ts` | `pipeline/infra/errors.ts` |
| `pipeline/experiments.ts` | `pipeline/manageExperiments.ts` |
| New file | `pipeline/setup/buildRunContext.ts` |

### Callers to update
- `pipeline/index.ts` — barrel re-exports (defer all barrel updates to Phase 5 to avoid double-updating)
- `services/experimentActionsV2.ts` — deep imports from `@evolution/lib/pipeline/experiments` and `pipeline/types`
- `services/strategyRegistryActionsV2.ts` — deep imports from `@evolution/lib/pipeline/strategy` and `pipeline/types`
- `evolution/scripts/lib/oneshotGenerator.ts` — imports `generateTitle` from `shared/seedArticle`

### Other changes
- Disable evolve agent from V2 pipeline loop
- Remove duplicate heartbeat (consolidate into single location)
- Reconcile `markRunFailed` differences: runner.ts sets `completed_at` but not `runner_id:null`; evolutionRunnerCore.ts sets `runner_id:null` but not `completed_at`. Consolidated version must set BOTH.
- Remove `/api/evolution/run` route + test (orphaned — no UI calls it, client wrapper already deleted)
- Consolidate `evolution/scripts/evolution-runner.ts` (284 lines) + `evolution-runner-v2.ts` (109 lines) → `evolution/scripts/processRunQueue.ts`
  - Use v2's cleaner approach: `createSupabaseServiceClient()`, `initLLMSemaphore()`
  - Keep v1's features: `--dry-run`, `--max-runs`, `--parallel`, `--max-concurrent-llm` flags
  - Update systemd deploy config (`evolution-runner.service`) to point to `processRunQueue.ts`
- Consolidate 4 rating/comparison files → `lib/shared/computeRatings.ts` (~345 lines)
  - Merge: `lib/shared/rating.ts` + `lib/shared/comparisonCache.ts` + `lib/shared/reversalComparison.ts` + **`lib/comparison.ts`** (at lib root)
  - Rating math + comparison + cache + 2-pass reversal in one file
  - Update all importers of `lib/comparison.ts`: `pipeline/rank.ts`, `pipeline/evolve-article.ts`, `pipeline/index.ts`, `lib/index.ts`
- Consolidate 3 format files → `lib/shared/enforceVariantFormat.ts` (~200 lines)
  - Merge: `lib/shared/formatValidator.ts` + `lib/shared/formatRules.ts` + `lib/shared/formatValidationRules.ts`
- Merge `lib/shared/textVariationFactory.ts` (27 lines) into existing `lib/types.ts` (where `TextVariation` interface lives)
  - Note: `lib/shared/` does NOT have its own `types.ts` — the core types live at `lib/types.ts`
- Rename `lib/shared/errorClassification.ts` → `lib/shared/classifyErrors.ts`
- Rename `lib/shared/strategyConfig.ts` → `lib/shared/hashStrategyConfig.ts`
- Delete `lib/shared/validation.ts` + test (dead V1 code, zero production callers)
- Delete `lib/shared/seedArticle.ts` + test (V1 duplicate)
  - Migrate `generateTitle()` to V2's `pipeline/setup/generateSeedArticle.ts` (V2 version lacks this export)
  - Update `oneshotGenerator.ts` to import from V2 path

Final `lib/shared/` structure (4 files, down from 11 + 1 at lib root):
```
lib/shared/
├── computeRatings.ts          — rating math + comparison + cache + reversal (~345 lines)
├── enforceVariantFormat.ts    — format rules + validation (~200 lines)
├── classifyErrors.ts          — transient vs fatal error detection
└── hashStrategyConfig.ts      — strategy hashing/labeling

lib/types.ts                   — core types + createTextVariation factory (unchanged location)
```

## Phased Execution Plan

### Phase 1: Disable evolve agent
- Remove the evolve phase from `pipeline/evolve-article.ts` main loop (lines 221-232)
- Update tests in `pipeline/evolve-article.test.ts`

### Phase 2: Consolidate runner.ts + evolutionRunnerCore.ts
- Merge `pipeline/runner.ts` logic into new `pipeline/claimAndExecuteRun.ts`
- Extract setup into `pipeline/setup/buildRunContext.ts` with `RunContext` interface
- Remove duplicate heartbeat, reconcile `markRunFailed` (must set BOTH `completed_at` AND `runner_id:null`)
- Delete `pipeline/runner.ts` and `pipeline/runner.test.ts` (logic migrated to claimAndExecuteRun + buildRunContext)
- Delete `services/evolutionRunnerCore.ts` and `services/evolutionRunnerCore.test.ts`
- Delete `src/app/api/evolution/run/route.ts` and `route.test.ts` (orphaned endpoint, no UI callers)
- Note: `claimAndExecuteRun.ts` crosses services/lib boundary — will need both `@/lib` and `@evolution/*` import styles
- Update/create tests: `pipeline/claimAndExecuteRun.test.ts`, `pipeline/setup/buildRunContext.test.ts`

### Phase 3: Consolidate batch runner scripts
- Merge `evolution/scripts/evolution-runner.ts` + `evolution-runner-v2.ts` → `evolution/scripts/processRunQueue.ts`
- Use v2's cleaner infra (`createSupabaseServiceClient`, `initLLMSemaphore`)
- Keep v1's CLI flags (`--dry-run`, `--max-runs`, `--parallel`, `--max-concurrent-llm`)
- Update `evolution/deploy/evolution-runner.service` to point to `processRunQueue.ts`
- Delete `evolution-runner.ts`, `evolution-runner-v2.ts`
- Rename/rewrite `evolution-runner.test.ts` → `processRunQueue.test.ts`

### Phase 4: Clean up lib/shared/ (11 + 1 at root → 4 files)
- Merge 4 rating/comparison files → `lib/shared/computeRatings.ts`
  - Includes `lib/comparison.ts` at lib root (imported by rank.ts, evolve-article.ts, index.ts)
- Merge 3 format files → `lib/shared/enforceVariantFormat.ts`
- Merge `lib/shared/textVariationFactory.ts` (27 lines) into `lib/types.ts` (where TextVariation lives)
- Rename `errorClassification.ts` → `classifyErrors.ts`
- Rename `strategyConfig.ts` → `hashStrategyConfig.ts`
- Delete `lib/shared/validation.ts` + `validation.test.ts` (dead V1 code)
- Delete `lib/shared/seedArticle.ts` + `seedArticle.test.ts`
  - Migrate `generateTitle()` to V2's `pipeline/seed-article.ts`
  - Update `oneshotGenerator.ts` to import from V2 path
- Consolidate test files:
  - `rating.test.ts` + `comparisonCache.test.ts` + `reversalComparison.test.ts` + `lib/comparison.test.ts` → `computeRatings.test.ts`
  - `formatValidator.test.ts` + `formatValidationRules.test.ts` → `enforceVariantFormat.test.ts`
  - `textVariationFactory.test.ts` → merge tests into `lib/types.test.ts` or delete if trivial
  - Rename `errorClassification.test.ts` → `classifyErrors.test.ts`
  - Rename `strategyConfig.test.ts` → `hashStrategyConfig.test.ts`
- Update all imports

### Phase 5: Reorganize pipeline/ into folder structure + rename files
- Create `setup/`, `loop/`, `finalize/`, `infra/` folders under `pipeline/`
- Move and rename files per the table above
- Colocate test files next to their source files:
  - `evolve-article.test.ts` → `loop/runIterationLoop.test.ts`
  - `generate.test.ts` → `loop/generateVariants.test.ts`
  - `rank.test.ts` → `loop/rankVariants.test.ts`
  - `evolve.test.ts` → `loop/extractFeedback.test.ts`
  - `compose.test.ts` → `loop/compose.test.ts` (update imports from ./generate, ./rank)
  - `finalize.test.ts` → `finalize/persistRunResults.test.ts`
  - `arena.test.ts` → split: loadArenaEntries tests → `setup/buildRunContext.test.ts`, syncToArena tests → `finalize/persistRunResults.test.ts`
  - `cost-tracker.test.ts` → `infra/trackBudget.test.ts`
  - `llm-client.test.ts` → `infra/createLLMClient.test.ts`
  - `run-logger.test.ts` → `infra/createRunLogger.test.ts`
  - `invocations.test.ts` → `infra/trackInvocations.test.ts`
  - `types.test.ts` → `infra/types.test.ts`
  - `seed-article.test.ts` → `setup/generateSeedArticle.test.ts`
  - `strategy.test.ts` → `setup/findOrCreateStrategy.test.ts`
  - `experiments.test.ts` → `manageExperiments.test.ts`
  - `executePhase.test.ts` → `loop/executePhase.test.ts` (update imports)
  - `index.test.ts` → update all named export assertions to match new names
- Update all imports across codebase (including deep imports from services/)
- Update barrel exports in `pipeline/index.ts`

### Phase 6: Documentation updates
- Update file references in evolution docs

## Rollback
- Each phase is committed separately — `git revert` any phase if CI breaks
- Phases are ordered so earlier phases don't depend on later ones

## Testing
- Test files colocated next to their source files (e.g., `loop/generateVariants.test.ts`)
- Full test file inventory: 18 pipeline tests + 10 shared tests + 1 lib root (comparison) + 3 deleted in phases 2-3 (runner, evolutionRunnerCore, route) = 32 test files affected
- Update existing tests for renamed/merged files
- Verify `runIterationLoop` tests pass without evolve phase
- Run lint, tsc, build after EVERY phase
- Run full unit test suite after phases 2, 4, and 5 (major structural changes)

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
