# Rename Tables Based on Evolution V2 Entities Plan

## Background
Evolution V2 introduced clean entity names (Prompt, Strategy, Run, Variant, etc.) but several database tables still carry V1-era names that don't match. The biggest offender is `evolution_arena_topics` which is universally called "Prompt" in V2 code, and `evolution_strategy_configs` which maps to the "Strategy" entity. Additionally, the `evolution_arena_elo` table still exists in stage despite being merged into `evolution_arena_entries` during the V2 clean-slate migration.

## Requirements
1. Rename `evolution_arena_topics` → `evolution_prompts` (entity: Prompt)
2. Rename `evolution_strategy_configs` → `evolution_strategies` (entity: Strategy)
3. Drop `evolution_arena_elo` table (stale V1 artifact — verify gone, ensure migration covers it)
4. Drop `evolution_arena_batch_runs` table (completely unused — never-implemented rate-limiting feature)
5. Drop `difficulty_tier` and `domain_tags` columns from prompts table (unused categorization — remove from DB, types, actions, UI, tests)
6. Rename FK columns (`strategy_config_id` → `strategy_id`, `topic_id` → `prompt_id` on arena tables)
7. Update all code references (services, actions, types, components, tests)
8. Update all documentation (evolution docs, feature deep dives, architecture)

## Problem
V2 entity names and table names are misaligned, causing confusion when reading code that says "prompt" but queries `evolution_arena_topics`. The stale `evolution_arena_elo` table in stage is a liability — it could be mistakenly queried or referenced. The `evolution_arena_batch_runs` table was created for a feature that was never built. The `difficulty_tier` and `domain_tags` columns add unnecessary complexity to the Prompt entity. Docs referencing the old separate elo table are misleading.

## Options Considered

### Option A: ALTER TABLE RENAME (Chosen)
Use `ALTER TABLE ... RENAME TO` and `ALTER TABLE ... RENAME COLUMN` for renames. PostgreSQL automatically updates FK constraints, indexes, and sequences to point to the new table name. RLS policies, RPCs, views, and indexes that reference old names by string must be dropped and recreated.

**Pros:** Atomic, preserves data and constraints, no data movement, fastest.
**Cons:** Must manually drop/recreate RPCs, RLS policies, and views that hardcode table names.

### Option B: Create new tables + migrate data
Create new tables with new names, copy data, drop old tables.

**Pros:** Clean slate.
**Cons:** Unnecessarily complex for a rename, risks data loss, slower, must handle FK cascades.

**Decision:** Option A — `ALTER TABLE RENAME` is the standard PostgreSQL approach. All dependent objects (RPCs, policies, views) are enumerated below and will be dropped/recreated in the same transaction.

## DB Objects Affected by Renames

### Tables renamed
- `evolution_arena_topics` → `evolution_prompts`
- `evolution_strategy_configs` → `evolution_strategies`

### Tables dropped
- `evolution_arena_elo` (IF EXISTS — may already be gone)
- `evolution_arena_batch_runs`

### Columns dropped
- `evolution_prompts.difficulty_tier`
- `evolution_prompts.domain_tags`

### FK columns renamed
- `evolution_runs.strategy_config_id` → `strategy_id`
- `evolution_arena_entries.topic_id` → `prompt_id`
- `evolution_arena_comparisons.topic_id` → `prompt_id`

Note: `evolution_arena_batch_runs.topic_id` is dropped with the table, no rename needed.

### Indexes to drop and recreate (reference old column names)
- `idx_runs_strategy` — on `evolution_runs(strategy_config_id)` → recreate on `(strategy_id)`
- `idx_arena_entries_topic` — on `evolution_arena_entries(topic_id, elo_rating DESC)` → recreate on `(prompt_id, elo_rating DESC)`
- `idx_arena_entries_active` — on `evolution_arena_entries(topic_id)` → recreate on `(prompt_id)`
- `idx_arena_comparisons_topic` — on `evolution_arena_comparisons(topic_id, created_at DESC)` → recreate on `(prompt_id, created_at DESC)`
- `idx_arena_batch_active` — dropped with table
- `uq_arena_topic_prompt` — on `evolution_arena_topics(lower(prompt))` → auto-renamed by ALTER TABLE RENAME, but verify

