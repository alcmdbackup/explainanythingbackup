# Infra Cleanup Evolution Pipeline Research

**Date**: 2026-02-06
**Git Commit**: 26d8ce2
**Branch**: feat/infra_cleanup_evolution_pipeline_20260206

## Problem Statement
Assess opportunities to simplify the evolution pipeline architecture, audit cost infrastructure for bugs, and identify ways to consolidate the multiple pipeline construction callsites.

## High Level Summary

The evolution pipeline is a ~4,500 LOC subsystem under `src/lib/evolution/` with 14 agent files, 10 core modules, and 5 tree-of-thought files. There are **5 production callsites** that construct and execute pipelines, each independently instantiating agents and building execution contexts. The cost infrastructure flows through 3 layers (estimation → reservation → recording) with one known attribution bug. Key architectural areas documented below.

---

## 1. Pipeline Construction Callsites (5 total)

### Callsite 1: `scripts/evolution-runner.ts` — Batch Runner
- **Pipeline mode**: `executeFullPipeline`
- **Agents**: All 10 including TreeSearchAgent ✅
- **Config**: `resolveConfig(run.config)` from DB
- **Feature flags**: Fetched from DB, checks `dryRunOnly`
- **LLM client ID**: `RUNNER_ID`
- **Checkpoint resume**: Not implemented
- **Heartbeat**: 60-second interval

### Callsite 2: `scripts/run-evolution-local.ts` — Local CLI
- **Pipeline mode**: Custom implementations of both minimal and full (NOT imported from pipeline.ts)
- **Agents**: All 10 including TreeSearchAgent ✅
- **Config**: CLI overrides → `resolveConfig()`
- **Feature flags**: None (local mode)
- **LLM client**: Either `createMockLLMClient()` or `createDirectLLMClient()`
- **Checkpoint resume**: Bank checkpoint snapshots at specified iterations
- **Notable**: Uses `PoolSupervisor` directly, manually persists variants to DB, adjusts supervisor constraints for low iteration counts

### Callsite 3: `src/app/api/cron/evolution-runner/route.ts` — Cron Handler
- **Pipeline mode**: `executeFullPipeline`
- **Agents**: 9 agents — **Missing TreeSearchAgent** ❌
- **Config**: `resolveConfig(pendingRun.config ?? {})`
- **Feature flags**: Fetched from DB, checks `dryRunOnly`
- **LLM client ID**: `'evolution-cron'`
- **Checkpoint resume**: Not implemented
- **Heartbeat**: `setInterval` based

### Callsite 4: `src/lib/services/evolutionActions.ts` — Admin Trigger
- **Pipeline mode**: `executeFullPipeline`
- **Agents**: 9 agents — **Missing TreeSearchAgent** ❌
- **Config**: `resolveConfig(run.config ?? {})`
- **Feature flags**: Fetched from DB, checks `dryRunOnly`
- **LLM client ID**: `'evolution-admin'`
- **Checkpoint resume**: Not implemented
- **Heartbeat**: None

### Callsite 5: `scripts/run-batch.ts` — Batch Experiments
- **Pipeline mode**: `executeFullPipeline`
- **Agents**: 9 agents — **Missing TreeSearchAgent** ❌
- **Config**: From batch JSON expansion → `resolveConfig()`
- **Feature flags**: Fetched, but no dry-run check
- **LLM client ID**: batch ID
- **Checkpoint resume**: Not implemented

### Summary Table

| Callsite | TreeSearchAgent | Mode | Feature Flags | Config Source | Resume |
|----------|:-:|------|:-:|------|:-:|
| evolution-runner.ts | ✅ | Full | ✅ | DB | ❌ |
| run-evolution-local.ts | ✅ | Custom both | ❌ | CLI | ✅ bank |
| cron evolution-runner | ❌ | Full | ✅ | DB | ❌ |
| evolutionActions.ts | ❌ | Full | ✅ | DB | ❌ |
| run-batch.ts | ❌ | Full | Partial | Batch JSON | ❌ |

---

## 2. Cost Infrastructure (End-to-End Flow)

### Layer 1: Cost Estimation (`core/llmClient.ts:15`)
- `estimateTokenCost(prompt, model)`: heuristic ~4 chars/token, output = 50% of input
- Uses `getModelPricing(model)` from `src/config/llmPricing.ts`
- Called before every LLM request to reserve budget

### Layer 2: Budget Reservation (`core/costTracker.ts:19`)
- `reserveBudget(agentName, estimatedCost)`:
  - Applies 30% safety margin (`estimatedCost * 1.3`)
  - Checks per-agent cap: `agentCapPct * budgetCapUsd`
  - Checks global cap: `totalSpent + totalReserved + withMargin > budgetCapUsd`
  - Throws `BudgetExceededError` if either check fails
  - Tracks reservation in `reservedByAgent` Map and `totalReserved` counter

