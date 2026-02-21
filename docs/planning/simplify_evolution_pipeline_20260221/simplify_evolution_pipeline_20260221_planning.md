# Simplify Evolution Pipeline Plan

## Background
The evolution pipeline's database tables in staging and production are bloated and use inconsistent naming conventions. Tables are spread across multiple prefixes (`content_evolution_*`, `hall_of_fame_*`, `agent_*`, `batch_*`, `strategy_*`, `content_*`) making it hard to identify which tables belong to the evolution system. All evolution-specific tables should follow the `evolution_` prefix convention, and any stale or unused tables should be deleted.

## Requirements (from GH Issue #505)
1. All evolution-specific database tables must start with the `evolution_` prefix
2. Delete any stale or unused evolution tables
3. Rename tables that don't follow the convention via Supabase migrations
4. Update all TypeScript code references to use the new table names

## Problem
16 evolution-related tables are spread across 6 prefixes (`content_evolution_*`, `hall_of_fame_*`, `agent_*`, `batch_*`, `strategy_*`, `content_*`). Only 4 already use the correct `evolution_` prefix. FK constraint names still reference the old `article_bank_*` prefix from a previous rename. Four RPC functions hardcode old table names: `claim_evolution_run` (uses `RETURNS SETOF content_evolution_runs` and `%ROWTYPE`), `checkpoint_and_continue` (UPDATE on `content_evolution_runs`), `update_strategy_aggregates` (SELECT/UPDATE on `strategy_configs`), and `apply_evolution_winner` (INSERT INTO `content_history`, SELECT/UPDATE on `content_evolution_variants`). Three empty tables (`content_history`, `content_quality_scores`, `content_eval_runs`) belong to unreleased features and should be deleted along with their associated code.

## Table Dispositions

### Tables to Rename (9)
| Current Name | New Name | Rows | TS Files | FK Constraints |
|---|---|---|---|---|
| `content_evolution_runs` | `evolution_runs` | 56 | ~32 | 11 inbound |
| `content_evolution_variants` | `evolution_variants` | 364 | ~11 | 4 inbound |
| `hall_of_fame_topics` | `evolution_hall_of_fame_topics` | 2,016 | ~16 | 4 inbound |
| `hall_of_fame_entries` | `evolution_hall_of_fame_entries` | 36 | ~13 | 7 inbound |
| `hall_of_fame_comparisons` | `evolution_hall_of_fame_comparisons` | 230 | ~6 | 4 inbound |
| `hall_of_fame_elo` | `evolution_hall_of_fame_elo` | 34 | ~8 | 2 inbound |
| `strategy_configs` | `evolution_strategy_configs` | 1,970 | ~21 | 1 inbound |
| `batch_runs` | `evolution_batch_runs` | 5 | 1 | 1 inbound |
| `agent_cost_baselines` | `evolution_agent_cost_baselines` | 0 | 2 | 0 |

### Tables to Delete (3)
| Table | Rows | Reason |
|---|---|---|
| `content_history` | 0 | Apply-winner / rollback feature never used; removing the capability entirely |
| `content_quality_scores` | 0 | Part of unreleased Phase E quality eval, gated behind disabled feature flag |
| `content_eval_runs` | 0 | Coupled to Phase E quality eval system above |

### Tables Already Correct (4, no changes)
| Name | Rows |
|---|---|
| `evolution_checkpoints` | 889 |
| `evolution_run_agent_metrics` | 15 |
| `evolution_run_logs` | 4,622 |
| `evolution_agent_invocations` | 202 |

## Deployment Strategy

### Two-PR Approach for Zero Downtime + CI Compatibility

Integration tests in CI run against the staging DB **before merge**. If we rename `.from()` calls and apply the migration in the same PR, integration tests would call `.from('evolution_runs')` against staging where `evolution_runs` doesn't exist yet → 42P01 errors → PR blocked. To avoid this, we split the work into two PRs:

**PR 1 (this branch): Migration only**
- Supabase migration file: renames, drops, RPCs, constraints, backward-compatible views
- No TS/TSX code changes (old `.from()` calls keep working via the views)
- CI passes because integration tests still use old table names against staging (unchanged)
- After merge: migration runs, tables renamed, views created → old code works via views

