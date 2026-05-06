# Fixes Additional Generation Tactics Evolution Research

## Problem Statement
Fix and enhance the evolution tactics system. The tactics list page shows no tactics, the detail view needs verification, tactics need to appear as a top-level entity in the left nav, and the strategy creation wizard needs tactic preference configuration per generateFromSeedArticle iteration.

## Requirements (from GH Issue #NNN)
- **Make sure there is a way to set tactics preference from the strategy creation wizard, for each generateFromSeedArticle in each iteration**
- Tactics should be in left nav, as a top-level entity
- There are no tactics listed when I go to the tactics list view
- Make sure we have a tactics detail view

## High Level Summary

Four issues identified across tactics infrastructure, UI, and pipeline integration:

1. **Empty tactics list** — The `evolution_tactics` table is empty because `syncSystemTactics.ts` has never been executed. The migration creates the schema but doesn't seed data. The sync script exists and is idempotent but is not wired into CI or batch runner startup.

2. **Missing sidebar nav** — Tactics is not in the `EvolutionSidebar.tsx` nav groups. The dashboard has a link to tactics, but the sidebar does not. Simple config addition needed.

3. **Detail view exists and is functional** — `TacticDetailContent.tsx` has 5 tabs (Overview, Metrics, Variants, Runs, By Prompt). Overview and Metrics are complete; Variants and Runs are Phase 3 stubs. `TacticPromptPerformanceTable` works. Entity integration is correct via `TacticEntity.ts`.

4. **Strategy wizard has no tactic guidance UI** — `generationGuidance` exists at the strategy level in `StrategyConfig` but has no UI in the wizard. Per-iteration guidance requires adding `generationGuidance` to `IterationConfig` schema + pipeline changes in `runIterationLoop.ts` (3 lines) + wizard UI.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/architecture.md — 24 tactics, tactic registry, weighted selection via generationGuidance
- evolution/docs/data_model.md — evolution_tactics table schema, RLS policies, stale trigger
- evolution/docs/strategies_and_experiments.md — StrategyConfig.generationGuidance field, selectTacticWeighted
- evolution/docs/arena.md — arena integration (no tactic changes needed)
- evolution/docs/cost_optimization.md — per-tactic EMPIRICAL_OUTPUT_CHARS cost estimation
- evolution/docs/entities.md — TacticEntity in entity registry, entity action matrix
- evolution/docs/metrics.md — tactic-level metrics (avg_elo, best_elo, total_variants, etc.)
- evolution/docs/visualization.md — tactics list/detail admin pages, TacticPromptPerformanceTable
- docs/feature_deep_dives/evolution_metrics.md — tactic metric rendering

## Code Files Read

### Tactics Infrastructure
- `evolution/src/lib/core/tactics/generateTactics.ts` — 25 tactic definitions (SYSTEM_GENERATE_TACTICS) with label, category, preamble, instructions
- `evolution/src/lib/core/tactics/index.ts` — ALL_SYSTEM_TACTICS, getTacticDef, isValidTactic, DEFAULT_TACTICS, TACTICS_BY_CATEGORY, TACTIC_PALETTE
- `evolution/src/lib/core/tactics/selectTacticWeighted.ts` — cumulative probability distribution selection with SeededRandom
- `evolution/src/lib/core/tactics/types.ts` — TacticDef interface
- `evolution/scripts/syncSystemTactics.ts` — idempotent upsert by name, exported function taking (supabaseUrl, supabaseKey), returns {upserted, errors}

### Database & Migrations
- `supabase/migrations/20260417000001_evolution_tactics.sql` — table creation, RLS policies (all with IF NOT EXISTS guards after fix), tactic column on invocations, metrics constraint update
- `supabase/migrations/20260417000002_tactic_stale_trigger.sql` — extends mark_elo_metrics_stale() to cascade to tactic metrics
- Commit `443bb316` — adds IF NOT EXISTS guards to 2 policy CREATE statements (service_role_all, readonly_select)

### Server Actions
- `evolution/src/services/tacticActions.ts` — listTacticsAction (queries evolution_tactics), getTacticDetailAction (enriches with code-defined prompt via getTacticDef)
- `evolution/src/services/tacticPromptActions.ts` — getTacticPromptPerformanceAction (joins variants→runs→prompts, groups by tactic+prompt)
- `evolution/src/services/strategyRegistryActions.ts` — createStrategyAction, createStrategySchema (includes generationGuidance at strategy level)