### RLS policies — NO action needed
`ALTER TABLE RENAME` preserves policies on the table (they follow the table, not the name). The `deny_all` and `readonly_select` policies on `evolution_strategy_configs` and `evolution_arena_topics` will automatically apply to the renamed tables. Policies on `evolution_arena_batch_runs` are dropped with the table. Verify post-migration with `\dp` or `pg_policies`.

### RPCs to drop and recreate (hardcoded table/column names in function body)
- `update_strategy_aggregates(UUID, NUMERIC, NUMERIC)` — references `evolution_strategy_configs` in UPDATE body
- `sync_to_arena(UUID, UUID, JSONB, JSONB)` — uses `p_topic_id` parameter name and inserts `topic_id` into `evolution_arena_entries` and `evolution_arena_comparisons`

RPCs NOT affected (no reference to renamed tables/columns):
- `claim_evolution_run(TEXT, UUID)` — only references `evolution_runs`
- `cancel_experiment(UUID)` — only references `evolution_experiments` and `evolution_runs`
- `get_run_total_cost(UUID)` — only references `evolution_agent_invocations`

### Views NOT affected
- `evolution_run_costs` — only references `evolution_agent_invocations`, no renamed tables/columns

## Phased Execution Plan

### Pre-deployment: Stop batch runner
```bash
# SSH to minicomputer
sudo systemctl stop evolution-runner.timer
sudo systemctl stop evolution-runner.service
# Verify no active runs in DB
```
This prevents the runner from querying renamed tables during migration.

### Phase 1: Migration SQL (single transaction)

Create migration `supabase/migrations/YYYYMMDD000001_rename_evolution_tables.sql`:

```sql
-- NOTE: Supabase migrations are auto-wrapped in a transaction.
-- Do NOT add explicit BEGIN/COMMIT — it would cause nested transaction issues.

-- ═══════════════════════════════════════════════════════════════
-- 1. DROP stale/unused tables
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS evolution_arena_elo CASCADE;
DROP TABLE IF EXISTS evolution_arena_batch_runs CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 2. DROP RPCs that reference old table/column names
--    (must drop before rename to avoid stale function bodies)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS update_strategy_aggregates(UUID, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB);

-- ═══════════════════════════════════════════════════════════════
-- 3. DROP indexes that reference old column names
--    (ALTER TABLE RENAME COLUMN does NOT rename indexes)
-- ═══════════════════════════════════════════════════════════════
DROP INDEX IF EXISTS idx_runs_strategy;
DROP INDEX IF EXISTS idx_arena_entries_topic;
DROP INDEX IF EXISTS idx_arena_entries_active;
DROP INDEX IF EXISTS idx_arena_comparisons_topic;

-- ═══════════════════════════════════════════════════════════════
-- 4. RENAME tables
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_arena_topics RENAME TO evolution_prompts;
ALTER TABLE evolution_strategy_configs RENAME TO evolution_strategies;

-- ═══════════════════════════════════════════════════════════════
-- 5. RENAME FK columns
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_runs RENAME COLUMN strategy_config_id TO strategy_id;
ALTER TABLE evolution_arena_entries RENAME COLUMN topic_id TO prompt_id;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN topic_id TO prompt_id;

-- ═══════════════════════════════════════════════════════════════
-- 6. DROP columns from evolution_prompts
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS difficulty_tier;
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS domain_tags;

-- ═══════════════════════════════════════════════════════════════
-- 7. RECREATE indexes with new column names
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_runs_strategy ON evolution_runs (strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX idx_arena_entries_prompt ON evolution_arena_entries (prompt_id, elo_rating DESC);
CREATE INDEX idx_arena_entries_active ON evolution_arena_entries (prompt_id) WHERE archived_at IS NULL;
CREATE INDEX idx_arena_comparisons_prompt ON evolution_arena_comparisons (prompt_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 8. RECREATE RPCs with new table/column names
-- ═══════════════════════════════════════════════════════════════

-- update_strategy_aggregates: references evolution_strategies (was evolution_strategy_configs)
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE evolution_strategies
  SET
    run_count = run_count + 1,
    total_cost_usd = total_cost_usd + COALESCE(p_cost_usd, 0),
    avg_final_elo = CASE
      WHEN run_count = 0 THEN p_final_elo
      ELSE (avg_final_elo * run_count + p_final_elo) / (run_count + 1)
    END,
    best_final_elo = GREATEST(COALESCE(best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = now()
  WHERE id = p_strategy_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) TO service_role;

-- sync_to_arena: rename topic_id → prompt_id in body and parameter
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  match JSONB;
BEGIN
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_matches) > 1000 THEN
    RAISE EXCEPTION 'p_matches exceeds maximum of 1000 elements';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_arena_entries (id, prompt_id, run_id, content, elo_rating, mu, sigma, match_count, generation_method)
    VALUES (
      (entry->>'id')::UUID,
      p_prompt_id,
      p_run_id,
      entry->>'content',
      COALESCE((entry->>'elo_rating')::NUMERIC, 1200),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'match_count')::INT, 0),
      COALESCE(entry->>'generation_method', 'pipeline')
    )
    ON CONFLICT (id) DO UPDATE SET
      elo_rating = COALESCE((entry->>'elo_rating')::NUMERIC, evolution_arena_entries.elo_rating),
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_arena_entries.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_arena_entries.sigma),
      match_count = COALESCE((entry->>'match_count')::INT, evolution_arena_entries.match_count);
  END LOOP;

  FOR match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (prompt_id, entry_a, entry_b, winner, confidence, run_id)
    VALUES (
      p_prompt_id,
      (match->>'entry_a')::UUID,
      (match->>'entry_b')::UUID,
      match->>'winner',
      COALESCE((match->>'confidence')::NUMERIC, 0),
      p_run_id
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) TO service_role;

```

**Important notes:**
- `ALTER TABLE RENAME` automatically updates FK constraints that reference the table
- `ALTER TABLE RENAME COLUMN` automatically updates FK constraint definitions
- RLS policies follow the table through rename (no drop/recreate needed)
- The unique index `uq_arena_topic_prompt` follows the table through rename
- The `sync_to_arena` RPC signature changes parameter name from `p_topic_id` → `p_prompt_id` — the calling code must be updated to match
- All operations are in a single transaction — if any step fails, everything rolls back

### Phase 2: Update TypeScript code (all code changes)

Complete file inventory from grep (42 files total):

