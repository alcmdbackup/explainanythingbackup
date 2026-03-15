# Rework Data Types Evolution Plan

## Background
The evolution pipeline's type system has grown organically — all shared types live in a single 869-line `types.ts`, with additional entity types scattered across 10+ service action files. Entity shapes (DB rows) are mixed with pipeline internals, JSONB sub-types, and UI view models. This makes it hard to understand what's a real entity vs. a derived shape, and forces unnecessary coupling.

## Requirements (from GH Issue #701)
- Split types into `core_entities.ts`, `secondary_entities.ts`, and `supporting_types.ts`
- Core entities = 7 types (Experiment, Prompt, Strategy, Run, Invocation, Variant, ArenaEntry), each with own DB table, PK, and FK references
- Use Row + Entity pattern: `XxxRow` (DB columns only) and `Xxx extends XxxRow` (enriched with joined fields)
- New `evolution_explanations` table to decouple evolution's article identity from main `explanations` table
- New DB columns on Invocation and Variant for direct FK references (experiment_id, strategy_config_id, evolution_explanation_id, invocation_id)
- Each file exports a programmatically checkable const array of type names

## Problem
Currently there's no clear boundary between "what's stored in the DB" and "what's a derived/in-memory shape." Types like `EvolutionRun`, `EvolutionVariant`, and `PromptMetadata` are defined inline in service action files rather than in a shared location. Invocations and Variants lack direct FK references to their parent experiment, strategy, and explanation — requiring multi-hop joins for common queries. Prompt-based runs generate seed articles that are never persisted, leaving `explanation_id` NULL and breaking the entity graph.

## Options Considered
See research doc for detailed analysis of 3 type architecture approaches:
1. **Row + enriched Entity** (selected) — `XxxRow` for DB columns, `Xxx extends XxxRow` for joined fields
2. **Pick from parent** — Use `Pick<Run, 'experiment_id'>` to inherit fields
3. **Shared base interface** — Common `EvolutionEntityBase` extended by all entities

Approach 1 selected for clarity: explicit about what's stored vs. what's computed.

## Phased Execution Plan

### Phase 1: Create `evolution_explanations` table + migration
- Write migration to CREATE TABLE `evolution_explanations`
- Backfill: for each existing run with `explanation_id`, insert a row into `evolution_explanations` with `source: 'explanation'`
- Backfill: for each existing run with NULL `explanation_id` (prompt-based), insert a row with `source: 'prompt_seed'`, title/content from checkpoint `originalText`
- Add `evolution_explanation_id` FK to `evolution_experiments`, `evolution_runs`, `evolution_arena_entries`
- Update runner to persist seed articles to `evolution_explanations` before creating runs

### Phase 2: Add FK columns to Invocation and Variant
- Write migration to ADD COLUMN `strategy_config_id`, `evolution_explanation_id`, `experiment_id` on `evolution_agent_invocations`
- Write migration to ADD COLUMN `strategy_config_id`, `evolution_explanation_id`, `experiment_id`, `invocation_id` on `evolution_variants`
- Backfill existing rows from their parent run
- Alter `evolution_runs.experiment_id` to NOT NULL (after backfill)
- Alter `evolution_runs.prompt_id` to DROP NOT NULL
- Alter `evolution_experiments.prompt_id` to DROP NOT NULL
- Alter `evolution_arena_entries.topic_id` to DROP NOT NULL

### Phase 3: Create type files
- Create `evolution/src/lib/core_entities.ts`:
  - 7 `XxxRow` interfaces (DB column shapes)
  - 7 `Xxx` interfaces extending their Row
  - `CORE_ENTITIES` const array of entity names (runtime-usable for nav, filtering, etc.)
  - `CoreEntityName` union type derived from `CORE_ENTITIES`
  - `CORE_ENTITY_ROW_TYPES` and `CORE_ENTITY_TYPES` const arrays (compile-time checking)
- Create `evolution/src/lib/secondary_entities.ts`:
  - `EvolutionExplanationRow` / `EvolutionExplanation`
  - `ArenaEloRow` / `ArenaElo`
  - `ArenaComparisonRow` / `ArenaComparison`
  - `SECONDARY_ENTITY_TYPES` const array
- Create `evolution/src/lib/supporting_types.ts`:
  - Move all non-entity types from `types.ts`: enums, JSONB shapes, pipeline internals, agent execution details, LLM/logger/cost interfaces, checkpoint types, error classes
  - `SUPPORTING_TYPES` const array

### Phase 4: Update imports across codebase
- Update `evolution/src/lib/index.ts` to re-export from new files
- Update all service action files to import entity types from `core_entities.ts`
- Remove duplicate type definitions from service files (e.g., `EvolutionRun` in `evolutionActions.ts`)
- Update pipeline code to populate new FK columns at insert time
- Delete `evolution/src/lib/types.ts` (or keep as thin re-export shim temporarily)

### Phase 5: Update pipeline insert paths
- Update `createAgentInvocation()` to populate `strategy_config_id`, `evolution_explanation_id`, `experiment_id` from `ExecutionContext`
- Update variant persistence to populate `strategy_config_id`, `evolution_explanation_id`, `experiment_id`, `invocation_id`
- Update arena entry creation to populate `evolution_explanation_id`, `strategy_config_id`

## Testing
- Unit tests for each new type file: verify `CORE_ENTITY_TYPES` array matches actual exports
- Unit tests for migration backfill logic
- Integration tests: verify existing runs/invocations/variants have correct FK values after backfill
- Integration tests: verify new runs populate all FK columns correctly
- Integration tests: verify prompt-based runs create `evolution_explanations` rows
- E2E: trigger a run from admin UI, verify all entities link correctly

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Add `evolution_explanations` table, update entity definitions with new FKs, document Row/Entity pattern
- `evolution/docs/evolution/architecture.md` - Update pipeline insert paths, document FK population in ExecutionContext
- `evolution/docs/evolution/entity_diagram.md` - Add EvolutionExplanation entity, update FK arrows for new columns on Invocation/Variant
- `evolution/docs/evolution/reference.md` - Add new type files to key files section, update migration list