**PR 2 (follow-up branch): Code rename + cleanup**
- All TS/TSX `.from()` renames (Phase 3 below)
- Dead code removal (Phase 2 below)
- Documentation updates (Phase 4 below)
- CI passes because staging now has both old names (views) and new names (tables)
- **Prerequisite**: PR 1 must be merged and migration confirmed applied to staging

**PR 3 (cleanup branch): Drop backward-compatible views**
- Single migration that drops the 9 views (Phase 5 below)
- **Prerequisite**: PR 2 must be merged and Vercel deploy confirmed live and healthy
- Must NOT be merged until PR 2's code is serving on all Vercel instances

### Backward-Compatible Views

The migration creates **backward-compatible views** with the old table names that alias to the new tables. PostgreSQL simple views (`SELECT * FROM single_table`) are auto-updatable — INSERT/UPDATE/DELETE pass through transparently. PostgREST/Supabase client treats them identically to tables. This ensures:
1. Old running code (during Vercel deploy window) works via views
2. PR 2's integration tests work because staging has both names

The migration ends with `NOTIFY pgrst, 'reload schema'` to force PostgREST to refresh its schema cache immediately (rather than waiting up to ~60 seconds).

### Pre-Migration Safety: Ensure No Active Runs

Before merging PR 1, verify no evolution runs are in `running` or `continuation_pending` status. The `evolution-batch.yml` workflow runs Monday 4am UTC and can be manually triggered. If a batch run is in progress, its hardcoded table names in PL/pgSQL RPCs will fail mid-execution. **Merge only when no runs are active.**

Check via Supabase MCP or direct query:
```sql
SELECT id, status FROM content_evolution_runs WHERE status IN ('running', 'continuation_pending', 'claimed');
```

## Phased Execution Plan

### Phase 1: Single Supabase Migration (Renames + Drops + RPCs + Constraints + Views) — PR 1

All database changes in **one migration file** for atomicity. Supabase runs each migration file in its own transaction (except statements that require `CONCURRENTLY`). Consolidating all DB changes prevents intermediate states where the database is partially migrated. **This is the only change in PR 1** — no TS/TSX code changes.

