# Scan Evolution Stage Prod Issues Research

## Problem Statement
Scan the evolution pipeline for discrepancies and bugs between staging and production environments, investigate failures, and fix identified issues.

## Requirements (from GH Issue #735)
Look for mismatches between tables in production and stage, and what the code is relying on for evolution. Use prod supabase query tool to query production. Otherwise, look for any/all types of bugs that could result from our recent migration to evolution V2.

## High Level Summary

The V2 migration (20260315000001) dropped 16 V1 tables and recreated 10 clean V2 tables. The V2 runner, finalize, and arena code paths are clean. However, **extensive stale V1 references remain in services, tests, scripts, and UI code** that will cause runtime errors, test failures, and silent data degradation.

Key categories of issues:
1. **Active code querying dropped tables** (costEstimator, experimentActions)
2. **Column mismatches** between V2 schema and code (evolution_runs missing ~10 columns code expects, arena_entries using wrong column names)
3. **Invalid status values** (paused, continuation_pending) in types and queries
4. **Broken tests** referencing dropped tables (arena integration, E2E visualization, budget events)
5. **Deferred scripts** referencing dropped evolution_arena_elo table

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/flow_critique.md

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql - V2 migration (full schema)
- evolution/src/lib/core/costEstimator.ts - queries dropped evolution_agent_cost_baselines
- evolution/src/services/experimentActions.ts - queries dropped evolution_run_agent_metrics
- evolution/src/services/evolutionRunnerCore.ts - references continuation_count, continuation_pending
- evolution/src/services/evolutionActions.ts - references continuation_pending, missing columns
- evolution/src/services/evolutionVisualizationActions.ts - references multiple missing columns
- evolution/src/services/arenaActions.ts - wrong column names for arena_entries/comparisons
- evolution/src/lib/types.ts - EvolutionRunStatus includes invalid statuses
- evolution/src/components/evolution/EvolutionStatusBadge.tsx - renders invalid statuses
- src/app/admin/evolution/runs/page.tsx - UI filter for continuation_pending
- evolution/src/testing/evolution-test-helpers.ts - creates checkpoints in dropped table
- src/__tests__/integration/arena-actions.integration.test.ts - references evolution_arena_elo
- src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts - seeds checkpoints
- src/__tests__/e2e/specs/09-admin/admin-budget-events.spec.ts - references budget_events
- evolution/src/lib/v2/runner.ts - V2 runner (CLEAN)
- evolution/src/lib/v2/finalize.ts - V2 finalize (CLEAN)
- evolution/src/lib/v2/arena.ts - V2 arena (CLEAN)
- evolution/scripts/evolution-runner.ts - main batch runner (CLEAN)
- evolution/scripts/deferred/ - 4 scripts with evolution_arena_elo refs
- scripts/query-elo-baselines.ts - joins against dropped table

## Key Findings

### V2 Schema (10 Tables)
1. evolution_strategy_configs
2. evolution_arena_topics
3. evolution_experiments (simplified: id, name, prompt_id, status, config, created_at, updated_at)
4. evolution_runs (simplified: id, explanation_id, prompt_id, experiment_id, strategy_config_id, config, status, pipeline_version, runner_id, error_message, run_summary, last_heartbeat, archived, created_at, completed_at)
5. evolution_variants
6. evolution_agent_invocations
7. evolution_run_logs
8. evolution_arena_entries (mu/sigma/elo_rating merged in, no separate elo table)
9. evolution_arena_comparisons (simplified: winner is TEXT 'a'/'b'/'draw')
10. evolution_arena_batch_runs

### V2 Status CHECK Constraints
- evolution_runs: pending, claimed, running, completed, failed, cancelled
- evolution_experiments: draft, running, completed, cancelled, archived
- evolution_strategy_configs: active, archived
- evolution_arena_topics: active, archived

### V2 RPCs (4 core + 4 from earlier migrations)
- claim_evolution_run (V2) - ✓ callers match
- update_strategy_aggregates (V2) - ✓ callers match
- sync_to_arena (V2) - ✓ callers match
- cancel_experiment (V2) - ✓ callers match
- archive_experiment, unarchive_experiment, get_non_archived_runs, compute_run_variant_stats - ✓ all match

---

## CRITICAL Issues (Runtime Errors in Production)

### C1. costEstimator.ts queries dropped `evolution_agent_cost_baselines`
- **Lines**: 97, 382
- **Functions**: getAgentBaseline(), refreshAgentCostBaselines()
- **Impact**: Silent fallback to heuristics — cost estimates less accurate but no crash
- **Call chain**: estimateRunCostWithAgentModels() → estimateAgentCost() → getAgentBaseline()

### C2. experimentActions.ts queries dropped `evolution_run_agent_metrics`
- **Line**: 308
- **Function**: regenerateExperimentReportAction()
- **Impact**: Reports generate but with empty agent metrics — silent degradation

### C3. evolution_runs missing ~10 columns code expects
Code inserts/selects columns NOT in V2 schema:
- budget_cap_usd (INSERT in evolutionActions.ts:330)
- estimated_cost_usd (INSERT in evolutionActions.ts:331)
- cost_estimate_detail (INSERT in evolutionActions.ts:332)
- evolution_explanation_id (INSERT in evolutionActions.ts:335)
- total_cost_usd (SELECT in multiple files)
- cost_prediction (SELECT in visualizationActions.ts:539)
- current_iteration (SELECT in visualizationActions.ts:266,607)
- started_at (SELECT in visualizationActions.ts:539)
- continuation_count (SELECT in evolutionRunnerCore.ts:70)

