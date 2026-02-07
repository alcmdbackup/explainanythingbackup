# Recommended Improvements Evolution Pipeline Progress

## Phase 1: Tiered Model Routing
### Work Done
- Added `judgeModel` and `generationModel` fields to `EvolutionRunConfig` (types.ts)
- Set defaults: `judgeModel: 'gpt-4.1-nano'`, `generationModel: 'gpt-4.1-mini'` (config.ts)
- Updated `resolveConfig()` to properly merge model overrides
- Passed `judgeModel` to `CalibrationRanker.comparePair()` via `LLMCompletionOptions`
- Passed `judgeModel` to `PairwiseRanker.comparePair()` via `LLMCompletionOptions`
- Added per-model pricing to `estimateTokenCost()` in llmClient.ts (nano=4x cheaper)
- Created `config.test.ts` (8 tests) — verifies resolveConfig deep merge, model overrides, partial calibration
- Created `calibrationRanker.test.ts` (6 tests) — verifies model passthrough, Elo updates, canExecute
- Added model passthrough test to `pairwiseRanker.test.ts`

### Issues Encountered
- Workflow hook required project folder matching branch name `feat/recommended_improvements_evolution_pipeline_20260131`. Created folder with legacy exemption (no _status.json).

### Files Modified
- `src/lib/evolution/types.ts` — added judgeModel, generationModel, calibration.minOpponents
- `src/lib/evolution/config.ts` — added defaults and import for AllowedLLMModelType
- `src/lib/evolution/core/llmClient.ts` — added MODEL_PRICING, model param to estimateTokenCost
- `src/lib/evolution/agents/calibrationRanker.ts` — pass judgeModel to complete()
- `src/lib/evolution/agents/pairwiseRanker.ts` — pass judgeModel to complete()

### Files Created
- `src/lib/evolution/core/config.test.ts`
- `src/lib/evolution/agents/calibrationRanker.test.ts`

---

## Phase 2: LLM Response Cache
### Work Done
- Created `ComparisonCache` class with SHA-256 order-invariant keying
- Integrated cache into `PairwiseRanker.compareWithBiasMitigation()` — cache hit returns immediately
- Integrated cache into `CalibrationRanker.compareWithBiasMitigation()` — same pattern
- Added `comparisonCache?: ComparisonCache` to `ExecutionContext` interface
- Injected cache in both `executeMinimalPipeline()` and `executeFullPipeline()`
- Exported `ComparisonCache` and `CachedMatch` from index.ts
- Partial failure results (confidence 0.0, 0.3) are NOT cached — allows retry on next encounter
- Valid results (confidence >= 0.5) are cached for cross-iteration deduplication
- Created `comparisonCache.test.ts` (9 tests) — key generation, hit/miss, symmetry, error rejection
- Added cache integration tests to `pairwiseRanker.test.ts` (2 tests) — hit verification, error-not-cached

### Issues Encountered
- None

### Files Created
- `src/lib/evolution/core/comparisonCache.ts`
- `src/lib/evolution/core/comparisonCache.test.ts`

### Files Modified
- `src/lib/evolution/types.ts` — added comparisonCache to ExecutionContext
- `src/lib/evolution/agents/pairwiseRanker.ts` — cache lookup/store in compareWithBiasMitigation
- `src/lib/evolution/agents/calibrationRanker.ts` — cache lookup/store in compareWithBiasMitigation
- `src/lib/evolution/core/pipeline.ts` — instantiate cache in both pipeline modes
- `src/lib/evolution/index.ts` — export ComparisonCache

---

## Phase 3: Adaptive Calibration Opponents
### Work Done
- Added `minOpponents` to calibration config (default: 2)
- Added early-exit logic in CalibrationRanker: tracks consecutive decisive matches (confidence >= 0.7)
- When `consecutiveDecisive >= minOpponents`, breaks out of opponent loop
- Added 3 tests: early exit after first batch, full run on mixed confidence, default config verification

### Issues Encountered
- None

### Files Modified
- `src/lib/evolution/agents/calibrationRanker.ts` — early-exit logic in opponent loop
- `src/lib/evolution/agents/calibrationRanker.test.ts` — adaptive exit tests

---

## Phase 4: Async Parallelism Within Agents
### Work Done
- **GenerationAgent**: Replaced sequential `for...of` with `Promise.allSettled()` over strategies. State mutations (addToPool) sequential after resolve.
- **EvolutionAgent (evolvePool)**: Same pattern — parallel LLM calls, sequential state mutations.
- **ReflectionAgent**: Parallel critique LLM calls, sequential parse + state update.
- **CalibrationRanker**: Batched parallelism — first batch of `minOpponents` runs in parallel, checks for early exit. If not all decisive, runs remaining batch in parallel. Elo updates sequential after each batch. Added `applyEloUpdate()` helper method.
- **Tournament**: Parallel pairs within each Swiss round via `Promise.allSettled()`. Elo updates sequential after round resolves.
- **CostTracker**: Added optimistic reservation tracking (`reservedByAgent`, `totalReserved`). `reserveBudget()` now atomically increments reserved amounts before returning, preventing concurrent callers from all passing budget checks. `recordSpend()` releases reservations.
- Added concurrent reservation test and reservation release test to costTracker.test.ts
- Updated calibrationRanker tests for batched parallelism interleaving

### Issues Encountered
- Mock LLM response interleaving under parallel execution caused different confidence values than sequential. Fixed tests to account for `Promise.allSettled` call ordering (both forward calls fire before reverse calls).

### Files Modified
- `src/lib/evolution/agents/generationAgent.ts` — Promise.allSettled for strategies
- `src/lib/evolution/agents/evolvePool.ts` — Promise.allSettled for evolution strategies
- `src/lib/evolution/agents/reflectionAgent.ts` — Promise.allSettled for critiques
- `src/lib/evolution/agents/calibrationRanker.ts` — batched parallelism + applyEloUpdate helper
- `src/lib/evolution/agents/tournament.ts` — Promise.allSettled for Swiss round pairs
- `src/lib/evolution/core/costTracker.ts` — optimistic reservation tracking
- `src/lib/evolution/core/costTracker.test.ts` — concurrent reservation tests
- `src/lib/evolution/agents/calibrationRanker.test.ts` — updated for parallel interleaving

---

## Summary

| Phase | Tests Added | Lines Changed (approx) | Status |
|-------|------------|----------------------|--------|
| 1. Tiered Model Routing | 15 | ~25 | Complete |
| 2. LLM Response Cache | 11 | ~85 | Complete |
| 3. Adaptive Calibration | 3 | ~20 | Complete |
| 4. Async Parallelism | 2 | ~130 | Complete |
| **Total** | **31** | **~260** | **All 227 tests pass** |

### Verification
- `tsc --noEmit`: Clean
- `eslint`: Clean
- `npm run build`: Clean
- `jest src/lib/evolution/`: 227/227 tests pass (17 suites, up from 196/14)
