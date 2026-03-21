# Rename Tables Based on Evolution V2 Entities Plan

## Background
Evolution V2 introduced clean entity names (Prompt, Strategy, Run, Variant, etc.) but several database tables still carry V1-era names that don't match. The biggest offender is `evolution_arena_topics` which is universally called "Prompt" in V2 code, and `evolution_strategy_configs` which maps to the "Strategy" entity. Additionally, the `evolution_arena_elo` table still exists in stage despite being merged into `evolution_arena_entries` during the V2 clean-slate migration.

## Requirements
1. Rename `evolution_arena_topics` → `evolution_prompts` (entity: Prompt)
2. Rename `evolution_strategy_configs` → `evolution_strategies` (entity: Strategy)
3. Drop `evolution_arena_elo` table (stale — data merged into `evolution_arena_entries` in V2)
4. Rename FK columns where they reference old table names (e.g., `strategy_config_id` → `strategy_id`)
5. Update all code references (services, actions, types, components, tests)
6. Update all documentation (evolution docs, feature deep dives, architecture)

## Problem
V2 entity names and table names are misaligned, causing confusion when reading code that says "prompt" but queries `evolution_arena_topics`. The stale `evolution_arena_elo` table in stage is a liability — it could be mistakenly queried or referenced. Docs referencing the old separate elo table are misleading.

## Options Considered
[To be filled after /research]

## Phased Execution Plan
[To be filled after /research]

## Testing
[To be filled after /research]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Table names, entity diagram references
- `evolution/docs/evolution/reference.md` - Database schema section lists all tables
- `evolution/docs/evolution/entity_diagram.md` - Entity-to-table mapping in diagram
- `evolution/docs/evolution/arena.md` - Arena table references, mentions evolution_arena_elo
- `evolution/docs/evolution/README.md` - May reference table names
- `evolution/docs/evolution/experimental_framework.md` - May reference strategy_configs
- `docs/feature_deep_dives/admin_panel.md` - Routes and server actions reference table names
- `docs/feature_deep_dives/server_action_patterns.md` - Action patterns may reference tables
- `docs/docs_overall/architecture.md` - Database schema section lists arena tables including stale evolution_arena_elo
