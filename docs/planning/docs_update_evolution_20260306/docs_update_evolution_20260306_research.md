# Docs Update Evolution Research

## Problem Statement
Update all 16 evolution pipeline documentation files to ensure they accurately reflect the current codebase. Additionally, deprecate all references to the L8 orthogonal array / Taguchi fractional factorial experimentation system, as the project has switched to a manual experimentation approach.

## Requirements (from GH Issue #649)
- Update all 16 evolution docs (under `evolution/docs/evolution/`) to match current codebase state
- Deprecate L8/Taguchi fractional factorial experimentation references in `strategy_experiments.md`
- Update `strategy_experiments.md` to reflect the manual experimentation system
- Update any cross-references to L8 experimentation in other evolution docs (architecture.md, reference.md, cost_optimization.md, etc.)
- Ensure all file paths, test counts, migration lists, and configuration values are current
- Verify all cross-doc links are valid

## High Level Summary

4 rounds of research with 4 agents each (16 total agents) identified **60+ discrepancies** across all 16 evolution docs. The most impactful changes are:

1. **L8 experiment system fully replaced by manual experiments** (Mar 4-5, 2026)
2. **Per-agent budget caps deprecated** — system now uses global-only budget enforcement
3. **Plateau/degenerate stopping conditions removed** — only 3 stopping conditions remain
4. **maxIterations changed from 15 to 50**, MAX_RUN_BUDGET_USD hard cap of $1.00 added
5. **6+ new admin pages** undocumented (Strategy Registry, Prompt Registry, Invocations list, Variants list, etc.)
6. **10 referenced files no longer exist** (factorial.ts, factorRegistry.ts, hallOfFameIntegration.ts, articleDetailActions.ts, etc.)
7. **Hall of Fame fully renamed to Arena** — ghost references remain in docs
8. **4 article/ components removed** from visualization codebase
9. **Multiple test counts outdated** across agent and E2E docs

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/instructions_for_updating.md

### Evolution Docs (all 16 + README)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/flow_critique.md

