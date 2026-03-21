# Consolidate Arena Entries Variant Tables Evolution Plan

## Background
Consolidate evolution_arena_entries into evolution_variants to eliminate content duplication and simplify the data model. Currently all variants are synced 1:1 to the arena, making the separate table redundant. The merged table will add arena-specific columns (prompt_id, mu, sigma, archived_at, generation_method) to evolution_variants and retarget evolution_arena_comparisons FK. This eliminates ~100% content duplication and removes the orphaned variant_id column on arena entries.

## Requirements (from GH Issue #NNN)
1. Migration: Add arena columns to evolution_variants (prompt_id, mu, sigma, archived_at, generation_method, model, cost_usd), migrate data from evolution_arena_entries, retarget evolution_arena_comparisons FK, drop evolution_arena_entries
2. Update sync_to_arena RPC to upsert into evolution_variants instead
3. Update all TypeScript code referencing evolution_arena_entries (arenaActions, pipeline/arena, finalize, test helpers)
4. Update UI pages (arena leaderboard, arena entries, arena detail)
5. Update variant detail/list pages to show arena-specific data
6. Remove orphaned variant_id column handling
7. Update all tests and documentation
8. Explore removing `elo_score` column from evolution_variants (no more in-run Elo — only OpenSkill mu/sigma used)
9. Explore removing `is_winner` column (winner info is in run_summary JSONB — column may be redundant)

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Update variant/arena entity descriptions, remove arena_entries table refs
- `evolution/docs/evolution/arena.md` - Update schema section, arena sync description
- `evolution/docs/evolution/entity_diagram.md` - Update ER diagram to remove arena_entries entity
- `evolution/docs/evolution/reference.md` - Update DB schema table listing
- `evolution/docs/evolution/architecture.md` - Update data flow section
- `evolution/docs/evolution/README.md` - Update if arena_entries referenced
- `evolution/docs/evolution/visualization.md` - Update arena page descriptions
- `evolution/docs/evolution/rating_and_comparison.md` - Update rating persistence descriptions
- `evolution/docs/evolution/experimental_framework.md` - Update if arena_entries referenced
- `docs/docs_overall/architecture.md` - Update Arena Tables section
