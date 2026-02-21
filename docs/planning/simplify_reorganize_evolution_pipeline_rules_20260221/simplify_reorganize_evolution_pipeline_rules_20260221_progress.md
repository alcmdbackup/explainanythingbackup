# Simplify Reorganize Evolution Pipeline Rules Progress

## Phase 1: Simplify PhaseConfig and Remove Strategy Rotation (Tasks 1-4)
### Work Done
- Simplified `PhaseConfig` to `{phase, activeAgents}` — removed `generationPayload`, `calibrationPayload`
- Removed `_strategyRotationIndex` field and all rotation logic from `PoolSupervisor`
- Removed `strategyRotationIndex` from `SupervisorResumeState`
- Simplified `setPhaseFromResume()` signature (removed rotation index param)
- Updated pipeline.ts resume call
- Updated ~20 test fixtures across pipeline.test.ts, persistence.continuation.test.ts, hallOfFame.test.ts
- Removed 2 supervisor tests for deleted behavior, updated 3 resume tests
- Full evolution test suite verified: 1757/1757 pass

### Issues Encountered
- Workflow hook expected project folder at `docs/planning/feat/...` (matching full branch name) but folder was at `docs/planning/simplify_...`. Fixed with symlink.
- Prerequisites not auto-tracked (hooks ran before symlink existed). Set via bash.

## Phase 2: Remove Dead Config Fields (Tasks 5-7)
### Work Done
- Removed `expansion.minIterations` from `EvolutionRunConfig` type and `DEFAULT_EVOLUTION_CONFIG`
- Removed from `run-evolution-local.ts` config field (preserved local variable of same name)
- Removed from ~15 test fixtures across 3 test files
- Updated `reference.md`: removed `minIterations` from config table, updated supervisorResume description, updated `validateConfig` → `validateRunConfig` reference

## Phase 3: Consolidate Validation (Tasks 8-9)
### Work Done
- Removed entire `validateConfig()` method from `PoolSupervisor` (4 checks duplicated from `validateRunConfig`)
- Removed 8 supervisor validation tests (all covered by `configValidation.test.ts`)
- Supervisor tests: 53/53 pass

## Phase 4: Final Verification and Documentation (Task 10)
### Work Done
- Updated `architecture.md`: removed strategy payload/rotation references (3 locations), updated supervisor resume state descriptions (2 locations), removed "Supervisor strategy routing" from Known Implementation Gaps
- No changes needed in `agents/overview.md`
- Full project test suite: 247 suites, 4829 tests pass
- Full build: success
- tsc: clean

## Summary
- 11 commits total (6 production, 3 test, 2 docs)
- ~75 lines removed from production code
- ~60 lines removed from tests
- Zero behavioral changes