**Migration contents:**
```sql
-- ============================================================
-- Part A: Rename tables
-- ============================================================
ALTER TABLE IF EXISTS content_evolution_runs RENAME TO evolution_runs;
ALTER TABLE IF EXISTS content_evolution_variants RENAME TO evolution_variants;
ALTER TABLE IF EXISTS hall_of_fame_topics RENAME TO evolution_hall_of_fame_topics;
ALTER TABLE IF EXISTS hall_of_fame_entries RENAME TO evolution_hall_of_fame_entries;
ALTER TABLE IF EXISTS hall_of_fame_comparisons RENAME TO evolution_hall_of_fame_comparisons;
ALTER TABLE IF EXISTS hall_of_fame_elo RENAME TO evolution_hall_of_fame_elo;
ALTER TABLE IF EXISTS strategy_configs RENAME TO evolution_strategy_configs;
ALTER TABLE IF EXISTS batch_runs RENAME TO evolution_batch_runs;
ALTER TABLE IF EXISTS agent_cost_baselines RENAME TO evolution_agent_cost_baselines;

-- ============================================================
-- Part B: Drop dead-code RPC (references content_history which is being dropped)
-- ============================================================
DROP FUNCTION IF EXISTS apply_evolution_winner(integer, uuid, uuid, uuid);

-- ============================================================
-- Part C: Drop unused tables (order matters: content_quality_scores has FK to content_eval_runs)
-- ============================================================
DROP TABLE IF EXISTS content_history;
DROP TABLE IF EXISTS content_quality_scores;
DROP TABLE IF EXISTS content_eval_runs;

-- ============================================================
-- Part D: Recreate RPCs with new table names
-- Must DROP + RECREATE (not just CREATE OR REPLACE) because:
-- - claim_evolution_run: RETURNS SETOF and %ROWTYPE reference the old table name in signature
-- - checkpoint_and_continue: UPDATE references old name as string literal in PL/pgSQL
-- - update_strategy_aggregates: SELECT/UPDATE on strategy_configs (now evolution_strategy_configs)
-- ============================================================

-- D.0: Drop stale 6-arg overload of checkpoint_and_continue if it exists
-- (Migration 20260216000001 created 6-arg version, 20260220000001 added 7-arg overload.
-- CREATE OR REPLACE with different arg count creates a new function, not a replacement.)
DROP FUNCTION IF EXISTS checkpoint_and_continue(UUID, INT, TEXT, JSONB, INT, NUMERIC);

-- D.1: claim_evolution_run — full DROP+RECREATE (signature changes from RETURNS SETOF content_evolution_runs → evolution_runs)
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run evolution_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
  ORDER BY
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN NEXT v_run;
END;
$$;

-- D.2: checkpoint_and_continue — CREATE OR REPLACE (signature unchanged, body references new table)
CREATE OR REPLACE FUNCTION checkpoint_and_continue(
  p_run_id UUID,
  p_iteration INT,
  p_phase TEXT,
  p_state_snapshot JSONB,
  p_pool_length INT DEFAULT 0,
  p_total_cost_usd NUMERIC DEFAULT NULL,
  p_last_agent TEXT DEFAULT 'iteration_complete'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO evolution_checkpoints (run_id, iteration, phase, last_agent, state_snapshot, created_at)
  VALUES (p_run_id, p_iteration, p_phase, p_last_agent, p_state_snapshot, NOW())
  ON CONFLICT (run_id, iteration, last_agent)
  DO UPDATE SET state_snapshot = EXCLUDED.state_snapshot,
               phase = EXCLUDED.phase,
               created_at = NOW();

  UPDATE evolution_runs
  SET status = 'continuation_pending',
      runner_id = NULL,
      continuation_count = continuation_count + 1,
      current_iteration = p_iteration,
      phase = p_phase,
      last_heartbeat = NOW(),
      runner_agents_completed = p_pool_length,
      total_cost_usd = COALESCE(p_total_cost_usd, total_cost_usd)
  WHERE id = p_run_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % is not in running status, cannot transition to continuation_pending', p_run_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- D.3: update_strategy_aggregates — CREATE OR REPLACE (signature unchanged, body references new table)
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
BEGIN
  SET LOCAL statement_timeout = '5s';

  SELECT run_count, total_cost_usd, avg_final_elo, best_final_elo, worst_final_elo
  INTO v_stats
  FROM evolution_strategy_configs
  WHERE id = p_strategy_id
  FOR UPDATE;

  UPDATE evolution_strategy_configs SET
    run_count = COALESCE(v_stats.run_count, 0) + 1,
    total_cost_usd = COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd,
    avg_final_elo = (COALESCE(v_stats.avg_final_elo * v_stats.run_count, 0) + p_final_elo) / (COALESCE(v_stats.run_count, 0) + 1),
    avg_elo_per_dollar = CASE
      WHEN COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd > 0
      THEN ((COALESCE(v_stats.avg_final_elo * v_stats.run_count, 0) + p_final_elo) / (COALESCE(v_stats.run_count, 0) + 1) - 1200)
           / (COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd)
      ELSE NULL
    END,
    best_final_elo = GREATEST(COALESCE(v_stats.best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(v_stats.worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = NOW()
  WHERE id = p_strategy_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Part E: Rename FK constraints (old article_bank_* prefix → evolution_*)
-- ============================================================
ALTER TABLE IF EXISTS evolution_hall_of_fame_entries
  RENAME CONSTRAINT article_bank_entries_evolution_run_id_fkey
  TO evolution_hall_of_fame_entries_evolution_run_id_fkey;

ALTER TABLE IF EXISTS evolution_hall_of_fame_entries
  RENAME CONSTRAINT article_bank_entries_topic_id_fkey
  TO evolution_hall_of_fame_entries_topic_id_fkey;

ALTER TABLE IF EXISTS evolution_hall_of_fame_comparisons
  RENAME CONSTRAINT article_bank_comparisons_topic_id_fkey
  TO evolution_hall_of_fame_comparisons_topic_id_fkey;

ALTER TABLE IF EXISTS evolution_hall_of_fame_elo
  RENAME CONSTRAINT article_bank_elo_topic_id_fkey
  TO evolution_hall_of_fame_elo_topic_id_fkey;

-- ============================================================
-- Part F: Backward-compatible views (old names → new tables)
-- These keep old code working during the Vercel deploy window.
-- Will be dropped in a follow-up migration after code deploy is confirmed.
-- ============================================================
CREATE OR REPLACE VIEW content_evolution_runs AS SELECT * FROM evolution_runs;
CREATE OR REPLACE VIEW content_evolution_variants AS SELECT * FROM evolution_variants;
CREATE OR REPLACE VIEW hall_of_fame_topics AS SELECT * FROM evolution_hall_of_fame_topics;
CREATE OR REPLACE VIEW hall_of_fame_entries AS SELECT * FROM evolution_hall_of_fame_entries;
CREATE OR REPLACE VIEW hall_of_fame_comparisons AS SELECT * FROM evolution_hall_of_fame_comparisons;
CREATE OR REPLACE VIEW hall_of_fame_elo AS SELECT * FROM evolution_hall_of_fame_elo;
CREATE OR REPLACE VIEW strategy_configs AS SELECT * FROM evolution_strategy_configs;
CREATE OR REPLACE VIEW batch_runs AS SELECT * FROM evolution_batch_runs;
CREATE OR REPLACE VIEW agent_cost_baselines AS SELECT * FROM evolution_agent_cost_baselines;

-- ============================================================
-- Part G: Force PostgREST schema cache refresh
-- Without this, PostgREST may take up to ~60s to see the new views.
-- ============================================================
NOTIFY pgrst, 'reload schema';
```

