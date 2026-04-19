# Multi Iteration Strategy Support Evolution Research

## Problem Statement
Currently the evolution pipeline uses a single-strategy configuration for all iterations within a run. This project enables multiple iterations to be configured independently within strategies (different agent types, budgets, models per iteration) and provides per-iteration visibility in the admin dashboard. It also reworks seed variant handling so seed variants are not loaded directly into runs but instead serve as the basis for generation and are clearly marked in the arena.

## Requirements (from GH Issue #986)
- Goal
    - Enable multiple iterations to be configured within strategies
    - Allow visibility into what is happening in each iteration, within evolution admin dashboard
- Look into how seed article works today - investigate
    - For cleanness - don't load seed variant into run at all
    - If no seed variant, then generate it and attach it to arena topic, but do not load it directly into run
    - Seed variant is used as basis for every variant in initial iteration
    - Seed variant is clearly marked in arena leaderboard, for each prompt
- Rework strategy to support flexible multi-iteration framework
    - Strategy setup UI split into separate pages - initial setup + setup for iterations
    - Strategy defines of
        - models for rank/generation
        - generation temperature, etc
        - how to enforce budget within rounds
            - Use existing fraction of budget or multiples of agent cost setup
            - Cost prediction will need to be displayed differently per iteration, depending on agent used
        - # iterations
        - keep whatever else is there today, do an audit to make sure we move it accordingly
        - total budget
    - Each iteration (separate page in setup wizard) can specify
        - Type of agent
        - Max # to launch is optional
        - Budget to allocate - enforce total between iterations adds up to ≤ total
        - Budget enforcement based on settings and agent used (settings toggled in earlier setup)
- Budget enforcement
    - Budget enforcement at the iteration, AND run level both
    - This matches the budget allocation we have both at iteration and run level
- Run details - analysis
    - Timeline
        - Should show each iteration
    - Run should allow debugging each iteration
    - Cost estimates
        - Overall view - show budget and realized per iteration
        - Can filter by iteration, which shows results for each iteration
    - Variants
        - Add column to show which iteration created in
- Strategy details view
    - Config should show details for each iteration
- Variants
    - Should always store iteration they were created in
    - Variants should always surface their parent variant (which for now will always be seed variant)
    - "Iteration generated" and "parent variant" should be surfaced in
        - Variants tab of run
        - Arena leaderboard for variants (for a given prompt)
- Strategies detail view - variants tab
    - Create variants tab of strategies (create this, pattern it after similar one from runs)

## High Level Summary

Research conducted via 20 parallel exploration agents across 5 rounds. Key architectural findings:

1. **The orchestrator loop is config-driven but currently receives ONE immutable config for all iterations.** Per-iteration overrides require a resolution function in the loop.
2. **LLM client already supports per-call model switching** via `opts.model` — no client recreation needed.
3. **Seed variant is deeply embedded as pool[0]** — removal requires decoupling seed from pool membership while keeping it as generation source.
4. **Budget enforcement is run-level only** — per-iteration caps require tracking iteration-start budget and a new floor resolver.
5. **`evolution_variants.generation` stores `v.version` (always 0), NOT iteration number.** The `iterationBorn` field exists in-memory but is not persisted. This is a critical gap.
6. **Parent variant IDs are always empty** for generated variants — seed is not set as parent despite being the generation source.
7. **Strategy creation uses a modal FormDialog**, not a multi-page wizard. ExperimentForm's 3-step pattern is the reference for building a multi-page strategy wizard.
8. **Only 3 generation strategies exist** (structural_transform, lexical_simplify, grounding_enhance) despite docs mentioning 8. The `generationGuidance` weighted selection is defined in schema but not used by the orchestrator.

## Key Findings

