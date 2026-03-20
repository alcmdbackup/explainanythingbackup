# Create Evolution V2 Admin UI Research

## Problem Statement
Restore the evolution admin dashboard and supporting pages that were deleted in PR #736 (V1 cleanup). PR #736 correctly identified that V1 code referenced dropped V2 schema columns, but over-corrected by deleting the entire admin UI instead of surgically updating it. This project reverts PR #736's deletions, updates restored code to work with the current V2 schema (strategy_config_id as FK, no inline config JSONB, arena table renames), and removes only code that truly cannot work with V2.

## Requirements (from GH Issue #742)
1. Revert all file deletions from PR #736 to restore the previous working admin UI
2. Update restored server actions to use V2 schema (strategy_config_id FK, no config JSONB column on runs, arena table renames, evolution_explanations)
3. Restore all pages: evolution-dashboard, runs list + run detail, variants list + detail, invocations list + detail, strategies list + detail (CRUD), prompts list + detail (CRUD), arena pages
4. Remove code referencing dropped V1 columns/tables that cannot be adapted to V2
5. Update imports to use V2 action files (experimentActionsV2.ts) where PR #736 created replacements
6. Reuse existing V2 shared components (EntityDetailHeader, EntityTable, MetricGrid, etc.)
7. Ensure all restored pages pass lint, tsc, build with unit tests
8. Update visualization.md and admin_panel.md docs

## High Level Summary

### What PR #736 Deleted
~130 files totaling ~5000+ lines of server actions and ~100+ UI components/pages:
- **37 admin pages** under src/app/admin/evolution/ (dashboard, runs, strategies, prompts, arena, invocations, variants)
- **49 components** under evolution/src/components/evolution/ (tabs, agent details, variant views, charts)
- **25 server action files** under evolution/src/services/ (all CRUD + visualization actions)
- **12 E2E and integration tests**

### V2 Schema Reality
The V2 migration (20260315000001) was a **clean-slate rewrite** that dropped all V1 tables and recreated simplified versions. Key differences:

| Feature | V1 | V2 |
|---------|----|----|
| evolution_runs columns | ~20 columns (phase, current_iteration, continuation_count, total_cost_usd, estimated_cost_usd, cost_estimate_detail, cost_prediction, config JSONB) | 14 columns (no phase/iteration/cost columns, run_summary JSONB instead) |
| evolution_variants | elo_attribution JSONB | No elo_attribution |
| evolution_agent_invocations | agent_attribution JSONB | No agent_attribution |
| evolution_checkpoints | Exists (per-iteration state snapshots) | **DROPPED** |
| evolution_run_agent_metrics | Exists | **DROPPED** |
| evolution_budget_events | Exists | **DROPPED** |
| evolution_arena_elo | Separate table | **Merged into evolution_arena_entries** (mu, sigma, elo_rating, match_count) |
| Config | config JSONB on runs | strategy_config_id FK (NOT NULL) + budget_cap_usd column |

### Where Data Lives in V2
- **Run metrics**: In `run_summary` JSONB (stopReason, totalIterations, durationSeconds, muHistory, diversityHistory, matchStats, topVariants, baselineRank, strategyEffectiveness)
- **Cost**: SUM of `evolution_agent_invocations.cost_usd` per run (no total_cost_usd column)
- **Per-agent timeline**: `evolution_agent_invocations` with execution_detail JSONB
- **Strategy config**: `evolution_strategy_configs.config` (V2StrategyConfig type)
- **Arena ratings**: Directly on `evolution_arena_entries` (mu, sigma, elo_rating)

### What Survived PR #736
- **Experiment pages**: experiments list, experiment detail (with tabs), start-experiment
- **Shared V2 components**: EntityTable, EntityListPage, EntityDetailHeader, MetricGrid, RegistryPage, FormDialog, ConfirmDialog, EvolutionStatusBadge, EvolutionBreadcrumb, EmptyState, TableSkeleton
- **V2 server actions**: experimentActionsV2.ts (6 actions), adminAction.ts factory, shared.ts
- **V2 library**: lib/v2/ (35 files — complete pipeline reimplementation)
- **Sidebar navigation**: EvolutionSidebar still links to all 9 routes (most pages missing)

