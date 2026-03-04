# Evolution Rank Everything in Hall of Fame Progress

## All 11 Iterations Complete

### Iteration 1: DB Migration
- Created `supabase/migrations/20260303000001_arena_rename_and_schema.sql`
- Renames 4 tables, 5 indexes, 4 FK constraints
- Drops 2 incompatible indexes (run_rank, topic_rank)
- Adds `'evolution'` to generation_method CHECK
- Drops rank bounds CHECK
- Creates `sync_to_arena` atomic RPC

### Iteration 2: File Renames (16 files)
- git mv'd 10 hallOfFame/hall-of-fame files to arena naming
- Renamed UI directory `hall-of-fame/` → `arena/`
- Deleted bankUtils.ts/bankUtils.test.ts (merged into arenaUtils)
- Updated add-to-bank.ts imports

### Iteration 3: Content Renames (~50 files)
- Replaced HallOfFame, hallOfFame, hall_of_fame, hall-of-fame, Hall of Fame, HoF patterns
- Updated hofEntries → arenaEntries, hofResult → arenaResult
- Fixed string literal corruption from sed
- tsc + lint pass clean

### Iteration 4: UI Changes
- Removed AddToArenaDialog from run/[runId]/page.tsx (lines 40-167)
- Removed baseline 1200 ReferenceLine from EloTab
- Added `evolution` to METHOD_COLORS in both Arena pages
- Fixed `isEvolution` check to include `'evolution'` method
- Added `'evolution'` + `'evolution_ranked'` to arenaGenerationMethodSchema

### Iteration 5: Types
- Added `fromArena?: boolean` to TextVariation
- Added `arenaTopicId?: string` to ExecutionContext
- Updated ArenaInsertParams generation_method union type

### Iteration 6: loadArenaEntries()
- New function in arenaIntegration.ts loads Arena entries into state.pool
- Pre-seeds ratings and matchCounts from stored elo
- Calls state.rebuildIdMap() + invalidateCache()
- Called from both executeMinimalPipeline and executeFullPipeline (skip on resume)

### Iteration 7: CalibrationRanker Low-Sigma Skip
- Added CALIBRATED_SIGMA_THRESHOLD = 5.0
- Filters out entries with sigma < threshold from calibration targets
- Still used as opponents via getCalibrationOpponents

### Iteration 8: Arena Entry Filtering in Persistence
- persistVariants: filters `!v.fromArena`
- computeAndPersistAttribution: filters `!v.fromArena`
- persistAgentMetrics: filters `!v.fromArena`
- buildRunSummary: filters topVariants, allByRating, strategyEffectiveness
- runFlowCritiques: filters `!v.fromArena`
- total_variants: uses `pool.filter(v => !v.fromArena).length`

### Iteration 9: syncToArena + Finalization
- Replaced feedArena with syncToArena using sync_to_arena RPC
- Removed upsertEloRatings and triggerAutoReRank helpers
- Updated pipeline.ts import and finalization call

### Iteration 10: Test Updates
- Rewrote arenaIntegration.test.ts feedArena tests → syncToArena (15/15 pass)
- Rewrote arena.test.ts feedArena tests → syncToArena, removed auto-rerank tests
- Updated schemas.test.ts with evolution + evolution_ranked validation
- All 282 test suites, 5340 tests pass

### Iteration 11: Documentation
- Renamed hall_of_fame.md → arena.md with unified pool model docs
- Updated README.md: replaced "Two Rating Systems" with "Unified Arena Rating"
- Updated reference.md, rating_and_comparison.md, architecture.md table names

## Verification
- `npx tsc --noEmit` — PASS
- `npm run lint` — PASS (only pre-existing warnings)
- `npm run build` — PASS
- `npm test` — 282 suites, 5340 tests pass
