# Further Simplify Evolution Pipeline Research

**Date**: 2026-02-16T00:16:16Z
**Git Commit**: a3a54dd1
**Branch**: feat/further_simplify_ev_pipeline_20260215

## Problem Statement
Help me simplify how my pipeline works since there are many agents and config options today. Explain to me how it works in simple terms also, given the number of variations.

## Requirements (from GH Issue #449)
Help me simplify how my pipeline works since there are many agents and config options today. Explain to me how it works in simple terms also, given the number of variations.

---

## High Level Summary

The evolution pipeline is an AI content improvement system that takes an existing article and iteratively makes it better using a pool of competing text variants. Think of it like a breeding program for text: generate variations, have an AI judge rank them, let the best ones "reproduce," and repeat until quality plateaus.

The system has **13 agents**, **~30 config options**, **3 pipeline modes**, **4 entry points**, and **2 phases**. This document maps every moving part.

---

## How It Works — Plain English

### The Big Picture

```
Article → Generate variations → Judge them → Improve the best ones → Repeat → Winner applied
```

1. **You give it an article** (or a prompt to generate one)
2. **It creates 3 variations** using different rewriting strategies
3. **An AI judge compares pairs** to rank them (like a tournament)
4. **The best variants get refined** — edited, debated, evolved
5. **Repeat for N iterations** (default: 15) or until quality plateaus
6. **Admin applies the winner** back to the article

### Two Phases

The pipeline has two phases, like a funnel:

**EXPANSION (iterations 0-8):** Build a diverse pool
- Only runs: GenerationAgent (create variants) + CalibrationRanker (rate them) + ProximityAgent (track diversity)
- Goal: Get at least 15 variants with diversity score >= 0.25
- Transitions to COMPETITION when pool is big/diverse enough, or at iteration 8 (hard cap)

**COMPETITION (iterations 9-15):** Refine the best
- Runs ALL agents: generation, reflection, editing, debate, evolution, tournament
- Goal: Converge on the highest quality variant
- Stops on: quality plateau, budget exhausted, max iterations, or admin kill

### Three Pipeline Modes

| Mode | Used By | What It Does |
|------|---------|--------------|
| `executeFullPipeline` | Production (admin, cron, batch) | Full EXPANSION→COMPETITION with all agents, checkpointing, and supervisor |
| `executeFullPipeline` (single-article) | CLI `--single` | Skips EXPANSION entirely, only runs improvement agents on a single variant |
| `executeMinimalPipeline` | Testing, CLI default | Single pass with caller-chosen agents, no phase transitions |

---

## All 13 Agents — What Each One Does

### Required Agents (always run)

| # | Agent | Plain English | Phase | LLM Calls | Cost |
|---|-------|---------------|-------|-----------|------|
| 1 | **GenerationAgent** | Creates 3 text variations using structural, lexical, and grounding strategies | Both | 3 parallel | Low |
| 2 | **CalibrationRanker** | Rates new variants by comparing them against existing ones (stratified opponents) | Both | 8-16 | Low |
| 3 | **Tournament** | Swiss-style tournament ranking — pairs similar-rated variants for max info gain | COMPETITION | 15-40 | Medium |
| 4 | **ProximityAgent** | Computes text similarity to track pool diversity (no LLM, uses embeddings) | Both | 0 | Free |

### Optional Agents (toggled per strategy)

| # | Agent | Plain English | Phase | LLM Calls | Cost | Requires |
|---|-------|---------------|-------|-----------|------|----------|
| 5 | **ReflectionAgent** | Critiques top 3 variants across 5 quality dimensions (1-10 scores) | COMPETITION | 3 parallel | Low | — |
| 6 | **IterativeEditingAgent** | Surgical edits on the top variant guided by critique, with blind judge gating | COMPETITION | 15-18 | High | Reflection |
| 7 | **SectionDecompositionAgent** | Splits article into H2 sections, edits each in parallel, stitches back | COMPETITION | 9-15 | High | Reflection |
| 8 | **DebateAgent** | 3-turn structured debate between top 2 variants, produces synthesis | COMPETITION | 4 sequential | Medium | — |
| 9 | **EvolutionAgent** | Genetic operators: mutation (clarity/structure), crossover, creative exploration | COMPETITION | 3-5 | Medium | — |
| 10 | **OutlineGenerationAgent** | Generates via outline→expand→polish pipeline with per-step scoring | EXPANSION | 6 | Low | Flag |
| 11 | **MetaReviewAgent** | Analyzes strategy performance, identifies weaknesses (pure analysis, no LLM) | COMPETITION | 0 | Free | — |
| 12 | **TreeSearchAgent** | Beam search tree-of-thought: branch, prune, explore deep revisions | COMPETITION | ~112 | Very High | Reflection |
| 13 | **PairwiseRanker** | Low-level comparison engine (not standalone — used by Calibration and Tournament) | Both | 2 per comparison | Utility | — |