### C4. evolution_experiments missing ~9 columns code expects
Code selects: optimization_target, total_budget_usd, spent_usd, convergence_threshold, factor_definitions, results_summary, error_message, design, analysis_results
- None exist in V2 (experiments table only has: id, name, prompt_id, status, config, created_at, updated_at)

### C5. arenaActions.ts uses wrong column names for arena_entries
- Uses `total_cost_usd` instead of `cost_usd`
- Uses `deleted_at` instead of `archived_at`
- Uses `metadata` (doesn't exist)
- Uses `evolution_run_id`/`evolution_variant_id` instead of `run_id`/`variant_id`

### C6. arenaActions.ts uses wrong column names for arena_comparisons
- Uses `entry_a_id`/`entry_b_id` instead of `entry_a`/`entry_b`
- Uses `winner_id` (UUID) instead of `winner` (TEXT: 'a'/'b'/'draw')
- Uses `judge_model`/`dimension_scores` (don't exist)

### C7. Invalid status values in EvolutionRunStatus type
- `paused` — not in V2 CHECK constraint
- `continuation_pending` — not in V2 CHECK constraint
- Referenced in: types.ts:639, EvolutionStatusBadge.tsx, runs/page.tsx, evolutionRunnerCore.ts:145, evolutionVisualizationActions.ts:261

---

## HIGH Issues (Test Failures)

### H1. arena-actions.integration.test.ts references dropped evolution_arena_elo
- 10+ references inserting/querying/deleting from dropped table
- Tests 3, 4, 5, 8, 9 will all fail
- No try/catch, not skip-gated

### H2. admin-evolution-visualization.spec.ts seeds into dropped evolution_checkpoints
- All 7 E2E tests fail because beforeAll seed fails
- No error handling on insert

### H3. evolution-test-helpers.ts references dropped evolution_checkpoints
- createTestCheckpoint() inserts into dropped table
- cleanupEvolutionData() deletes from dropped table

### H4. admin-budget-events.spec.ts references dropped evolution_budget_events
- Gracefully handled with skip-gate — only Test 2 skipped

---

## MEDIUM Issues (Silent Degradation / Dead Code)

### M1. Visualization placeholder actions return empty data
- getEvolutionRunStepScoresAction returns `{ data: [] }` (step scores were in checkpoints)
- getEvolutionRunTreeSearchAction returns `{ data: { trees: [] } }` (tree search state was in checkpoints)

### M2. Deferred scripts reference dropped evolution_arena_elo
- evolution/scripts/deferred/run-arena-comparison.ts
- evolution/scripts/deferred/run-bank-comparison.ts
- evolution/scripts/deferred/run-prompt-bank-comparisons.ts
- evolution/scripts/deferred/lib/arenaUtils.ts
- scripts/query-elo-baselines.ts

### M3. Feature flags in DB may differ between stage and prod
- evolution_tournament_enabled, evolution_evolve_pool_enabled, evolution_dry_run_only, evolution_tree_search_enabled, evolution_flow_critique_enabled
- Each stored per-environment in feature_flags table
- Need to verify prod flags match expected state

### M4. Documentation references V1 tables/concepts
- evolution/docs/evolution/architecture.md references checkpoint system
- evolution/docs/evolution/reference.md references dropped tables
- evolution/docs/evolution/cost_optimization.md references evolution_budget_events

## Scope Split: V1 Admin UI Deprecation (Separate PR)

A separate PR is handling V1 evolution admin UI deprecation. The following items are **OUT OF SCOPE** for this project and will be addressed there:

### Out of Scope (handled by UI deprecation PR):
- **C5-C6**: arenaActions.ts wrong column names (serves V1 admin UI)
- **C7 (UI parts)**: EvolutionStatusBadge.tsx, runs/page.tsx status rendering
- **M1**: Visualization placeholder actions (serve V1 admin UI tabs)
- **H2**: admin-evolution-visualization.spec.ts E2E tests (V1 admin pages)
- **H4**: admin-budget-events.spec.ts E2E tests (V1 admin page)
- **M4**: Documentation updates for V1 concepts (will be rewritten for V2)
- V1 admin page components under src/app/admin/evolution/

### In Scope (this project):
- **C1**: costEstimator.ts dropped table query (backend, affects pipeline cost estimation)
- **C2**: experimentActions.ts dropped table query (backend, affects experiment reports)
- **C3**: evolution_runs missing columns in evolutionActions.ts INSERT (backend, affects run queueing)
- **C4**: evolution_experiments missing columns in experimentActions.ts (backend)
- **C7 (backend parts)**: types.ts EvolutionRunStatus, evolutionRunnerCore.ts status filters
- **H1**: arena-actions.integration.test.ts dropped evolution_arena_elo refs
- **H3**: evolution-test-helpers.ts dropped checkpoints refs
- **M2**: Deferred scripts with dropped table refs (cleanup)
- **M3**: Feature flag verification between stage/prod

## Open Questions
1. **Prod DB query tool not configured** — .env.prod.readonly missing. Need to set up to verify actual prod table state.
2. **Are the column mismatches in C3-C4 causing silent Supabase errors?** — Need to verify whether Supabase JS client silently ignores unknown columns in select/insert or throws.
3. **Is the minicomputer runner on V2?** — The systemd service runs evolution-runner.ts which delegates to evolutionRunnerCore.ts → executeV2Run. Should be fine but need to verify the runner was restarted after V2 deploy.
