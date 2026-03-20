# Evolution V2 Docs Update Research

## Problem Statement
Update the evolution pipeline documentation to reflect evolution v2 changes. The evolution system has undergone significant architectural changes including the unified RankingAgent (merging CalibrationRanker and Tournament), evolution explanations decoupling, and various pipeline improvements. This project will audit all evolution docs under evolution/docs/evolution/ and ensure they accurately reflect the current codebase state.

## Requirements (from GH Issue #TBD)
- Audit all evolution docs in evolution/docs/evolution/ for accuracy against current codebase
- Verify all file references, function names, and code patterns are up to date
- Ensure architectural descriptions match current implementation
- Update any stale references to removed or renamed components

## High Level Summary

**V2 is a complete rewrite of the evolution pipeline.** The entire documentation set (19 docs) describes V1 architecture. V2 replaces V1's 12-agent two-phase system with a simplified 3-operation flat loop. V1 code has been largely removed (agents, pipeline, checkpoint/resume, most UI/services), though V1 utility modules (rating, comparison, format validation) are reused by V2. A clean-slate DB migration (20260315000001) dropped all V1 tables and recreated them for V2.

### V2 Architecture (What's Actually Implemented)
- **3 operations per iteration**: generate → rank → evolve (flat loop, no phases)
- **No EXPANSION/COMPETITION phases** — same 3 operations every iteration
- **No checkpoint/resume** — runs must complete in one execution
- **No AgentBase framework** — flat functions (generateVariants, rankPool, evolveVariants)
- **Simplified config** — flat EvolutionConfig (not nested EvolutionRunConfig)
- **Reuses V1 core modules** — OpenSkill rating, bias-mitigated comparison, format validation

### Doc Accuracy Matrix

| # | Document | Accuracy | Action Needed |
|---|----------|----------|---------------|
| 1 | README.md | PARTIALLY_ACCURATE | Rewrite for V2 reading order |
| 2 | architecture.md | STALE | Complete rewrite for V2 |
| 3 | data_model.md | ACCURATE | Minor updates (remove V1-only refs) |
| 4 | rating_and_comparison.md | ACCURATE | Minor updates (RankingAgent → rankPool) |
| 5 | arena.md | ACCURATE | Minor updates (V2 sync pattern) |
| 6 | cost_optimization.md | ACCURATE | Minor updates (V2CostTracker differences) |
| 7 | entity_diagram.md | ACCURATE | Verify relationships |
| 8 | strategy_experiments.md | PARTIALLY_ACCURATE | Update for V2 experiment system |
| 9 | visualization.md | STALE | Major rewrite (80% of UI removed) |
| 10 | reference.md | PARTIALLY_ACCURATE | Major update (config, files, agents) |
| 11 | minicomputer_deployment.md | ACCURATE | Verify deployment steps |
| 12 | curriculum.md | PARTIALLY_ACCURATE | Update for V2 architecture |
| 13 | experimental_framework.md | ACCURATE | Minor updates |
| 14 | agents/overview.md | STALE | Complete rewrite or delete |
| 15 | agents/generation.md | STALE | Complete rewrite or delete |
| 16 | agents/editing.md | STALE | Delete (no editing agents in V2) |
| 17 | agents/tree_search.md | STALE | Delete (no tree search in V2) |
| 18 | agents/support.md | STALE | Delete (no support agents in V2) |
| 19 | agents/flow_critique.md | STALE | Delete (no flow critique in V2) |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### All Evolution Docs (19 files)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/flow_critique.md

## Code Files Read

### V2 Core (evolution/src/lib/v2/)
- evolve-article.ts — Main orchestrator (generate→rank→evolve loop)
- generate.ts — 3 strategy generation (structural_transform, lexical_simplify, grounding_enhance)
- rank.ts — Triage + Swiss fine-ranking (unified from V1 CalibrationRanker + Tournament)
- evolve.ts — Mutation (clarity/structure), crossover, creative exploration
- finalize.ts — Persist results in V1-compatible format
- runner.ts — Execution lifecycle (claim→resolve→evolve→persist→arena sync)
- arena.ts — Load arena entries into pool, sync results back
- llm-client.ts — LLM wrapper with retry, cost tracking, model pricing
- cost-tracker.ts — Reserve-before-spend budget management
- invocations.ts — Agent invocation tracking
- run-logger.ts — Fire-and-forget structured logging
- strategy.ts — Strategy config hashing/labeling (forked from V1, no Zod)
- seed-article.ts — Generate seed article from topic prompt
- experiments.ts — Create experiments, add runs, compute metrics
- errors.ts — BudgetExceededWithPartialResults
- types.ts — V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig
- index.ts — Barrel exports

