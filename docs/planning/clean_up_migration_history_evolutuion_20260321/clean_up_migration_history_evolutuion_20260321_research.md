# Clean Up Migration History Evolution Research

## Problem Statement
The evolution migration history is corrupted. A V2 clean-slate migration (20260315) dropped and recreated all evolution tables, making ~48 prior migrations dead code. Subsequent migrations reference pre-rename table/column names, and the two environments (dev/staging vs prod) have diverged significantly. The goal is to create a single fresh migration that documents the current desired state of evolution tables.

## Requirements (from GH Issue #773)
Help me clean up my migration history for evolution data tables. Create a fresh migration that documents the current state of evolution tables in Supabase staging (dev).

## High Level Summary

### Environment Comparison

| Aspect | Dev/Staging (`ifubinffdbyewoezcidz`) | Prod (`qbxhivoezkfbjbsctdzo`) |
|--------|--------------------------------------|-------------------------------|
| Migration count | 113 | 125 (includes duplicates) |
| Last evolution migration | `20260321000002_consolidate_arena_into_variants` | `20260315000001_evolution_v2` |
| Table names | Renamed (`evolution_strategies`, `evolution_prompts`) | Old names (`evolution_strategy_configs`, `evolution_arena_topics`) |
| `evolution_arena_entries` | **DROPPED** (consolidated into variants) | **EXISTS** |
| `evolution_arena_batch_runs` | **DROPPED** | **EXISTS** |
| `evolution_budget_events` | **DROPPED** | **DROPPED** (by V2) |
| `evolution_variants` arena columns | Has 10 arena columns (mu, sigma, prompt_id, synced_to_arena, etc.) | Only original 11 columns |
| `evolution_runs.strategy_id` | Renamed, NOT NULL | Still `strategy_config_id`, NULLABLE |
| `evolution_runs.config` | **DROPPED** | **EXISTS** (JSONB) |
| `evolution_runs.budget_cap_usd` | EXISTS | **MISSING** |
| `evolution_runs.evolution_explanation_id` | **MISSING** | **MISSING** |
| `evolution_experiments.evolution_explanation_id` | **MISSING** | **MISSING** |
| `evolution_explanations.prompt_id` FK | FK to `explanations` only (FK to prompts LOST) | FK to `explanations` only |
| `sync_to_arena` RPC | Targets `evolution_variants` | Targets `evolution_arena_entries` |
| `update_strategy_aggregates` RPC | References `evolution_strategies` | References `evolution_strategy_configs` |
| RLS readonly_select policies | Only on `evolution_variants` | Unknown |
| Duplicate migration entries | None | Yes — 20260304000004-18 duplicate 20260224-20260304 |

### Dev/Staging: Current Evolution Tables (10 tables + 1 view)

1. `evolution_strategies` (renamed from `evolution_strategy_configs`)
2. `evolution_prompts` (renamed from `evolution_arena_topics`)
3. `evolution_experiments`
4. `evolution_runs`
5. `evolution_variants` (now includes arena columns)
6. `evolution_agent_invocations`
7. `evolution_run_logs`
8. `evolution_explanations`
9. `evolution_arena_comparisons` (FKs retargeted to `evolution_variants`)
10. `evolution_run_costs` (VIEW)

### Dev/Staging: Current RPCs (5 functions)

1. `claim_evolution_run(TEXT, UUID)`
2. `update_strategy_aggregates(UUID, NUMERIC, NUMERIC)`
3. `sync_to_arena(UUID, UUID, JSONB, JSONB)`
4. `cancel_experiment(UUID)`
5. `get_run_total_cost(UUID)`

### Dev/Staging: Current RLS Policies

| Table | deny_all | service_role_all | readonly_select |
|-------|----------|------------------|-----------------|
| evolution_strategies | Yes | Yes | No |
| evolution_prompts | Yes | Yes | No |
| evolution_experiments | Yes | Yes | No |
| evolution_runs | Yes | Yes | No |
| evolution_variants | Yes | Yes | Yes (service_role only — likely a bug, should be readonly_local) |
| evolution_agent_invocations | Yes | Yes | No |
| evolution_run_logs | Yes | Yes | No |
| evolution_arena_comparisons | Yes | Yes | No |

### Dev/Staging: Current Indexes