**Note on CHECK constraints and indexes**: Named CHECK constraints (e.g., `content_evolution_runs_status_check`) and indexes (e.g., `idx_batch_runs_status`) retain their old names after ALTER TABLE RENAME. These still function correctly. Renaming them is cosmetic and deferred as acceptable tech debt — they can be cleaned up in a future PR.

**Note on RLS**: No RLS policies exist on any evolution tables (confirmed: migration 20260201000001 says "No RLS: admin-only access via service client"). Not a concern.

**Note on Supabase Realtime**: No realtime subscriptions reference evolution tables (no `.subscribe()` or `.channel()` calls found). Not a concern.

### Phase 2: Remove Deleted-Table Code (content_history, content_quality_scores, content_eval_runs) — PR 2

**Apply winner / rollback / content history removal:**
| File | Changes |
|---|---|
| `evolution/src/services/evolutionActions.ts` | Delete `ContentHistoryRow` interface (~56-63), `applyWinnerAction` (~424-511), `getEvolutionHistoryAction` (~754-788), `rollbackEvolutionAction` (~792-864), `triggerPostEvolutionEval` (~868-894) |
| `src/app/admin/quality/evolution/page.tsx` | Remove imports (`applyWinnerAction`, `getEvolutionHistoryAction`, `rollbackEvolutionAction`), delete `handleApplyWinner` (~700-724), `handleRollback` (~726-760), and any UI buttons calling them |
| `src/lib/services/auditLog.ts` | Remove `'rollback_evolution'` from action type union (~28) |

**Phase E quality eval removal:**
| File | Changes |
|---|---|
| `src/lib/services/contentQualityActions.ts` | Delete `getEvolutionComparisonAction` (~242-320) and `EvolutionComparison` interface (~231-240) |
| `src/lib/services/contentQualityEval.ts` | Delete `evaluateAndSaveContentQuality` (writes to `content_quality_scores`) and `runContentQualityBatch` (writes to `content_eval_runs`) |
| `src/app/api/cron/content-quality-eval/route.ts` | Delete entire file (cron gated behind disabled feature flag) |
| `vercel.json` | Remove cron entry: `{ "path": "/api/cron/content-quality-eval", "schedule": "0 */6 * * *" }` |

**Test files:**
| File | Changes |
|---|---|
| `evolution/src/services/evolutionActions.test.ts` | Remove `getEvolutionHistoryAction` and `rollbackEvolutionAction` test suites |
| `src/lib/services/contentQualityActions.test.ts` | Remove `getEvolutionComparisonAction` describe block |
| `src/__tests__/integration/evolution-actions.integration.test.ts` | Remove apply winner, rollback, and comparison tests; remove `content_history` references |

**Test helpers:**
| File | Changes |
|---|---|
| `evolution/src/testing/evolution-test-helpers.ts` | Remove `content_history` cleanup line (~95) and `content_quality_scores` cleanup line (~94); update `evolutionTablesExist()` helper to query `evolution_runs` instead of `content_evolution_runs` |

