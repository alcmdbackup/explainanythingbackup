# Minor Evolution V2 Changes Progress

## Phase 1: Disable evolve agent ✅
### Work Done
- Removed evolve phase from `evolve-article.ts` iteration loop (lines 221-232)
- Removed `evolveVariants` import
- Updated test comments referencing 3-phase pipeline
- All 21 evolve-article tests pass

## Phase 2: Consolidate runner.ts + evolutionRunnerCore.ts ✅
### Work Done
- Created `pipeline/claimAndExecuteRun.ts` merging both runners
- Extracted setup into `pipeline/setup/buildRunContext.ts` with `RunContext` interface
- Reconciled `markRunFailed`: sets both `completed_at` AND `runner_id:null`, with `.slice(0, 2000)` and try/catch
- Removed duplicate heartbeat (kept single instance in claimAndExecuteRun)
- Deleted: `pipeline/runner.ts`, `services/evolutionRunnerCore.ts`, `src/app/api/evolution/run/route.ts` + tests
- Created tests: `claimAndExecuteRun.test.ts` (10 tests), `buildRunContext.test.ts` (6 tests)
- Added bridge `executeV2Run` export for Phase 3 scripts

## Phase 3: Consolidate batch runner scripts ✅
### Work Done
- Created `scripts/processRunQueue.ts` merging v1 + v2 runners
- Uses v2 infra (`createSupabaseServiceClient`, `initLLMSemaphore`)
- Keeps v1 CLI flags (`--dry-run`, `--max-runs`, `--parallel`, `--max-concurrent-llm`)
- Updated `evolution-runner.service` systemd config
- Deleted: `evolution-runner.ts`, `evolution-runner-v2.ts`, old test
- Created `processRunQueue.test.ts` (9 tests)

## Phase 4: Clean up lib/shared/ (11 + 1 → 4 files) ✅
### Work Done
- Merged rating + comparisonCache + reversalComparison + lib/comparison → `shared/computeRatings.ts`
- Merged formatValidator + formatRules + formatValidationRules → `shared/enforceVariantFormat.ts`
- Merged `textVariationFactory.ts` into `lib/types.ts`
- Renamed `errorClassification.ts` → `classifyErrors.ts`
- Renamed `strategyConfig.ts` → `hashStrategyConfig.ts`
- Deleted dead V1: `validation.ts`, `seedArticle.ts` + tests
- Migrated `generateTitle()` to V2's `pipeline/seed-article.ts`
- Updated `oneshotGenerator.ts` import
- Updated all 14 source + 8 test file imports
- Updated both barrel files (`lib/index.ts`, `pipeline/index.ts`)

## Phase 5: Reorganize pipeline/ into folders + rename ✅
### Work Done
- Created `setup/`, `loop/`, `finalize/`, `infra/` folders
- Moved and renamed 15 pipeline files per rename table
- Split `arena.ts`: `loadArenaEntries`→`setup/buildRunContext.ts`, `syncToArena`→`finalize/persistRunResults.ts`
- Colocated all 18 test files next to source files
- Updated all imports including deep imports from services/
- Updated barrel `pipeline/index.ts`
- Fixed test mocks in `strategyRegistryActionsV2.test.ts`, `experimentActionsV2.test.ts`, `backfill-strategy-config-id.test.ts`

## Phase 6: Documentation updates ✅
### Work Done
- Updated file references across 8 evolution docs
- Removed evolve phase from architecture diagrams and descriptions
- Updated all file path references to new structure

## Verification
- `npm run lint` ✅ after every phase
- `npx tsc --noEmit` ✅ after every phase
- `npm run build` ✅ after every phase
- Full evolution test suite: 80 suites, 901 tests passing
- Full src/ test suite: 162 suites, 3216 tests passing
