# Run Evolution Not Respecting Max Iterations Progress

## Phase 1: Fix config propagation in queueEvolutionRunAction
### Work Done
- Added `maxIterations`, `generationModel`, `judgeModel`, `budgetCaps` copying from strategy config to run config JSONB in `src/lib/services/evolutionActions.ts` (after existing `enabledAgents`/`singleArticle` block, ~line 241)
- Added `budgetCaps` to `QueueStrategyConfig` type
- `iterations` → `maxIterations` mapping with `Math.max(1, Math.floor())` clamping
- `budgetCaps` shallow-cloned with null/empty/array guards
- Lint, tsc pass

## Phase 2: Fix off-by-one iteration counting in supervisor.ts
### Work Done
- Changed `shouldStop()` in `src/lib/evolution/core/supervisor.ts` line 251 from `>=` to `>`
- `maxIterations=N` now runs exactly N iterations (state.iteration goes 1..N, shouldStop fires at N+1)
- Lint, tsc pass

## Phase 3a: Config propagation tests
### Work Done
- Updated existing test "passes enabledAgents and singleArticle" to also verify `maxIterations`, `generationModel`, `judgeModel`
- Updated "omits config field" test → renamed to "copies model and iteration fields even without enabledAgents or singleArticle" since strategy fields now propagate
- Added 8 edge case tests: iterations: 0 clamping, iterations: -5 clamping, iterations: 1 boundary, budgetCaps: null, budgetCaps: {}, budgetCaps reference isolation, partial config, empty strategy
- All 33 evolutionActions tests pass

## Phase 3b: Off-by-one tests in supervisor.test.ts
### Work Done
- Updated "stops on max iterations" → split into "does not stop at maxIterations" (iteration=N, should not stop) and "stops when iteration exceeds maxIterations" (iteration=N+1, should stop)
- Added 4 boundary tests: maxIterations=1 with iteration=1 (no stop), maxIterations=1 with iteration=2 (stop), maxIterations=3 with iteration=3 (no stop)
- Used `makeState(0, N)` for maxIterations tests to avoid plateau detection interference from auto-created ratings
- All 44 supervisor tests pass

### Issues Encountered
- Initial maxIterations=1 tests used `plateauWindow: 1` with `makeState(1, N)`, which auto-creates ratings via `addToPool`. With plateau window of 1, a single shouldStop call triggers false plateau detection. Fixed by using `makeState(0, N)` (no pool entries = no ratings = no plateau noise) and `plateauWindow: 3`.

## Phase 3c: Integration test for config round-trip
### Work Done
- Added integration test in `src/__tests__/integration/evolution-actions.integration.test.ts`
- Tests full queue→read-back→resolveConfig path: creates evolution_strategy_configs row with all propagatable fields, queues run, reads back config JSONB, verifies all fields present, calls resolveConfig() to verify strategy values override defaults
- Lint, tsc pass

## Phase 4: Full verification
### Results
- Lint: all 5 changed files pass
- tsc: no errors
- Build: succeeds
- Evolution tests: 1139 tests across 68 suites, all pass

### Files Changed
1. `src/lib/services/evolutionActions.ts` — config propagation fix
2. `src/lib/evolution/core/supervisor.ts` — off-by-one fix
3. `src/lib/services/evolutionActions.test.ts` — updated + 8 new tests
4. `src/lib/evolution/core/supervisor.test.ts` — updated + 4 new boundary tests
5. `src/__tests__/integration/evolution-actions.integration.test.ts` — 1 new integration test
