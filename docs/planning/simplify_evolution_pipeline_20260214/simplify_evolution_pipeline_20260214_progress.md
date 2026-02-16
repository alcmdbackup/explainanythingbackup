# Simplify Evolution Pipeline Progress

## Phase 1: Dead Code & Shared Utilities — COMPLETE
### Work Done
- **Task 1.0**: Audited shared test helpers, migrated 6 test files to use shared module
- **Task 1.1**: Removed dead `useEmbeddings` parameter from types.ts and config.ts
- **Task 1.2**: Removed never-toggled `dryRunOnly` and `promptBasedEvolutionEnabled` flags + DB rows
- **Task 1.3**: Extracted TextVariation factory from 6 agents into `core/textVariationFactory.ts`
- **Task 1.4**: Extracted shared format validation rules into `core/formatValidationRules.ts`
- **Task 1.5**: Extracted shared 2-pass reversal pattern into `core/reversalComparison.ts`

### Issues Encountered
- None significant. All tasks completed cleanly.

## Phase 2: Module Extraction & Feature Flag Collapse — COMPLETE
### Work Done
- **Task 2.1**: Extracted Hall of Fame integration (~200 LOC) from pipeline.ts → `core/hallOfFameIntegration.ts`
- **Task 2.2**: Extracted metrics persistence (~170 LOC) from pipeline.ts → `core/metricsWriter.ts`
- **Task 2.3**: Extracted persistence & utilities (~170 LOC) → `core/persistence.ts` + `core/pipelineUtilities.ts`
- **Task 2.4**: Collapsed DB feature flags to 3 env vars. 5 core flags hardcoded as always-on. Migration deletes DB rows.
- **Task 2.5**: Moved `qualityThresholdMet()` into supervisor's `shouldStop()` — all 5 stopping conditions unified
- **Task 2.6**: Extracted CritiqueBatch utility from 3 duplicate critique implementations
- **Task 2.7**: Moved `experiment/` from `evolution/` to `lib/experiments/` (not pipeline code)
- **Task 2.8**: Simplified strategy config hash (removed agentModels, budgetCaps from fingerprint)
- **Task 2.9**: Consolidated seed article title generation into shared `generateTitle()` helper
- **Task 2.10**: Simplified `buildRunConfig()` in evolutionActions (52 → 38 LOC)
- **Task 2.12**: SKIPPED — all 4 candidate types had >2 consumers or would create circular deps
- **Task 2.13**: Extracted `DimensionScoresDisplay` shared UI component; `useExpandedId` skipped (not duplicated)
- **Task 2.14**: Added 9 coverage gap tests: model fallback chain, degenerate stop, two-tier gating

### Verification (Task 2.15)
- `tsc --noEmit`: Clean
- `jest src/lib/evolution/`: **1,083 tests pass** (58 suites)
- `jest src/lib/experiments/ src/__tests__/integration/`: **36 tests pass**
- `next lint`: Only pre-existing warnings
- `next build`: Successful

### Key Metrics
| Metric | Before | After Phase 2 |
|--------|--------|--------------|
| pipeline.ts LOC | 1,363 | 751 (45% reduction) |
| types.ts LOC | 679 | 678 |
| Feature flags (DB) | 10 | 0 (3 env vars) |
| Agent gating tiers | 3 | 2 |
| Total tests | ~995 | 1,119 |

### Issues Encountered
- Retry tests (pipeline.test.ts) broke after feature flag collapse — tests overrode `calibration` agent but COMPETITION phase uses `tournament`. Fixed by updating overrides.
- CritiqueBatch extraction changed warning behavior for flow critique parse failures — test assertion updated.
- `oneshotGenerator.ts` needed non-null assertion after seed article refactor (TS2454 for closure-assigned variable).

### Tasks Deferred
- **Task 2.11** (Drop V1 legacy compat): Requires production DB query to verify no V1-format checkpoints remain
- **Task 2.12** (Type colocation): All 4 types have >2 file consumers or would create circular dependencies

## Phase 3: Structural Simplification — DEFERRED
Blocked on production data queries (see plan for 6 required SQL queries).
Will be addressed in a follow-up PR after verifying production data.

## Final Verification
- `tsc --noEmit`: Clean
- `next lint`: Only pre-existing design-system warnings
- `next build`: Successful
- `jest src/lib/evolution/`: **1,083 tests pass** (58 suites)
- `jest src/lib/experiments/ src/__tests__/integration/`: **36 tests pass**
- Code review: 1 issue found and fixed (reflectionAgent null check consistency)
- Rebased on origin/main: 2 conflict sets resolved cleanly
