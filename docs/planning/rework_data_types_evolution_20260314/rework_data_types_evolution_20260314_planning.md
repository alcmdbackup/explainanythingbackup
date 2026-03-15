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

## Migration Safety Rules

All phases follow these rules:

1. **NULL-first pattern:** New FK columns are always added as NULLABLE first, backfilled, verified, then SET NOT NULL. Never add NOT NULL columns to tables with existing data.
2. **Verification before constraint:** Before every `ALTER SET NOT NULL`, run `SELECT COUNT(*) WHERE <column> IS NULL` and abort if > 0.
3. **Idempotent backfills:** All backfill queries use `WHERE <new_column> IS NULL` so they can be re-run safely after partial failures.
4. **Transaction wrapping:** Each migration file wraps DDL + backfill in a single transaction. If backfill fails, the entire migration rolls back.
5. **One migration file per phase:** Each phase is a single migration file. CI deploys one at a time. Tests must pass after each phase before the next is applied.
6. **Code deploys before column drops:** Code is updated to stop reading/writing a column BEFORE the migration that drops it. Never drop a column that deployed code still references.
7. **Test helpers updated per phase:** Test helpers are updated in the SAME PR as the migration, so CI stays green at every phase boundary.

## Rollback Strategy

| Phase | Rollback approach |
|-------|-------------------|
| 1 | DROP TABLE evolution_explanations + DROP COLUMN evolution_explanation_id from 3 tables |
| 2 | ALTER experiment_id DROP NOT NULL on runs + delete auto-created wrapper experiments (identified by `design = 'manual' AND name LIKE 'Ad-hoc Run:%'`) |
| 3 | DROP COLUMN new FK columns from invocations/variants (data loss acceptable — derived from parent run) |
| 4 | Re-add dropped columns with defaults (data loss acceptable — columns were redundant/derivable) |
| 5-7 | Revert file changes via git (no schema impact) |
| 8 | No rollback needed (V1/V2 schemas preserved until verified) |

Each migration file includes a commented `-- ROLLBACK:` section with the reverse DDL.

## Phased Execution Plan

### Phase 1: Create `evolution_explanations` table + migration
- Write migration to CREATE TABLE `evolution_explanations`
- ADD COLUMN `evolution_explanation_id UUID REFERENCES evolution_explanations(id)` as **NULLABLE** on `evolution_experiments`, `evolution_runs`, `evolution_arena_entries`
- Backfill: for each existing run with `explanation_id`, insert a row into `evolution_explanations` with `source: 'explanation'`, copying title/content from `explanations` table
- Backfill: for each existing run with NULL `explanation_id` (prompt-based), insert a row with `source: 'prompt_seed'`, title/content from checkpoint `originalText`. **Fallback:** If checkpoint data is missing, create a placeholder row with `title: 'Unknown (no checkpoint)'`, `content: ''`, `source: 'prompt_seed'` and log a warning.
- Backfill `evolution_explanation_id` on runs, experiments, and arena entries from the newly-created rows
- **Verify:** `SELECT COUNT(*) FROM evolution_runs WHERE evolution_explanation_id IS NULL` = 0
- ALTER `evolution_explanation_id` SET NOT NULL on all 3 tables
- Update runner to persist seed articles to `evolution_explanations` before creating runs
- Update test helpers: add `evolution_explanation_id` to `createTestEvolutionRun`, add `createTestEvolutionExplanation` helper, update `cleanupEvolutionData` to include `evolution_explanations` table
- **Timing:** Explanation-based runs insert at queue time (data already exists). Prompt-based runs insert at claim/execution time (after `generateSeedArticle()`). Race condition mitigated by check-before-insert pattern.
- **Dual-column coexistence (Phases 1-4a):** During this window, BOTH `explanation_id` (old INT) and `evolution_explanation_id` (new UUID) exist on runs and variants. Test helpers write BOTH columns during this period:
  ```typescript
  // createTestEvolutionRun during Phases 1-4a:
  { explanation_id: explanationId, evolution_explanation_id: evoExplId, ... }
  // createTestVariant during Phases 1-4a:
  { explanation_id: explanationId, evolution_explanation_id: evoExplId, ... }
  ```
  Service code reads from `evolution_explanation_id` (new) but old column is still populated for any code not yet migrated. In Phase 4a, all reads switch to new column. In Phase 4b, old column is dropped and test helpers stop writing it.
- **Tests must pass after this phase.**

