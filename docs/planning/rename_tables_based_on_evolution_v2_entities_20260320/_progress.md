# Rename Tables Based on Evolution V2 Entities — Progress

## Phase 1: Migration SQL
### Work Done
- Created `supabase/migrations/20260320000001_rename_evolution_tables.sql`
- Drops stale tables (evolution_arena_elo, evolution_arena_batch_runs)
- Drops and recreates RPCs (update_strategy_aggregates, sync_to_arena)
- Renames tables (evolution_arena_topics → evolution_prompts, evolution_strategy_configs → evolution_strategies)
- Renames FK columns (strategy_config_id → strategy_id, topic_id → prompt_id)
- Drops difficulty_tier and domain_tags columns
- Recreates indexes with new column names

## Phase 2: Update TypeScript Code (42 files)
### Work Done
- Updated 24 files in evolution/src/ (pipeline, services, testing)
- Updated 14 files in src/ (UI components, E2E specs, integration tests)
- Updated 3 files in evolution/scripts/ (runner, local runner, test)
- Deleted evolution/scripts/backfill-strategy-config-id.ts (obsolete V1→V2 migration)

## Phase 3: Verification
### Work Done
- `npm run lint` — clean (warnings only, pre-existing)
- `npx tsc --noEmit` — clean (1 pre-existing expect-type error)
- `npm run build` — compiled successfully
- `npm run test` — 250/251 suites pass, 4191 tests pass (1 pre-existing failure)
- `npm run test:integration` — 3 failures expected (DB migration not yet applied)

## Phase 4: Documentation (12 docs)
### Work Done
- Updated evolution/docs/evolution/data_model.md, reference.md, entity_diagram.md, arena.md, architecture.md, visualization.md, strategy_experiments.md, cost_optimization.md
- Updated docs/feature_deep_dives/admin_panel.md
- Updated docs/docs_overall/architecture.md
- Verified no stale references remain in active docs

### Issues Encountered
- arenaBudgetFilter.test.ts had a topic_id reference that agents missed — fixed manually
- strategy.ts comment still referenced strategy_config_id — fixed manually
