# Consolidate Arena Entries Variant Tables Evolution Research

## Problem Statement
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

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/experimental_framework.md
- docs/docs_overall/architecture.md

## Code Files Read
- [list of code files reviewed]
