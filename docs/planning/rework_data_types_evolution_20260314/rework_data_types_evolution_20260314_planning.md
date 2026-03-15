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
- ADD COLUMN `strategy_config_id`, `evolution_explanation_id`, `experiment_id` on `evolution_agent_invocations`
- ADD COLUMN `strategy_config_id`, `evolution_explanation_id`, `experiment_id`, `invocation_id` on `evolution_variants`
- Backfill existing rows from their parent run
- ALTER `evolution_runs.experiment_id` SET NOT NULL
- ALTER `evolution_runs.prompt_id` DROP NOT NULL
- ALTER `evolution_experiments.prompt_id` DROP NOT NULL
- ALTER `evolution_arena_entries.topic_id` DROP NOT NULL
- ADD COLUMN `strategy_config_id` on `evolution_arena_entries`

### Phase 3: Drop legacy columns and fix constraints
Complete cleanup — no backward compatibility needed.

**Drop columns:**
- `evolution_experiments._prompts_deprecated` — dead column from prompt→prompt_id migration
- `evolution_runs.explanation_id` — replaced by `evolution_explanation_id`
- `evolution_runs.variants_generated` — redundant with `total_variants`
- `evolution_runs.runner_agents_completed` — internal runner bookkeeping
- `evolution_runs.last_heartbeat` — internal runner bookkeeping
- `evolution_runs.source` — derivable from `evolution_explanations.source`
- `evolution_variants.explanation_id` — replaced by `evolution_explanation_id`
- `evolution_arena_entries.rank` — legacy from old hall_of_fame model
- `evolution_strategy_configs.elo_sum_sq_diff` — internal Welford accumulator for RPC
- `evolution_arena_elo.elo_rating` — legacy pre-OpenSkill, derivable from `toEloScale(mu)`

**Fix CHECK constraints:**
- `evolution_runs.pipeline_type` — add `'single'` (currently only `full, minimal, batch`)
- `evolution_strategy_configs.pipeline_type` — add `'single'` (same)
- `evolution_arena_topics.title` — ensure NOT NULL constraint

**Update RPCs:**
- `update_strategy_aggregates` — remove dependency on `elo_sum_sq_diff` column (rewrite Welford or switch to simpler aggregation)
- `checkpoint_and_continue` — remove `last_heartbeat = NOW()` from the update
- `sync_to_arena` — remove `elo_rating` from insert/upsert, add `evolution_explanation_id` and `strategy_config_id`
- `compute_run_variant_stats` — verify no dependency on dropped columns
- `claim_evolution_run` — remove `last_heartbeat` from claiming logic

**Update code — dropped column writes (6 files):**
- `evolution/src/services/evolutionRunnerCore.ts:226` — remove `last_heartbeat` from heartbeat interval; replace with checkpoint-based staleness detection
- `evolution/src/lib/core/persistence.ts:48` — remove `last_heartbeat` from checkpoint update
- `evolution/src/lib/core/pipeline.ts:715` — remove `last_heartbeat` from pipeline checkpoint
- `evolution/src/services/evolutionActions.ts:243,251` — remove `source` from run insert
- `evolution/src/services/experimentActions.ts:553` — remove `source` from experiment run insert
- `evolution/src/lib/core/arenaIntegration.ts:254` — remove `elo_rating` from eloRows; add `evolution_explanation_id`, `strategy_config_id`

**Update code — replaced column writes (3 files):**
- `evolution/src/services/evolutionActions.ts:255` — replace `explanation_id` with `evolution_explanation_id` in run insert
- `evolution/src/services/experimentActions.ts:549` — replace `explanation_id` with `evolution_explanation_id` in experiment run insert
- `evolution/src/lib/core/persistence.ts:75` — replace `explanation_id` with `evolution_explanation_id` in variant upsert

**Update code — new FK writes (4 files):**
- `evolution/src/lib/core/pipelineUtilities.ts:163` — add `strategy_config_id`, `evolution_explanation_id`, `experiment_id` to invocation insert (values from ExecutionContext)
- `evolution/src/lib/core/persistence.ts:72-83` — add `strategy_config_id`, `evolution_explanation_id`, `experiment_id`, `invocation_id` to variant upsert
- `evolution/src/services/arenaActions.ts:193-206` — add `evolution_explanation_id`, `strategy_config_id` to arena entry insert
- `evolution/scripts/lib/arenaUtils.ts:60-73` — same for CLI arena utils