| Table | Indexes |
|-------|---------|
| evolution_agent_invocations | pkey, idx_invocations_run, idx_invocations_run_cost |
| evolution_arena_comparisons | pkey, idx_arena_comparisons_prompt |
| evolution_experiments | pkey, idx_experiments_status |
| evolution_explanations | pkey, idx_..._explanation_id, idx_..._prompt_id |
| evolution_prompts | evolution_arena_topics_pkey (old PK name), uq_arena_topic_prompt |
| evolution_run_logs | pkey, idx_logs_run_agent, idx_logs_run_created, idx_logs_run_iteration, idx_logs_run_level, idx_logs_run_variant |
| evolution_runs | pkey, idx_runs_archived, idx_runs_experiment, idx_runs_heartbeat_stale, idx_runs_pending_claim, idx_runs_strategy |
| evolution_strategies | evolution_strategy_configs_pkey (old PK name), uq_strategy_config_hash |
| evolution_variants | pkey, idx_variants_arena_active, idx_variants_arena_prompt, idx_variants_run, idx_variants_winner |

### Dev/Staging: `evolution_variants` Full Column List (21 columns)

| Column | Type | Nullable | Default | Origin |
|--------|------|----------|---------|--------|
| id | UUID | NO | gen_random_uuid() | Original |
| run_id | UUID | YES | | Original |
| explanation_id | INT | YES | | Original |
| variant_content | TEXT | NO | | Original |
| elo_score | NUMERIC | NO | 1200 | Original |
| generation | INT | NO | 0 | Original |
| parent_variant_id | UUID | YES | | Original |
| agent_name | TEXT | YES | | Original |
| match_count | INT | NO | 0 | Original |
| is_winner | BOOLEAN | NO | false | Original |
| created_at | TIMESTAMPTZ | NO | now() | Original |
| mu | NUMERIC | NO | 25 | Arena consolidation |
| sigma | NUMERIC | NO | 8.333 | Arena consolidation |
| prompt_id | UUID | YES | | Arena consolidation |
| synced_to_arena | BOOLEAN | NO | false | Arena consolidation |
| arena_match_count | INT | NO | 0 | Arena consolidation |
| generation_method | TEXT | YES | 'pipeline' | Arena consolidation |
| model | TEXT | YES | | Arena consolidation |
| cost_usd | NUMERIC | YES | | Arena consolidation |
| archived_at | TIMESTAMPTZ | YES | | Arena consolidation |
| evolution_explanation_id | UUID | YES | | Arena consolidation |

### Dev/Staging: `evolution_runs` Column List (15 columns)

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | UUID | NO | PK |
| explanation_id | INT | YES | Legacy |
| prompt_id | UUID | YES | FK → evolution_prompts |
| experiment_id | UUID | YES | FK → evolution_experiments |
| strategy_id | UUID | NO | FK → evolution_strategies (renamed from strategy_config_id) |
| status | TEXT | NO | |
| pipeline_version | TEXT | NO | |
| runner_id | TEXT | YES | |
| error_message | TEXT | YES | |
| run_summary | JSONB | YES | |
| last_heartbeat | TIMESTAMPTZ | YES | |
| archived | BOOLEAN | NO | |
| created_at | TIMESTAMPTZ | NO | |
| completed_at | TIMESTAMPTZ | YES | |
| budget_cap_usd | NUMERIC | YES | Added by config_into_db migration |

**Missing:** `evolution_explanation_id` (was added by 20260314 migration but lost when V2 dropped/recreated the table)

### Dev/Staging: `evolution_experiments` Column List (7 columns)

| Column | Type | Nullable |
|--------|------|----------|
| id | UUID | NO |
| name | TEXT | NO |
| prompt_id | UUID | YES |
| status | TEXT | NO |
| config | JSONB | YES |
| created_at | TIMESTAMPTZ | NO |
| updated_at | TIMESTAMPTZ | NO |

**Missing:** `evolution_explanation_id` (same issue as runs)

### Dev/Staging: `evolution_explanations` Column List (7 columns)

| Column | Type | Nullable | FK |
|--------|------|----------|-----|
| id | UUID | NO | PK |
| explanation_id | INT | YES | → explanations(id) |
| prompt_id | UUID | YES | **NO FK** (was → evolution_arena_topics, lost during V2 drop) |
| title | TEXT | NO | |
| content | TEXT | NO | |
| source | TEXT | NO | CHECK ('explanation','prompt_seed') |
| created_at | TIMESTAMPTZ | NO | |