### Phase 3: Update All TS/TSX References to Renamed Tables — PR 2
Find-and-replace old table name strings in `.from('...')` calls across all TS/TSX files. Estimated ~100+ replacements across ~50 files. Key renames:
- `content_evolution_runs` → `evolution_runs` (~32 files)
- `content_evolution_variants` → `evolution_variants` (~11 files)
- `hall_of_fame_topics` → `evolution_hall_of_fame_topics` (~16 files)
- `hall_of_fame_entries` → `evolution_hall_of_fame_entries` (~13 files)
- `hall_of_fame_comparisons` → `evolution_hall_of_fame_comparisons` (~6 files)
- `hall_of_fame_elo` → `evolution_hall_of_fame_elo` (~8 files)
- `strategy_configs` → `evolution_strategy_configs` (~21 files)
- `batch_runs` → `evolution_batch_runs` (~1 file)
- `agent_cost_baselines` → `evolution_agent_cost_baselines` (~2 files)

**Note on ambiguous names**: `batch_runs` and `strategy_configs` are generic names. Codebase grep confirms all occurrences of these strings in `.from()` calls are evolution-only — no non-evolution usages exist.

### Phase 4: Update Documentation — PR 2
Update table name references in all 15 evolution docs (see Documentation Updates below).

### Phase 5: Drop Backward-Compatible Views — PR 3 (separate PR, merge after PR 2 deploy is confirmed live)
**WARNING**: This MUST NOT be in PR 2. Supabase migrations run independently and complete ~1 min after merge, but Vercel code deploy takes 2-3 min. If views drop before new code is live, old Vercel instances hit 42P01 errors. Phase 5 goes in a **separate PR 3**, merged only after PR 2's Vercel deployment is confirmed healthy.
```sql
DROP VIEW IF EXISTS content_evolution_runs;
DROP VIEW IF EXISTS content_evolution_variants;
DROP VIEW IF EXISTS hall_of_fame_topics;
DROP VIEW IF EXISTS hall_of_fame_entries;
DROP VIEW IF EXISTS hall_of_fame_comparisons;
DROP VIEW IF EXISTS hall_of_fame_elo;
DROP VIEW IF EXISTS strategy_configs;
DROP VIEW IF EXISTS batch_runs;
DROP VIEW IF EXISTS agent_cost_baselines;
```

## CI Strategy

The three-PR approach eliminates all timing issues:

**PR 1 (migration only):**
- Contains only the migration SQL file — no TS/TSX changes
- CI unit tests: pass (no code changes to break)
- CI integration tests: pass (staging still has old table names, no `.from()` calls changed)
- After merge: migration runs → tables renamed + views created → staging has both old names (views) and new names (tables)