### Agent Dependencies

```
ReflectionAgent ← required by → IterativeEditingAgent
                ← required by → SectionDecompositionAgent
                ← required by → TreeSearchAgent

TreeSearchAgent ⊕ IterativeEditingAgent  (mutually exclusive — can't enable both)
```

---

## Config System — All Options

### Default Config (`DEFAULT_EVOLUTION_CONFIG`)

**File:** `src/lib/evolution/config.ts`

| Category | Option | Default | What It Controls |
|----------|--------|---------|-----------------|
| **Global** | `maxIterations` | 15 | Total pipeline iterations |
| | `budgetCapUsd` | $5.00 | Max spend per run |
| **Plateau** | `plateau.window` | 3 | Iterations to check for stagnation |
| | `plateau.threshold` | 0.02 | Min ordinal improvement to avoid plateau |
| **Expansion** | `expansion.minPool` | 15 | Min variants before switching to COMPETITION |
| | `expansion.minIterations` | 3 | Min EXPANSION iterations |
| | `expansion.diversityThreshold` | 0.25 | Min diversity for phase transition |
| | `expansion.maxIterations` | 8 | Hard cap — force COMPETITION at this point |
| **Generation** | `generation.strategies` | 3 | Variants per generation call |
| **Calibration** | `calibration.opponents` | 5 | Matches per new variant |
| | `calibration.minOpponents` | 2 | Minimum before early exit |
| **Tournament** | `tournament.topK` | 5 | Focus window for tournament |
| **Models** | `judgeModel` | `gpt-4.1-nano` | Model for A/B comparisons (cheap) |
| | `generationModel` | `gpt-4.1-mini` | Model for text generation |
| **Budget Caps** | 12 per-agent caps | 5%-20% each | Per-agent % of total budget (sum > 100% intentionally) |

### Additional Strategy Options

| Option | Default | What It Controls |
|--------|---------|-----------------|
| `enabledAgents` | undefined (all) | Which optional agents the strategy permits |
| `singleArticle` | false | Single-article mode (no generation/evolution, only improvement) |

### Config Flow

```
Strategy (DB) → queueEvolutionRunAction snapshots to run.config →
  resolveConfig() merges with defaults → validateRunConfig() strict check →
    computeEffectiveBudgetCaps() redistributes budget → ExecutionContext
```

**Key insight:** Config is snapshotted at queue time. Editing a strategy after queuing doesn't affect already-queued runs.

---

## Feature Flags

### Hardcoded (always on)
- Tournament, EvolutionAgent, DebateAgent, SectionDecompositionAgent

### Environment Variables (opt-in)
| Env Var | Default | Effect |
|---------|---------|--------|
| `EVOLUTION_TREE_SEARCH` | `false` | Enable TreeSearchAgent (disables IterativeEditing) |
| `EVOLUTION_OUTLINE_GENERATION` | `false` | Enable OutlineGenerationAgent |
| `EVOLUTION_FLOW_CRITIQUE` | `false` | Enable FlowCritiqueAgent |

**File:** `src/lib/evolution/core/featureFlags.ts` — No DB dependency, reads `process.env` synchronously.

---

## Four Entry Points

