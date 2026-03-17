# Remove Ordinals Replace With Mu Evolution Progress

## Phase 1: Core rating module cleanup
### Work Done
- Updated `toEloScale` formula: `1200 + (mu - 25) * 16` — fresh mu=25 → Elo 1200
- Removed deprecated `ordinalToEloScale` alias from `rating.ts`
- Removed `ordinalToEloScale` from `index.ts` exports
- Removed `ordinal()` function from openskill mock
- Updated `rating.test.ts`: removed alias test, updated expected values

## Phase 2: Arena actions cleanup
### Work Done
- Removed `ordinal` and `elo_rating` fields from `ArenaEloEntry` interface
- Updated CI bound comments from `ordinalToEloScale` to `toEloScale`
- Replaced ordinal computation with `ordinal: 0` dummy in `buildInitialEloRow` and comparison upsert
- Removed ordinal from leaderboard SELECT and response mapping

## Phase 3: Arena integration cleanup
### Work Done
- Removed ordinal from SELECT clause in `loadArenaEntries`
- Replaced ordinal computation with `ordinal: 0` dummy in `syncToArena`

## Phase 4: Scripts cleanup
### Work Done
- Removed ordinal from `.select()` queries in all 3 comparison scripts
- Replaced ordinal field with `ordinal: 0` dummy in all 4 scripts' DB upserts
- Cleaned up ordinal comment in `backfill-experiment-metrics.ts`

## Phase 5: Legacy/backward-compat cleanup
### Work Done
- Fixed V2 ordinal fallback in `extractTopElo`: uses OLD formula inline `1200 + ordinal * 16`
- Removed `getOrdinal` and `ordinalToEloScale` mocks from `persistence.continuation.test.ts`

## Phase 6: Database migration
### Work Done
- Created `supabase/migrations/20260312000001_remove_ordinal_recalibrate_elo.sql`
- Shifts all elo_score/elo_rating/avg_elo/elo_gain down by 400
- Recalculates elo_per_dollar
- Drops ordinal column and ordinal-based indexes
- Creates mu-based indexes
- Rewrites `sync_to_arena` RPC without ordinal

## Phase 7: Update test fixtures
### Work Done
- Updated 22 test files total:
  - Removed ordinal from all fixtures/assertions
  - Updated Elo expected values: 1600→1200 for fresh variants
  - Updated elo_gain: 400→0 for fresh variants
  - Added V2 ordinal fallback test in experimentActions.test.ts
- All 299 test suites pass (5452 tests)

## Phase 8: Documentation updates
### Work Done
- Updated 6 evolution docs: rating_and_comparison, arena, visualization, data_model, reference, experimental_framework
- Updated 1 source file comment: experimentMetrics.ts
- All references now use `toEloScale`, `mu`, and fresh=1200