### V1 Core Modules Reused by V2 (evolution/src/lib/core/)
- rating.ts — OpenSkill (Weng-Lin Bayesian) rating: createRating, updateRating, updateDraw, toEloScale
- comparison.ts — compareWithBiasMitigation(), 2-pass reversal bias mitigation
- core/reversalComparison.ts — Generic run2PassReversal() runner
- core/comparisonCache.ts — Order-invariant SHA-256 cache (exported but not used by V2)
- agents/formatValidator.ts — validateFormat() for generated text
- agents/formatRules.ts — FORMAT_RULES constant
- core/textVariationFactory.ts — createTextVariation() factory

### V1 Code Status
- evolution/src/lib/core/ — 33 files remain (utility modules reused by V2)
- evolution/src/lib/agents/ — Only formatValidator.ts and formatRules.ts remain
- evolution/src/lib/treeOfThought/ — REMOVED
- evolution/src/lib/section/ — REMOVED
- evolution/src/lib/diffComparison.ts — REMOVED
- evolution/src/lib/flowRubric.ts — REMOVED

### Services (evolution/src/services/)
- experimentActionsV2.ts — 7 V2 server actions (replaces 17+ V1 actions)
- evolutionRunClient.ts — Client-side fetch wrapper
- evolutionRunnerCore.ts — Runner orchestration (rejects V1 checkpoint resume)
- adminAction.ts — Admin action factory
- shared.ts — ActionResult type, UUID validation
- costAnalytics.ts — LLM cost tracking (not evolution-specific)
- All V1 service files REMOVED (evolutionActions, promptRegistryActions, strategyRegistryActions, arenaActions, evolutionVisualizationActions, variantDetailActions, etc.)

### UI Pages (src/app/admin/evolution/)
- experiments/page.tsx — Experiment list
- experiments/[experimentId]/page.tsx — Experiment detail
- start-experiment/page.tsx — Create experiment wizard
- All other V1 pages REMOVED (runs, variants, invocations, strategies, prompts, arena, dashboard)

### Scripts
- evolution/scripts/evolution-runner.ts — Production batch runner (V2, systemd timer)
- evolution/scripts/evolution-runner-v2.ts — Alternate CLI runner (broken LLM provider, dead code)
- evolution/scripts/run-evolution-local.ts — Local CLI (V2)
- evolution/scripts/deferred/ — Arena utility scripts (moved here)

### Database
- supabase/migrations/20260315000001_evolution_v2.sql — Clean-slate V2 migration (drops all V1 tables)
- Active RPCs: claim_evolution_run, update_strategy_aggregates, sync_to_arena, cancel_experiment
- Dropped RPCs: checkpoint_and_continue, apply_evolution_winner, get_non_archived_runs, archive/unarchive_experiment

### Tests
- 17 V2 core test files (197 test cases) — all V2 code
- 14 UI component test files (107 test cases) — shared components
- 6 service test files (78 test cases) — mixed V1/V2
- 0 integration/E2E test files remaining

## Key Findings

1. **V2 is a complete rewrite** — 3-operation flat loop replaces V1's 12-agent two-phase system
2. **All 19 doc files describe V1** — none mention V2 concepts (evolveArticle, flat loop, etc.)
3. **10 of 19 docs are STALE** — describe components that no longer exist (agents, phases, checkpoint/resume)
4. **V1 utility modules are reused** — rating, comparison, format validation unchanged and accurately documented
5. **80% of V1 UI removed** — only 3 experiment pages remain out of 15+ documented pages
6. **Server actions consolidated** — 7 V2 actions replace 44+ V1 actions across 4 files
7. **Clean-slate DB migration** — all V1 data dropped, V2 schema simplified
8. **No V1→V2 migration docs exist** — no deprecation markers or migration guides
9. **agents/ subdirectory should be deleted or consolidated** — 5 of 6 agent docs describe non-existent agents
10. **V2 reuses V1-compatible persistence format** — finalizeRun() writes V1-shaped run_summary/variants

## Open Questions

1. Should V1 agent docs be archived or deleted entirely?
2. Should architecture.md be rewritten from scratch or restructured with V1 as "historical" appendix?
3. What level of detail should V2 docs have? (V1 docs are extremely detailed; V2 is much simpler)
4. Should the README reading order be completely rewritten?
5. Should visualization.md be rewritten to only cover the 3 remaining experiment pages?