**A. Table name + strategy_config_id renames (21 files under evolution/src/):**
- `evolution/src/lib/types.ts` — `PromptMetadata` interface, strategy_config_id type refs
- `evolution/src/lib/pipeline/runner.ts` — `.from('evolution_strategy_configs')`, strategy_config_id
- `evolution/src/lib/pipeline/runner.test.ts` — mock for evolution_strategy_configs, strategy_config_id
- `evolution/src/lib/pipeline/finalize.ts` — strategy_config_id interface
- `evolution/src/lib/pipeline/finalize.test.ts` — strategy_config_id in ~15 call sites
- `evolution/src/lib/pipeline/strategy.ts` — `.from('evolution_strategy_configs')`
- `evolution/src/lib/pipeline/experiments.ts` — strategy_config_id
- `evolution/src/lib/pipeline/experiments.test.ts` — strategy_config_id
- `evolution/src/lib/pipeline/arena.ts` — topic_id, p_topic_id in sync_to_arena call
- `evolution/src/lib/pipeline/arena.test.ts` — topic_id, p_topic_id mock assertions
- `evolution/src/services/arenaActions.ts` — `.from('evolution_arena_topics')`, topic_id, difficulty/domain schemas
- `evolution/src/services/arenaActions.test.ts` — mock data, topic_id, difficulty/domain
- `evolution/src/services/experimentActionsV2.ts` — `.from('evolution_arena_topics')`, difficulty/domain select
- `evolution/src/services/experimentActionsV2.test.ts` — strategy_config_id, mock data
- `evolution/src/services/strategyRegistryActionsV2.ts` — `.from('evolution_strategy_configs')` (9 refs)
- `evolution/src/services/strategyRegistryActionsV2.test.ts` — strategy_config_id mocks
- `evolution/src/services/evolutionActions.ts` — both tables, strategy_config_id (12+ refs)
- `evolution/src/services/evolutionActions.test.ts` — mocks for both tables
- `evolution/src/services/evolutionVisualizationActions.ts` — evolution_strategy_configs, strategy_config_id
- `evolution/src/services/evolutionVisualizationActions.test.ts` — mocks
- `evolution/src/services/evolutionRunnerCore.ts` — strategy_config_id
- `evolution/src/services/evolutionRunnerCore.test.ts` — strategy_config_id mocks
- `evolution/src/testing/evolution-test-helpers.ts` — both tables, strategy_config_id