### Phase 2: Make experiment_id required + auto-create wrapper experiments
- Auto-create one wrapper experiment per standalone run (not a shared bucket)
- Use `design: 'manual'`, `factor_definitions: {}`, `total_budget_usd: 0`, `status: 'pending'`
- Update `queueEvolutionRunAction` to create wrapper experiment **atomically in the same transaction** as the run insert (experiment created, then run inserted with experiment_id — no window for race condition)
- Update `run-evolution-local.ts` to create wrapper experiment before inserting run
- Backfill existing NULL experiment_id runs with auto-created experiments (one experiment per run, idempotent: `WHERE experiment_id IS NULL`)
- **Verify:** `SELECT COUNT(*) FROM evolution_runs WHERE experiment_id IS NULL` = 0
- ALTER `evolution_runs.experiment_id` SET NOT NULL
- Update test helpers: all `createTestEvolutionRun` calls must include `experiment_id`
- **Experiment lifecycle:** When wrapper experiment's run completes/fails, update experiment status to match. No separate cron needed — do it inline at run completion.
- **Tests must pass after this phase.**

### Phase 3: Add FK columns to Invocation and Variant
- ADD COLUMN as **NULLABLE**: `strategy_config_id`, `evolution_explanation_id`, `experiment_id` on `evolution_agent_invocations`
- ADD COLUMN as **NULLABLE**: `strategy_config_id`, `evolution_explanation_id`, `experiment_id`, `invocation_id` on `evolution_variants`
- ADD COLUMN as **NULLABLE**: `strategy_config_id` on `evolution_arena_entries`
- Backfill invocations: `UPDATE evolution_agent_invocations i SET strategy_config_id = r.strategy_config_id, evolution_explanation_id = r.evolution_explanation_id, experiment_id = r.experiment_id FROM evolution_runs r WHERE i.run_id = r.id AND i.strategy_config_id IS NULL`
- Backfill variants: same pattern joining through runs, plus `invocation_id` matched by `(run_id, iteration, agent_name)` → invocation.id lookup
- Backfill arena entries: `strategy_config_id` from linked run's strategy
- **Verify** all counts = 0 for NULL values on invocations and variants
- ALTER SET NOT NULL on all new columns (except `strategy_config_id` on arena_entries which is intentionally nullable)
- Thread FK values through pipeline: add `experimentId`, `strategyConfigId`, `evolutionExplanationId` to `AgentPayload` and `PipelineRunInputs` → flows via `preparePipelineRun()` and `prepareResumedPipelineRun()` in `index.ts` → `ctx.payload`
- Add `invocationId` field to `TextVariation` interface, have agents pass `ctx.invocationId` when calling `createTextVariation()`
- ALTER `evolution_runs.prompt_id` DROP NOT NULL
- ALTER `evolution_experiments.prompt_id` DROP NOT NULL (fix 2 inner joins in experimentActions.ts lines 104/499: change `!prompt_id` to left join)
- ALTER `evolution_arena_entries.topic_id` DROP NOT NULL
- Update test helpers: add new FK columns to `createTestAgentInvocation` and `createTestVariant`
- **Tests must pass after this phase** with both old columns (explanation_id) and new columns present.

### Phase 4a: Update code to stop reading/writing columns being dropped
**Separate PR, merged BEFORE Phase 4b.** Code must tolerate columns existing but not use them.

**CI enforcement:** Phase 4b migration file is NOT included in this PR. It lives in Phase 4b's PR which is only opened after Phase 4a is merged and deployed to staging. The migration file references the Phase 4a PR number in a comment to document the dependency.

All code changes listed below (dropped column writes, replaced column writes, arena elo reads, ordinal cleanup, watchdog rewrite) are done in this phase. Tests updated to not reference dropped columns.

### Phase 4b: Drop legacy columns and fix constraints
**Separate PR, merged AFTER Phase 4a is deployed.** No code references dropped columns at this point. Only contains the migration file — no code changes.

**Drop columns (10):**
- `evolution_experiments._prompts_deprecated` — dead column from prompt→prompt_id migration
- `evolution_runs.explanation_id` — replaced by `evolution_explanation_id`
- `evolution_runs.variants_generated` — already dropped by migration 20260221000004
- `evolution_runs.runner_agents_completed` — already dropped by migration 20260221000003
- `evolution_runs.last_heartbeat` — replaced by checkpoint-based staleness
- `evolution_runs.source` — derivable from `evolution_explanations.source`
- `evolution_variants.explanation_id` — replaced by `evolution_explanation_id`
- `evolution_arena_entries.rank` — legacy from old hall_of_fame model
- `evolution_strategy_configs.elo_sum_sq_diff` — internal Welford accumulator
- `evolution_arena_elo.elo_rating` — legacy pre-OpenSkill, derivable from `toEloScale(mu)`