### Layer 3: Cost Recording (`core/costTracker.ts:37`)
- `recordSpend(agentName, actualCost)`:
  - Adds to `spentByAgent` and `totalSpent`
  - Releases one reservation: `min(agentReserved, actualCost * 1.3)`
- Triggered by `onUsage` callback in `llmClient.ts:62`: `costTracker.recordSpend(agentName, usage.estimatedCostUsd)`

### Layer 4: Available Budget (`core/costTracker.ts:59`)
- `getAvailableBudget()`: `budgetCapUsd - totalSpent`
- **Note**: Does NOT subtract `totalReserved` — only used for supervisor stop conditions, not for reservation checks

### Layer 5: Cost Persistence (`core/pipeline.ts:214`)
- `persistAgentMetrics()`: writes per-agent cost/Elo to `evolution_run_agent_metrics` table
- `linkStrategyConfig()`: hashes config → finds/creates evolution_strategy_configs entry → updates aggregates via RPC
- Both called at end of `executeMinimalPipeline` and `executeFullPipeline`

### Cost Estimation Module (`core/costEstimator.ts`)
- Data-driven predictions from `evolution_agent_cost_baselines` table
- In-memory cache with 5-min TTL
- Minimum 50 samples for high confidence
- Heuristic fallback for missing baselines
- `refreshBaselines()`: aggregates `llmCallTracking` data (min 10 samples per agent/model combo)

### Adaptive Allocation (`core/adaptiveAllocation.ts`)
- `computeAdaptiveBudgetCaps()`: proportional allocation based on ROI from `evolution_run_agent_metrics`
- Floor 5%, ceiling 40%, iterative normalization
- `budgetPressureConfig()`: multiplier based on remaining budget ratio and iterations
- Not currently wired into any pipeline callsite

### Agent Cost Behavior Summary

| Agent | Calls reserveBudget? | Returns accurate costUsd? | Makes LLM calls? |
|-------|:-:|:-:|:-:|
| GenerationAgent | ❌ (llmClient does) | ✅ `getAgentCost()` | ✅ 3 parallel |
| CalibrationRanker | ❌ | ✅ | ✅ bias-mitigated |
| Tournament | ❌ | ✅ | ✅ Swiss rounds |
| EvolutionAgent | ❌ | ✅ | ✅ 3-4 parallel |
| ReflectionAgent | ❌ | ✅ | ✅ up to 3 parallel |
| IterativeEditingAgent | ❌ | ✅ | ✅ sequential cycles |
| TreeSearchAgent | ✅ (explicit) | ✅ | ✅ via beamSearch |
| DebateAgent | ❌ | ❌ **hardcoded 0 in all 9 return stmts** | ✅ 4 sequential |
| MetaReviewAgent | ❌ | ✅ (always 0) | ❌ |
| ProximityAgent | ❌ | ✅ (always 0) | ❌ (estimateCost claims embedding calls but impl uses char-based fallback) |

### Budget Tab Visualization
- `getEvolutionRunBudgetAction` in `evolutionVisualizationActions.ts`
- Queries `llmCallTracking` table with time-window correlation (run start → end)
- Strips `evolution_` prefix from `call_source` to get agent name
- Builds cumulative burn curve from chronological LLM calls
- **Note**: `llmCallTracking` has NO foreign key to `evolution_runs` — time-window only, concurrent runs will contaminate each other's cost attribution

### Agent-Name Stripping Bug (`costEstimator.ts:272`)
- `costEstimator.ts:272` uses non-regex `.replace('evolution_', '')` — strips ALL occurrences, not just prefix
- `evolutionVisualizationActions.ts:362,656,670` uses correct regex `.replace(/^evolution_/, '')`
- Impact: baseline training can create entries with wrong agent names in `evolution_agent_cost_baselines` table
- Example: `evolution_iterative_evolution_call` → costEstimator produces `iterative_call` (wrong) vs viz produces `iterative_evolution_call` (correct)

### Existing Test Masks Reservation Leak
- `costTracker.test.ts:90-98` tests "recordSpend releases reservation" and PASSES
- But it only passes because `getAvailableBudget()` ignores `totalReserved`
- If the test asserted `tracker.totalReserved === 0`, it would FAIL (would be 0.26 remaining)
- This is why the phantom reservation leak was never caught

### Naming Confusion
- `estimatedCostUsd` in `LLMUsageMetadata` (llms.ts) is actually the calculated cost from real token counts, not an estimate — misleading name

---

## 2b. Error Handling Audit