**PR 2 (code rename + cleanup):**
- Changes `.from('content_evolution_runs')` → `.from('evolution_runs')` etc.
- CI unit tests: pass (mocked DB, no real table lookups)
- CI integration tests: pass (staging now has `evolution_runs` as a real table, thanks to PR 1's migration)
- **Must not be opened/merged until PR 1 is merged and migration confirmed**

**PR 3 (view drop):**
- Single migration dropping 9 backward-compatible views
- CI unit tests: pass (no code changes)
- CI integration tests: pass (code already uses new table names from PR 2)
- **Must not be merged until PR 2's Vercel deploy is confirmed live** — otherwise old code hits 42P01

## Rollback Plan

### If migration causes issues after deployment:
```sql
-- Reverse migration (apply manually via Supabase dashboard if needed)

-- Drop backward-compatible views first
DROP VIEW IF EXISTS content_evolution_runs;
DROP VIEW IF EXISTS content_evolution_variants;
DROP VIEW IF EXISTS hall_of_fame_topics;
DROP VIEW IF EXISTS hall_of_fame_entries;
DROP VIEW IF EXISTS hall_of_fame_comparisons;
DROP VIEW IF EXISTS hall_of_fame_elo;
DROP VIEW IF EXISTS strategy_configs;
DROP VIEW IF EXISTS batch_runs;
DROP VIEW IF EXISTS agent_cost_baselines;

-- Reverse renames
ALTER TABLE IF EXISTS evolution_runs RENAME TO content_evolution_runs;
ALTER TABLE IF EXISTS evolution_variants RENAME TO content_evolution_variants;
ALTER TABLE IF EXISTS evolution_hall_of_fame_topics RENAME TO hall_of_fame_topics;
ALTER TABLE IF EXISTS evolution_hall_of_fame_entries RENAME TO hall_of_fame_entries;
ALTER TABLE IF EXISTS evolution_hall_of_fame_comparisons RENAME TO hall_of_fame_comparisons;
ALTER TABLE IF EXISTS evolution_hall_of_fame_elo RENAME TO hall_of_fame_elo;
ALTER TABLE IF EXISTS evolution_strategy_configs RENAME TO strategy_configs;
ALTER TABLE IF EXISTS evolution_batch_runs RENAME TO batch_runs;
ALTER TABLE IF EXISTS evolution_agent_cost_baselines RENAME TO agent_cost_baselines;

-- Reverse FK constraint renames
ALTER TABLE IF EXISTS hall_of_fame_entries
  RENAME CONSTRAINT evolution_hall_of_fame_entries_evolution_run_id_fkey
  TO article_bank_entries_evolution_run_id_fkey;
ALTER TABLE IF EXISTS hall_of_fame_entries
  RENAME CONSTRAINT evolution_hall_of_fame_entries_topic_id_fkey
  TO article_bank_entries_topic_id_fkey;
ALTER TABLE IF EXISTS hall_of_fame_comparisons
  RENAME CONSTRAINT evolution_hall_of_fame_comparisons_topic_id_fkey
  TO article_bank_comparisons_topic_id_fkey;
ALTER TABLE IF EXISTS hall_of_fame_elo
  RENAME CONSTRAINT evolution_hall_of_fame_elo_topic_id_fkey
  TO article_bank_elo_topic_id_fkey;

-- Recreate RPCs with old table names (restore from migration files 20260214000001, 20260215000003, 20260216000001, 20260220000001)
-- NOTE: apply_evolution_winner RPC is NOT restored (it was dead code before this change)

-- NOTE: Dropped tables (content_history, content_quality_scores, content_eval_runs)
-- cannot be restored as they were empty (0 rows). Recreate with schema from original migrations if needed.
```

### If code deploy fails but migration succeeds:
No action needed — the backward-compatible views ensure old code works against the new schema.

## Testing
- **Type check**: `npx tsc --noEmit` — catches any broken imports from deleted exports
- **Lint**: `npm run lint` — catches unused imports
- **Unit tests**: `npm run test:unit` — verifies deleted test suites don't break remaining tests
- **Integration tests**: `npm run test:integration` — verifies renamed table references work against DB
- **Build**: `npm run build` — full Next.js build
- **Local migration dry-run**: `supabase db reset` to verify migration SQL is valid before push
- **Manual verification**: After migration applied to staging, verify via Supabase MCP that:
  - All 9 tables renamed correctly
  - 3 deleted tables no longer exist
  - FK constraints updated
  - RPCs reference new table names
  - 9 backward-compatible views exist with old names
- **Note on generated types**: The project does not use `supabase gen types` (no `database.types.ts` file). Table names are raw string literals in `.from()` calls. No type regeneration needed.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` - may need table name references updated
- `evolution/docs/evolution/architecture.md` - references table names in data flow
- `evolution/docs/evolution/data_model.md` - core data model table references
- `evolution/docs/evolution/agents/overview.md` - agent interaction table references
- `evolution/docs/evolution/agents/generation.md` - agent key files section
- `evolution/docs/evolution/agents/editing.md` - agent key files section
- `evolution/docs/evolution/agents/tree_search.md` - agent key files section
- `evolution/docs/evolution/agents/support.md` - agent key files section
- `evolution/docs/evolution/agents/flow_critique.md` - agent key files section
- `evolution/docs/evolution/rating_and_comparison.md` - rating system table references
- `evolution/docs/evolution/cost_optimization.md` - cost tracking table references
- `evolution/docs/evolution/hall_of_fame.md` - hall of fame table references
- `evolution/docs/evolution/strategy_experiments.md` - experiment state references
- `evolution/docs/evolution/visualization.md` - visualization server action references
- `evolution/docs/evolution/reference.md` - database schema section with all table names