| Entry Point | Who Uses It | How It Works |
|-------------|-------------|--------------|
| **Admin UI** | Human admin | `queueEvolutionRunAction` → `triggerEvolutionRunAction` (inline execution) |
| **Vercel Cron** | Automated (every 5 min) | Polls for pending runs, claims one, executes with 30s heartbeat |
| **Batch Runner** | CLI / GitHub Actions | `scripts/evolution-runner.ts` — parallel execution, 60s heartbeat, SIGTERM handling |
| **Local CLI** | Developer testing | `scripts/run-evolution-local.ts` — mock/real LLM, file/prompt input, no DB required |

### Entry Point Shared Path

All 4 entry points converge on the same execution path:
```
preparePipelineRun(inputs) → createDefaultAgents() → executeFullPipeline(ctx, agents, options)
```

**File:** `src/lib/evolution/index.ts` — `preparePipelineRun()` is the unified factory.

---

## State Management

### Key Types

| Type | Purpose |
|------|---------|
| `TextVariation` | A single text variant (id, text, version, parentIds, strategy, cost) |
| `PipelineState` | Mutable state: pool, ratings, matches, critiques, diversity, meta-feedback |
| `ExecutionContext` | Dependency injection: state + llmClient + logger + costTracker + config |
| `EvolutionRunConfig` | Per-run config after merging defaults |
| `AgentResult` | Return value from each agent (success, cost, variants added) |

### State Flow Per Iteration

```
1. startNewIteration() → clears newEntrantsThisIteration
2. Agents execute sequentially → mutate state (add variants, update ratings, add critiques)
3. After each agent: persistCheckpoint() + persistAgentInvocation()
4. End of iteration: supervisor checks stopping conditions
5. Loop or finalize
```

### Persistence

| What | When | Where |
|------|------|-------|
| Checkpoint | After every agent | `evolution_checkpoints` (JSONB state snapshot) |
| Heartbeat | After every agent | `content_evolution_runs.last_heartbeat` |
| Variants | At run completion | `content_evolution_variants` |
| Agent metrics | At run completion | `evolution_run_agent_metrics` |
| Agent invocations | After every agent | `evolution_agent_invocations` (per-agent execution detail) |
| Cost prediction | At run completion | `content_evolution_runs.cost_prediction` |
| Hall of Fame | At run completion | `hall_of_fame_entries` (top 3 variants) |

### Budget Enforcement

The `CostTracker` enforces budget at two levels:
- **Per-agent caps** — each agent gets a % of total budget (e.g., generation: 20%)
- **Global cap** — total run budget (default: $5.00)
- **Pre-call reservation** — budget checked BEFORE every LLM call with 30% safety margin
- **FIFO queue** — concurrent parallel calls can't all pass budget checks

When budget is exceeded, run is **paused** (not failed) — admin can increase budget and resume.

---

## Stopping Conditions

The pipeline stops when any of these fire (checked at iteration start):

| Condition | When | Type |
|-----------|------|------|
| **Admin kill** | Run status set to `failed` externally | External |
| **Quality threshold** | All critique dimensions >= 8 (single-article only) | Success |
| **Quality plateau** | Top ordinal improves < 0.12 over 3 iterations | Convergence |
| **Budget exhausted** | Available < $0.01 | Resource |
| **Max iterations** | Hit `maxIterations` (default: 15) | Hard cap |
| **Degenerate state** | Diversity < 0.01 during plateau | Failure |

---

## Rating System

**Within a run:** OpenSkill Bayesian rating (Weng-Lin model)
- Each variant has `{mu, sigma}` — mu = estimated skill, sigma = uncertainty
- New variants: `mu=25, sigma=8.333`
- **Ordinal** = `mu - 3*sigma` (conservative ranking — penalizes under-tested variants)
- Mapped to legacy Elo scale (0-3000) for display via `ordinalToEloScale()`

**Across runs (Hall of Fame):** Elo K-32 rating
- Separate system for comparing variants from different runs
- Initial: 1200, K-factor: 32

---

## Pipeline Module Decomposition

`pipeline.ts` (~751 LOC) delegates to four extracted modules:

| Module | Responsibility |
|--------|---------------|
| `core/persistence.ts` | Checkpoint upsert, variant persistence, run failure/pause marking |
| `core/metricsWriter.ts` | Strategy config linking, cost prediction, per-agent cost metrics |
| `core/hallOfFameIntegration.ts` | Hall of Fame topic/entry linking and variant feeding |
| `core/pipelineUtilities.ts` | Agent invocation persistence and execution detail truncation |