### Types Status
- **Available**: EvolutionRunStatus, PipelinePhase, EvolutionRunSummary, EloAttribution, StrategyConfig, StrategyConfigRow, V2StrategyConfig, toEloScale()
- **Deleted in PR #738**: EvolutionRunConfig, DEFAULT_EVOLUTION_CONFIG, resolveConfig(), V1 hashStrategyConfig

## File Classification

### RESTORE (minor import/type updates — ~19 files)
- **Components**: AutoRefreshProvider, EloSparkline, VariantCard, RunsTable, TextDiff, InputArticleSection, ElapsedTime, LineageGraph, VariantDetailPanel, VariantContentSection, VariantLineageSection, VariantMatchHistory
- **Tabs**: LineageTab, VariantsTab
- **Pages**: invocations/page.tsx, invocations/[invocationId]/* (3 files), variants/page.tsx, variants/[variantId]/* (3 files)
- **Actions**: variantDetailActions.ts

### REWRITE (significant V2 schema adaptation — ~12 files)
- **Pages**: evolution-dashboard/page.tsx, runs/page.tsx, runs/[runId]/page.tsx, runs/[runId]/RunMetricsTab.tsx, arena/page.tsx, arena/[topicId]/page.tsx, arena/entries/[entryId]/page.tsx
- **Actions**: evolutionActions.ts (run CRUD), evolutionVisualizationActions.ts (dashboard/timeline), arenaActions.ts
- **Components**: EloTab (no checkpoint trajectories), MetricsTab (use run_summary)

### SKIP (V1-only, dead code — ~40+ files)
- **Components**: PhaseIndicator, AttributionBadge, StepScoreBar, ActionChips, all 12 agentDetails views, BudgetTab, TimelineTab, LogsTab, RelatedVariantsTab
- **Actions**: experimentActions.ts (replaced by V2), eloBudgetActions.ts, costAnalyticsActions.ts, experimentHelpers.ts, experimentReportPrompt.ts, strategyResolution.ts
- **Pages**: strategies/ (use RegistryPage pattern instead), prompts/ (use RegistryPage pattern), runs/[runId]/compare/page.tsx

### REBUILD with RegistryPage (leverage existing V2 pattern)
- **strategies/page.tsx** → Use RegistryPage component with strategy CRUD actions
- **prompts/page.tsx** → Use RegistryPage component with prompt CRUD actions
- These are simpler to rebuild using the V2 RegistryPage pattern than to restore V1 code

## V1 References That Must Be Updated in Restored Code

1. **`total_cost_usd` column** → SUM from `evolution_agent_invocations.cost_usd` or extract from `run_summary`
2. **`estimated_cost_usd` / `cost_estimate_detail` / `cost_prediction`** → Remove (V2 has no cost estimation)
3. **`phase` / `current_iteration` / `continuation_count`** → Read from `run_summary` JSONB
4. **`evolution_checkpoints` table** → Remove all checkpoint-based fallback code
5. **`elo_attribution` on variants** → Remove attribution display (V2 doesn't compute it)
6. **`agent_attribution` on invocations** → Remove
7. **`evolution_arena_elo` table** → Query `evolution_arena_entries` directly (mu, sigma, elo_rating)
8. **`evolution_run_agent_metrics`** → Use `evolution_agent_invocations` instead
9. **`evolution_budget_events`** → Remove budget event references
10. **`DEFAULT_EVOLUTION_CONFIG` / `EvolutionRunConfig` / `resolveConfig`** → Use V2StrategyConfig, upsertStrategy()
11. **`config` JSONB on runs** → Use `strategy_config_id` FK to fetch from strategy table
12. **Old action wrapper pattern** → Use `adminAction()` factory

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/visualization.md — Full UI spec for all pages, components, actions
- evolution/docs/evolution/reference.md — V2 config, feature flags, DB schema
- evolution/docs/evolution/data_model.md — Core primitives, migration list, dimensional model
- docs/feature_deep_dives/admin_panel.md — Admin layout, sidebar switching, routes, patterns
- evolution/docs/evolution/architecture.md — Pipeline phases, agents, checkpoint/resume, data flow
- evolution/docs/evolution/experimental_framework.md — Per-run metrics, bootstrap CIs
- docs/feature_deep_dives/server_action_patterns.md — Action wrapping, response pattern
- evolution/docs/evolution/arena.md — Arena CRUD, topic/entry schema, leaderboard
- docs/docs_overall/design_style_guide.md — Color tokens, component patterns, ESLint rules
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill, Swiss tournament, attribution

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql — V2 clean-slate migration (10 tables)
- supabase/migrations/20260318000002_config_into_db.sql — Drop config, add budget_cap_usd
- evolution/src/services/experimentActionsV2.ts — V2 experiment actions (reference pattern)
- evolution/src/services/adminAction.ts — adminAction() factory wrapper
- evolution/src/services/shared.ts — ActionResult type, UUID validation
- evolution/src/lib/v2/experiments.ts — V2 library functions
- evolution/src/lib/v2/finalize.ts — buildRunSummary, variant persistence
- evolution/src/lib/v2/invocations.ts — Agent invocation writes
- evolution/src/lib/v2/evolve-article.ts — V2 pipeline entry point
- evolution/src/lib/types.ts — EvolutionRunSummary, EvolutionRunStatus, etc.
- evolution/src/lib/core/strategyConfig.ts — StrategyConfig, StrategyConfigRow
- evolution/src/lib/index.ts — Barrel exports
- evolution/src/components/evolution/index.ts — Component barrel (current)
- evolution/src/components/evolution/RegistryPage.tsx — Config-driven CRUD page
- evolution/src/components/evolution/FormDialog.tsx — Reusable form modal
- evolution/src/components/evolution/ConfirmDialog.tsx — Confirmation modal
- evolution/src/components/evolution/EntityTable.tsx — Generic sortable table
- evolution/src/components/evolution/EntityListPage.tsx — List page wrapper
- evolution/src/components/evolution/EntityDetailHeader.tsx — Detail page header
- evolution/src/components/evolution/MetricGrid.tsx — Metrics display grid
- src/components/admin/EvolutionSidebar.tsx — Navigation links (all 9 routes)
- src/components/admin/SidebarSwitcher.tsx — Route-based sidebar selection
- src/app/admin/page.tsx — Admin dashboard with evolution link
- src/app/admin/evolution/experiments/page.tsx — Working V2 experiment list
- src/app/admin/evolution/experiments/[experimentId]/page.tsx — Working V2 experiment detail
- src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx — V2 reference pattern
- src/app/admin/evolution/experiments/[experimentId]/RunsTab.tsx — V2 runs tab pattern
- Git history: PR #736 deleted files list (130 files categorized)
- Git history: Pre-deletion versions of evolutionActions.ts, evolutionVisualizationActions.ts, strategyRegistryActions.ts, promptRegistryActions.ts, arenaActions.ts, variantDetailActions.ts
- Git history: Pre-deletion admin pages (dashboard, runs, strategies, prompts, arena, variants)
- Git history: Pre-deletion components (TimelineTab, EloTab, VariantsTab, RunsTable, AttributionBadge, agentDetails/index.ts)

## Open Questions
1. Should we add back `total_cost_usd` as a computed column or view on `evolution_runs` (derived from agent invocations), or always compute it client-side?
2. Should the dashboard show V2 metrics from `run_summary` JSONB, or should we add convenience columns?
3. The strategy/prompt pages were classified as SKIP for restore but REBUILD with RegistryPage — confirm this approach vs restoring old V1 CRUD pages.
