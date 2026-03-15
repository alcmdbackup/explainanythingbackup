# Rebuild Evolution Cleanly Research

## Problem Statement
Rebuild the evolution pipeline into evolution V2. The goal is to do this incrementally using testable milestones, greatly simplifying the system and improving understanding of how it works.

## Requirements (from GH Issue #712)
Rebuild the evolution pipeline into evolution V2. Do this incrementally using testable milestones, so the system can be greatly simplified and better understood.

## High Level Summary

The evolution system is **123K LOC across 564 files** — a substantial subsystem that has grown organically through multiple refactoring projects. While functional, it carries significant complexity debt: 14 agent classes (2 dead), 85 server actions, 21 DB tables, and 56% over-engineered pipeline state. A V2 rebuild can dramatically simplify by starting from the minimum viable core (7 modules, 4-5 agents) and incrementally adding features back only when justified by quality impact.

### Key Metrics

| Area | Files | Production LOC | Test LOC |
|------|-------|----------------|----------|
| Core library (evolution/src/lib/) | 136 | 34,508 | — |
| Agents (evolution/src/lib/agents/) | 32 | 10,598 | — |
| Core infra (evolution/src/lib/core/) | 66 | 17,070 | — |
| Services (evolution/src/services/) | 29 | 13,788 | — |
| UI components (evolution/src/components/) | 85 | 9,850 | — |
| Scripts (evolution/scripts/) | 24 | 6,752 | — |
| Admin pages (src/app/admin/evolution/) | 62 | 10,105 | — |
| All test files | 130 | — | 35,749 |
| DB migrations (evolution-related) | 66 | 2,530 | — |
| **Total** | **564** | **~88K** | **~36K** |

## Key Findings

### 1. Pipeline Core Orchestration (1,597 LOC)

| File | LOC | Role |
|------|-----|------|
| pipeline.ts | 904 | Main orchestrator — heavily nested, 25+ imports |
| supervisor.ts | 213 | Phase mgmt, agent ordering (hardcoded 13-agent list) |
| state.ts | 320 | Immutable state with dual in-place/immutable API |
| reducer.ts | 32 | Pure reducer — well designed |
| actions.ts | 128 | 8 action types with duplicate switch statements |

**Complexity hotspots**: pipeline.ts has 4-level nested try-catch, state mutation via closures, fragmented resume logic, and scattered timeout management.

### 2. Agent Inventory (14 classes, 2 dead)

| Agent | LOC | LLM Calls | Complexity | Status |
|-------|-----|-----------|-----------|--------|
| MetaReviewAgent | 253 | 0 | Simple | Keep |
| ProximityAgent | 221 | 0 | Simple | Keep (required) |
| GenerationAgent | 150 | 3 | Simple | Keep (required) |
| ReflectionAgent | 164 | ≤3 | Simple | Keep |
| OutlineGenerationAgent | 317 | 6 | Medium | Optional |
| CalibrationRanker | 300 | Variable | Medium | **DEAD — absorbed into RankingAgent** |
| DebateAgent | 357 | 4 | Medium | Optional |
| IterativeEditingAgent | 375 | ≤9 | Med-High | Optional |
| EvolutionAgent | 404 | 3-5 | Med-High | Recommended |
| TreeSearchAgent | 173 | Variable | Med-High | Optional |
| SectionDecompositionAgent | 224 | Variable | Med-High | Optional |
| Tournament | 457 | Variable | Complex | **DEAD — absorbed into RankingAgent** |
| RankingAgent | 706 | Variable | Complex | Keep (required) |
| PairwiseRanker | 357 | Variable | Medium | Utility (not pipeline agent) |

**Minimal V2 set (4-5 agents)**: generation, ranking, proximity, evolution, + optionally reflection (unlocks editing agents).

### 3. Pipeline State (56% over-engineered)

