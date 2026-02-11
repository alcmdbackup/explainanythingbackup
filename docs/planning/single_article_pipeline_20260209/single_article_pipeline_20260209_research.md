# Single Article Pipeline Research

## Problem Statement
Create a single-article pipeline mode that produces one article variant and iterates on it sequentially through agent passes. Unlike the existing evolution pipeline which maintains a population pool with competitive selection and tournament ranking, this mode operates on a single article — no population search, no pool diversification, just focused sequential improvement (e.g., generation → reflection → editing → polishing).

## Requirements (from GH Issue #385)
I want to be able to run a pipeline that produces only a single article variant, and has agents operate on it sequentially. No population search, just iterating on a single article.

## High Level Summary

The existing evolution pipeline (`src/lib/evolution/`) provides a mature agent framework with two execution modes: `executeMinimalPipeline` (sequential agent array) and `executeFullPipeline` (phase-aware with PoolSupervisor). Both modes share the same `AgentBase` contract, `ExecutionContext`, `PipelineState`, checkpointing, and finalization infrastructure.

**Key finding:** Several agents already operate on a single top variant and are directly reusable for a single-article pipeline:
- **ReflectionAgent** — critiques top variant across 5 dimensions (canExecute: pool.length >= 1)
- **IterativeEditingAgent** — critique→edit→judge loop on top variant (requires critiques + ratings)
- **SectionDecompositionAgent** — H2 decomposition with parallel section edits (requires critiques + ratings + ≥2 H2 sections)
- **GenerationAgent** — generates from originalText only, no pool dependency
- **OutlineGenerationAgent** — 6-step pipeline (outline→expand→polish) from originalText

**Population-dependent agents** that would NOT apply:
- CalibrationRanker, Tournament, PairwiseRanker (need pool >= 2 for comparisons)
- EvolutionAgent (genetic crossover/mutation needs rated parents)
- ProximityAgent (diversity tracking needs pool >= 2)
- DebateAgent (needs 2+ rated non-baseline variants)
- MetaReviewAgent (analyzes cross-variant statistics)

The `executeMinimalPipeline` function already supports flat sequential agent execution — it takes an ordered `PipelineAgent[]` array and runs each in order with checkpointing. No phase transitions, no supervisor. This is the natural integration point for a single-article mode.

No existing `--single`, `--sequential`, or `--no-population` CLI flag exists.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/iterative_editing_agent.md
- docs/feature_deep_dives/outline_based_generation_editing.md
- docs/feature_deep_dives/hierarchical_decomposition_agent.md
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/writing_pipeline.md (stub — template only)
- docs/planning/feat/integrate_writing_pipeline_20260130/_planning.md
- docs/planning/feat/integrate_writing_pipeline_20260130/_research.md

## Code Files Read

### Pipeline Orchestration
- `src/lib/evolution/core/pipeline.ts` — executeMinimalPipeline (L641-711), executeFullPipeline (L746-928), runAgent wrapper (L930-983), insertBaselineVariant (L279-294), buildRunSummary (L296-355), finalizePipelineRun (L374-412), persistCheckpoint (L24-64)
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor (L64-277), detectPhase (L96-113), beginIteration (L115-143), getPhaseConfig (L145-200), shouldStop (L202-238)
- `src/lib/evolution/index.ts` — createDefaultAgents (L97-112), preparePipelineRun (L142-170), barrel exports

### Agent Framework
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class (L1-17)
- `src/lib/evolution/types.ts` — ExecutionContext (L127-136), AgentResult (L113-123), PipelineState (L140-179), TextVariation (L22-32)

### Single-Variant Agents
- `src/lib/evolution/agents/reflectionAgent.ts` — canExecute: pool.length >= 1 (L180-182), critiques top 3 (L109)
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — canExecute: critiques + ratings + top has critique (L49-55), edit loop (L70-127)
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — canExecute: critiques + ratings + ≥2 H2 sections (L24-38), decompose→edit→stitch (L43-142)
- `src/lib/evolution/agents/generationAgent.ts` — canExecute: originalText.length > 0 (L134-136), 3 strategies from originalText
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — canExecute: originalText.length > 0 (L279-281), 6-step pipeline

### Population-Dependent Agents
- `src/lib/evolution/agents/calibrationRanker.ts` — canExecute: newEntrants > 0 && pool >= 2 (L212-214)
- `src/lib/evolution/agents/tournament.ts` — canExecute: pool >= 2 (L349-351)
- `src/lib/evolution/agents/evolvePool.ts` — canExecute: pool >= 1 && ratings >= 1 (L376-378)
- `src/lib/evolution/agents/debateAgent.ts` — canExecute: rated non-baseline >= 2 (L331-333)
- `src/lib/evolution/agents/metaReviewAgent.ts` — canExecute: pool >= 1 && ratings >= 1 (L54-56), but fundamentally needs population statistics
- `src/lib/evolution/agents/proximityAgent.ts` — canExecute: pool >= 2 (L89-91)

### State & Config
- `src/lib/evolution/core/state.ts` — PipelineStateImpl (L17-77), addToPool (L46-55), getTopByRating (L62-72), serializeState (L80-103), deserializeState (L106-139)
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG (L7-36), resolveConfig (L39-51)
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl (L7-76), reserveBudget with 30% margin (L21-41)
- `src/lib/evolution/core/llmClient.ts` — createEvolutionLLMClient (L40-107), estimateTokenCost (L15-23)

### CLI Runner
- `scripts/run-evolution-local.ts` — parseArgs (L59-147), generateSeedArticle (L550-580), buildAgents (L694-698), main execution flow (L584-809)
- `scripts/lib/oneshotGenerator.ts` — generateOneshotArticle (L142-216), multi-provider LLM support

### Cron Runner
- `src/app/api/cron/evolution-runner/route.ts` — production execution flow (L1-205)

## Detailed Findings

### 1. Pipeline Orchestration Architecture

The pipeline has two execution modes in `src/lib/evolution/core/pipeline.ts`:

**executeMinimalPipeline (L641-711):** Takes a flat `PipelineAgent[]` array. Loops sequentially — each agent runs, then checkpoints. No supervisor, no phase transitions. This is already close to what a single-article pipeline needs.

**executeFullPipeline (L746-928):** Multi-iteration loop with PoolSupervisor managing EXPANSION→COMPETITION phase transitions. Each iteration runs phase-gated agents via `config = supervisor.getPhaseConfig(state)`. Agents are keyed by name in a `PipelineAgents` object (not an array).