**Also clean up `ordinal` dummy writes (7 locations):**
- Remove `ordinal: 0` from arenaIntegration.ts, arenaActions.ts (2 locations), arenaUtils.ts, and 3 comparison scripts
- Column already dropped by migration 20260312000001, but code still writes dummy value

**Fix CHECK constraints:**
- `evolution_runs.pipeline_type` — add `'single'`
- `evolution_strategy_configs.pipeline_type` — add `'single'`
- `evolution_arena_topics.title` — ensure NOT NULL

**Drop indexes:**
- `idx_evolution_runs_heartbeat` — depends on `last_heartbeat`

**Rewrite RPCs (5):**
- `update_strategy_aggregates` — replace Welford M2 with `STDDEV_POP()` over linked runs (full materialization, acceptable O(run_count) per call at finalization time)
- `checkpoint_and_continue` — remove `last_heartbeat = NOW()`
- `claim_evolution_run` — remove `last_heartbeat = NOW()` from claim UPDATE
- `sync_to_arena` — remove `elo_rating` and `ordinal` from insert/upsert, add `evolution_explanation_id` and `strategy_config_id`
- `compute_run_variant_stats` — verify no dependency on dropped columns

**Rewrite watchdog:**
- `src/app/api/cron/evolution-watchdog/route.ts` — replace `last_heartbeat < cutoff` with checkpoint-based detection:
  ```sql
  SELECT r.id FROM evolution_runs r
  WHERE r.status IN ('claimed', 'running')
  AND NOT EXISTS (
    SELECT 1 FROM evolution_checkpoints c
    WHERE c.run_id = r.id AND c.created_at > NOW() - INTERVAL '10 minutes'
  )
  ```
- Remove heartbeat interval timer from `evolutionRunnerCore.ts:setupHeartbeat()`
- Edge case: long LLM calls (2-5min) with no checkpoint — same risk as current heartbeat (agent must complete before checkpoint). Existing 10-minute threshold handles this.
- Edge case: freshly claimed run with zero checkpoints — fall back to `evolution_runs.started_at` as liveness signal (if `started_at` > cutoff, run is still fresh).

**Update code — dropped column writes (6 files):**
- `evolution/src/services/evolutionRunnerCore.ts:226` — delete `setupHeartbeat()` function entirely
- `evolution/src/lib/core/persistence.ts:48` — remove `last_heartbeat` from checkpoint update
- `evolution/src/lib/core/pipeline.ts:715` — remove `last_heartbeat` from pipeline checkpoint
- `evolution/src/services/evolutionActions.ts:243,251` — remove `source` from run insert
- `evolution/src/services/experimentActions.ts:553` — remove `source` from experiment run insert
- `evolution/src/lib/core/arenaIntegration.ts:254` — remove `elo_rating` and `ordinal` from eloRows

**Update code — replaced column writes (3 files):**
- `evolution/src/services/evolutionActions.ts:255` — replace `explanation_id` with `evolution_explanation_id`
- `evolution/src/services/experimentActions.ts:549` — same
- `evolution/src/lib/core/persistence.ts:75` — same in variant upsert

**Update code — new FK writes (4 files):**
- `evolution/src/lib/core/pipelineUtilities.ts:163` — add `strategy_config_id`, `evolution_explanation_id`, `experiment_id` to invocation insert
- `evolution/src/lib/core/persistence.ts:72-83` — add `strategy_config_id`, `evolution_explanation_id`, `experiment_id`, `invocation_id` to variant upsert
- `evolution/src/services/arenaActions.ts:193-206` — add `evolution_explanation_id`, `strategy_config_id` to arena entry insert
- `evolution/scripts/lib/arenaUtils.ts:60-73` — same

**Update arena elo reads (replace `elo_rating` with `toEloScale(mu)`):**
- `arenaActions.ts` — 5 query locations (lines 308, 594, 824, 954, 1052): change `.select()` to fetch `mu` instead of `elo_rating`, replace ~15 code refs
- `scripts/query-elo-baselines.ts:33,73` — same
- `scripts/lib/arenaUtils.ts` — remove from initial elo row
- Leaderboard already uses computed `display_elo` — UI unchanged

**Update experimentActions.ts for nullable prompt_id:**
- Line 104: change `evolution_arena_topics!prompt_id(prompt)` to `evolution_arena_topics(prompt)` (inner → left join)
- Line 499: same change