---

## Agent Gating: 4 Layers of Complexity

Today, whether an agent runs requires checking 4 separate layers:

| Layer | Question It Answers | Mechanism | Location |
|-------|-------------------|-----------|----------|
| **1. Phase config** | "Is this EXPANSION or COMPETITION?" | `getPhaseConfig()` returns 12 booleans | `supervisor.ts` |
| **2. Feature flags** | "Is this experimental agent enabled?" | env vars: `EVOLUTION_TREE_SEARCH`, etc. | `featureFlags.ts` |
| **3. enabledAgents** | "Did the strategy choose this agent?" | `isEnabled()` checks config array | `supervisor.ts` |
| **4. canExecute()** | "Does the data exist for this agent to run?" | Per-agent precondition check | Each agent file |

### Redundancy Analysis

Layers 1-3 all answer "should this agent run?" but in 3 different places. The pipeline combines them:
```typescript
if (phaseConfig.runReflection              // Layer 1
    && featureFlags.iterativeEditingEnabled // Layer 2
    && agent.canExecute(state))            // Layer 4
// Layer 3 is buried inside Layer 1 via supervisor.isEnabled()
```

### Typical COMPETITION Iteration (default config)

```
✅ GenerationAgent, CalibrationRanker, Tournament, ProximityAgent  (required — always run)
✅ ReflectionAgent, IterativeEditingAgent, SectionDecompositionAgent  (optional — on by default)
✅ DebateAgent, EvolutionAgent, MetaReviewAgent  (optional — on by default)
❌ OutlineGenerationAgent  (feature flag off by default)
❌ TreeSearchAgent  (feature flag off by default)
❌ FlowCritiqueAgent  (feature flag off by default)
```

10 of 13 agents run. The 3 experimental ones are hidden behind env vars.

### TreeSearch/IterativeEditing Mutex

`MUTEX_AGENTS` in `budgetRedistribution.ts` enforces that TreeSearch and IterativeEditing can't both be enabled. This is a **design choice, not a technical constraint**:

- **IterativeEditingAgent**: Picks the highest-rated variant (proven best), applies sequential critique→edit→judge cycles. Polishes the winner.
- **TreeSearchAgent**: Picks a high-mu + high-sigma variant (underexplored potential), branches via beam search. Explores untapped candidates.

They're **complementary** — one refines the known best, the other explores promising unknowns. The mutex was likely a budget concern (both are expensive) made during initial development.

### Proposed Simplification: Collapse to 2 Layers

**Remove feature flags entirely** — all agents available via `enabledAgents` in strategy config.

**Remove TreeSearch/IterativeEditing mutex** — let strategies choose both if desired.

**Replace Layers 1+2+3 with single `getActiveAgents()` function:**
```
getActiveAgents(phase, enabledAgents, singleArticle) → string[]
```

**Pipeline becomes:**
```typescript
const activeAgents = getActiveAgents(phase, config.enabledAgents, config.singleArticle);
for (const name of activeAgents) {
  if (agents[name].canExecute(state)) await runAgent(agents[name], ...);
}
```

This reduces 4 layers to 2: `getActiveAgents()` (resolved list) + `canExecute()` (runtime data guard).

### TreeSearch vs IterativeEditing: Deep Dive

These two agents are the most expensive optional agents. Understanding what each does explains why the mutex is unnecessary.

**IterativeEditingAgent — The Surgeon**
- **Variant selection:** Takes the #1 rated variant via `getTopByRating(1)` — the proven best
- **Strategy:** Sequential critique→edit→judge cycles (up to 3 rounds)
- **Gating:** Blind diff-based judge compares old vs new without knowing which is which; edit only kept if judge picks the new version
- **Risk tolerance:** Conservative — only accepts changes that demonstrably improve the text
- **LLM calls:** 15-18 (3 rounds × {critique, edit, judge} × sections)
- **State interaction:** Mutates the top variant in-place (replaces its text)
- **Analogy:** A careful editor with a red pen, making targeted fixes