Both share: baseline variant insertion, the `runAgent()` wrapper (canExecute check → execute → checkpoint → error handling), and `finalizePipelineRun()`.

### 2. Agent Classification for Single-Article Reuse

| Agent | Pool Requirement | Single-Article Compatible | Notes |
|-------|-----------------|---------------------------|-------|
| GenerationAgent | pool >= 0 | YES | Generates from originalText only |
| OutlineGenerationAgent | pool >= 0 | YES | 6-step pipeline from originalText |
| ReflectionAgent | pool >= 1 | YES | Critiques top N variants |
| IterativeEditingAgent | critiques + ratings | YES | Edit loop on top variant |
| SectionDecompositionAgent | critiques + ratings + sections | YES | H2-level parallel edits |
| TreeSearchAgent | critiques + ratings | YES | Beam search on top variant |
| CalibrationRanker | pool >= 2, newEntrants > 0 | NO | Pairwise comparison needs 2+ variants |
| Tournament | pool >= 2 | NO | Swiss-style ranking needs population |
| EvolutionAgent | pool >= 1, ratings >= 1 | NO | Crossover needs 2 parents |
| ProximityAgent | pool >= 2 | NO | Diversity needs multiple variants |
| DebateAgent | rated non-baseline >= 2 | NO | Needs 2 opponents |
| MetaReviewAgent | pool >= 1, ratings >= 1 | NO | Population statistics analysis |

### 3. Single-Variant Agent Dependencies

For agents to work on a single article, they need certain state to be pre-populated:

```
GenerationAgent (or OutlineGenerationAgent)
  → produces variants in pool
  → triggers rating initialization via addToPool()

ReflectionAgent
  ← requires: pool.length >= 1
  → produces: state.allCritiques, state.dimensionScores

IterativeEditingAgent
  ← requires: state.allCritiques.length > 0, state.ratings.size > 0, critique for top variant
  → produces: edited variants in pool

SectionDecompositionAgent
  ← requires: state.allCritiques.length > 0, state.ratings.size > 0, top variant has ≥2 H2 sections, critique for top
  → produces: stitched variant in pool
```

The natural sequential chain for a single article: **Generate → Reflect → IterativeEdit → SectionDecomposition**

### 4. IterativeEditingAgent Loop Detail

The most relevant pattern for single-article improvement (`src/lib/evolution/agents/iterativeEditingAgent.ts`):

1. Pick top variant by ordinal (L64)
2. Get existing critique + run open-ended review (L65-67)
3. Loop up to maxCycles=3 (L70):
   - Identify weakest dimension from critique (L71-82)
   - Generate surgical edit targeting weakness (L86)
   - Validate format (L90-95)
   - Blind diff judge with direction-reversal bias mitigation (L99)
   - If accepted: add to pool, re-critique, continue (L102-122)
   - If rejected: increment counter, try next weakness (L124)
4. Early stop on maxConsecutiveRejections=3 or qualityThreshold=8 met

This is already a single-article sequential improvement pattern — it just happens to live inside the evolution framework.

### 5. CLI Runner Entry Point

`scripts/run-evolution-local.ts` is the natural place to add a `--single` flag:

- Current minimal mode (L694-698): `[agents.generation, agents.calibration]`
- Current full mode: all 12 agents with phase-aware execution
- A single-article mode would pass a different agent subset to `executeMinimalPipeline`

The runner already supports `--file` and `--prompt` input modes, mock LLM, budget caps, and Supabase persistence. These all carry over to a single-article mode.

### 6. PipelineState Compatibility

`PipelineStateImpl` works fine with a single variant. Key behaviors:
- `addToPool()` (L46-55): Initializes rating {mu:25, sigma:8.333} automatically
- `getTopByRating(1)` (L62-72): Returns single best variant; falls back to pool[0] if no ratings
- Rating initialization happens on addToPool, so IterativeEditingAgent's `state.ratings.size > 0` guard is satisfied after any variant enters the pool

### 7. Budget Config for Single-Article Mode

The current per-agent budget caps (config.ts L24-35) sum to 1.52 because not all agents run per iteration. For a single-article pipeline with fewer agents, budget allocation could be simplified:
- generation: 0.20, reflection: 0.05, iterativeEditing: 0.05, sectionDecomposition: 0.10
- Total: 0.40 of budget cap, leaving headroom
- The CostTracker handles this gracefully — uncapped agents just have more room

### 8. Existing Patterns Similar to Single-Article Pipeline

**OutlineGenerationAgent** already implements a multi-step sequential pipeline:
```
Original Text → Outline → Score → Expand → Score → Polish → Score → Verify
```
Each step is an LLM call, scored independently. This is conceptually similar to what a single-article pipeline does at a higher level.

**IterativeEditingAgent** implements the critique→edit→judge loop which is the core of iterative single-article improvement.

**SectionDecompositionAgent** adds hierarchical decomposition — edit sections in parallel, stitch back.

### 9. Writing Pipeline (Python) Context

The standalone Python writing_pipeline at `/Users/abel/Documents/writing_pipeline/` has already been fully ported to TypeScript in the evolution pipeline. The integration planning doc (`docs/planning/feat/integrate_writing_pipeline_20260130/_planning.md`) describes the 10 foundational decisions and vertical slice delivery. The `writing_pipeline.md` deep dive is still a stub template.

## Deep Dive Findings (Round 2)

### 10. Blind Diff Judge Mechanism

The quality gate for single-article editing uses CriticMarkup diff comparison (`src/lib/evolution/diffComparison.ts`):

1. Both texts (before/after) are parsed to MDAST via `unified()` + `remark-parse`
2. Forward diff generated: `RenderCriticMarkupFromMDAstDiff(beforeAst, afterAst)` using CriticMarkup notation (`{++added++}`, `{--removed--}`, `{~~old~>new~~}`)
3. Reverse diff generated: same function but with args swapped (after→before)
4. **Two-pass direction reversal** for bias mitigation:
   - Pass 1: Judge evaluates forward diff
   - Pass 2: Judge evaluates reverse diff
5. **Truth table** (`interpretDirectionReversal()`, diffComparison.ts L103-122):
   - Forward=ACCEPT + Reverse=REJECT → **ACCEPT** (confidence 1.0) — B truly improves A
   - Forward=REJECT + Reverse=ACCEPT → **REJECT** (confidence 1.0) — B harms A
   - Both ACCEPT or both REJECT → **UNSURE** (confidence 0.5) — framing bias detected
   - Either UNSURE → **UNSURE** (confidence 0.3)