## Code Files Read
- evolution/src/lib/config.ts — DEFAULT_EVOLUTION_CONFIG, MAX_RUN_BUDGET_USD, resolveConfig()
- evolution/src/lib/types.ts — EvolutionRunConfig, MetaFeedback, AgentName, PipelineType
- evolution/src/lib/core/supervisor.ts — stopping conditions (3 only, no plateau)
- evolution/src/lib/core/costTracker.ts — global budget enforcement, event logger
- evolution/src/lib/core/costEstimator.ts — estimateRunCostWithAgentModels()
- evolution/src/lib/core/budgetRedistribution.ts — agent classification only (per-agent caps removed)
- evolution/src/lib/core/arenaIntegration.ts — loadArenaEntries(), syncToArena()
- evolution/src/lib/core/pipeline.ts — agent dispatch, runFlowCritiques()
- evolution/src/lib/core/persistence.ts — computeAndPersistAttribution()
- evolution/src/lib/core/diversityTracker.ts — pure analysis utility
- evolution/src/lib/core/pool.ts — PoolManager for opponent selection
- evolution/src/lib/core/validation.ts — state contract guards
- evolution/src/lib/index.ts — createDefaultAgents() (12 agents)
- evolution/src/lib/flowRubric.ts — flow dimensions, normalizeScore()
- evolution/src/lib/agents/*.ts — all 12 agent implementations
- evolution/src/services/experimentActions.ts — manual experiment CRUD
- evolution/src/services/experimentReportPrompt.ts — still references "factorial"
- evolution/src/experiments/evolution/analysis.ts — computeManualAnalysis()
- evolution/src/services/evolutionVisualizationActions.ts — 15 actions (docs say 13)
- evolution/src/services/evolutionActions.ts — 10 actions (docs say 11)
- evolution/src/services/arenaActions.ts — 15 actions
- evolution/src/services/variantDetailActions.ts — 5 actions (docs say 4)
- evolution/src/services/strategyRegistryActions.ts — 8 actions (undocumented)
- evolution/src/services/promptRegistryActions.ts — 7 actions (undocumented)
- evolution/src/services/costAnalyticsActions.ts — 2 actions
- evolution/src/services/eloBudgetActions.ts — 10 actions
- src/app/api/cron/experiment-driver/route.ts — manual experiment state machine
- src/app/admin/evolution/strategies/page.tsx — NEW strategy registry
- src/app/admin/evolution/prompts/page.tsx — NEW prompt registry
- src/app/admin/evolution/invocations/page.tsx — NEW invocations list
- src/app/admin/evolution/variants/page.tsx — NEW variants list
- src/app/admin/evolution/experiments/page.tsx — NEW experiments list
- src/app/admin/evolution/start-experiment/page.tsx — NEW start experiment
- src/app/admin/evolution/analysis/_components/ExperimentForm.tsx — manual experiment form
- src/app/admin/evolution/experiments/[experimentId]/*.tsx — experiment detail components
- supabase/migrations/20260306000001_evolution_budget_events.sql — NEW budget audit table
- evolution/src/components/evolution/ — component inventory check

---

## Key Findings

### A. Experiment System (L8 → Manual)

1. **L8 fully replaced**: `createManualExperimentAction()` creates experiments with `design: 'manual'`, `factor_definitions: {}`. No L8 auto-generation.
2. **Manual workflow**: User configures runs 1-by-1 (model, judge, agents, budget per run), then starts experiment. Cron driver processes state machine.
3. **Analysis simplified**: `computeManualAnalysis()` does per-run Elo/cost comparison. No main effects, factor rankings, or recommendations.
4. **Files deleted**: `factorial.ts`, `factorRegistry.ts`, `experimentValidation.ts`, `scripts/run-strategy-experiment.ts` — all gone.
5. **Report prompt artifact**: `experimentReportPrompt.ts` line 20 still says "Analyze this factorial experiment" — should be updated.
6. **DB schema**: Migration `20260304000003` added `'manual'` to design CHECK constraint alongside legacy `'L8'` and `'full-factorial'`.
7. **Budget constraints**: MAX_RUN_BUDGET_USD = $1.00 per run, MAX_EXPERIMENT_BUDGET_USD = $10.00 per experiment.

### B. Config & Stopping Conditions

8. **maxIterations**: DEFAULT changed from 15 → **50** (`config.ts` line 8)
9. **budgetCapUsd**: DEFAULT is 5.00 but hard-capped to **1.00** by MAX_RUN_BUDGET_USD (`config.ts` line 81)
10. **plateau**: Marked `@deprecated` in types.ts. **Completely removed from supervisor.ts** — no plateau detection code exists.
11. **degenerate state**: Also removed. No diversity-based stopping.
12. **Stopping conditions (3 only)**:
    - Quality threshold (single-article mode, all critique dims >= 8)
    - Budget exhausted (available < $0.01)
    - Max iterations exceeded
13. **Auto-clamping formula changed**: Now `maxIterations <= expansion.maxIterations + 1` → clamp to `max(0, maxIterations - 1)`. Docs describe old formula involving `plateau.window`.
14. **budgetCaps**: Marked `@deprecated` in types.ts. NOT in DEFAULT_EVOLUTION_CONFIG. Per-agent budget caps completely removed.

### C. Budget System

15. **Global-only enforcement**: CostTracker checks `totalSpent + totalReserved + estimate <= budgetCapUsd` (global). No per-agent cap validation.
16. **Per-agent tracking still exists**: `spentByAgent` Map for analytics/ROI metrics, but NOT for enforcement.
17. **Budget event audit log**: NEW table `evolution_budget_events` (migration `20260306000001`) with event types: reserve, spend, release_ok, release_failed.
18. **adaptiveAllocation.ts**: Does NOT exist. Docs claim "implemented but intentionally unused" — actually never implemented.
19. **'pairwise' agent name**: Removed from budget system entirely.
20. **budgetRedistribution.ts**: Gutted — only contains agent classification lists and validation, no redistribution logic.

### D. Dashboard UI — New Pages

21. **Strategy Registry** (`/admin/evolution/strategies`): Full CRUD for strategy configs with presets, agent selection, model selection, clone, archive/delete.
22. **Prompt Registry** (`/admin/evolution/prompts`): Full CRUD for prompts with difficulty tiers, domain tags, archive/delete.
23. **Invocations List** (`/admin/evolution/invocations`): Filterable table of all agent invocations.
24. **Variants List** (`/admin/evolution/variants`): Filterable table of all variants with winner filtering.
25. **Experiments List** (`/admin/evolution/experiments`): Standalone experiments listing page.
26. **Start Experiment** (`/admin/evolution/start-experiment`): Dedicated experiment creation page.
27. **Arena Prompt Bank**: Coverage tracking, comparison status, batch comparison runner — not documented.

### E. Dashboard UI — Enhancements

28. **Run detail page**: Budget bar, ETA display, Phase indicator — not documented.
29. **Runs table**: Est. column with cost accuracy color-coding (green/amber/red).
30. **Analysis page**: RecommendedStrategyCard, Pareto chart — not documented.
31. **3 new components undocumented**: RunsTable.tsx, ElapsedTime.tsx, EvolutionBreadcrumb.tsx.

### F. Removed/Missing Code Referenced in Docs

32. **article/ component directory**: 4 components documented but don't exist (ArticleOverviewCard, ArticleRunsTimeline, ArticleAgentAttribution, ArticleVariantsList).
33. **articleDetailActions.ts**: Referenced in reference.md but file doesn't exist.
34. **Article detail page** (`/admin/evolution/runs/article/[explanationId]`): Referenced in reference.md but route doesn't exist.
35. **unifiedExplorerActions.ts**: Referenced in data_model.md but doesn't exist.
36. **hallOfFameIntegration.ts**: Referenced in architecture.md — actually named `arenaIntegration.ts`.
37. **hall_of_fame.md**: Referenced in generation.md — file doesn't exist.
38. **article_detail_view.md**: Referenced in README.md — file doesn't exist in feature_deep_dives/.

### G. Agent Doc Discrepancies

39. **MetaFeedback fields**: Docs claim `overallAssessment`, `strategicDirection` — code has `recurringWeaknesses`, `priorityImprovements`, `successfulStrategies`, `patternsToAvoid`.
40. **IterativeEditingAgent**: Flow critique integration exists in code (lines 261-265) but NOT documented in editing.md.
41. **ProximityAgent**: Semantic+lexical blending mode (SEMANTIC_WEIGHT=0.7) and LRU cache (MAX_CACHE_SIZE=200) not documented.
42. **MetaReviewAgent**: Failure threshold `< -3` not documented. `CREATIVE_STAGNATION_ITERATIONS=2` not documented.
43. **FlowCritique**: `normalizeScore()` function and `CROSS_SCALE_MARGIN=0.05` not documented.

### H. Server Action Count Mismatches

44. **evolutionVisualizationActions**: Docs say 13, actual is **15** (+buildVariantsFromCheckpoint, +listInvocationsAction).
45. **evolutionActions**: Docs say 11, actual is **10** (missing actions: applyWinner, rollbackEvolution, getEvolutionHistory).
46. **variantDetailActions**: Docs say 4, actual is **5** (+getVariantLineageChainAction).

### I. Test Count Mismatches

47. **outlineGenerationAgent.test.ts**: Docs say 16, actual **19**.
48. **iterativeEditingAgent.test.ts**: Docs say 21, actual **35**.
49. **treeSearchAgent.test.ts**: Docs say 17, actual **19**.
50. **revisionActions.test.ts**: Docs say 12, actual **19**.
51. **admin-evolution-visualization.spec.ts**: Docs say 5, actual **7**.
52. **admin-article-variant-detail.spec.ts**: Docs say 9, actual **6**.

### J. Data Model & Arena

53. **Generation methods**: Schema includes `'evolution'` (used by syncToArena) — not in docs. Legacy methods `'evolution_top3'`, `'evolution_ranked'` still in schema.
54. **sync_to_arena RPC**: Stores `metadata: {strategy, iterationBorn}` and `evolution_variant_id` — not documented.
55. **evolution_budget_events table**: New, undocumented migration #22.
56. **Arena rename migrations**: `20260221000002` (table renames) and `20260303000005` (hall_of_fame → arena) not in migration list.

### K. Cross-Doc Links

57. **Broken**: `generation.md` → `../hall_of_fame.md` (doesn't exist)
58. **Broken**: `README.md` → `../../../docs/feature_deep_dives/article_detail_view.md` (doesn't exist)
59. **instructions_for_updating.md**: Says "13 files" but actual count is 15 evolution docs. Lists `hall_of_fame.md` which doesn't exist. Missing `entity_diagram.md`, `strategy_experiments.md`, `flow_critique.md`.

---

## Open Questions

1. Should `strategy_experiments.md` be fully rewritten for manual experiments or just mark L8 as deprecated?
2. Should the 4 removed article/ components be re-implemented or just removed from docs?
3. Should `adaptiveAllocation.ts` documentation be removed entirely since it was never implemented?
4. Should the `hall_of_fame.md` doc be created covering Arena integration, or just fix the broken link?
5. Should `article_detail_view.md` be created in feature_deep_dives/?