### 1. Iteration Loop Mechanics
- **File**: `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (696 lines)
- `nextIteration()` (lines 297-353) is oracle-driven: iter 0 = generate, iter 1+ = swiss until convergence/budget/kill
- All agents receive the same `resolvedConfig` via `AgentContext.config`
- `MAX_ORCHESTRATOR_ITERATIONS = 20` hard cap (line 70)
- `config.iterations` is deprecated/ignored — orchestrator decides when to stop
- LLM client created once at line 198 with fixed `generationModel`
- Budget floors computed once before loop (lines 292-294)

### 2. Strategy Config & Storage
- **File**: `evolution/src/lib/schemas.ts` (lines 357-423)
- `StrategyConfig` defines: generationModel, judgeModel, iterations, strategiesPerRound, budgetUsd, generationGuidance, maxVariants, maxComparisons, 4 budget floor fields, generationTemperature
- Config stored as JSONB in `evolution_strategies.config`
- Hash computed from only 3 fields: `{generationModel, judgeModel, iterations}` — other fields don't affect dedup
- Config is immutable after creation (edit only updates name/description/status)
- **File**: `evolution/src/lib/pipeline/setup/buildRunContext.ts` (lines 246-264) — maps StrategyConfig → EvolutionConfig at run startup

### 3. Strategy Wizard UI
- **File**: `src/app/admin/evolution/strategies/page.tsx` (585 lines)
- Strategy creation uses a **single FormDialog modal** with fields: name, description, generationModel, judgeModel, iterations, generationGuidance (custom), maxVariants, maxComparisons, budgetFloors (custom), generationTemperature
- Custom composite fields: `GenerationGuidanceField` (lines 112-184), `BudgetFloorsField` (lines 197-362)
- BudgetFloorsField has dual-mode (fraction vs agent-multiple) with live cost preview via `estimateAgentCostPreviewAction`
- **File**: `src/app/admin/evolution/_components/ExperimentForm.tsx` (545 lines) — the multi-step wizard reference with 3 steps (setup→strategies→review), step state management, validation per step

### 4. Seed Variant Lifecycle
- **File**: `evolution/src/lib/pipeline/setup/buildRunContext.ts` (lines 142-193)
- For prompt-based runs, loads highest-rated arena seed (`generation_method='seed'`, `synced_to_arena=true`)
- `EVOLUTION_REUSE_SEED_RATING` (default true) controls UUID/rating reuse
- Seed added to pool[0] with `strategy='seed_variant'` and optional `reusedFromSeed=true`
- `loadArenaEntries()` called with `excludeId: seedVariantRow?.id` to prevent double-loading
- **File**: `evolution/src/lib/pipeline/finalize/persistRunResults.ts`
  - Reused seed gets optimistic-concurrency UPDATE (not INSERT)
  - Collision detection via WHERE `mu+sigma+arena_match_count` match
- Arena leaderboard shows `generation_method` as plain text — **no visual seed marking**

### 5. Budget Enforcement
- **File**: `evolution/src/lib/pipeline/cost-tracker.ts` (lines 75-148)
- Reserve-before-spend with 1.3x margin; `reserve()` is synchronous for parallel safety
- Three operations: `reserve(phase, est) → recordSpend(phase, actual, reserved) → release(phase, reserved)`
- Budget tiers: <50% = low (40 comparisons), 50-80% = medium (25), >80% = high (15)
- **File**: `evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts` — `resolveParallelFloor()` and `resolveSequentialFloor()`
- Per-iteration budget enforcement doesn't exist — would need iteration-start budget snapshot + iteration floor resolver

### 6. Variant Storage & Display Gaps
- **DB schema** (`evolution/src/lib/schemas.ts` lines 142-174): `generation` and `parent_variant_id` columns exist
- **Critical**: `generation` stores `v.version` (always 0), not iteration number. `iterationBorn` exists in-memory only.
- **Critical**: `parentIds` always `[]` for generated variants — seed not set as parent
- **Run Variants Tab** (`evolution/src/components/evolution/tabs/VariantsTab.tsx`): Shows "Gen" column (always 0), no parent variant column
- **Arena Leaderboard** (`src/app/admin/evolution/arena/[topicId]/page.tsx`): No generation column, no parent column, no seed marking
- **Variant Entity** (`evolution/src/lib/core/entities/VariantEntity.ts`): List columns missing generation and parent

### 7. Run Detail Tabs — Current Per-Iteration State
- **Timeline Tab**: ALREADY per-iteration — groups invocations by iteration with subtotals (duration, cost)
- **Cost Estimates Tab**: Has iteration data in invocation table but NO grouping/filtering by iteration
- **Variants Tab**: No iteration information (generation is always 0)
- **Snapshots Tab**: ALREADY per-iteration — shows pool state, ratings, discards per iteration

### 8. Strategy Detail Page
- **File**: `src/app/admin/evolution/strategies/[strategyId]/page.tsx` (148 lines)
- 5 tabs: Metrics, Cost Estimates, Runs, Configuration, Logs
- **No Variants tab** — would need `getStrategyVariantsAction` (query via strategy_id→runs→variants)
- Config tab renders flat StrategyConfigDisplay — no per-iteration breakdown
- Runs tab uses `EntityTable` with `getEvolutionRunsAction({ strategy_id })`

### 9. Agent System
- 4 agent types: `CreateSeedArticleAgent`, `GenerateFromSeedArticleAgent`, `SwissRankingAgent`, `MergeRatingsAgent`
- Agents instantiated directly in orchestrator, not via registry
- `agentRegistry.ts` exists but is NOT used for dispatch — only for merging invocation metrics
- Per-iteration agent type selection requires replacing hardcoded dispatch with config-driven lookup

### 10. LLM Client — Per-Call Model Already Supported
- **File**: `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` (line 60)
- `model = opts.model ?? defaultModel` — per-call model override already works
- Cost estimation dynamic per-model via `getModelPricing(model)`
- All agents already pass `ctx.config.generationModel` / `ctx.config.judgeModel` per-call
- **No new LLM infrastructure needed** — just pass different model in per-iteration config

### 11. Iteration Snapshots
- **Schema**: `evolution/src/lib/schemas.ts` (lines 991-1012)
- Captures: iteration, iterationType, phase, poolVariantIds, ratings, matchCounts, discardedVariantIds
- **Does NOT capture**: iteration config, costs, budget state, agent model used
- Stored as JSONB array on `evolution_runs.iteration_snapshots`
- Written at finalization only (not streaming)

### 12. Test Infrastructure
- 122 test files across evolution/
- Key test files: `runIterationLoop.test.ts` (520 lines), `buildRunContext.test.ts` (543 lines), `ExperimentForm.test.tsx` (538 lines)
- Mock patterns: `createV2MockLlm`, `createSupabaseChainMock`, module-level jest.mock for agents
- UI tests use React Testing Library

## Open Questions — RESOLVED

1. **Seed variant removal from pool**: ✅ **Remove from pool.** Seed is reference material, not a competitor. Generated variants compete against each other only. Seed still used as generation source text. Arena leaderboard shows seed quality cross-run.

2. **Per-iteration config hashing**: ✅ **Include in hash.** Different iteration plans = different strategy rows. Clean lineage, meaningful experiment comparison.

3. **Iteration count flexibility**: ✅ **Hybrid.** User defines the iteration sequence (agent type + budget per iteration). Orchestrator respects convergence/kill/budget as early-exit within an iteration, but a converged iteration doesn't kill the run — the next iteration still runs. Key details:
   - **Two-layer budget enforcement**: Run-level V2CostTracker (safety net, kills run) + per-iteration budget (stops iteration only, run continues)
   - **Convergence is per-iteration**: Swiss convergence stops that iteration, next iteration still executes
   - **Stop reasons are per-iteration**: `iteration_budget_exceeded`, `iteration_converged`, etc. — distinct from run-level `total_budget_exceeded`, `killed`, `deadline`
   - **Iteration 3 runs even if iteration 2 converged**: New generate agents may produce variants that un-converge things

4. **generationGuidance**: ✅ **Leave out.** Orthogonal to multi-iteration support. Follow-up project.

5. **generation field fix**: ✅ **Fix existing column.** Change `generation = v.version` to `generation = v.iterationBorn` in persistRunResults.ts. Existing data (all 0) is correct for old single-iteration model.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/data_model.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- evolution/docs/agents/overview.md
- docs/feature_deep_dives/evolution_metrics.md

## Code Files Read
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — orchestrator loop, nextIteration(), dispatch logic
- `evolution/src/lib/pipeline/infra/types.ts` — EvolutionConfig, EvolutionResult, BudgetFloorObservables
- `evolution/src/lib/schemas.ts` — strategyConfigSchema, evolutionConfigSchema, iterationSnapshotSchema, variant schemas
- `evolution/src/lib/core/types.ts` — AgentContext
- `evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts` — parallel/sequential floor resolution
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — seed variant loading, StrategyConfig→EvolutionConfig mapping
- `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` — seed article generation
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — config hashing, upsert
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — variant persistence, arena sync, seed optimistic-concurrency
- `evolution/src/lib/pipeline/cost-tracker.ts` — V2CostTracker reserve-before-spend
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` — cost estimation functions
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — AgentCostScope
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — LLM client with per-call model support
- `evolution/src/lib/pipeline/arena.ts` — loadArenaEntries, syncToArena
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — GFSA agent, strategy defs, variant creation
- `evolution/src/lib/core/agents/SwissRankingAgent.ts` — swiss ranking agent
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` — merge agent
- `evolution/src/lib/core/agents/createSeedArticle.ts` — seed article agent
- `evolution/src/lib/core/agentRegistry.ts` — agent registration (lazy, not used for dispatch)
- `evolution/src/lib/core/agentNames.ts` — agent name constants, cost metric mapping
- `evolution/src/lib/core/entities/VariantEntity.ts` — variant entity definition, columns
- `evolution/src/lib/core/entities/StrategyEntity.ts` — strategy entity definition, tabs
- `evolution/src/lib/types.ts` — Variant type (version, iterationBorn, parentIds)
- `evolution/src/services/strategyRegistryActions.ts` — strategy CRUD actions
- `evolution/src/services/experimentActions.ts` — experiment + run creation
- `evolution/src/services/arenaActions.ts` — arena entries, ArenaEntry interface
- `evolution/src/services/evolutionActions.ts` — run/variant fetching, snapshots
- `evolution/src/services/costEstimationActions.ts` — cost estimate data fetching
- `evolution/src/services/variantDetailActions.ts` — variant detail fetching
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — run variants tab
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — timeline (already per-iteration)
- `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` — cost estimates tab
- `evolution/src/components/evolution/tabs/SnapshotsTab.tsx` — snapshots (already per-iteration)
- `evolution/src/components/evolution/dialogs/FormDialog.tsx` — form dialog component
- `src/app/admin/evolution/strategies/page.tsx` — strategy list + create/edit modal
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — strategy detail page
- `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` — config display component
- `src/app/admin/evolution/_components/ExperimentForm.tsx` — 3-step experiment wizard
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — arena leaderboard
- `src/app/admin/evolution/arena/[topicId]/arenaCutoff.ts` — eligibility cutoff
- `src/app/admin/evolution/runs/[runId]/page.tsx` — run detail page
- `src/app/admin/evolution/variants/page.tsx` — variants list
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` — variant detail