### BudgetExceededError Handling Inconsistencies

| Agent | Correct Re-throw? | State Mutation Before Check? | Silent Swallowing? |
|-------|:-:|:-:|:-:|
| GenerationAgent | ✅ | ❌ safe | ❌ |
| CalibrationRanker | ✅ | ❌ safe | ❌ |
| Tournament | ❌ **Promise.allSettled swallows it** | ❌ safe | ❌ |
| EvolutionAgent | ❌ **creative exploration swallows it** | ❌ safe | ❌ |
| ReflectionAgent | ✅ | ❌ safe | ❌ |
| IterativeEditingAgent | ✅ | ❌ safe | ✅ runOpenReview + runInlineCritique |
| TreeSearchAgent/BeamSearch | ❌ **mini-tournament catches, doesn't re-throw** | ❌ safe | ❌ |
| DebateAgent | ✅ | ✅ **4 locations** | ❌ |

### Critical: EvolutionAgent Creative Exploration (`evolvePool.ts:267-269`)
- Catch block logs error but does NOT check for `BudgetExceededError`
- If budget exceeded during creative exploration, error is swallowed, pipeline continues
- The standard strategy loop (lines 202-206) correctly re-throws

### Critical: Tournament `Promise.allSettled` (`tournament.ts:255-259`)
- Swiss round matches run via `Promise.allSettled()` which captures rejections
- Line 264 checks `result.status !== 'fulfilled'` and skips, but never checks if rejection is `BudgetExceededError`
- Budget exhaustion during tournament is silently absorbed

### High: BeamSearch Mini-Tournament (`beamSearch.ts:102-110`)
- `BudgetExceededError` is caught but NOT re-thrown — beam search degrades silently using unranked survivors
- Inconsistent with depth 1-2 behavior where budget errors break the loop

### High: Pipeline Checkpoint Failure (`pipeline.ts:389-401, 732-742`)
- `persistCheckpoint(...).catch(() => {})` silently ignores checkpoint failures
- If checkpoint fails AND `BudgetExceededError` is thrown, resume will re-execute agent with stale state, double-counting cost

### Medium: IterativeEditingAgent Silent Swallowing
- Both `runOpenReview()` (line ~157) and `runInlineCritique()` (line ~241) catch non-budget errors and return `null` with zero logging
- Parse failures, malformed JSON, network errors all silently return null

---

## 2c. Type Safety Audit

### PipelineAgent ↔ AgentBase Mismatch
- `AgentBase` (base.ts:6-17): requires `execute()`, `estimateCost()`, `canExecute()`
- `PipelineAgent` (pipeline.ts:18-22): only requires `name`, `execute()`, `canExecute()` — **missing `estimateCost()`**
- No agents actually implement `estimateCost()` meaningfully — it's dead on `AgentBase` too

### ~~PipelineAgents Field Name Mismatch~~ (False Positive)
- Interface actually defines `metaReview?: PipelineAgent` (pipeline.ts:460), matching all callsites
- No mismatch exists — initial explore agent report was incorrect

### Budget Caps Loosely Typed
- `budgetCaps: Record<string, number>` allows any string key
- Typo like `budgetCaps['generatio']` silently returns `undefined`, falls back to default 0.20 at costTracker.ts line 28
- Should be a discriminated union of agent name literals

### Dead Code Corrections from Previous Research
- `isConverged()` in `rating.ts` is **NOT dead** — used by `tournament.ts:296` for convergence threshold
- Only `ratingToDisplay()` is truly dead (test-only)

---

## 3. Architecture Components

### Pipeline Orchestrator (`core/pipeline.ts`, 782 lines)
Two exported functions:
- `executeMinimalPipeline`: Single-pass, accepts `PipelineAgent[]` array, no phases
- `executeFullPipeline`: Phase-aware with `PoolSupervisor`, accepts `PipelineAgents` named struct

Both share post-completion logic (duplicated code):
- `persistVariants()` → `evolution_variants`
- `persistAgentMetrics()` → `evolution_run_agent_metrics`
- `linkStrategyConfig()` → `evolution_strategy_configs`
- `buildRunSummary()` → `validateRunSummary()` → `evolution_runs.run_summary`

### PoolSupervisor (`core/supervisor.ts`, 269 lines)
- Drives EXPANSION → COMPETITION transitions (one-way lock)
- `detectPhase()`: pool size ≥ 15 AND diversity ≥ 0.25, OR iteration ≥ 8
- `getPhaseConfig()`: returns which agents run and their payloads
- `shouldStop()`: plateau, budget, max iterations, degenerate state
- **Note**: Generates strategy rotation payload for COMPETITION, but GenerationAgent ignores it (always uses all 3 strategies)