**Works with 1 variant** — diff comparison is parent→edit, not variant-vs-variant. The judge sees only the diff markup and decides ACCEPT/REJECT/UNSURE. No population context needed.

**Verdict-only gating**: Only `verdict === 'ACCEPT'` triggers acceptance (not confidence threshold). Consecutive rejections (3) trigger stop.

### 11. Rating Flow with Single Variant — Critical Finding

**Problem identified:** When CalibrationRanker and Tournament are skipped (single-article mode), **no ratings are ever updated**. All variants keep default `{mu:25, sigma:8.333}`, giving identical ordinals ≈ 0.

**Tiebreaker behavior** (`state.ts` L62-72): When ordinals are equal, JavaScript stable sort preserves Map insertion order. `getTopByRating(1)` returns the **first variant added to `state.ratings`** — which is the baseline/original, NOT the latest edit.

**Impact on IterativeEditingAgent**: After accepting an edit:
- Line 116: `current = editedVariant` — the agent tracks the latest variant internally
- But in the **next agent's** execution, `getTopByRating(1)` returns the original baseline (first in ratings Map)
- **This means SectionDecompositionAgent would operate on the baseline, not the improved variant**

**Mitigation needed**: Either:
1. After each accepted edit, the current variant needs to be "promoted" (e.g., via a synthetic rating update)
2. Or a new pipeline function that passes the current variant between agents explicitly

### 12. IterativeEditingAgent Complete Flow

**Edit targeting priority** (iterativeEditingAgent.ts L247-292):
1. Step-based targets (OutlineVariant weakest step)
2. Rubric dimensions scoring < qualityThreshold=8 (sorted lowest first)
3. Open-ended review suggestions
4. `attemptedTargets` Set prevents retargeting same dimension

**Edit prompt** (L303-352): Two types:
- Step-targeted: "Re-generate ONLY the {step} step to improve quality"
- Dimension-targeted: "Fix ONLY the identified weakness while preserving all other qualities"
- Both include FORMAT_RULES and emphasis on surgical editing

**Re-critique after acceptance** (L121-122):
- `runInlineCritique()` — generates fresh rubric scores for the newly edited variant
- `runOpenReview()` — generates fresh freeform suggestions
- These feed into next cycle's targeting, creating a self-improving loop

**Variant naming**: `critique_edit_{dimension}` or `critique_edit_open` strategy
**Parent chain**: `parentIds: [current.id]` — linear chain, each edit builds on the previous

### 13. CLI Integration Point — Exact Changes Needed

**CLIArgs interface** (run-evolution-local.ts L41-55): Need to add `single: boolean` flag

**buildAgents()** (L495-504): Currently returns all 12 agents. For single mode, only need:
- `reflection` (ReflectionAgent)
- `iterativeEditing` (IterativeEditingAgent)
- `sectionDecomposition` (SectionDecompositionAgent)
- Optionally: `generation` (if starting from prompt, not file)

**Pipeline branching** (L700-710):
```typescript
// Current:
if (args.full) { executeFullPipeline(...) }
else { executeMinimalPipeline(runId, [agents.generation, agents.calibration], ...) }

// With single mode:
if (args.single) { executeMinimalPipeline(runId, [agents.reflection, agents.iterativeEditing, agents.sectionDecomposition], ...) }
```

**Type compatibility**: `executeMinimalPipeline` accepts `PipelineAgent[]` — any agent implementing the interface can be passed. No validation prevents single-variant-compatible agents.

**Output**: `buildOutput()` (L508-541) works with any pool size. Rankings sort by ordinal — with identical ratings, all variants show Elo ≈ 1200 (mapped from ordinal ≈ 0).

### 14. Key Design Decision: How to Track "Current Best" Without Ratings

Since ratings aren't updated in single-article mode, the system needs a way to know which variant is the "latest improved" one:

**Option A: Use pool order** — newest variant added last, but `getTopByRating()` returns first-added
**Option B: Synthetic rating update** — after each accepted edit, call `updateRating(newVariant, oldVariant)` to promote it
**Option C: Pass variant ID between agents** — new pipeline function that explicitly threads the current variant through the agent chain
**Option D: Override getTopByRating** — in single mode, return last-added variant instead of first

This is the core design decision for the single-article pipeline.

## Deep Dive Findings (Round 3)

### 15. Rating Promotion Mechanics — Option B Confirmed Viable

`updateRating(winner, loser)` (rating.ts L33-36) uses OpenSkill Bayesian model. Starting from default `{mu:25, sigma:8.333}`:

- After 1 call with new variant as winner: winner gets ~`{mu:26.5, sigma:7.3}` → ordinal ≈ 4.6
- Baseline (loser) gets ~`{mu:23.5, sigma:7.3}` → ordinal ≈ 1.6
- Default unchanged rating ordinal ≈ 0

**One `updateRating` call clearly separates the promoted variant** from all default-rated variants. `getTopByRating(1)` will return the promoted variant.

`state.ratings` is a plain `Map<string, Rating>` — direct `state.ratings.set(id, newRating)` works. This is the exact pattern used by CalibrationRanker (calibrationRanker.ts L86-93) and Tournament (tournament.ts L280-285).

### 16. Baseline-Only Flow (No GenerationAgent) — Confirmed Viable

`insertBaselineVariant()` creates a variant with `strategy='original_baseline'`, `version=0`, `parentIds=[]`. After insertion, pool has exactly 1 variant.

**No baseline filtering in single-variant agents:**
- ReflectionAgent: critiques any top variant, no baseline filter ✅
- IterativeEditingAgent: edits any top variant, no baseline filter ✅
- SectionDecompositionAgent: decomposes any top variant, no baseline filter ✅

**Baseline IS filtered by population agents** (DebateAgent L15-18, EvolutionAgent L126, PoolManager L96-99) — but these aren't used in single-article mode.