### Phase 5: Create type files
- Create `evolution/src/lib/core_entities.ts`:
  - 7 `XxxRow` interfaces (DB column shapes — matching cleaned-up schema)
  - 7 `Xxx` interfaces extending their Row
  - `CORE_ENTITIES` const array of entity names (runtime-usable for nav, filtering, etc.)
  - `CoreEntityName` union type derived from `CORE_ENTITIES`
  - `CORE_ENTITY_ROW_TYPES` and `CORE_ENTITY_TYPES` const arrays (compile-time checking)
- Create `evolution/src/lib/secondary_entities.ts`:
  - `EvolutionExplanationRow` / `EvolutionExplanation`
  - `ArenaEloRow` / `ArenaElo` (mu/sigma only, no elo_rating)
  - `ArenaComparisonRow` / `ArenaComparison`
  - `SECONDARY_ENTITY_TYPES` const array
- Create `evolution/src/lib/supporting_types.ts`:
  - Move all non-entity types from `types.ts`: enums, JSONB shapes, pipeline internals, agent execution details, LLM/logger/cost interfaces, checkpoint types, error classes
  - `SUPPORTING_TYPES` const array

### Phase 6: Update imports across codebase
- Update `evolution/src/lib/index.ts` to re-export from new files
- Update all service action files to import entity types from `core_entities.ts`
- Remove duplicate type definitions from service files (e.g., `EvolutionRun` in `evolutionActions.ts`)
- Delete `evolution/src/lib/types.ts` (or keep as thin re-export shim temporarily)

### Phase 7: Update admin UI
- `src/app/admin/evolution/runs/page.tsx` (lines 68, 75) — replace `explanation_id` refs with `evolution_explanation_id`
- `evolution/src/components/evolution/RunsTable.tsx` (lines 82, 90) — same
- `src/app/admin/evolution/arena/[topicId]/page.tsx` (lines 270, 313, 353) — same
- Arena leaderboard — no changes needed (already uses computed `display_elo`)

### Phase 8 (optional): Backfill V1/V2 run_summary to V3
- Audit: `SELECT COALESCE(run_summary->>'version', '(none)') as v, COUNT(*) FROM evolution_runs WHERE run_summary IS NOT NULL GROUP BY 1`
- If >95% V3: run SQL migration to transform V1/V2 field names in-place (transforms proven in Zod)
- After 2 weeks: remove V1/V2 schemas from types.ts (~86 lines of legacy transform code)

## Testing

**Phase boundary rule:** Tests must pass after EVERY phase. Each phase's PR includes both migration + test helper updates. CI runs migrations then tests — if tests fail, the PR is blocked.

**Test files requiring updates (~20+ files):**

| Category | Files | Changes |
|----------|-------|---------|
| `explanation_id` refs | 10+ files | Replace with `evolution_explanation_id` in fixtures/assertions |
| `last_heartbeat` refs | 2 files (watchdog route + integration) | Rewrite to use checkpoint-based detection |
| `elo_rating` refs | 1 file (arena-actions integration) | Replace with `toEloScale(mu)` |
| `ordinal` dummy writes | 2 files (pipeline test, experiment test) | Remove V2 transform tests (after Phase 8) |
| Run insert fixtures | 7+ integration files | Add new FK columns, remove dropped columns |
| Variant insert fixtures | 4+ integration files | Add new FK columns, replace explanation_id |
| Test helpers | evolution-test-helpers.ts | Update invocation + variant insert helpers |

**New tests:**
- Unit tests for each new type file: verify `CORE_ENTITY_TYPES` array matches actual exports
- Unit tests for migration backfill logic
- Integration: verify existing runs/invocations/variants have correct FK values after backfill
- Integration: verify new runs populate all FK columns correctly
- Integration: verify prompt-based runs create `evolution_explanations` rows
- Integration: verify auto-created wrapper experiments for standalone runs
- Integration: verify watchdog checkpoint-based staleness detection
- E2E: trigger a run from admin UI, verify all entities link correctly

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` - Add `evolution_explanations` table, update entity definitions with new FKs, document Row/Entity pattern, update entity diagram
- `evolution/docs/evolution/architecture.md` - Update pipeline insert paths, document FK population in ExecutionContext, document checkpoint-based staleness
- `evolution/docs/evolution/entity_diagram.md` - Add EvolutionExplanation entity, update FK arrows for new columns on Invocation/Variant, remove dropped columns
- `evolution/docs/evolution/reference.md` - Add new type files to key files section, update migration list, update RPC documentation