**Update code — new evolution_explanations writes (2 files):**
- `evolution/src/services/evolutionRunnerCore.ts` — insert into `evolution_explanations` before pipeline start (both explanation-based and prompt-based paths)
- `evolution/src/services/experimentActions.ts` — insert into `evolution_explanations` when creating experiment runs

**Update code — experiment_id now required on runs:**
- `evolution/src/services/evolutionActions.ts` (queueEvolutionRunAction) — currently allows runs without experiment_id. Must auto-create a wrapper experiment for standalone/ad-hoc runs, or require experiment_id at queue time.
- `evolution/scripts/run-evolution-local.ts:497-504` — local runner inserts runs without experiment_id. Must create experiment first.

**Update watchdog — replace heartbeat-based staleness:**
- `src/app/api/cron/evolution-watchdog/route.ts` — currently detects stale runs via `last_heartbeat < cutoff`. Replace with checkpoint-based detection: query `evolution_checkpoints` for most recent checkpoint `created_at` per run, use that as the liveness signal instead.

**Update arena elo reads — replace elo_rating:**
- `evolution/src/services/arenaActions.ts` (getArenaLeaderboardAction) — compute `display_elo` from `toEloScale(mu)` instead of reading `elo_rating` column
- `evolution/src/services/arenaActions.ts` (buildInitialEloRow) — remove `elo_rating` from initial row, keep only `mu`/`sigma`
- `evolution/scripts/lib/arenaUtils.ts` — same

**Update test helpers:**
- `evolution/src/testing/evolution-test-helpers.ts:334-344` — add new FK columns to invocation insert helper
- `evolution/src/testing/evolution-test-helpers.ts:193-201` — replace `explanation_id` with `evolution_explanation_id`, add new FK columns to variant insert helper

### Phase 4: Create type files
- Create `evolution/src/lib/core_entities.ts`:
  - 7 `XxxRow` interfaces (DB column shapes — matching cleaned-up schema)
  - 7 `Xxx` interfaces extending their Row
  - `CORE_ENTITIES` const array of entity names (runtime-usable for nav, filtering, etc.)
  - `CoreEntityName` union type derived from `CORE_ENTITIES`
  - `CORE_ENTITY_ROW_TYPES` and `CORE_ENTITY_TYPES` const arrays (compile-time checking)
- Create `evolution/src/lib/secondary_entities.ts`:
  - `EvolutionExplanationRow` / `EvolutionExplanation`
  - `ArenaEloRow` / `ArenaElo` (without `elo_rating` — uses mu/sigma only)
  - `ArenaComparisonRow` / `ArenaComparison`
  - `SECONDARY_ENTITY_TYPES` const array
- Create `evolution/src/lib/supporting_types.ts`:
  - Move all non-entity types from `types.ts`: enums, JSONB shapes, pipeline internals, agent execution details, LLM/logger/cost interfaces, checkpoint types, error classes
  - `SUPPORTING_TYPES` const array

### Phase 5: Update imports across codebase
- Update `evolution/src/lib/index.ts` to re-export from new files
- Update all service action files to import entity types from `core_entities.ts`
- Remove duplicate type definitions from service files (e.g., `EvolutionRun` in `evolutionActions.ts`)
- Delete `evolution/src/lib/types.ts` (or keep as thin re-export shim temporarily)

### Phase 6: Update pipeline insert paths
- All insert path changes are detailed in Phase 3 above
- This phase is purely execution of those changes + verification

## Testing
- Unit tests for each new type file: verify `CORE_ENTITY_TYPES` array matches actual exports
- Unit tests for migration backfill logic
- Integration tests: verify existing runs/invocations/variants have correct FK values after backfill
- Integration tests: verify no code references dropped columns (`last_heartbeat`, `runner_agents_completed`, `variants_generated`, `source`, `elo_rating`, `elo_sum_sq_diff`, `rank`)
- Integration tests: verify `toEloScale(mu)` produces correct values everywhere `elo_rating` was previously read
- Integration tests: verify new runs populate all FK columns correctly
- Integration tests: verify prompt-based runs create `evolution_explanations` rows
- E2E: trigger a run from admin UI, verify all entities link correctly

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Add `evolution_explanations` table, update entity definitions with new FKs, document Row/Entity pattern
- `evolution/docs/evolution/architecture.md` - Update pipeline insert paths, document FK population in ExecutionContext
- `evolution/docs/evolution/entity_diagram.md` - Add EvolutionExplanation entity, update FK arrows for new columns on Invocation/Variant
- `evolution/docs/evolution/reference.md` - Add new type files to key files section, update migration list