**Input file requirements for baseline:** Must have valid markdown format:
- Exactly one H1 title on first line (formatValidator.ts L23-38)
- ≥1 section heading (## or ###) (L40-44)
- No bullet/numbered lists or tables (L53-64)
- ≥75% paragraphs with 2+ sentences (L66-89)
- ≥2 H2 sections for SectionDecompositionAgent (sectionDecompositionAgent.ts L36-37)

### 17. Multi-Iteration Architecture — New Pipeline Function Needed

**executeMinimalPipeline** runs agents ONCE with NO iteration loop. `state.iteration` stays 0. No `startNewIteration()` call.

**executeFullPipeline** has proper iteration loop (pipeline.ts L789): `for (i = state.iteration; i < maxIterations; i++)` with `startNewIteration()`, stopping conditions, and per-iteration checkpointing.

**For multi-iteration single-article mode, need a new `executeSingleArticlePipeline`** that:
1. Loops like executeFullPipeline but without PoolSupervisor
2. Calls `state.startNewIteration()` each iteration (clears `newEntrantsThisIteration`)
3. Has simple stopping conditions (budget, max iterations, quality threshold)
4. Promotes latest accepted variant via `updateRating` each iteration

**State between iterations:**
- `state.allCritiques` — accumulates, never cleared (reflectionAgent.ts L153-154)
- `state.pool` — accumulates (append-only)
- `state.newEntrantsThisIteration` — auto-cleared by `startNewIteration()`
- `IterativeEditingAgent.attemptedTargets` — auto-cleared each `execute()` call (iterativeEditingAgent.ts L61)

### 18. Test Infrastructure — Rich Reuse Available

Key test utilities in `src/testing/utils/evolution-test-helpers.ts`:
- `createMockEvolutionLLMClient()` — returns `{complete: jest.fn(), completeStructured: jest.fn()}`
- `createMockEvolutionLogger()` — 4 no-op jest.fn() methods
- `VALID_VARIANT_TEXT` — format-valid markdown template (L29-37)
- `createTestEvolutionRun()` — inserts test run to DB
- `createTestVariant()` — inserts test variant to DB
- `createTestCheckpoint()` — creates checkpoint with serialized state

**IterativeEditingAgent test pattern** (iterativeEditingAgent.test.ts):
- Mocks `compareWithDiff` module with `makeAcceptResult()`/`makeRejectResult()`
- Builds state with seed variants + critiques, then calls `execute(ctx)`
- Asserts variant count, strategy names, parent chain

**Pipeline integration test pattern** (evolution-pipeline.integration.test.ts):
- Constructs `PipelineAgent[]` array: `[new GenerationAgent(), new CalibrationRanker()]`
- Passes to `executeMinimalPipeline()` — **custom agent subsets already tested**
- Outline test uses 3-agent subset: `[GenerationAgent, OutlineGenerationAgent, CalibrationRanker]`

**Mock LLM in CLI** (run-evolution-local.ts L201-299):
- Detects prompt type (comparison/critique/generation) via string matching
- Returns rotating template responses
- Supports `--mock` flag for zero-cost testing

## Deep Dive Findings (Round 4) — Config-Driven Approach

### 19. Revised Goal: Single-Article as Special Case of Full Pipeline

**Previous approach** (abandoned): Create a separate `executeSingleArticlePipeline` function.

**New approach**: Implement single-article mode as a config-driven special case of the existing `executeFullPipeline` + `PoolSupervisor`. This means no new pipeline function — just config overrides that produce single-article behavior by:
1. Disabling generation/population agents via phase config
2. Relying on existing `canExecute()` gates to skip multi-variant agents
3. Leveraging the existing supervisor iteration loop, checkpointing, and finalization

### 20. Agent canExecute() Gates — Natural Single-Article Behavior

Agents already self-gate based on pool state. With only a baseline variant (pool=1, no ratings beyond default):

| Agent | canExecute Gate | Behavior with pool=1 | Behavior after 1st improvement |
|-------|----------------|----------------------|-------------------------------|
| GenerationAgent | `originalText.length > 0` | ✅ RUNS (creates 3 variants) | ✅ RUNS (unwanted in single mode) |
| OutlineGenerationAgent | `originalText.length > 0` | ✅ RUNS | ✅ RUNS (unwanted in single mode) |
| CalibrationRanker | `newEntrants > 0 && pool >= 2` | ❌ SKIPS (pool=1) | ✅ RUNS (pool=2+) |
| Tournament | `pool >= 2` | ❌ SKIPS | ✅ RUNS (pool=2+) |
| EvolutionAgent | `pool >= 1 && ratings >= 1` | ✅ RUNS (has default rating) | ✅ RUNS (unwanted in single mode) |
| ReflectionAgent | `pool >= 1` | ✅ RUNS | ✅ RUNS |
| IterativeEditingAgent | `critiques + ratings + critique for top` | ❌ SKIPS iter 0 (no critique) | ✅ RUNS after reflection |
| TreeSearchAgent | `critiques + ratings + critique for top` | ❌ SKIPS iter 0 | ✅ RUNS after reflection |
| SectionDecompositionAgent | `critiques + ratings + ≥2 H2 + critique for top` | ❌ SKIPS iter 0 | ✅ RUNS if ≥2 H2 sections |
| DebateAgent | `countRatedNonBaseline >= 2` | ❌ SKIPS | ❌ SKIPS (only 1 non-baseline) |
| ProximityAgent | `pool >= 2` | ❌ SKIPS | ✅ RUNS (pool=2+) |
| MetaReviewAgent | `pool >= 1 && ratings >= 1` | ✅ RUNS (limited value) | ✅ RUNS |

**Key insight**: Agents that MUST be disabled by config (canExecute would let them run but they'd add unwanted population breadth):
- **GenerationAgent** — creates 3 new variants from scratch each iteration
- **OutlineGenerationAgent** — creates outline-based variant each iteration
- **EvolutionAgent** — creates 3 mutated variants from existing pool

Agents that naturally self-disable OR are useful:
- CalibrationRanker/Tournament: self-disable when pool=1, useful when pool=2+
- DebateAgent: self-disables (needs 2 non-baseline)
- ProximityAgent: self-disables when pool=1, useful when pool=2+
- ReflectionAgent, IterativeEditingAgent, TreeSearchAgent, SectionDecompositionAgent: all useful

### 21. PoolSupervisor Phase Config — Agent Control Points

`getPhaseConfig()` returns boolean flags per agent (supervisor.ts L146-200):

```typescript
interface PhaseConfig {
  phase: PipelinePhase;
  runGeneration: boolean;          // ← disable for single-article
  runOutlineGeneration: boolean;   // ← disable for single-article
  runEvolution: boolean;           // ← disable for single-article
  runReflection: boolean;          // keep enabled
  runIterativeEditing: boolean;    // keep enabled
  runTreeSearch: boolean;          // keep enabled
  runSectionDecomposition: boolean; // keep enabled
  runDebate: boolean;              // canExecute self-disables
  runCalibration: boolean;         // keep enabled (rates when pool >= 2)
  runProximity: boolean;           // keep enabled (runs when pool >= 2)
  runMetaReview: boolean;          // keep enabled (lightweight analysis)
  generationPayload: { strategies: string[] };
  calibrationPayload: { opponentsPerEntrant: number };
}
```

**Two approaches to disable generation/evolution in single-article mode:**

**Approach A: Modify PoolSupervisor** to check a config flag and return different PhaseConfig:
- Add `singleArticle: boolean` to `SupervisorConfig`
- In `getPhaseConfig()`, when `singleArticle && phase === 'COMPETITION'`:
  - `runGeneration: false`, `runOutlineGeneration: false`, `runEvolution: false`
  - Everything else stays as-is
- Pro: Centralized, clean
- Con: Supervisor gets a new concern

**Approach B: Feature flags** — existing `EvolutionFeatureFlags` already gate agents:
- `executeFullPipeline` checks `featureFlags?.[flagKey] === false` (pipeline.ts L853)
- Add flags: `generationEnabled`, `evolutionEnabled` (currently missing)
- Pass flags as `{ generationEnabled: false, evolvePoolEnabled: false, outlineGenerationEnabled: false }`
- Pro: No supervisor changes, uses existing mechanism
- Con: Feature flags are meant for gradual rollout, not operational modes

**Approach C: Config-driven via EvolutionRunConfig**:
- Add `generation: { strategies: 0 }` → GenerationAgent respects 0 = skip
- Add `singleArticle: boolean` or `maxVariantsPerIteration: number` to config
- Supervisor reads config and adjusts PhaseConfig accordingly
- Pro: Config is the natural place for operational modes
- Con: GenerationAgent doesn't currently respect strategies count

### 22. Phase Transition in Single-Article Mode

**EXPANSION phase** runs: generation + calibration + proximity. This is pure population growth.
**COMPETITION phase** runs: all agents with phase-gated configs.

**For single-article mode**: EXPANSION is entirely unnecessary. We want to:
1. Skip EXPANSION entirely → start in COMPETITION
2. Disable generation/evolution agents in COMPETITION

**Mechanism**: Set `expansion.maxIterations: 0` in config. The supervisor's `detectPhase()` checks `state.iteration >= cfg.expansionMaxIterations` first (supervisor.ts L98-100), so with `maxIterations: 0` it immediately transitions to COMPETITION.

This is already supported and tested — no code changes needed for the phase skip.

### 23. Stopping Conditions in Single-Article Mode

The existing `shouldStop()` has three conditions:
1. **Quality plateau** — tracks ordinal improvement over window. With improvement agents, ordinal should improve after each accepted edit. Plateau detection still makes sense.
2. **Budget exhausted** — works as-is.
3. **Max iterations** — works as-is (default 3 for single mode).

**Additional stopping condition** (from earlier research): Quality threshold where all critique dimensions >= 8. This could be added to `shouldStop()` or checked in the iteration loop.

### 24. Rating Flow — The Promotion Problem Revisited

**With the config-driven approach**, CalibrationRanker/Tournament will self-disable on iteration 0 (pool=1). But after IterativeEditing produces a new variant (pool=2), CalibrationRanker's canExecute becomes `true` on the NEXT iteration (newEntrants=1, pool=2).

**Natural flow:**
- Iter 0: baseline only → Reflect → Edit (adds variant) → Calibration SKIPS (newEntrants cleared by next startNewIteration) ...wait.

Actually, `newEntrantsThisIteration` tracks variants added THIS iteration. After IterativeEditing adds a variant, `newEntrantsThisIteration` has the new ID. Calibration runs later in the same iteration and sees `newEntrants.length > 0 && pool.length >= 2` → it RUNS and rates the new variant against baseline.

**So ratings update naturally!** No synthetic promotion needed if Calibration/Tournament run after editing agents in the same iteration. The existing COMPETITION agent order already places calibration after iterativeEditing.

This simplifies the approach significantly: no `promoteLatestVariant()` needed.

### 25. Complete Agent Execution Order in COMPETITION

From pipeline.ts L832-875 (executeFullPipeline):
```
1. generation              ← DISABLE for single-article
2. outlineGeneration       ← DISABLE for single-article
3. reflection              ✅ critiques current best
4. iterativeEditing        ✅ improves current best
5. treeSearch              ✅ explores revision branches
6. sectionDecomposition    ✅ parallel section edits
7. debate                  canExecute self-disables
8. evolution               ← DISABLE for single-article
9. calibration/tournament  ✅ rates new variants (auto-enables when pool >= 2)
10. proximity              ✅ diversity tracking (auto-enables when pool >= 2)
11. metaReview             ✅ analysis feedback
```

This order is ideal for single-article: reflect → improve → rank → analyze.

### 26. Summary: Minimal Changes Needed

1. **EvolutionRunConfig**: Add `singleArticle?: boolean` field
2. **PoolSupervisor or FeatureFlags**: Disable generation/outlineGeneration/evolution when `singleArticle` is true
3. **Config defaults for single-article**: `expansion.maxIterations: 0` (skip EXPANSION), `maxIterations: 3`, `budgetCapUsd: 1.00`
4. **CLI**: `--single` flag maps to config overrides
5. **DB migration**: Add 'single' to pipeline_type CHECK constraint
6. **No new pipeline function** — `executeFullPipeline` handles everything
7. **No synthetic rating promotion** — CalibrationRanker/Tournament naturally rate after editing agents produce new variants

## Deep Dive Findings (Round 5) — Implementation Constraints

### 27. GenerationAgent Ignores Config — Must Disable via PhaseConfig

GenerationAgent has a **hardcoded** `STRATEGIES` array (generationAgent.ts L11):
```typescript
const STRATEGIES = ['structural_transform', 'lexical_simplify', 'grounding_enhance'] as const;
```

- `config.generation.strategies` is **never read** by GenerationAgent
- Always creates exactly 3 variants via `Promise.allSettled(STRATEGIES.map(...))`
- Setting `strategies: 0` has **no effect** — only used by CalibrationRanker/ProximityAgent for cost estimation
- Supervisor already has a TODO (supervisor.ts L180-182) noting `generationPayload.strategies` is dead code
- **Must disable via `config.runGeneration: false`** in PhaseConfig — no finer-grained control possible

Similarly, EvolutionAgent creates 3-5 variants per execution (3 base strategies + optional creative/outline mutations) with no config control. Must disable via `config.runEvolution: false`.

### 28. Feature Flag System — GenerationAgent NOT Gated

Current `flagGatedAgents` array in pipeline.ts (L837-849):
```typescript
const flagGatedAgents = [
  { configKey: 'runOutlineGeneration', agent: agents.outlineGeneration, flagKey: 'outlineGenerationEnabled' },
  { configKey: 'runReflection',        agent: agents.reflection },  // NO FLAG
  { configKey: 'runIterativeEditing',  agent: agents.iterativeEditing, flagKey: 'iterativeEditingEnabled' },
  { configKey: 'runTreeSearch',        agent: agents.treeSearch, flagKey: 'treeSearchEnabled' },
  { configKey: 'runSectionDecomposition', agent: agents.sectionDecomposition, flagKey: 'sectionDecompositionEnabled' },
  { configKey: 'runDebate',            agent: agents.debate, flagKey: 'debateEnabled' },
  { configKey: 'runEvolution',         agent: agents.evolution, flagKey: 'evolvePoolEnabled' },
];
```

**GenerationAgent runs OUTSIDE this array** (pipeline.ts L832-834):
```typescript
if (config.runGeneration) {
  await runAgent(runId, agents.generation, ctx, phase, logger);
}
```

To disable GenerationAgent for single-article mode, two approaches:
- **Approach A**: Modify supervisor `getPhaseConfig()` to return `runGeneration: false` when `singleArticle` config is set
- **Approach B**: Move GenerationAgent into the `flagGatedAgents` array and add a `generationEnabled` flag

Approach A is simpler — keeps the change in one place (supervisor config).

### 29. Supervisor Constraint — Minimum Iterations with expansionMaxIterations=0

Constructor validation (supervisor.ts L82-88):
```typescript
if (maxIterations <= expansionMaxIterations) {
  throw new Error(`maxIterations must be > expansionMaxIterations`);
}
const minViable = expansionMaxIterations + plateauWindow + 1;
if (maxIterations < minViable) {
  throw new Error(`maxIterations must be >= ${minViable}`);
}
```

With `expansionMaxIterations=0` and default `plateauWindow=3`:
- `minViable = 0 + 3 + 1 = 4`
- **Minimum `maxIterations` = 4**, even for single-article mode

**Solutions:**
- Set `plateauWindow: 1` for single-article mode → `minViable = 0 + 1 + 1 = 2` (allows 2-3 iterations)
- Or set `plateauWindow: 0` → `minViable = 1` (minimum 1 iteration)
- Plateau detection still works with smaller window — just less smoothing

### 30. COMPETITION Phase Uses Tournament (Not Calibration)

Pipeline.ts L860-864:
```typescript
if (config.runCalibration) {
  const useTournament = phase === 'COMPETITION' && options.featureFlags?.tournamentEnabled !== false;
  const rankingAgent = useTournament ? agents.tournament : agents.calibration;
  await runAgent(runId, rankingAgent, ctx, phase, logger);
}
```

In single-article COMPETITION mode:
- **Tournament** runs after editing agents add variants
- Pool=2 scenario: Swiss pairing creates single `(baseline, edited_v1)` pair
- Runs 3-4 rounds of same comparison (stale limit = 3)
- **ComparisonCache** (comparisonCache.ts) makes repeated comparisons free after first
- Effectively: 1 real LLM comparison (2 calls for bias mitigation) + 2-3 cache hits
- **Cost: ~$0.001** per iteration for rating — negligible

### 31. addToPool() Auto-Populates newEntrantsThisIteration — Confirmed

state.ts L46-55:
```typescript
addToPool(variation: TextVariation): void {
  if (this.poolIds.has(variation.id)) return;
  this.pool.push(variation);
  this.poolIds.add(variation.id);
  this.newEntrantsThisIteration.push(variation.id);  // ← auto-tracks
  if (!this.ratings.has(variation.id)) {
    this.ratings.set(variation.id, createRating());
    this.matchCounts.set(variation.id, 0);
  }
}
```

When IterativeEditingAgent calls `state.addToPool(editedVariant)` (iterativeEditingAgent.ts L113):
1. Variant added to pool (pool size 1→2)
2. ID pushed to `newEntrantsThisIteration`
3. Default rating `{mu:25, sigma:8.333}` created
4. Tournament runs later in same iteration → rates the pair

### 32. CLI Feature Flag Gap

The local CLI runner (`scripts/run-evolution-local.ts` L705) does **NOT** fetch or pass feature flags:
```typescript
const result = await executeFullPipeline(runId, agents, ctx, logger, { startMs });
```

Production cron runner (`scripts/evolution-runner.ts` L126-128) DOES:
```typescript
const featureFlags = await fetchEvolutionFeatureFlags(getSupabase());
// ... passes to executeFullPipeline
```

For single-article mode, the CLI needs to either:
1. Pass feature flags with `evolvePoolEnabled: false`, `outlineGenerationEnabled: false`
2. Or rely solely on supervisor PhaseConfig overrides (simpler)

### 33. Iteration Flow for Single-Article Mode — Detailed Walkthrough

**Config overrides:**
```typescript
{
  expansion: { maxIterations: 0 },  // skip EXPANSION
  plateau: { window: 1 },           // allow 2+ iterations
  maxIterations: 3,                  // default for single mode
  budgetCapUsd: 1.00,
}
```

**Supervisor modification**: When `singleArticle`, `getPhaseConfig()` returns:
```typescript
{
  phase: 'COMPETITION',
  runGeneration: false,          // ← disabled
  runOutlineGeneration: false,   // ← disabled
  runEvolution: false,           // ← disabled
  runReflection: true,           // critiques current best
  runIterativeEditing: true,     // improves via critique-driven edits
  runTreeSearch: true,           // beam search on top variant
  runSectionDecomposition: true, // parallel section edits
  runDebate: true,               // canExecute self-disables (needs 2 non-baseline)
  runCalibration: true,          // Tournament rates when pool >= 2
  runProximity: true,            // runs when pool >= 2
  runMetaReview: true,           // lightweight analysis
}
```

**Iteration 0:**
1. `insertBaselineVariant()` → pool=`[baseline]`, ratings=`{baseline: default}`
2. `startNewIteration()` → iter=0, `newEntrantsThisIteration=[baseline_id]`
3. Reflection → critiques baseline → `allCritiques=[{baseline_id, scores}]`
4. IterativeEditing → reads critique → edits baseline → adds `edited_v1` → pool=2
5. TreeSearch → beam search on top variant → may add `tree_v1` → pool=2-3
6. SectionDecomposition → parallel section edits → may add `section_v1` → pool=2-4
7. Debate → `canExecute: countRatedNonBaseline >= 2` → SKIPS (only 1-3 non-baseline, may not all be rated yet)
8. Tournament → `pool >= 2` → rates ALL variants → ordinals separate
9. Proximity → diversity metrics (optional, runs when pool >= 2)
10. MetaReview → analysis feedback

**Iteration 1:**
- `startNewIteration()` clears `newEntrantsThisIteration`
- `getTopByRating(1)` now returns the highest-rated variant from iteration 0
- Reflection → fresh critique on current best
- IterativeEditing → targets new weaknesses → may add improved variant
- Tournament → rates expanded pool
- Repeat until quality plateau, budget, or max iterations

**Pool growth**: ~1-3 variants per iteration from editing agents. After 3 iterations: ~4-10 total variants. This is "single-article" in spirit — focused linear improvement, not broad population search.

### 34. Approach Decision Summary

**Recommended: Modify PoolSupervisor to handle singleArticle config**

Changes needed:
1. `EvolutionRunConfig`: Add `singleArticle?: boolean`
2. `SupervisorConfig`: Add `singleArticle: boolean`
3. `supervisorConfigFromRunConfig()`: Map the field
4. `getPhaseConfig()`: When `singleArticle && COMPETITION`, set `runGeneration: false`, `runOutlineGeneration: false`, `runEvolution: false`
5. Constructor: Relax `expansionMinPool >= 5` constraint when `singleArticle` (pool starts at 1)
6. CLI: `--single` flag → config overrides `{ singleArticle: true, expansion: { maxIterations: 0 }, plateau: { window: 1 }, maxIterations: 3, budgetCapUsd: 1.00 }`
7. DB migration: Add 'single' to pipeline_type CHECK constraint
8. Pipeline.ts: Set `pipeline_type: 'single'` when `config.singleArticle`

**What stays the same:**
- `executeFullPipeline` — no changes to the function itself
- All agent code — canExecute gates handle everything
- Checkpointing, finalization, summary, variant persistence
- Rating system (Tournament works naturally with pool=2)
- ComparisonCache, OTel spans, error handling

## Deep Dive Findings (Round 6) — Comparative Analysis & Implementation Details

Eight research agents explored three implementation approaches in depth: Option B (new `executeSingleArticlePipeline` function), Option C (config-driven PoolSupervisor modification), and Option D (thin wrapper around `executeMinimalPipeline`). This round consolidates those findings.

### 35. Options B and D Are Functionally Identical

Option D (thin wrapper) and Option B (new function) produce the same implementation: a new `executeSingleArticlePipeline()` in `pipeline.ts` that reuses `runAgent()`, `insertBaselineVariant()`, and `finalizePipelineRun()`. The structural difference is naming only. Both require ~80 lines of new code, a `promoteLatestVariant()` helper, and a `qualityThresholdMet()` helper.

### 36. executeFullPipeline Line-by-Line Decomposition

Classified every line of `executeFullPipeline` (L746-928):
- **~55 lines infrastructure** (OTel spans, DB updates, checkpointing, finalization) — reusable in any approach
- **~25 lines supervisor-specific** (PoolSupervisor construction, phase detection, transitions, resume) — eliminated in Option B, leveraged in Option C
- **~30 lines agent dispatch** (flagGatedAgents loop, generation block, calibration/tournament) — replaced by 5-line loop in Option B, unchanged in Option C

### 37. executeMinimalPipeline Cannot Be Wrapped

`executeMinimalPipeline` (L641-711) lacks iteration loop, `startNewIteration()`, stopping conditions, and variant promotion. It also performs its own DB status updates and `finalizePipelineRun()` inline. Wrapping it would require refactoring to disable its bookkeeping — breaking backward compatibility. Concluded: extracting from `executeFullPipeline` is cleaner.

### 38. PoolSupervisor Constraint Analysis — Option C Viable With 6 Lines

Detailed constraint analysis for Option C (config-driven approach):

**Constraint 1: `expansionMinPool >= 5`** (supervisor.ts L79-81)
- Constructor throws for `expansionMinPool < 5`. But with `expansionMaxIterations: 0`, the pool gate in `detectPhase()` is never evaluated (iteration 0 >= 0 triggers COMPETITION immediately at L98-100).
- Cleanest fix: `if (expansionMaxIterations > 0 && expansionMinPool < 5) throw` — no `singleArticle` field needed for this specific check.
- Alternative: pass `expansion.minPool: 1` in config overrides and add `if (!cfg.singleArticle)` guard.

**Constraint 2: `minViable` iterations** (supervisor.ts L85-88)
- With `expansionMaxIterations: 0` and `plateauWindow: 1`: `minViable = 0 + 1 + 1 = 2`. `maxIterations: 3` satisfies this.
- **No code changes needed** — config overrides handle it.

**Constraint 3: `getPhaseConfig()` COMPETITION** (supervisor.ts L179-199)
- Returns `runGeneration: true`, `runOutlineGeneration: true`, `runEvolution: true` for COMPETITION.
- Fix: 3-line conditional: `runGeneration: !this.cfg.singleArticle`, same for outline and evolution.

**Total supervisor.ts changes: ~6 lines** (1 interface field, 1 mapping line, 1 constructor guard, 3 getPhaseConfig conditionals).

### 39. Natural Rating Flow — Confirmed Valid for Option C

Step-by-step walkthrough of iteration 0 with Option C:

1. `insertBaselineVariant()` → pool=1, `newEntrantsThisIteration=[baseline_id]`
2. `startNewIteration()` → clears `newEntrantsThisIteration=[]`
3. Generation SKIPPED (`runGeneration: false`)
4. Reflection → critiques baseline → populates `allCritiques`
5. IterativeEditing → edits baseline → calls `state.addToPool(edited_v1)` → pool=2, `newEntrantsThisIteration=[edited_v1_id]`
6. Tournament (step 9 in COMPETITION order) → `canExecute: pool >= 2` → TRUE → Swiss-pairs `(baseline, edited_v1)` → runs 1 real pairwise comparison → updates ratings
7. After Tournament: `getTopByRating(1)` returns whichever won the comparison

**No synthetic promotion needed.** Tournament runs after editing agents in the same iteration (pipeline.ts agent order places calibration/tournament at step 9, after editing at step 4). The existing execution order naturally handles this.

**Edge case confirmed:** If editing agents reject all edits (pool stays at 1), Tournament SKIPS (`canExecute: pool < 2`). Next iteration, Reflection re-critiques baseline with fresh critique, IterativeEditing tries new targets. This is correct behavior.

### 40. Feature Flags Do NOT Block Option C

The `flagGatedAgents` loop (pipeline.ts L851-858) checks PhaseConfig FIRST, then feature flags:
```
if (!config[configKey] || !agent) continue;        // ← PhaseConfig blocks here
if (flagKey && options.featureFlags?.[flagKey] === false) continue;  // secondary gate
```

Since supervisor returns `runGeneration: false` for single-article, the PhaseConfig gate blocks before feature flags are checked. **No feature flag changes needed.** The CLI doesn't need to synthesize flags.

### 41. Pipeline.ts — Only 1 Line Changed for Option C

The only change in `executeFullPipeline` itself:
```typescript
// L764: was 'full', now conditional
pipeline_type: ctx.payload.config.singleArticle ? 'single' : 'full',
```

Everything else — agent dispatch, iteration loop, checkpointing, finalization, OTel — works unchanged.

### 42. Comparative Analysis — Final Verdict

| Criterion | Option B (New Function) | Option C (Supervisor Mod) |
|-----------|------------------------|--------------------------|
| New lines of code | ~80 (new function + 2 helpers) | ~25 (6 in supervisor + config + pipeline + types) |
| Files touched | 5-6 | 5-6 |
| Risk to existing pipelines | Very low (zero shared code modified) | Low (supervisor change is additive, gated by new flag) |
| Testability | Easy (isolated) | Moderate (need supervisor + integration tests) |
| Needs `promoteLatestVariant()`? | Yes (~13 lines) | No (Tournament rates naturally) |
| Quality threshold stopping | Own function | Needs `shouldStop()` addition or checked in iteration loop |
| Code duplication | ~35 lines copied from existing pipelines | Zero duplication |
| Reuses iteration loop | No (new loop) | Yes (existing `executeFullPipeline` loop) |
| Reuses checkpointing | Partially (calls `runAgent`) | Fully (entire checkpoint + resume system) |
| Reuses stopping conditions | No (new stopping logic) | Partially (plateau + budget + max iterations) |
| Supervisor resume | Not supported | Fully supported (existing checkpoint/resume) |

**Key advantage of Option C**: Full checkpoint/resume support comes free. If a single-article run is interrupted, it can resume from the last checkpoint — the supervisor state, pool, ratings, and critiques are all preserved. Option B would need to implement its own resume logic.

**Key advantage of Option B**: Clean separation, no risk to existing full/minimal pipelines. The `promoteLatestVariant()` approach is explicit. Adding single-article-specific features is natural in the isolated function.

### 43. DB Migration — Both Tables Need Updating

Two tables have `pipeline_type` CHECK constraints:
1. `content_evolution_runs` (`20260207000004_pipeline_type_on_runs.sql`)
2. `strategy_configs` (`20260207000003_strategy_formalization.sql`)

Both need `'single'` added. TypeScript types in 3 locations:
- `src/lib/evolution/types.ts` L301-303: `PipelineType` union + `PIPELINE_TYPES` array
- `src/lib/evolution/core/strategyConfig.ts` L31: `StrategyConfigRow.pipeline_type`

### 44. CLI Does Not Pass Feature Flags — Not a Problem for Option C

The CLI runner (`run-evolution-local.ts` L705) does NOT pass `featureFlags` to `executeFullPipeline`. The cron runner DOES (route.ts L141-144). For Option C, this is irrelevant because agent gating is handled by supervisor PhaseConfig, not feature flags. The `flagGatedAgents` loop checks PhaseConfig first and short-circuits before reaching the feature flag check.

### 45. Production Runner Dispatch — Both Options Need Branching

The cron runner (route.ts L141) always calls `executeFullPipeline`. For Option C, this STILL works — `executeFullPipeline` handles single-article mode transparently via supervisor config. No cron runner changes needed.

For Option B, the cron runner needs a dispatch branch: `if (config.singleArticle) executeSingleArticlePipeline(...) else executeFullPipeline(...)`.

### 46. Edge Cases for Option C — Tournament with Small Pools

- **Pool=2 (baseline + 1 edit):** Tournament runs 1 comparison, then stalls (all pairs exhausted after `maxStaleRounds=3`). Cost: ~$0.001 (negligible via ComparisonCache).
- **Pool growth ~1-3 per iteration:** After 3 iterations, pool is ~4-10 variants. Tournament handles up to ~20 efficiently.
- **Stale critiques:** After Tournament reranks and a new variant becomes top, the next iteration's Reflection re-critiques it. IterativeEditing then gets a fresh critique for the new top variant.
- **SectionDecomposition blocked (<2 H2 sections):** canExecute returns false, agent skips silently. Benign — other agents still improve the article.

### 47. Quality Threshold for Option C — Where to Add

Option C can add quality threshold stopping in two ways:
1. **In `shouldStop()`** (supervisor.ts L202-238): Add a 4th condition checking critique dimensions. Pro: centralized. Con: modifies supervisor for a single-article-specific concern.
2. **In `executeFullPipeline` iteration loop** (pipeline.ts L822-829): Check after `shouldStop()` but before continuing. Pro: no supervisor change. Con: adds logic to the pipeline function.

Approach 2 is cleaner — add a `qualityThresholdMet()` check in the iteration loop, gated by `config.singleArticle`. ~5 lines in `executeFullPipeline`.

### 48. buildRunSummary Handles Small Pools Gracefully

`buildRunSummary()` (pipeline.ts L297-355) works with any pool size:
- `getTopByRating(5)` returns all variants if pool < 5
- Match stats default to 0 when no matches
- `finalPhase` from supervisor works correctly (always 'COMPETITION' for single-article)
- Ordinal/diversity history populated by supervisor as normal

No changes needed to summary generation.
