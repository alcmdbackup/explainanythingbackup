# Simplify Reorganize Evolution Pipeline Rules Research

## Problem Statement
The evolution pipeline's PoolSupervisor currently manages complex phase transitions (EXPANSION→COMPETITION), multi-layered config validation, and agent gating logic that has grown organically. This project simplifies and reorganizes the supervisor's phase management, config validation (`validateStrategyConfig`, `validateRunConfig`, `resolveConfig`), and the rules governing which agents run when. The goal is to reduce complexity while preserving correctness, making the pipeline easier to understand, test, and extend.

## Requirements (from GH Issue #503)
- Simplify how the supervisor works with COMPETITION and EXPANSION phases
- Simplify config validations (`validateStrategyConfig`, `validateRunConfig`, `resolveConfig`)
- Reorganize the rules governing agent gating and phase transitions

## High Level Summary

The pipeline rules system spans ~20 files with 4 layers of concern: **config resolution** (merging defaults + overrides), **config validation** (strategy-level lenient + run-level strict), **runtime gating** (supervisor phase detection + agent filtering + budget redistribution + canExecute guards), and **checkpoint/resume** (supervisor state serialization + mid-iteration agent tracking). There are 108 tests across 4 test files covering the core rules. The key architectural patterns are:

1. **Two-phase supervisor** (`PoolSupervisor`, 314 LOC) — manages EXPANSION→COMPETITION transitions with one-way phase lock, strategy rotation, plateau detection, and stopping conditions
2. **Three-layer agent gating** — `getActiveAgents()` filters by phase + `enabledAgents` + `singleArticle`, then `canExecute()` on each agent checks runtime pool state, then budget redistribution scales caps
3. **Dual config validation** — `validateStrategyConfig` (lenient, at queue time) and `validateRunConfig` (strict, after `resolveConfig` merges defaults), plus duplicated checks in `PoolSupervisor.validateConfig`
4. **Config resolution with auto-clamping** — `resolveConfig` deep-merges per-run overrides and auto-clamps expansion parameters for short runs, called from 5 sites across 3 runners
5. **Three parallel runners** — Cron (with timeout + continuation), Batch (no timeout), Inline (no resume) — each with different capability matrices
6. **Checkpoint/resume with supervisor state** — end-of-iteration supervisor state serialized alongside pipeline state, mid-iteration resume tracks `completedAgents`

## Detailed Findings

### 1. PoolSupervisor (`evolution/src/lib/core/supervisor.ts`, 314 LOC)

**Purpose**: Drives EXPANSION→COMPETITION phase transitions with one-way lock and plateau detection.

**Key types**:
- `SupervisorConfig` (lines 35-46) — flattened from `EvolutionRunConfig` via `supervisorConfigFromRunConfig` (lines 48-62)
- `PhaseConfig` (lines 19-25) — returned by `getPhaseConfig()`, contains `activeAgents`, `generationPayload`, `calibrationPayload`
- `SupervisorResumeState` (lines 28-33) — serializable for checkpoint persistence
- `ExecutableAgent` (line 65) — `AgentName | 'ranking'` — the `'ranking'` sentinel dispatches to calibration (EXPANSION) or tournament (COMPETITION)

**Phase detection** (`detectPhase`, lines 146-155):
- Returns COMPETITION if `state.iteration >= expansionMaxIterations` (safety cap at iteration 8)
- OR if `poolSize >= expansionMinPool` AND `diversity >= expansionDiversityThreshold`
- Otherwise returns EXPANSION

**Phase transition** (`beginIteration`, lines 161-177):
- Checks `_phaseLocked ?? detectPhase(state)` — once COMPETITION, always COMPETITION
- On transition: clears ordinalHistory/diversityHistory, resets strategy rotation to -1
- In COMPETITION: advances strategy rotation index each iteration

**Agent filtering** (`getActiveAgents`, lines 92-105):
- Filters `AGENT_EXECUTION_ORDER` (13 entries including `'ranking'` sentinel)
- `'ranking'` always passes (pipeline swaps calibration/tournament by phase)
- EXPANSION: only allows `generation`, `ranking`, `proximity`
- singleArticle: excludes `generation`, `outlineGeneration`, `evolution`
- Required agents always pass; optional agents need to be in `enabledAgents` (or `enabledAgents` undefined)

**Stopping conditions** (`shouldStop`, lines 226-249):
1. Quality threshold (singleArticle only): all critique dimensions >= 8
2. Plateau (COMPETITION only): top ordinal improvement < `threshold × 6` over `window` iterations
3. Degenerate: plateau + diversity < 0.01
4. Budget exhausted: available < $0.01
5. Max iterations: `state.iteration > maxIterations`