**B. Table name + topic_id renames (9 files under src/):**
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — strategy_config_id
- `src/app/admin/evolution/_components/ExperimentForm.test.tsx` — strategy_config_id
- `src/app/admin/evolution/runs/page.test.tsx` — strategy_config_id
- `src/app/admin/evolution/runs/[runId]/page.test.tsx` — strategy_config_id
- `src/app/admin/evolution/arena/[topicId]/page.test.tsx` — topic_id
- `src/app/admin/evolution/arena/arenaBudgetFilter.test.ts` — topic_id
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — evolution_arena_topics, topic_id (20+ refs)
- `src/__tests__/e2e/specs/09-admin/admin-strategy-budget.spec.ts` — strategy_config_id (10+ refs)
- `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — evolution_strategy_configs
- `src/__tests__/integration/evolution-run-costs.integration.test.ts` — evolution_strategy_configs, strategy_config_id

**B2. Scripts (4 files under evolution/scripts/):**
- `evolution/scripts/evolution-runner.ts` — strategy_config_id (batch runner deployed on minicomputer — CRITICAL)
- `evolution/scripts/evolution-runner.test.ts` — strategy_config_id mocks
- `evolution/scripts/run-evolution-local.ts` — strategy_config_id
- `evolution/scripts/backfill-strategy-config-id.ts` — DELETE this file (one-time V1→V2 migration tool, no longer needed)

**C. difficulty_tier + domain_tags removal (11 files, overlaps with A/B):**
- `evolution/src/lib/types.ts` — `PromptMetadata` interface
- `evolution/src/services/arenaActions.ts` — `ArenaTopic`/`PromptListItem` interfaces, schemas, actions
- `evolution/src/services/experimentActionsV2.ts` — getPromptsAction select
- `evolution/src/services/arenaActions.test.ts` — mock data, create tests
- `evolution/src/lib/shared/strategyConfig.test.ts` — PromptMetadata validation tests
- `src/app/admin/evolution/prompts/page.tsx` — column, filter, form fields
- `src/app/admin/evolution/prompts/page.test.tsx` — mock data, filter test
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — detail display
- `src/app/admin/evolution/arena/page.test.tsx` — mock data
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — MetricGrid display
- `src/app/admin/evolution/arena/[topicId]/page.test.tsx` — mock data

**D. UI components (remove difficulty/domain_tags fields):**
- `src/app/admin/evolution/prompts/page.tsx` — remove difficulty column, filter, form fields
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — remove difficulty metric and domain_tags section
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — remove difficulty and tags from MetricGrid

### Deploy ordering

Code and migration must deploy atomically. Since Supabase migrations run on push to main via CI, and Vercel deploys from the same push, they are effectively atomic. However, if there's a window where the migration applies before the new code is live:
- **Mitigation:** The renamed tables won't break old code immediately — Supabase client queries reference table names as strings, so old code querying `evolution_arena_topics` will get errors, but the Vercel deploy typically completes within 1-2 minutes of the push
- **If concerned:** Deploy code changes first in a PR that handles both old and new table names (backward-compatible), then apply migration, then remove backward compatibility. For this project, the simultaneous deploy is acceptable since this is a stage-only change initially

### Phase 3: Run all checks
```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test           # unit tests
npm run test:integration  # integration tests (real DB — verifies renamed tables)
npm run test:e2e       # E2E tests
```

### Phase 4: Update documentation
Update all docs listed in Documentation Updates section below.

### Phase 5: Deploy
1. Merge PR to main — triggers `supabase-migrations.yml` which applies migration to stage
2. Verify stage: run smoke test against stage DB confirming renamed tables work
3. Restart batch runner: `sudo systemctl start evolution-runner.timer`

### Rollback Strategy

**If migration fails mid-transaction:** Supabase auto-wraps migrations in a transaction — PostgreSQL rolls back automatically on any error. No manual intervention needed.

**If code deploy has issues after migration succeeds:** The migration is not reversible without a reverse migration. Create a rollback migration that:
```sql
-- Reverse renames
ALTER TABLE evolution_prompts RENAME TO evolution_arena_topics;
ALTER TABLE evolution_strategies RENAME TO evolution_strategy_configs;
ALTER TABLE evolution_runs RENAME COLUMN strategy_id TO strategy_config_id;
ALTER TABLE evolution_arena_entries RENAME COLUMN prompt_id TO topic_id;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN prompt_id TO topic_id;
-- Re-add dropped columns (data is lost)
ALTER TABLE evolution_arena_topics ADD COLUMN difficulty_tier TEXT;
ALTER TABLE evolution_arena_topics ADD COLUMN domain_tags TEXT[] NOT NULL DEFAULT '{}';
-- Reverse index renames
DROP INDEX IF EXISTS idx_runs_strategy;
DROP INDEX IF EXISTS idx_arena_entries_prompt;
DROP INDEX IF EXISTS idx_arena_entries_active;
DROP INDEX IF EXISTS idx_arena_comparisons_prompt;
CREATE INDEX idx_runs_strategy ON evolution_runs (strategy_config_id) WHERE strategy_config_id IS NOT NULL;
CREATE INDEX idx_arena_entries_topic ON evolution_arena_entries (topic_id, elo_rating DESC);
CREATE INDEX idx_arena_entries_active ON evolution_arena_entries (topic_id) WHERE archived_at IS NULL;
CREATE INDEX idx_arena_comparisons_topic ON evolution_arena_comparisons (topic_id, created_at DESC);
-- Recreate RPCs with old names (update_strategy_aggregates, sync_to_arena with p_topic_id)
```

**Note:** Column data for `difficulty_tier` and `domain_tags` cannot be recovered — but these are confirmed unused (no prod data populated). The dropped tables (`evolution_arena_elo`, `evolution_arena_batch_runs`) contained no data in V2 so no data loss. The `evolution_arena_elo` DROP is purely defensive/idempotent — the V2 migration already drops it.

### Batch Runner Coordination

The evolution batch runner on the minicomputer runs via systemd timer. During deployment:
1. **Before migration:** Stop timer and service, verify no runs are in `claimed` or `running` status
2. **After code + migration deployed:** Start timer
3. **If rollback needed:** Stop timer, apply reverse migration, revert code, start timer

## Testing

### Unit Tests (21 test files to update)
- All existing evolution unit tests must pass after renaming table/column references
- Remove tests for `difficulty_tier`/`domain_tags` from 5 test files
- Update mock data in all test files to use new table/column names
- Key test files for rename verification:
  - `evolution/src/lib/pipeline/arena.test.ts` — verify `p_prompt_id` parameter in sync_to_arena mock
  - `evolution/src/lib/pipeline/finalize.test.ts` — verify `strategy_id` (was `strategy_config_id`)
  - `evolution/src/lib/pipeline/runner.test.ts` — verify `.from('evolution_strategies')`
  - `evolution/src/services/strategyRegistryActionsV2.test.ts` — verify `.from('evolution_strategies')`
  - `evolution/src/services/arenaActions.test.ts` — verify `.from('evolution_prompts')`, no difficulty/domain

### Integration Tests
- `src/__tests__/integration/evolution-run-costs.integration.test.ts` — update table/column refs, verify against real DB
- Integration tests hit real DB — they confirm renamed tables/columns work end-to-end
- Specifically verify: prompt CRUD, strategy CRUD, experiment creation, run creation, arena sync
- Verify `sync_to_arena` RPC works with new `p_prompt_id` parameter name

### E2E Tests (3 spec files to update)
- `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` — update evolution_arena_topics refs, topic_id (20+ refs)
- `src/__tests__/e2e/specs/09-admin/admin-strategy-budget.spec.ts` — update strategy_config_id (10+ refs)
- `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` — update evolution_strategy_configs refs
- Verify prompt creation form no longer shows difficulty/domain fields
- Verify prompt detail page no longer shows difficulty/domain sections

### Pre-deploy Verification (local)
```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test           # all unit tests
npm run test:integration
npm run test:e2e
```

### Post-deploy Verification (stage)
After migration deploys to stage via CI:
1. Verify tables renamed: `SELECT * FROM evolution_prompts LIMIT 1`
2. Verify old tables gone: `SELECT * FROM evolution_arena_topics` should fail
3. Verify columns dropped: `SELECT difficulty_tier FROM evolution_prompts` should fail
4. Verify `evolution_arena_elo` gone: `SELECT * FROM evolution_arena_elo` should fail
5. Verify `evolution_arena_batch_runs` gone: `SELECT * FROM evolution_arena_batch_runs` should fail
6. Verify RPCs work: call `sync_to_arena` with `p_prompt_id` and `update_strategy_aggregates`
7. Start an experiment via admin UI to verify full flow
8. Restart batch runner and verify it claims a run successfully

## Documentation Updates
The following docs were identified as relevant and need updates:
- `evolution/docs/evolution/data_model.md` — Update table names, remove difficulty_tier/domain_tags from Prompt primitive, update entity diagram references, update dimensional model (remove "difficulty tier, domain tags" from attribute filters), update migration list
- `evolution/docs/evolution/reference.md` — Update database schema table listing, update RPC signatures (sync_to_arena parameter rename), remove evolution_arena_elo and evolution_arena_batch_runs references
- `evolution/docs/evolution/entity_diagram.md` — Update table names in entity boxes (`_evolution_arena_topics_` → `_evolution_prompts_`, `_evolution_strategy_configs_` → `_evolution_strategies_`), update FK labels
- `evolution/docs/evolution/arena.md` — Update table names in schema section, remove evolution_arena_elo references
- `evolution/docs/evolution/README.md` — Update any table name references
- `evolution/docs/evolution/experimental_framework.md` — Update any strategy_configs references
- `evolution/docs/evolution/visualization.md` — References evolution_arena_topics
- `evolution/docs/evolution/strategy_experiments.md` — References strategy_config_id
- `evolution/docs/evolution/cost_optimization.md` — References evolution_strategy_configs, strategy_config_id
- `docs/feature_deep_dives/admin_panel.md` — Update route descriptions if they reference table names
- `docs/docs_overall/architecture.md` — Update Database Schema section: rename tables, remove evolution_arena_elo from Arena Tables, update arena table descriptions
