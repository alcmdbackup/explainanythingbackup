# Bring Back Editing Agents Evolution Research

## Problem Statement

The V2 evolution pipeline currently has only two work-agent types — `GenerateFromPreviousArticleAgent` (full-article regeneration) and `SwissRankingAgent` (pairwise ranking) — plus the seed agent and `MergeRatingsAgent`. There is no agent that performs targeted edits, decomposes an article into sections for parallel editing, or restructures via an outline. Three V1 agents that covered these gaps were deleted in commit `4f03d4f6` (2026-03-14, M8 of `rebuild_evolution_cleanly_20260314`) and have not been ported to V2. We want to bring them back.

## Requirements (from GH Issue #NNN)

I want to reintroduce some of the editing agents we've had historically. Please look through github history and find the various editing agents including iterativeediting agent and outline editing agent

## High Level Summary

### V1 editing agents (now deleted)

| Agent | First added | Source location | Behavior |
|-------|-------------|-----------------|----------|
| `IterativeEditingAgent` | PR #343, 2026-02-06, commits `e5f5ac33` / `8f254eec` | `evolution/src/lib/agents/iterativeEditingAgent.ts` (originally `src/lib/evolution/agents/iterativeEditingAgent.ts`) | Evaluate → targeted edit → blind diff-judge (CriticMarkup + 2-pass direction reversal). Reads `state.allCritiques` from `ReflectionAgent` + an inline open-ended review. |
| `OutlineGenerationAgent` | Originating project `outline_based_generation_editing_20260206` | `evolution/src/lib/agents/outlineGenerationAgent.ts` | 4-step pipeline: outline → expand → polish → verify. Generate-only in V1. |
| `SectionDecompositionAgent` | Originating project (M-series in V1) | `evolution/src/lib/agents/sectionDecompositionAgent.ts` | Parses H2s, filters eligible sections (≥100 chars, not preamble), edits each in parallel up to 2 cycles, stitches back, format-validates. |

All three were deleted in `4f03d4f6` (2026-03-14, "refactor(evolution): delete V1 pipeline, agents, subsystems (M8)").

### Other V1 agents wiped in the same M8 commit

These are not strictly "editing" agents but are the surrounding cast that earlier projects fed into the editing loop:

- `evolvePool` / `EvolutionAgent` — mutate_clarity, mutate_structure, crossover, creative_exploration tactics
- `DebateAgent` — synthesizes from two parents
- `ReflectionAgent` — 5-dimension critique (clarity, structure, engagement, precision, coherence). Its output (`state.allCritiques`) was the primary input to `IterativeEditingAgent`.
- `MetaReviewAgent`, `ProximityAgent`, `TreeSearchAgent`

### Prior in-progress branches we're inheriting

- `feat/create_editing_agent_evolution_20260415` — only the `/initialize` skeleton; no plan content.
- `feat/introduce_editing_agent_evolution_20260421` — has a **fully-fleshed 7-phase plan + research doc** at `docs/planning/introduce_editing_agent_evolution_20260421/`. Scope: bring back all three V1 agents on the V2 `Agent` base class, extend `OutlineGenerationAgent` with an `edit` mode, and add a parent-vs-child `TextDiff` UI to the invocation-detail page. Implementation never landed; the design work is the most directly reusable artifact.

### Current V2 agent inventory (in `main`)

`evolution/src/lib/core/agents/`:
- `createSeedArticle.ts` (+ test)
- `generateFromPreviousArticle.ts` (+ test)
- `MergeRatingsAgent.ts` (+ test)
- `SwissRankingAgent.ts` (+ test)

A `ReflectAndGenerateFromPreviousArticleAgent` was built on a different branch (commit `1f4c8bc1`) but never merged to `main`.

### Surfaces still in the V2 tree that anticipate the resurrection

- **Orphaned Zod schemas** — `iterativeEditingExecutionDetailSchema`, `sectionDecompositionExecutionDetailSchema`, `outlineGenerationExecutionDetailSchema` in `evolution/src/lib/schemas.ts` were left in place when the agents were deleted.
- **Orphaned `DETAIL_VIEW_CONFIGS` entries** — `iterativeEditing`, `sectionDecomposition`, `outlineGeneration` keys in `evolution/src/lib/core/detailViewConfigs.ts`.
- **Free-form `agent_name`** — `evolution_agent_invocations.agent_name` is `TEXT`, no DB migration needed to re-add agent identifiers.
- **`InvocationEntity.listFilters`** dropdown already lists 7 of 8 V1 agent names.

This makes the resurrection cheaper than a from-scratch design.

## Documents Read

- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- All 14 evolution docs under `evolution/docs/**/*.md`
- `docs/planning/iterative_editing_agent_20260203/iterative_editing_agent_20260203_planning.md` (V1 plan)
- `docs/planning/iterative_editing_agent_20260203/iterative_editing_agent_20260203_research.md` (V1 research with diff-judge bias-mitigation rationale)
- `docs/feature_deep_dives/multi_iteration_strategies.md` (config-driven `iterationConfigs[]`)
- `docs/feature_deep_dives/variant_lineage.md` (`parent_variant_id`, `agent_invocation_id`, attribution metrics)
- `docs/feature_deep_dives/evolution_metrics.md` (per-iteration cost tracking, dispatch prediction)
- Prior in-progress plan: `git show feat/introduce_editing_agent_evolution_20260421:docs/planning/introduce_editing_agent_evolution_20260421/introduce_editing_agent_evolution_20260421_planning.md`

## Code Files Read

Will be populated during the dedicated `/research` pass — at this stage we have only surveyed via git history. Anticipated reads:

- V1 agent sources via `git show 4f03d4f6^:evolution/src/lib/agents/{iterativeEditingAgent,outlineGenerationAgent,sectionDecompositionAgent}.ts`
- V1 helpers: `evolution/src/lib/section/*` (sectionParser, sectionStitcher, sectionEditRunner)
- V1 diff-judge: `evolution/src/lib/diffComparison.ts` (and the V1 dependency on `RenderCriticMarkupFromMDAstDiff`)
- V2 Agent base class: `evolution/src/lib/core/Agent.ts`
- V2 dispatch: `evolution/src/lib/pipeline/loop/runIterationLoop.ts`, `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`
- V2 schemas: `evolution/src/lib/schemas.ts` (orphan editing schemas)
- V2 detail views: `evolution/src/lib/core/detailViewConfigs.ts`
- V2 metrics registry: `evolution/src/lib/metrics/registry.ts`
- Strategy wizard UI: `src/app/admin/evolution/strategies/new/page.tsx`
- Invocation detail UI: `src/app/admin/evolution/invocations/[invocationId]/ConfigDrivenDetailRenderer.tsx`, `InvocationParentBlock.tsx`
- Existing `TextDiff` component: `evolution/src/components/evolution/visualizations/TextDiff.tsx`
