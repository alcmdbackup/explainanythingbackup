# Develop Reflection and GenerateFromParentArticle Agent Evolution Progress

## Phase 1: Schema & Cost-Stack Foundation
### Work Done
- Added `'reflection'` to `AGENT_NAMES` and `COST_METRIC_BY_AGENT` mapping (`evolution/src/lib/core/agentNames.ts`).
- Added `'reflection_cost'`, `'total_reflection_cost'`, `'avg_reflection_cost_per_run'` to `STATIC_METRIC_NAMES` (`evolution/src/lib/metrics/types.ts`).
- Added `'reflection'` to `costCalibrationLoader.ts` phase enum.
- Added `'reflection'` branch to calibration-lookup ladder + `OUTPUT_TOKEN_ESTIMATES.reflection = 600` (tokens) in `createEvolutionLLMClient.ts`.
- Added propagation metric defs (`total_reflection_cost`, `avg_reflection_cost_per_run`) to `SHARED_PROPAGATION_DEFS` in `metrics/registry.ts`.
- Added `reflection_cost` to run-level `duringExecution` defs in `metrics/registry.ts`.
- Added `reflection_cost`, `total_reflection_cost`, `avg_reflection_cost_per_run` definitions to `metricCatalog.ts`.
- Wired into `RunEntity`, `StrategyEntity`, `ExperimentEntity`.
- Added `reflection: number` field to `EstPerAgentValue` interface in `projectDispatchPlan.ts`. Updated 3 call sites that construct `EstPerAgentValue` literals to default `reflection: 0`.
- Extended `iterationConfigSchema` with `useReflection` and `reflectionTopN` plus 3 new Zod refinements (mutex w/ generationGuidance, useReflection only on generate, reflectionTopN only when reflection enabled).
- Added new `reflectAndGenerateFromPreviousArticleExecutionDetailSchema` and registered in discriminated `agentExecutionDetailSchema` union.
- Updated `hashStrategyConfig` to canonicalize falsy optionals (`useReflection: false === undefined === absent`) so existing strategies don't re-hash.
- Added 5 new tests in `findOrCreateStrategy.test.ts`: useReflection-changes-hash, reflectionTopN-changes-hash, hash collision symmetry (3-way), and legacy snapshot regression.
- Updated `entities.test.ts` count assertions for reflection_cost addition (RunEntity 4→5 duringExecution, StrategyEntity 31→33 atPropagation).

### Test Results
- All 1423 evolution lib tests pass (2 skipped).
- TypeScript: clean (`tsc --noEmit`).
- Lint: clean (only pre-existing warnings unrelated to changes).

### Issues Encountered
- Initial run-level metric registry was missing `reflection_cost` even though propagation defs reference it; the registry-validation guard caught this at module load. Fixed by adding it to the duringExecution array.
- Entity-class registry parity test required matching additions in `RunEntity`, `StrategyEntity`, `ExperimentEntity` plus `metricCatalog.ts`. Resolved.
- `entities.test.ts` had hardcoded count assertions (4, 31) that need bumping to 5 and 33.

### User Clarifications
None this phase.

## Phase 2: Framework Logger Fix
### Work Done
[in progress]

### Issues Encountered
[in progress]

### User Clarifications
[in progress]