### Admin UI Pages
- `src/app/admin/evolution/tactics/page.tsx` — EntityListPage with Status/AgentType filters, 0 items shown (verified via Playwright)
- `src/app/admin/evolution/tactics/loading.tsx` — TableSkeleton loading state
- `src/app/admin/evolution/tactics/[tacticId]/page.tsx` — server wrapper calling getTacticDetailAction
- `src/app/admin/evolution/tactics/[tacticId]/TacticDetailContent.tsx` — 5 tabs: Overview, Metrics, Variants (stub), Runs (stub), By Prompt
- `evolution/src/components/evolution/tabs/TacticPromptPerformanceTable.tsx` — per-prompt tactic perf table

### Sidebar & Navigation
- `src/components/admin/EvolutionSidebar.tsx` — navGroups: Overview (Dashboard, Start Experiment), Entities (Experiments, Prompts, Strategies, Runs, Invocations, Variants), Results (Arena). **No Tactics entry.**
- `src/components/admin/EvolutionSidebar.test.tsx` — expectedItems array (9 items, no tactics)
- `src/components/admin/BaseSidebar.tsx` — NavItem interface: {href, label, icon (emoji), testId, description}
- `src/app/admin/evolution-dashboard/page.tsx` — link to /admin/evolution/tactics at line 128

