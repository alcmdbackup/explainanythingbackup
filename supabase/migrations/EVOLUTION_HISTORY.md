# Evolution Migration History
<!-- Updated 2026-03-22 -->

## Why are evolution migration files missing?

The evolution schema went through multiple phases:

1. **V1** (20260131–20260314): ~48 migrations creating the original evolution pipeline tables
2. **V2 Clean Slate** (20260315): Dropped ALL V1 evolution tables and recreated from scratch
3. **Renames & Consolidation** (20260318–20260321): Renamed tables/columns, consolidated `evolution_arena_entries` into `evolution_variants`
4. **Fresh Schema** (20260322000001): Idempotent staging documentation migration
5. **Prod Convergence** (20260322000002): Converges prod to match staging

All pre-20260322 evolution migration files have been **deleted from the repo** because they are fully superseded by the fresh schema and prod convergence migrations. The version numbers still exist in `supabase_migrations.schema_migrations` on both environments — this is expected and correct.

## Current source of truth

- `20260322000001_evolution_fresh_schema.sql` — Documents staging state (staging no-op)
- `20260322000002_evolution_prod_convergence.sql` — Converges prod to match staging

## Tables (post-convergence)

9 tables + 1 view:
- `evolution_strategies` (was `evolution_strategy_configs`)
- `evolution_prompts` (was `evolution_arena_topics`)
- `evolution_experiments`
- `evolution_runs`
- `evolution_variants` (includes arena columns, replaces `evolution_arena_entries`)
- `evolution_agent_invocations`
- `evolution_run_logs`
- `evolution_explanations`
- `evolution_arena_comparisons`
- `evolution_run_costs` (VIEW)

## Deleted tables

- `evolution_arena_entries` — consolidated into `evolution_variants` with `synced_to_arena` flag
- `evolution_arena_batch_runs` — unused rate-limiting table
- `evolution_budget_events` — dropped during V2, never recreated
- `evolution_checkpoints` — V1 checkpoint system, replaced by atomic V2 execution
- Various other V1 tables (agent_cost_baselines, run_agent_metrics, etc.)

## `supabase db reset` caveat

After deleting old migration files, `supabase db reset` on a fresh local database will fail because the fresh schema migration depends on prior migrations having created tables. Use the remote dev database for testing instead.