| Category | Fields | Essential | Over-Engineered |
|----------|--------|-----------|-----------------|
| Pool & Ranking | pool, poolIds, ratings, matchCounts, matchHistory | 5/5 | No |
| Iteration | iteration, originalText, newEntrantsThisIteration | 2/3 | newEntrants recomputable |
| Analysis | dimensionScores, allCritiques, diversityScore, metaFeedback | 0/4 | Move to execution_detail |
| Arena | lastSyncedMatchIndex | 0/1 | Move to run metadata |
| Dead fields | similarityMatrix, debateTranscripts, treeSearchResults, sectionState | 0/4 | Remove entirely |

**Minimal state**: `{originalText, iteration, pool, poolIds, ratings, matchCounts, matchHistory}` — ~435 KB vs current ~685 KB.

### 4. Services Layer (85 server actions, 5,829 LOC)

| File | LOC | Actions | Assessment |
|------|-----|---------|-----------|
| evolutionVisualizationActions | 1,580 | 14 | Over-engineered — should split |
| arenaActions | 1,192 | 14 | Moderate — split analytics out |
| experimentActions | 895 | 17 | Well-structured but dense |
| evolutionActions | 755 | 12 | Self-contained |
| strategyRegistryActions | 447 | 9 | Well-designed |
| promptRegistryActions | 317 | 7 | Clean & minimal |
| variantDetailActions | 301 | 5 | Clean & purposeful |
| evolutionRunnerCore | 258 | 0 | Business logic only |
| costAnalyticsActions | 84 | 1 | Perfect size |

### 5. Database Schema (21 tables, 8 RPCs)

**Core tables (5)**: evolution_runs, evolution_variants, evolution_checkpoints, evolution_arena_entries, evolution_arena_elo

**Supporting (8)**: run_logs, agent_invocations, budget_events, agent_metrics, strategy_configs, agent_cost_baselines, arena_topics, arena_comparisons

**Experiment (2)**: evolution_experiments, evolution_experiment_rounds

**Essential RPCs**: claim_evolution_run, checkpoint_and_continue, sync_to_arena

**Removable RPCs**: update_strategy_aggregates (can move to app layer)

### 6. Cross-Cutting Coupling

Evolution has **12+ hard dependencies** on the main app:
- Supabase client (in 12+ files, no abstraction)
- LLM service (callLLM — no adapter)
- Logger, Auth, Pricing, Schemas, Error handling, Audit log, Markdown diffing

**Good news**: Agent core logic is relatively pure. Services layer is the coupling bottleneck.

**Consumer interface is bimodal**:
- Execution mode (cron/API): narrow, deep — prep → execute → checkpoint
- Observability mode (admin UI): broad, shallow — 52 pages reading via server actions

### 7. Dead Code & Legacy

**Confirmed dead**: CalibrationRanker class, Tournament class (both absorbed into RankingAgent)

**Backward compat shims** (removable after data ages 3+ months):
- eloRatings → ratings format conversion
- EvolutionRunSummaryV1Schema → V3 transform
- plateau & budgetCaps deprecated config fields

**Feature-flagged**: flowCritique (optional agent, inline in ranking)

### 8. Prior Refactoring Projects

| Project | Status | Key Learning |
|---------|--------|-------------|
| Rearchitect into Framework (Feb 2026) | Completed | Framework approach works; clear service separation |
| Experiments vs Strategies Refactor (Feb 2026) | Planned | Pre-register strategies at creation, not post-completion |
| Rework Tournament & Calibration (Mar 2026) | Planned | Merge into single RankingAgent; expected 40-60% LLM call reduction |
| Simplify Pipeline (Feb 2026) | Planned | Backward-compatible views critical for zero-downtime deploys |

### 9. Test Infrastructure (163 files, 2,380 tests)

**Reusable patterns**:
- Centralized mock factories in `evolution-test-helpers.ts`
- Chainable Supabase mock + Proxy-based advanced tracking
- Override-based ExecutionContext factory
- Per-test LLM response queuing
- FK-safe cleanup utilities

