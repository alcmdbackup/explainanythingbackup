# Consolidate Arena Entries Variant Tables Evolution Progress

## Phase 1: Migration SQL
### Work Done
- Created `supabase/migrations/20260321000002_consolidate_arena_into_variants.sql`
- Drops sync_to_arena RPC, indexes on arena_entries
- Adds arena columns to evolution_variants (mu, sigma, prompt_id, synced_to_arena, arena_match_count, generation_method, model, cost_usd, archived_at, evolution_explanation_id)
- Drops elo_attribution column
- Migrates data from arena_entries to variants (empty on staging)
- Retargets evolution_arena_comparisons FKs
- Drops evolution_arena_entries table
- Creates new indexes for arena queries
- Recreates sync_to_arena RPC with INSERT ON CONFLICT
- Verifies/enforces RLS policies

## Phase 2: Pipeline Code Updates
### Work Done
- **finalize.ts**: Added DEFAULT_SIGMA import, added prompt_id to RunContext interface, added mu/sigma/prompt_id to variant rows
- **arena.ts**: loadArenaEntries now queries evolution_variants with synced_to_arena=true filter, field renames (variant_content, arena_match_count, elo_score)
- **runner.ts**: Passes prompt_id from claimedRun to finalizeRun

## Phase 3: Service Updates
### Work Done
- **arenaActions.ts**: Updated ArenaEntry interface (removed variant_id, added synced_to_arena, renamed fields), all queries now target evolution_variants with synced_to_arena filter

## Phase 4: UI Updates
### Work Done
- **arena/[topicId]/page.tsx**: Field renames, link now points to /variants/
- **arena/entries/[entryId]/page.tsx**: Replaced with redirect to /variants/
- **arenaBudgetFilter.ts**: No changes needed (type propagation from interface)

## Phase 5: Scripts
### Work Done
- Grepped evolution/scripts/ — no references to evolution_arena_entries found

## Phase 6: Tests
### Work Done
- Updated 7 test files with field rename mapping
- Added mu/sigma/prompt_id assertions to finalize.test.ts
- All 60 affected tests passing, 4198/4216 total tests passing (1 pre-existing failure in types.test.ts)

## Phase 7: Lint, tsc, build, tests
### Work Done
- `npx tsc --noEmit` — clean (only pre-existing expect-type issue)
- `npm run lint` — no errors (pre-existing warnings only)
- `npm run build` — clean
- `npm run test` — 250/251 suites pass (1 pre-existing failure)
- Zero references to `evolution_arena_entries` or `elo_rating` in TypeScript code

## Phase 8: Documentation
### Work Done
- Updating 10 docs (in progress via parallel agents)