### Prod: Tables Still on V2 Clean-Slate State

Prod stopped at `20260315000001_evolution_v2` — it has:
- Old table names: `evolution_strategy_configs`, `evolution_arena_topics`
- Old column names: `strategy_config_id` (nullable)
- `evolution_arena_entries` and `evolution_arena_batch_runs` still exist
- `evolution_runs.config` JSONB still exists
- No `budget_cap_usd` column
- No post-V2 migrations (readonly policies, rename, cost helpers, arena consolidation)
- **Duplicate migration entries** in schema_migrations (20260304000004-18 are copies of earlier migrations with different version numbers)

### Root Causes of Corruption

1. **V2 clean-slate didn't incorporate prior work**: The 20260314 migration added `evolution_explanations` and FK columns on runs/experiments. V2 (20260315) dropped and recreated `evolution_runs` and `evolution_experiments` WITHOUT these columns, losing the `evolution_explanation_id` FK permanently.

2. **Rename migration didn't cascade**: 20260320 renamed tables but didn't fix FKs on `evolution_explanations.prompt_id` (still orphaned) or recreate RLS policies that referenced old names.

3. **Budget events table dropped and never recreated**: 20260306 created it, V2 dropped it, no migration recreated it. Docs still reference it.

4. **Prod has duplicate migration entries**: Versions 20260304000004-18 are copies of 20260224-20260304 migrations with renumbered versions, suggesting a botched manual migration repair.

5. **Post-V2 migrations not deployed to prod**: Prod is stuck at V2 clean-slate. It's missing table renames, config-into-db, cost helpers, readonly policies, service_role RLS, and the arena consolidation.

6. **No idempotent desired-state migration**: Each migration assumes prior state, but the V2 wipe created a discontinuity that broke assumptions for everything between 20260306 and 20260314.

### FK Relationships in Dev (Actual)

```
evolution_runs.strategy_id → evolution_strategies.id
evolution_runs.prompt_id → evolution_prompts.id
evolution_runs.experiment_id → evolution_experiments.id
evolution_experiments.prompt_id → evolution_prompts.id
evolution_variants.run_id → evolution_runs.id
evolution_variants.prompt_id → evolution_prompts.id
evolution_variants.evolution_explanation_id → evolution_explanations.id
evolution_agent_invocations.run_id → evolution_runs.id
evolution_run_logs.run_id → evolution_runs.id
evolution_arena_comparisons.prompt_id → evolution_prompts.id
evolution_arena_comparisons.entry_a → evolution_variants.id
evolution_arena_comparisons.entry_b → evolution_variants.id
evolution_arena_comparisons.run_id → evolution_runs.id
evolution_explanations.explanation_id → explanations.id
evolution_explanations.prompt_id → (NO FK — orphaned)
```

### What the Fresh Migration Should Produce

A single migration that creates the dev/staging schema from scratch:
- 9 tables (strategies, prompts, experiments, runs, variants, agent_invocations, run_logs, explanations, arena_comparisons)
- 1 view (evolution_run_costs)
- 5 RPCs (claim_evolution_run, update_strategy_aggregates, sync_to_arena, cancel_experiment, get_run_total_cost)
- All indexes
- RLS policies (deny_all + service_role_all on all tables, readonly_select where appropriate)
- Fix the missing `evolution_explanation_id` on runs and experiments
- Fix the missing FK on `evolution_explanations.prompt_id`
- Use final/correct table and column names throughout

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/environments.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/rating_and_comparison.md

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql (V2 clean-slate)
- supabase/migrations/20260306000001_evolution_budget_events.sql
- supabase/migrations/20260314000002_create_evolution_explanations.sql
- supabase/migrations/20260318000001_evolution_readonly_select_policy.sql
- supabase/migrations/20260318000002_config_into_db.sql
- supabase/migrations/20260319000001_evolution_run_cost_helpers.sql
- supabase/migrations/20260320000001_rename_evolution_tables.sql
- supabase/migrations/20260321000001_evolution_service_role_rls.sql
- supabase/migrations/20260321000002_consolidate_arena_into_variants.sql

## Supabase Queries Run
- Dev: list_migrations, list_tables, columns for all evolution tables, FK constraints, indexes, RLS policies, RPC function bodies
- Prod: list_migrations, list_tables, columns for evolution_variants and evolution_runs