### PipelineState (`core/state.ts`, 136 lines)
- `PipelineStateImpl`: mutable state with append-only pool via `addToPool()`
- `serializeState` / `deserializeState`: JSON roundtrip for checkpoints
- Legacy backward compat: `eloRatings` → `ratings` conversion via `eloToRating()`

### Agent Framework (`agents/base.ts`)
- Abstract `AgentBase` with `execute()`, `estimateCost()`, `canExecute()`
- 10 concrete agents: Generation, CalibrationRanker, PairwiseRanker, Tournament, EvolutionAgent, ReflectionAgent, IterativeEditingAgent, TreeSearchAgent, DebateAgent, MetaReviewAgent, ProximityAgent
- PairwiseRanker is not directly used by the pipeline orchestrator but is used internally by Tournament

### Comparison Infrastructure
- `comparison.ts`: `compareWithBiasMitigation()` with order-invariant SHA-256 cache
- `diffComparison.ts`: CriticMarkup diff + direction-reversal judge (ESM-only imports via dynamic `import()`)
- Used by CalibrationRanker, Tournament (via PairwiseRanker), IterativeEditingAgent, and TreeSearchAgent (via evaluator)

### Feature Flags (`core/featureFlags.ts`)
6 flags from `feature_flags` table:
1. `evolution_tournament_enabled` (default: true)
2. `evolution_evolve_pool_enabled` (default: true)
3. `evolution_dry_run_only` (default: false)
4. `evolution_debate_enabled` (default: true)
5. `evolution_iterative_editing_enabled` (default: true)
6. `evolution_tree_search_enabled` (default: false)

### Other Core Modules
- `core/rating.ts`: OpenSkill (Weng-Lin) wrapper — createRating, updateRating, updateDraw, getOrdinal, ordinalToEloScale
- `core/comparisonCache.ts`: Order-invariant SHA-256 in-memory cache
- `core/pool.ts`: PoolManager — stratified opponent selection, pool health stats
- `core/diversityTracker.ts`: Lineage dominance, strategy diversity, trend computation
- `core/validation.ts`: State contract guards per phase
- `core/logger.ts`: Factory adding `{subsystem: 'evolution', runId}` context
- `core/strategyConfig.ts`: SHA-256 config hashing, human-readable labeling

---

## 4. Config Architecture

### Default Config (`config.ts`)
```
maxIterations: 15, budgetCapUsd: 5.00
plateau: { window: 3, threshold: 0.02 }
expansion: { minPool: 15, minIterations: 3, diversityThreshold: 0.25, maxIterations: 8 }
budgetCaps: { generation: 0.25, calibration: 0.15, tournament: 0.20, evolution: 0.15, reflection: 0.05, debate: 0.05, iterativeEditing: 0.05, treeSearch: 0.10 }
judgeModel: 'gpt-4.1-nano', generationModel: 'gpt-4.1-mini'
```

### Config Resolution
`resolveConfig()` in `config.ts`: deep-spread merge of per-run overrides with defaults for each nested object (plateau, expansion, generation, calibration, budgetCaps).

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/tree_of_thought_revisions.md
- docs/feature_deep_dives/iterative_editing_agent.md

## Code Files Read
- src/lib/evolution/types.ts
- src/lib/evolution/config.ts
- src/lib/evolution/index.ts
- src/lib/evolution/comparison.ts
- src/lib/evolution/diffComparison.ts
- src/lib/evolution/core/pipeline.ts
- src/lib/evolution/core/supervisor.ts
- src/lib/evolution/core/state.ts
- src/lib/evolution/core/costTracker.ts
- src/lib/evolution/core/llmClient.ts
- src/lib/evolution/core/rating.ts
- src/lib/evolution/core/comparisonCache.ts
- src/lib/evolution/core/pool.ts
- src/lib/evolution/core/diversityTracker.ts
- src/lib/evolution/core/validation.ts
- src/lib/evolution/core/logger.ts
- src/lib/evolution/core/featureFlags.ts
- src/lib/evolution/core/costEstimator.ts
- src/lib/evolution/core/adaptiveAllocation.ts
- src/lib/evolution/core/strategyConfig.ts
- src/lib/evolution/agents/ (all 14 files)
- src/lib/evolution/treeOfThought/ (all 5 files)
- scripts/evolution-runner.ts
- scripts/run-evolution-local.ts
- scripts/run-batch.ts
- src/app/api/cron/evolution-runner/route.ts
- src/lib/services/evolutionActions.ts
- src/lib/services/evolutionVisualizationActions.ts
- src/lib/services/eloBudgetActions.ts
- scripts/lib/oneshotGenerator.ts
- scripts/lib/bankUtils.ts