### Strategy Wizard
- `src/app/admin/evolution/strategies/new/page.tsx` — 2-step wizard. Step 1: config (models, budget, advanced). Step 2: iterations (agentType, budgetPercent, maxAgents per row) + submit. No generationGuidance UI anywhere. Verified via Playwright.
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` — displays generationGuidance as tactic/percent list (lines 150-159), iterations table (lines 160-206). No per-iteration guidance column.

### Pipeline Flow (Tactic Selection)
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — validates generationGuidance tactic names via isValidTactic (lines 251-259), passes to EvolutionConfig (line 269)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — extracts guidance (line 322), selectTactic closure (lines 324-330): weighted if guidance present, else round-robin. Applied uniformly to ALL iterations.
- `evolution/src/lib/schemas.ts` — generationGuidanceEntrySchema ({tactic, percent} with legacy {strategy} preprocess), iterationConfigSchema (agentType, budgetPercent, maxAgents — no generationGuidance), strategyConfigSchema (has generationGuidance at strategy level)
- `evolution/src/lib/pipeline/infra/types.ts` — StrategyConfig and IterationConfig types (IterationConfig lacks generationGuidance)

### Batch Runner
- `evolution/scripts/processRunQueue.ts` — no sync/seed at startup. syncSystemTactics could be called after buildDbTargets() (line 125) with target.client credentials.

### Existing Tests
- `evolution/src/lib/core/tactics/generateTactics.test.ts` — tactic registry validation, 24 tactics
- `evolution/src/lib/core/tactics/selectTacticWeighted.test.ts` — weighted selection algorithm
- `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — uses tactic field
- `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — orchestrator loop with tactics
- `evolution/src/components/evolution/visualizations/VariantCard.test.tsx` — tactic colors
- **Missing tests:** tacticActions, TacticPromptPerformanceTable, tactics pages (E2E)

## Key Findings

1. **Root cause of empty list**: `syncSystemTactics.ts` exists and is idempotent but never called. The script comment says "Runs on deploy (CI step) and at batch runner startup" but neither is wired up. Fix: run the sync script once, then wire into CI and processRunQueue startup.

2. **Sidebar is a 1-line fix**: Add `{ href: '/admin/evolution/tactics', label: 'Tactics', icon: '⚔️', testId: 'evolution-sidebar-nav-tactics', description: 'Generation tactics configuration' }` to the Entities group in EvolutionSidebar.tsx, after Strategies.

3. **Detail view is mostly complete**: Overview tab shows agent_type, category, preamble, instructions. Metrics tab uses EntityMetricsTab. By Prompt tab uses TacticPromptPerformanceTable. Variants and Runs tabs are Phase 3 stubs.

4. **Per-iteration generationGuidance requires 3-layer changes**:
   - **Schema**: Add `generationGuidance: generationGuidanceSchema.optional()` to `iterationConfigSchema` + refine to block on swiss iterations
   - **Pipeline**: In `runIterationLoop.ts`, check `iterCfg.generationGuidance ?? resolvedConfig.generationGuidance` (per-iteration takes precedence over strategy-level)
   - **Wizard UI**: Extend IterationRow with tacticGuidance field, add collapsible tactic editor per generate iteration row, update handleSubmit to include guidance
   - **Display**: Update StrategyConfigDisplay iterations table to show per-iteration guidance

5. **Backward compatibility is safe**: Strategy-level generationGuidance becomes fallback for iterations without per-iteration guidance. Round-robin (default when no guidance) is unaffected. No breaking changes to existing strategies.

6. **24 tactics across 7 categories**: Core (3), Extended (5), Depth (4), Audience (3), Structural (3), Quality (3), Meta (3). All defined in `SYSTEM_GENERATE_TACTICS` with preamble + instructions.

7. **Validation already exists**: `buildRunContext.ts` validates tactic names via `isValidTactic()` before pipeline execution. Would need extending for per-iteration guidance.

8. **Strategy wizard iteration step needs agent dispatch preview**: The iteration configuration screen (Step 2) currently shows only agentType, budgetPercent, dollar amount, and maxAgents. It should also preview how many agents will run per generate iteration — broken down by parallel vs. sequential — based on budget settings (total budget, budget floors, estimated per-agent cost). The estimation logic already exists in `evolution/src/lib/pipeline/infra/estimateCosts.ts` (`estimateAgentCost`, `estimateGenerationCost`) and the budget floor config fields are on StrategyConfig. This preview would help users understand the practical impact of their budget allocation before creating the strategy.

9. **Invocation cost_usd = 0 bug (confirmed on staging run f56992e7)**: Per-invocation cost attribution is broken in production. Root cause: `runIterationLoop.ts` line 207 builds one LLM client with the **shared** `costTracker` and passes it as `input.llm` to all agents. Agent.run() creates an `AgentCostScope` at line 55 and checks `ctx.rawProvider` at line 63 to build a scoped LLM client — but `rawProvider` and `defaultModel` are **never set on AgentContext** by the orchestrator. The condition is always false, so the scoped LLM client is never built, and `costScope.getOwnSpent()` always returns 0. The Bug B fix (PR #946) is dead code in production. Run-level metrics work because `writeMetricMax` in the shared LLM client writes to `evolution_metrics` via `getTotalSpent()`. Fix: propagate `llmProvider` as `rawProvider` and `resolvedConfig.generationModel` as `defaultModel` on the AgentContext in `runIterationLoop.ts`.

10. **Minicomputer batch runner still running old code**: Run f56992e7 was executed by `v2-gmktec-vm` (minicomputer batch runner) 12 minutes after PR #997 merged. The invocations show `agent_name: "generate_from_seed_article"` (old name). The minicomputer runs `processRunQueue.ts` locally and doesn't auto-deploy when main is updated — it requires a manual restart or git pull. This explains why the rename wasn't in effect.

11. **Backward-compat items to clean up from PR #997**: Two files still reference the old `generate_from_seed_article` name:
    - `evolution/scripts/syncSystemTactics.ts` line 31: `agent_type: 'generate_from_seed_article'` (has TODO)
    - `evolution/src/lib/core/entities/TacticEntity.ts` line 50: filter dropdown only lists old name

12. **Tactic metrics lack Elo delta and CI**: `computeTacticMetrics()` computes `avg_elo` as a plain mean with no bootstrap CI and no Elo delta (change from baseline 1200). No `win_rate` metric exists either. The existing `bootstrapMeanCI()` in `experimentMetrics.ts` can be reused — it already handles uncertainty propagation via `Normal(elo, uncertainty)` draws. Need to: (a) add `avg_elo_delta` metric = avg(variant_elo - 1200) with bootstrap CI, (b) upgrade `avg_elo` to use `bootstrapMeanCI()`, (c) add `win_rate` = winner_count/total_variants with CI.

## Open Questions (Resolved)

1. **Per-iteration vs strategy-level generationGuidance?** → Allow override. Per-iteration takes precedence over strategy-level; strategy-level becomes fallback.
2. **Tactic guidance UI style?** → Modal/popover per generate iteration row.
3. **Wire syncSystemTactics into CI/batch runner?** → Run manually for now. Not part of this project scope.
4. **Implement Variants/Runs tabs in tactic detail?** → Yes, implement in this project.
5. **Agent dispatch preview placement?** → Inline per iteration row.
