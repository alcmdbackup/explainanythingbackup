# Rename Tables Based on Evolution V2 Entities Progress

## Phase 1: Research & Planning
### Work Done
- Analyzed all evolution tables against V2 entity names
- Identified 2 table renames, 1 table drop, and FK column renames needed
- Confirmed evolution_arena_elo is stale (merged into entries in V2 migration)
- Confirmed evolution_arena_elo still exists in stage Supabase

### Issues Encountered
- Docs (architecture.md, arena.md, reference.md) still reference evolution_arena_elo as a separate table — stale

### User Clarifications
- User confirmed evolution_arena_elo exists in stage and wants it dropped
- User wants all evolution tables to map cleanly to entities

## Phase 2: [Research]
...