**Constructor validation** (`validateConfig`, lines 120-140):
- Validates `expansionDiversityThreshold` in [0,1]
- If `expansionMaxIterations > 0`: validates `expansionMinPool >= 5`, `maxIterations > expansionMaxIterations`, `maxIterations >= expansionMaxIterations + plateauWindow + 1`

### 2. Config Resolution (`evolution/src/lib/config.ts`, 98 LOC)

**`DEFAULT_EVOLUTION_CONFIG`** (lines 7-38): The canonical defaults:
- `maxIterations: 15`, `budgetCapUsd: 5.00`
- `plateau: { window: 3, threshold: 0.02 }`
- `expansion: { minPool: 15, minIterations: 3, diversityThreshold: 0.25, maxIterations: 8 }`
- `generation: { strategies: 3 }`, `calibration: { opponents: 5, minOpponents: 2 }`, `tournament: { topK: 5 }`
- 12 budget cap entries summing to >1.0 (intentional)
- `judgeModel: 'gpt-4.1-nano'`, `generationModel: 'gpt-4.1-mini'`

**`resolveConfig`** (lines 74-90):
- Deep-merges per-run overrides with `DEFAULT_EVOLUTION_CONFIG`
- Auto-clamps `expansion.maxIterations` when `maxIterations` is too small for default expansion window
- Formula: if `maxIterations <= expansion.maxIterations + plateau.window + 1`, clamp to `max(0, maxIterations - plateau.window - 1)`
- Emits `console.warn` on clamp

**Callsites** (5 production):
1. `index.ts:157` — `preparePipelineRun()`
2. `index.ts:229` — `prepareResumedPipelineRun()`
3. `evolutionRunnerCore.ts:149` — seed article generation (batch runner)
4. `evolutionActions.ts:569` — seed article generation (inline trigger)
5. `run-evolution-local.ts:630` — CLI runner

### 3. Config Validation (`evolution/src/lib/core/configValidation.ts`, 147 LOC)

**`validateStrategyConfig`** (lines 56-78) — lenient, for strategy UI:
- Model names: only validated when present (partial configs get defaults)
- Budget caps: keys must be known, values in [0, 1]
- `enabledAgents`: delegates to `validateAgentSelection`
- Iterations: only validated when explicitly set

**`validateRunConfig`** (lines 83-146) — strict, after `resolveConfig`:
- Model names: must be present AND valid
- Budget total: must be > 0 and finite
- Supervisor constraints (when expansion enabled): duplicates `PoolSupervisor.validateConfig` checks
- Nested bounds: plateau.window >= 1, plateau.threshold >= 0, generation.strategies > 0, calibration.opponents > 0, tournament.topK > 0

**Callsites**:
- `validateStrategyConfig`: `evolutionActions.ts:319` (queue time), `audit-evolution-configs.ts:60` (audit script)
- `validateRunConfig`: `index.ts:160` (`preparePipelineRun`), `index.ts:231` (`prepareResumedPipelineRun`)

**`isTestEntry`** (line 14): Returns true if name includes "test" (case-insensitive). Used to filter test prompts/strategies from pipeline dropdowns.

### 4. Agent Classification & Budget Redistribution (`evolution/src/lib/core/budgetRedistribution.ts`)

**Agent classification**:
- **Required** (4): `generation`, `calibration`, `tournament`, `proximity` — always run, UI shows locked
- **Optional** (9): `reflection`, `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `debate`, `evolution`, `outlineGeneration`, `metaReview`, `flowCritique`
- **Single-article disabled**: `generation`, `outlineGeneration`, `evolution`

**Agent dependencies** (`AGENT_DEPENDENCIES`):
- `reflection` → required by: `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `flowCritique`
- `tournament` → required by: `evolution`, `metaReview` (always satisfied since tournament is required)

**`computeEffectiveBudgetCaps`**: When agents are disabled, their budget share is redistributed proportionally to remaining active agents. Preserves original managed sum. Handles backward compat (undefined enabledAgents = all agents).

### 5. Agent Toggle UI (`evolution/src/lib/core/agentToggle.ts`)

