# Rename Tables Based on Evolution V2 Entities Research

## Problem Statement
Evolution V2 introduced clean entity names (Prompt, Strategy, Run, Variant, etc.) but several database tables still carry V1-era names that don't match. The biggest offender is `evolution_arena_topics` which is universally called "Prompt" in V2 code, and `evolution_strategy_configs` which maps to the "Strategy" entity. Additionally, the `evolution_arena_elo` table still exists in stage despite being merged into `evolution_arena_entries` during the V2 clean-slate migration.

## Requirements
1. Rename `evolution_arena_topics` → `evolution_prompts` (entity: Prompt)
2. Rename `evolution_strategy_configs` → `evolution_strategies` (entity: Strategy)
3. Drop `evolution_arena_elo` table (stale — data merged into `evolution_arena_entries` in V2)
4. Rename FK columns where they reference old table names (e.g., `strategy_config_id` → `strategy_id`)
5. Update all code references (services, actions, types, components, tests)
6. Update all documentation (evolution docs, feature deep dives, architecture)

## High Level Summary

### Current Table → Entity Mapping

| V2 Entity | Current Table | Status |
|-----------|--------------|--------|
| Prompt | `evolution_arena_topics` | **Rename → `evolution_prompts`** |
| Strategy | `evolution_strategy_configs` | **Rename → `evolution_strategies`** |
| Arena Elo | `evolution_arena_elo` | **Drop** (merged into entries in V2) |
| Experiment | `evolution_experiments` | Clean |
| Run | `evolution_runs` | Clean |
| Variant | `evolution_variants` | Clean |
| Evolution Explanation | `evolution_explanations` | Clean |
| Agent Invocation | `evolution_agent_invocations` | Clean |
| Run Log | `evolution_run_logs` | Clean |
| Budget Event | `evolution_budget_events` | Clean |
| Arena Entry | `evolution_arena_entries` | Clean |
| Arena Comparison | `evolution_arena_comparisons` | Clean |
| Arena Batch Run | `evolution_arena_batch_runs` | Clean |

### `evolution_arena_elo` — Why It Should Be Dropped

The V2 clean-slate migration (`20260315000001_evolution_v2.sql`) merged Elo data (`mu`, `sigma`, `elo_rating`, `match_count`) directly into `evolution_arena_entries`. The separate `evolution_arena_elo` table is a V1 artifact that still exists in the stage Supabase database. No V2 code reads from or writes to it. Multiple docs (architecture.md, arena.md, reference.md) still reference it as a separate table — these are stale.

### FK Column Renames

| Current FK | New FK | Tables Affected |
|-----------|--------|----------------|
| `strategy_config_id` | `strategy_id` | `evolution_runs` |
| `topic_id` | `prompt_id` | `evolution_arena_entries`, `evolution_arena_comparisons`, `evolution_arena_batch_runs` |

Note: `prompt_id` already exists on `evolution_runs` and `evolution_experiments` — those are clean.

### Arena Tables (V2 Actual)

| Table | Purpose |
|-------|---------|
| `evolution_arena_topics` → `evolution_prompts` | Prompt grouping (used beyond arena: experiments, runs) |
| `evolution_arena_entries` | Articles + embedded Elo ratings |
| `evolution_arena_comparisons` | Match history (A vs B results) |
| `evolution_arena_batch_runs` | Comparison batch tracking |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/experimental_framework.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/server_action_patterns.md

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql (V2 clean-slate migration — confirmed arena_elo merged into entries)
- evolution/src/lib/pipeline/arena.ts (load/sync — references evolution_arena_entries only)
- evolution/src/services/arenaActions.ts (admin actions)