**Preservation estimate**: ~40% of tests preservable (rating, comparison, format validation, cost calculation). Pipeline/agent/service tests need rewrite.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/architecture.md — Pipeline orchestration, two-phase design
- evolution/docs/evolution/data_model.md — Core primitives, dimensional queries
- evolution/docs/evolution/entity_diagram.md — ERD of all entities
- evolution/docs/evolution/reference.md — Config, flags, budget, schema, key files
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill rating, Swiss tournament
- evolution/docs/evolution/README.md — Overview and reading order
- evolution/docs/evolution/arena.md — Cross-method comparison system
- evolution/docs/evolution/experimental_framework.md — Per-run metrics, bootstrap CIs
- evolution/docs/evolution/curriculum.md — Learning curriculum
- evolution/docs/evolution/visualization.md — Dashboard components, server actions

### Prior Project Docs
- docs/planning/rearchitect_evolution_into_framework_20260207/
- docs/planning/experiments_vs_strategies_refactor_evolution_20260224/
- docs/planning/rework_tournament_and_calibration_agent_evolution_20260312/
- docs/planning/simplify_evolution_pipeline_20260221/

## Code Files Read (via 16 research agents)

### Pipeline Core
- evolution/src/lib/core/pipeline.ts (904 LOC)
- evolution/src/lib/core/supervisor.ts (213 LOC)
- evolution/src/lib/core/state.ts (320 LOC)
- evolution/src/lib/core/reducer.ts (32 LOC)
- evolution/src/lib/core/actions.ts (128 LOC)

### All 14 Agent Files
- evolution/src/lib/agents/base.ts, generationAgent.ts, rankingAgent.ts, tournament.ts
- calibrationRanker.ts, pairwiseRanker.ts, reflectionAgent.ts, metaReviewAgent.ts
- iterativeEditingAgent.ts, debateAgent.ts, outlineGenerationAgent.ts
- treeSearchAgent.ts, sectionDecompositionAgent.ts, evolvePool.ts, proximityAgent.ts

### Core Infrastructure
- evolution/src/lib/types.ts (859 LOC)
- evolution/src/lib/config.ts (92 LOC)
- evolution/src/lib/core/configValidation.ts, costTracker.ts, costEstimator.ts
- evolution/src/lib/core/rating.ts, pool.ts, strategyConfig.ts
- evolution/src/lib/comparison.ts, core/comparisonCache.ts, core/reversalComparison.ts
- evolution/src/lib/core/persistence.ts, budgetRedistribution.ts, eloAttribution.ts

### Services Layer (all 9 files)
- evolution/src/services/evolutionActions.ts through costAnalyticsActions.ts

### Execution Infrastructure
- evolution/scripts/evolution-runner.ts (425 LOC)
- evolution/src/services/evolutionRunnerCore.ts (259 LOC)
- src/app/api/evolution/run/route.ts (108 LOC)
- src/app/api/cron/evolution-watchdog/route.ts (161 LOC)
- src/app/api/cron/experiment-driver/route.ts (332 LOC)
- evolution/src/lib/core/seedArticle.ts (67 LOC)
- evolution/src/lib/index.ts (285 LOC) — public API barrel

### UI Components & Pages
- Full inventory of evolution/src/components/evolution/ (85 files)
- Full inventory of src/app/admin/evolution/ (62 files)

### Test Infrastructure
- evolution/src/testing/evolution-test-helpers.ts
- Representative agent, service, and integration test files

## Open Questions

1. **What's the actual quality impact per agent?** — Need to analyze completed runs to see which agents produce winning variants most often
2. **Can we use a simpler rating system?** — OpenSkill is powerful but adds complexity; simple Elo or even win-rate might suffice for V2
3. **Should V2 be a new directory or evolve in-place?** — Clean break vs incremental migration trade-offs
4. **What's the minimum DB schema for V2?** — Could we start with just runs + variants + ratings?
5. **Should the two-phase (EXPANSION→COMPETITION) model be simplified?** — Single-phase with all agents could be simpler