**`toggleAgent(current, agent)`**: Pure function for UI state:
- Disabling an agent cascades to its dependents (e.g., disabling `reflection` also disables `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `flowCritique`)
- Enabling an agent auto-enables its optional dependencies (e.g., enabling `iterativeEditing` also enables `reflection`)
- Required agents are never in the toggle array

### 6. Pipeline Integration (`evolution/src/lib/index.ts`)

**`preparePipelineRun`** (lines 156-197): Fresh run setup:
1. `resolveConfig(overrides)` → full config
2. `validateRunConfig(config)` → throws on invalid
3. `computeEffectiveBudgetCaps(config.budgetCaps, enabledAgents, singleArticle)` → mutates config.budgetCaps
4. Creates state, costTracker, logger, llmClient
5. Returns `{ ctx, agents: createDefaultAgents(), config, costTracker, logger }`

**`prepareResumedPipelineRun`** (lines 227-271): Same flow but restores state from checkpoint, uses `createCostTrackerFromCheckpoint` for continuous budget tracking.

**`createDefaultAgents`** (lines 111-126): Constructs all 12 agents with no arguments. Single source of truth.

### 7. Pipeline Loop (`evolution/src/lib/core/pipeline.ts`)

**`executeFullPipeline`** (lines 352-482):
1. Creates `PoolSupervisor` from config via `supervisorConfigFromRunConfig`
2. Optionally restores supervisor from resume state
3. Loop: `for i from state.iteration to maxIterations`:
   - `state.startNewIteration()` (unless mid-iteration resume)
   - `supervisor.beginIteration(state)` (unless mid-iteration resume)
   - `supervisor.getPhaseConfig(state)` → activeAgents, phase
   - `supervisor.shouldStop(state, availableBudget)` → break if true
   - For each agent in `agentsToRun`:
     - `'ranking'` → dispatches `agents.calibration` (EXPANSION) or `agents.tournament` (COMPETITION)
     - `'flowCritique'` → inline `runFlowCritiques` call
     - Others → looked up on `agents` object, silently skipped if not present

### 8. Strategies UI Config Construction & Validation (`src/app/admin/quality/strategies/`)

**Strategy Registry Page** (`strategies/page.tsx`):
- `FormState` holds `enabledAgents`, `budgetCaps`, `singleArticle`, model names, iterations
- Required agents shown as locked checkboxes (cannot be toggled); optional agents use `toggleAgent`
- `agentErrors` reactive validation via `validateAgentSelection` on every toggle
- `budgetPreview` reactive via `computeEffectiveBudgetCaps` — shows real-time budget distribution
- Form submission calls `formToConfig()` → server action `upsertStrategy()` with `validateStrategyConfig()`

**Form↔Config Converters** (`strategies/strategyFormUtils.ts`):
- `formToConfig(form)`: `FormState` → `StrategyConfig` — coerces `singleArticle: false` → `undefined` to avoid persisting falsy defaults
- `rowToForm(row, defaultEnabledAgents)`: DB row → `FormState` — fills missing fields from defaults

**Strategy Config Type** (`evolution/src/lib/core/strategyConfig.ts`):
- `StrategyConfig` (lines 14-24): `generationModel`, `judgeModel`, `iterations`, `budgetCaps`, `enabledAgents?`, `singleArticle?`
- Strategy hash excludes `budgetCaps` and `agentModels` — so budget/agent-model changes don't create new strategy fingerprints

**Start Run Card** (`src/app/admin/quality/evolution/page.tsx`):
- Consumes strategy config via dropdown, no per-run config editing
- Passes strategy fields directly to `queueEvolutionRunAction`

**Queue Flow** (`evolution/src/services/evolutionActions.ts`):
- `queueEvolutionRunAction` (line ~310): validates with `validateStrategyConfig`, then snapshots strategy fields into run JSONB
- Strategy fields like `enabledAgents`, `budgetCaps`, `singleArticle` are copied into the run's `config_overrides`

### 9. Pipeline Runner Entry Points (3 runners)

**Cron Runner** (`src/app/api/cron/evolution-runner/route.ts`):
- `maxDuration: 800` (740s effective budget for safety margin)
- Delegates to `claimAndExecuteEvolutionRun()` in `evolutionRunnerCore.ts`
- Supports resume (via `loadCheckpointForResume`), prompt-based runs, and mid-iteration resume
- On timeout/error: `checkpointAndMarkContinuationPending()` for next cron pickup

**Batch Runner** (`evolution/scripts/evolution-runner.ts`):
- No timeout (runs until pipeline completes)
- No prompt-based runs (pool runs only)
- Supports resume from checkpoint
- 60s heartbeat to prevent run staleness
- Uses `claimAndExecuteEvolutionRun()` same as cron

**Inline Trigger** (`evolution/src/services/evolutionActions.ts:515-669`):
- No resume support, no timeout
- Supports prompt-based runs (triggers seed article generation)
- Direct DB claim with race detection (checks `run_status` before executing)
- Calls `resolveConfig` at line 569 for seed generation independently

**`claimAndExecuteEvolutionRun`** (`evolutionRunnerCore.ts`):
- Central orchestrator shared by cron and batch runners
- `resolveConfig` called at line 149 for seed generation
- Calls `preparePipelineRun` or `prepareResumedPipelineRun` → `executeFullPipeline`
- Handles fresh runs vs resumed runs transparently

### 10. Agent `canExecute()` Guards

Each agent has a `canExecute(ctx)` method checked at runtime before execution. These are the **third layer** of gating (after `getActiveAgents` phase filtering and `enabledAgents` config filtering):

| Agent | `canExecute()` Condition |
|---|---|
| `GenerationAgent` | `originalText.length > 0` |
| `OutlineGenerationAgent` | `originalText.length > 0` |
| `CalibrationRanker` | `newEntrantsThisIteration.length > 0 && pool.length >= 2` |
| `Tournament` | `pool.length >= 2` |
| `ProximityAgent` | `pool.length >= 2` |
| `EvolutionAgent` | `pool.length >= 1 && ratings.size >= 1` |
| `MetaReviewAgent` | `pool.length >= 1 && ratings.size >= 1` |
| `ReflectionAgent` | `pool.length >= 1` |
| `IterativeEditingAgent` | critiques exist + ratings exist + top variant has critique |
| `TreeSearchAgent` | critiques exist + ratings exist + top variant has critique |
| `SectionDecompositionAgent` | same as above + top variant has >= 2 H2 sections (parses markdown inline) |
| `DebateAgent` | >= 2 non-baseline variants |
| `flowCritique` | No `canExecute()`; filters internally to uncritiqued variants |

**Pattern**: All guards check **pool state** (size, ratings, critiques) — they gate on whether meaningful input data exists. No guard checks config or phase — that's handled by the supervisor's `getActiveAgents`.

**Dispatch in pipeline.ts** (`runAgent`, line ~545): Calls `agent.canExecute(ctx)`, if false → `logger.debug` skip message. The `'flowCritique'` case is special-cased inline (lines 444-460) and swallows non-fatal errors.

### 11. Checkpoint/Resume Flow & Supervisor State Serialization

**Checkpoint Persistence** (`evolution/src/lib/core/persistence.ts`):
- `persistCheckpoint` (lines 14-60): Per-agent checkpoint **without** supervisor state — called after each agent completes
- `persistCheckpointWithSupervisor` (pipeline.ts lines 619-656): End-of-iteration checkpoint **with** supervisor state — called at loop boundary
- `checkpointAndMarkContinuationPending` (lines 116-155): Atomic RPC for continuation-passing on cron timeout — marks run as `pending` for next pickup
- `loadCheckpointForResume` (lines 167-206): Loads most recent `iteration_complete` or `continuation_yield` checkpoint type

**Supervisor Resume State** (`SupervisorResumeState` in supervisor.ts lines 28-33):
- Serialized: `{ phase: PipelinePhase, strategyRotationIndex: number, ordinalHistory: number[], diversityHistory: number[] }`
- Restored via `supervisor.restoreFromResumeState(resumeState)`
- Phase lock is reconstructed: if saved phase is COMPETITION, the `_phaseLocked` flag is set

**State Serialization** (`evolution/src/lib/core/state.ts`):
- `serializeState`: Converts `Map`s → `Record`s, truncates `matchHistory` to 5000 entries, critiques to last 5 iterations
- `deserializeState`: `Record`s → `Map`s, rebuilds `poolIds` Set, calls `rebuildIdMap()`

**Mid-iteration Resume**:
- Checkpoint stores `completedAgents: string[]` — list of agents that finished before the yield
- On resume, pipeline skips agents already in `completedAgents` and resumes from the next agent
- `beginIteration()` is NOT called on resume iteration (supervisor state already advanced)

### 12. Duplication Between Validation Layers

The supervisor's `validateConfig` (supervisor.ts:120-140) and `validateRunConfig` (configValidation.ts:112-126) check overlapping constraints:

| Constraint | `PoolSupervisor.validateConfig` | `validateRunConfig` |
|---|---|---|
| `expansionDiversityThreshold` in [0,1] | ✓ (line 126-128) | ✓ (lines 123-125) |
| `expansionMinPool >= 5` | ✓ (lines 131-133) | ✓ (lines 114-116) |
| `maxIterations > expansionMaxIterations` | ✓ (lines 134-136) | ✓ (lines 117-119) |
| `maxIterations >= expansion + plateau + 1` | ✓ (lines 137-139) | ✓ (lines 120-122) |

Both check the same conditions. `validateRunConfig` runs first (in `preparePipelineRun`), then `PoolSupervisor.validateConfig` runs when the supervisor is constructed in `executeFullPipeline`. The first validation catches errors at context preparation time; the second is a defense-in-depth check.

### 13. Dead Config Fields (Pass 3)

Three config-related code paths exist in the type system and defaults but are never consumed at runtime:

**`expansion.minIterations`** — dead field:
- Defined in `EvolutionRunConfig` (types.ts:501) and defaulted to `3` (config.ts:13)
- NOT extracted by `supervisorConfigFromRunConfig()` — dropped during conversion
- NOT used in `detectPhase()` — phase transition checks `maxIterations`, `minPool`, `diversityThreshold` only
- NOT validated by `validateRunConfig()` or `PoolSupervisor.validateConfig()`
- Present passively in 13 test configs but no test verifies its effect
- Historical intent: planned as minimum iteration gate before COMPETITION (from planning docs), never wired up

**`generation.strategies`** (the numeric count) — validated but unused:
- Defined as `{ strategies: number }` in `EvolutionRunConfig` (types.ts:505), defaulted to `3`
- Validated in `validateRunConfig()` as `> 0` (configValidation.ts:135-137)
- Used by `CostEstimator` for cost scaling (costEstimator.ts:167-169)
- NOT read by `GenerationAgent` — agent always generates all 3 strategies from the `GENERATION_STRATEGIES` constant

**`PhaseConfig.generationPayload` and `calibrationPayload`** — computed but never consumed:
- Supervisor computes these in `getExpansionConfig()` and `getCompetitionConfig()`
- Pipeline calls `supervisor.getPhaseConfig()` but only reads `.phase` and `.activeAgents`
- `generationPayload.strategies` is never passed to the generation agent
- `calibrationPayload.opponentsPerEntrant` is never passed to calibration agent
- CalibrationRanker reads `ctx.payload.config.calibration.opponents` directly instead
- Tests verify the PhaseConfig shape but no integration test checks pipeline consumption

### 14. Strategy Rotation Gap (Pass 3)

The supervisor implements strategy rotation in COMPETITION phase, but the generation agent ignores it:

**Supervisor side** (supervisor.ts:174-176, 216-224):
- `_strategyRotationIndex` advances each COMPETITION iteration (modulo 3)
- `getCompetitionConfig()` returns `generationPayload: { strategies: [currentStrategy] }` — single strategy per iteration
- On transition, resets to -1 (first COMPETITION iteration gets index 0)
- Rotation order: structural_transform → lexical_simplify → grounding_enhance → repeat

**Agent side** (generationAgent.ts:75-88):
- `GenerationAgent.execute()` iterates `GENERATION_STRATEGIES.map(...)` — always all 3 in parallel
- Does NOT read `ctx.payload.config.generation.strategies`
- Does NOT receive any phase-based strategy selection
- Result: generation always produces 3 variants regardless of supervisor intent

**EvolutionAgent** (evolvePool.ts) uses a separate strategy set (`EVOLUTION_STRATEGIES`: mutate_clarity, mutate_structure, crossover) — independent of supervisor rotation.

### 15. Minimal vs Full Pipeline Split (Pass 3)

Two pipeline modes exist: `executeMinimalPipeline` (dev-only) and `executeFullPipeline` (production).

**`executeMinimalPipeline`** (pipeline.ts:182-256):
- Callsites: `run-evolution-local.ts:710` (local script, no flags), integration tests
- Agents: hardcoded `[generation, calibration]` only
- No supervisor, no phases, no resume support
- Checkpoints with hardcoded `'EXPANSION'` phase
- `finalizePipelineRun` called with `supervisor=undefined`
- Pipeline type: `'minimal'` in DB

**`executeFullPipeline`** (pipeline.ts:283-534):
- Callsites: `evolutionRunnerCore.ts` (cron/batch), `evolutionActions.ts` (inline), `run-evolution-local.ts` (with flags), `run-batch.ts`
- Production always uses full pipeline — minimal is development-only
- Full supervisor, phase transitions, 12 agents, checkpoint/resume, timeout awareness
- Pipeline type: `'full'` or `'single'` based on `singleArticle`

### 16. Single-Article Mode Behavior (Pass 3)

`singleArticle` mode is cleanly isolated — no agent has internal `singleArticle`-aware code:

**Config flow**: Strategy UI → `StrategyConfig.singleArticle` → `EvolutionRunConfig.singleArticle` → `SupervisorConfig.singleArticle`

**Agent exclusion**: `SINGLE_ARTICLE_EXCLUDED = { generation, outlineGeneration, evolution }` — these agents never run in singleArticle mode (in both EXPANSION and COMPETITION phases)

**Budget redistribution**: Removes caps for 3 excluded agents (0.20 + 0.10 + 0.10 = 0.40), redistributes proportionally to remaining agents

**Unique stopping condition**: `shouldStop()` checks quality threshold (all critique dimensions >= 8) before plateau check — only in singleArticle mode (supervisor.ts:228-230)

**Pool behavior**: Pool is static (only baseline initially since generation is excluded); all improvement comes from editing agents

**Checkpoint/resume**: Mode-agnostic — works identically because `getActiveAgents()` reapplies singleArticle filter on each fresh iteration

**Pipeline type in DB**: `'single'` (pipeline.ts:309)

**Strategy hash**: `singleArticle` IS included in hash — affects strategy identity

### 17. Config Field Dependency Map (Pass 3)

Complete map of which `EvolutionRunConfig` fields are consumed by which components:

| Field | Supervisor | Agents | Validation | CostTracker | CostEstimator |
|---|:---:|:---:|:---:|:---:|:---:|
| `maxIterations` | ✓ | — | ✓ | — | ✓ |
| `budgetCapUsd` | — | ✓ (tournament) | ✓ | ✓ | — |
| `plateau.window` | ✓ | — | ✓ | — | — |
| `plateau.threshold` | ✓ | — | ✓ | — | — |
| `expansion.minPool` | ✓ | — | ✓ | — | — |
| `expansion.minIterations` | **DEAD** | **DEAD** | **DEAD** | **DEAD** | **DEAD** |
| `expansion.diversityThreshold` | ✓ | — | ✓ | — | — |
| `expansion.maxIterations` | ✓ | — | ✓ | — | ✓ |
| `generation.strategies` | — | — | ✓ | — | ✓ |
| `calibration.opponents` | — | ✓ | ✓ | — | ✓ |
| `calibration.minOpponents` | — | ✓ | — | — | — |
| `tournament.topK` | — | ✓ | ✓ | — | — |
| `budgetCaps` | — | — | ✓ | ✓ | ✓ |
| `judgeModel` | — | ✓ (many) | ✓ | — | ✓ |
| `generationModel` | — | ✓ (outline) | ✓ | — | ✓ |
| `singleArticle` | ✓ | — | — | — | — |
| `enabledAgents` | ✓ | ✓ (tournament) | ✓ | — | — |

**Key patterns**:
- **Supervisor-owned fields**: `maxIterations`, `plateau.*`, `expansion.*` (except dead `minIterations`), `singleArticle`
- **Agent-owned fields**: `budgetCapUsd`, `calibration.*`, `tournament.*`, `judgeModel`, `generationModel`
- **Cross-cutting fields**: `enabledAgents` (supervisor + agents + validation + budget redistribution)
- **Budget fields**: `budgetCapUsd` and `budgetCaps` consumed by CostTracker
- **Dead fields**: `expansion.minIterations` (no consumer), `generation.strategies` (validated + estimated but never drives agent behavior)

### 18. `GENERATION_STRATEGIES` Import Graph (Pass 3)

The `GENERATION_STRATEGIES` constant (supervisor.ts:10-14) is imported by:
1. `evolution/src/lib/agents/generationAgent.ts` — iterates all 3 strategies in parallel
2. `evolution/src/lib/core/supervisor.test.ts` — verifies rotation behavior

No other files import it. The constant lives in supervisor.ts but its only runtime consumer is the generation agent, which uses it as a static list rather than reading the supervisor's phase-based selection.

## Test Coverage

| File | Tests | Coverage |
|---|---|---|
| `evolution/src/lib/core/supervisor.test.ts` | 58 | Phase detection, locking, transition, strategy rotation, stopping conditions, resume, singleArticle, enabledAgents, getActiveAgents |
| `evolution/src/lib/core/configValidation.test.ts` | 27 | isTestEntry, validateStrategyConfig, validateRunConfig, integration |
| `evolution/src/lib/config.test.ts` | 16 | resolveConfig, auto-clamping, budgetCaps completeness |
| `evolution/src/lib/core/config.test.ts` | 7 | resolveConfig deep merge, model defaults |
| **Total** | **108** | |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (all 15 evolution docs)
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/flow_critique.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/hall_of_fame.md

## Code Files Read

### Core Pipeline Rules (Pass 1)
- `evolution/src/lib/core/supervisor.ts` — PoolSupervisor, getActiveAgents, phase detection, stopping conditions
- `evolution/src/lib/core/configValidation.ts` — validateStrategyConfig, validateRunConfig, isTestEntry
- `evolution/src/lib/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig, deepMerge
- `evolution/src/lib/core/budgetRedistribution.ts` — REQUIRED_AGENTS, OPTIONAL_AGENTS, AGENT_DEPENDENCIES, computeEffectiveBudgetCaps
- `evolution/src/lib/core/agentToggle.ts` — toggleAgent UI utility
- `evolution/src/lib/types.ts` — EvolutionRunConfig, AgentName, PipelinePhase, ExecutionContext
- `evolution/src/lib/index.ts` — preparePipelineRun, prepareResumedPipelineRun, createDefaultAgents
- `evolution/src/lib/core/pipeline.ts` — executeFullPipeline, agent dispatch loop, ranking sentinel

### Tests (Pass 1)
- `evolution/src/lib/core/supervisor.test.ts` — 58 tests
- `evolution/src/lib/core/configValidation.test.ts` — 27 tests
- `evolution/src/lib/config.test.ts` — 16 tests
- `evolution/src/lib/core/config.test.ts` — 7 tests

### Callsites (Pass 1)
- `evolution/src/services/evolutionActions.ts` — validateStrategyConfig callsite, resolveConfig callsite
- `evolution/src/services/evolutionRunnerCore.ts` — resolveConfig callsite for seed generation
- `evolution/scripts/run-evolution-local.ts` — resolveConfig callsite for CLI
- `evolution/scripts/audit-evolution-configs.ts` — validateStrategyConfig callsite for audit

### Strategies UI & Runner Entry Points (Pass 2)
- `src/app/admin/quality/strategies/page.tsx` — Strategy Registry UI, form state, agent toggles
- `src/app/admin/quality/strategies/strategyFormUtils.ts` — formToConfig, rowToForm converters
- `src/app/admin/quality/evolution/page.tsx` — Start Run card, strategy dropdown
- `evolution/src/lib/core/strategyConfig.ts` — StrategyConfig type, hash logic
- `evolution/src/services/strategyRegistryActions.ts` — Strategy CRUD server actions
- `src/app/api/cron/evolution-runner/route.ts` — Cron runner entry point
- `evolution/scripts/evolution-runner.ts` — Batch runner entry point

### Agent canExecute() & Checkpoint/Resume (Pass 2)
- All 12 agent files — canExecute() guard implementations
- `evolution/src/lib/core/persistence.ts` — persistCheckpoint, loadCheckpointForResume, continuation
- `evolution/src/lib/core/state.ts` — serializeState, deserializeState, PipelineStateImpl

### Deep Dive: Dead Code, Strategy Flow, Config Dependencies (Pass 3)
- `evolution/src/lib/agents/generationAgent.ts` — GENERATION_STRATEGIES import, always runs all 3
- `evolution/src/lib/agents/calibrationRanker.ts` — reads ctx.payload.config.calibration.opponents directly
- `evolution/src/lib/agents/evolvePool.ts` — EVOLUTION_STRATEGIES (separate from generation)
- `evolution/src/lib/agents/tournament.ts` — reads budgetCapUsd for budget pressure, enabledAgents for flowCritique check
- `evolution/src/lib/core/costEstimator.ts` — reads generation.strategies, expansion.maxIterations, judgeModel, generationModel
- `evolution/src/lib/core/costTracker.ts` — reads budgetCapUsd, budgetCaps
- `evolution/scripts/run-evolution-local.ts` — minimal vs full pipeline decision logic
- `evolution/scripts/run-batch.ts` — executeFullPipeline callsite

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ Strategy UI (strategies/page.tsx)                                    │
│   └─ toggleAgent() ─ enforces dependencies (cascade disable/enable) │
│   └─ formToConfig() ─ FormState → StrategyConfig                    │
│   └─ validateStrategyConfig() ─ lenient, partial config ok          │
│   └─ computeEffectiveBudgetCaps() ─ real-time budget preview        │
├─────────────────────────────────────────────────────────────────────┤
│ Queue Run (evolutionActions.ts)                                     │
│   └─ validateStrategyConfig() ─ on strategy config at queue time    │
│   └─ snapshots config fields into run JSONB                         │
├─────────────────────────────────────────────────────────────────────┤
│ 3 Runners: Cron (800s) │ Batch (no timeout) │ Inline (no resume)   │
│   └─ all call resolveConfig() for seed generation                   │
│   └─ cron/batch → claimAndExecuteEvolutionRun()                     │
│   └─ inline → direct DB claim with race detection                   │
├─────────────────────────────────────────────────────────────────────┤
│ Prepare Run (index.ts)                                              │
│   └─ resolveConfig() ─ deep-merge + auto-clamp expansion            │
│   └─ validateRunConfig() ─ strict, full config required             │
│   └─ computeEffectiveBudgetCaps() ─ redistribute disabled budgets   │
├─────────────────────────────────────────────────────────────────────┤
│ Execute (pipeline.ts)                                               │
│   └─ supervisorConfigFromRunConfig() ─ flatten to SupervisorConfig  │
│   └─ new PoolSupervisor(cfg) ─ validateConfig (defense-in-depth)    │
│   └─ Loop:                                                          │
│       ├─ beginIteration() ─ detect/lock phase                       │
│       ├─ getPhaseConfig() ─ getActiveAgents() ─ filter by phase,    │
│       │                     enabledAgents, singleArticle             │
│       ├─ shouldStop() ─ quality/plateau/budget/maxIterations         │
│       ├─ dispatch agents ─ 'ranking' → calibration/tournament       │
│       │                  ─ each agent.canExecute() ─ pool state guard│
│       ├─ persistCheckpoint() ─ per-agent (no supervisor state)      │
│       └─ persistCheckpointWithSupervisor() ─ end-of-iteration       │
│                                               (supervisor + state)   │
├─────────────────────────────────────────────────────────────────────┤
│ Resume (on cron timeout or explicit resume)                          │
│   └─ loadCheckpointForResume() ─ latest iteration_complete/yield    │
│   └─ prepareResumedPipelineRun() ─ restore state + cost tracker     │
│   └─ supervisor.restoreFromResumeState() ─ phase lock + histories   │
│   └─ skip completedAgents ─ mid-iteration resume                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Open Questions (Resolved)

These questions from earlier passes have been answered by Pass 3 research:

| Question | Answer |
|---|---|
| What is the minimal set of config fields the supervisor actually needs? | 10 fields via `SupervisorConfig` (see Section 17 dependency map). `expansion.minIterations` is dead. |
| Could `getActiveAgents` and `computeEffectiveBudgetCaps` share the same "active agent" computation? | They already share the same concept (required + enabled + singleArticle filtering) but with slightly different implementations. Both use `REQUIRED_AGENTS` and `SINGLE_ARTICLE_DISABLED`/`SINGLE_ARTICLE_EXCLUDED`. |
| `canExecute()` guards all check pool state — could they share a common "pool readiness" check? | Guards are heterogeneous enough that a shared base wouldn't help much. They range from `originalText.length > 0` to complex critique/rating/H2-section checks. |

## Open Questions (Remaining)
- How many of the 5 `resolveConfig` callsites could be consolidated? (3 are for seed generation in different runners)
- Could the duplicated supervisor validation checks be removed from one layer?
- The 3 runners (cron, batch, inline) have different capability matrices — could these be unified?
- Mid-iteration resume stores `completedAgents` — does simplifying the supervisor affect how resume checkpoints work?
- Strategy hash excludes `budgetCaps` and `agentModels` — should simplification preserve this boundary?

## Dead Code Identified (Pass 3)

| Code | Location | Status |
|---|---|---|
| `expansion.minIterations` field | types.ts:501, config.ts:13 | Dead — defined/defaulted but never read at runtime |
| `generation.strategies` numeric count | types.ts:505, config.ts:17 | Partially dead — validated + used in cost estimation, but agent ignores it |
| `PhaseConfig.generationPayload` | supervisor.ts:23 | Dead — computed but never consumed by pipeline or agents |
| `PhaseConfig.calibrationPayload` | supervisor.ts:24 | Dead — computed but never consumed by pipeline or agents |
| Strategy rotation (`_strategyRotationIndex`) | supervisor.ts:110, 174-176 | Dead effect — supervisor rotates but GenerationAgent always runs all 3 |
| `executeMinimalPipeline` | pipeline.ts:182-256 | Dev-only — never used in production |