**TreeSearchAgent — The Explorer**
- **Variant selection:** Picks a high-mu + high-sigma variant via `selectRoot()` — underexplored potential, not necessarily the current best
- **Strategy:** Beam search branching (beamWidth=2, branchingFactor=3, maxDepth=3) — generates multiple alternatives at each level, prunes weak branches
- **Gating:** Pre-check requires reflection critiques to exist (depends on ReflectionAgent)
- **Risk tolerance:** Aggressive — explores many paths, most get pruned
- **LLM calls:** ~112 (tree of parallel generation + scoring at each node)
- **State interaction:** Produces 0-1 best leaf variant added to the pool as a new entry
- **Analogy:** A researcher trying many experimental approaches in parallel

**Comparison Table**

| Dimension | IterativeEditing | TreeSearch |
|-----------|-----------------|------------|
| Picks variant by | Highest rating (exploit) | Highest uncertainty (explore) |
| Strategy | Sequential refinement | Branching exploration |
| Risk | Low — only keeps proven improvements | High — explores many paths |
| Output | Mutated top variant | New pool entry (best leaf) |
| Cost | 15-18 LLM calls | ~112 LLM calls |
| Operates on | The #1 proven winner | An underexplored candidate |

**Why the mutex is unnecessary:** They operate on different variants with different goals. IterativeEditing polishes the known best; TreeSearch explores promising unknowns. Running both implements a classic **exploit + explore** strategy — the same principle behind multi-armed bandit algorithms. The mutex was likely a budget concern during initial development, not a correctness constraint.

### Entry Point Overlap

All 4 entry points repeat the same boilerplate:
1. Content resolution (explanation vs prompt) — ~40 lines, 3/4 entry points
2. Seed article generation setup — ~12 lines, 3/4
3. `preparePipelineRun()` call — 3/4 (local CLI builds context manually)
4. Feature flags loading — 3/4
5. Error handling → DB status update — all 4

Each entry point has unique value (admin auth, cron heartbeat, parallel batch, mock LLM), but ~60% of the code is shared boilerplate.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/reference.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/cost_optimization.md
- docs/evolution/visualization.md
- docs/evolution/hall_of_fame.md
- docs/evolution/strategy_experiments.md

## Code Files Read
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor (phases, stopping)
- `src/lib/evolution/index.ts` — Barrel export, preparePipelineRun, finalizePipelineRun
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig
- `src/lib/evolution/types.ts` — All shared types
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, serialize/deserialize
- `src/lib/evolution/core/persistence.ts` — Checkpoint, variant persistence
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl, budget enforcement
- `src/lib/evolution/core/metricsWriter.ts` — Strategy linking, cost prediction
- `src/lib/evolution/core/hallOfFameIntegration.ts` — Hall of Fame feeding
- `src/lib/evolution/core/pipelineUtilities.ts` — Agent invocation persistence
- `src/lib/evolution/core/configValidation.ts` — Config validation
- `src/lib/evolution/core/featureFlags.ts` — Feature flags
- `src/lib/evolution/core/budgetRedistribution.ts` — Agent classification, budget redistribution
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class
- `src/lib/evolution/agents/generationAgent.ts` — GenerationAgent
- `src/lib/evolution/agents/calibrationRanker.ts` — CalibrationRanker
- `src/lib/evolution/agents/tournament.ts` — Tournament
- `src/lib/evolution/agents/evolvePool.ts` — EvolutionAgent
- `src/lib/evolution/agents/reflectionAgent.ts` — ReflectionAgent
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — IterativeEditingAgent
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — SectionDecompositionAgent
- `src/lib/evolution/agents/debateAgent.ts` — DebateAgent
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — OutlineGenerationAgent
- `src/lib/evolution/agents/metaReviewAgent.ts` — MetaReviewAgent
- `src/lib/evolution/agents/proximityAgent.ts` — ProximityAgent
- `src/lib/evolution/agents/treeSearchAgent.ts` — TreeSearchAgent
- `src/lib/evolution/agents/pairwiseRanker.ts` — PairwiseRanker
- `src/lib/services/evolutionActions.ts` — Server actions (queue, trigger, apply)
- `scripts/evolution-runner.ts` — Batch runner
- `scripts/run-evolution-local.ts` — Local CLI runner
- `src/app/api/cron/evolution-runner/route.ts` — Cron entry point
