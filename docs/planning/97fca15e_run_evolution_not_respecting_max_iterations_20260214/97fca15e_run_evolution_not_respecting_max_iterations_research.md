# Run Evolution Not Respecting Max Iterations Research

## Problem Statement
A production evolution run (97fca15e) exceeded its configured maxIterations limit instead of terminating. This resulted in wasted budget and compute resources. The pipeline's stopping condition for max iterations may have a bug in the PoolSupervisor's shouldStop() logic, or the run's config may not have been properly resolved.

## Requirements (from GH Issue #429)
1. Investigate production run 97fca15e to determine configured maxIterations
2. Check if run exceeded its maxIterations limit
3. Identify root cause in stopping condition logic if exceeded
4. Fix the bug so max_iterations is properly respected
5. Add tests to verify enforcement

## High Level Summary

### Two Bugs Found

**Bug 1 (Critical): Strategy config fields not propagated to run config**

`queueEvolutionRunAction` (evolutionActions.ts:225-248) only copies `enabledAgents` and `singleArticle` from strategy config to the run's config JSONB. Five fields are silently dropped: `iterations` (→ maxIterations), `generationModel`, `judgeModel`, `agentModels`, and `budgetCaps`. The pipeline then uses `DEFAULT_EVOLUTION_CONFIG` defaults for all dropped fields.

For run 97fca15e: strategy "Light" specified `iterations: 3`, but the run used `maxIterations: 15` (default). The run executed 12 iterations before hitting a per-agent budget cap, 4x more than intended.

**Bug 2 (Minor): Off-by-one in iteration counting**

The pipeline for-loop increments `state.iteration` via `startNewIteration()` BEFORE calling `shouldStop()`. For `maxIterations=N`, only N-1 iterations actually execute agents. The final iteration enters the loop, increments the counter, hits `shouldStop()`, and breaks before running any agents. Example: `maxIterations=3` → only 2 iterations execute.

### Production Run 97fca15e Data

| Field | Value |
|-------|-------|
| **id** | `97fca15e-13a8-48af-8215-68c2bb701387` |
| **status** | `paused` (budget exceeded) |
| **phase** | `COMPETITION` |
| **current_iteration** | 12 |
| **error_message** | `Budget exceeded for pairwise: spent $0.9994, cap $1.0000` |
| **budget_cap_usd** | 5 |
| **run config** | `{ enabledAgents: [6 agents] }` — no maxIterations |
| **strategy** | "Light" (`bcfb6d9e`) — `iterations: 3` |
| **strategy models** | `generationModel: deepseek-chat`, `judgeModel: deepseek-chat` |
| **actual models used** | `generationModel: gpt-4.1-mini` (default), `judgeModel: gpt-4.1-nano` (default) |
| **variants in DB** | 0 (finalizePipelineRun never ran) |

## Detailed Findings

### Finding 1: Config Propagation Gap

**Data flow trace:**

```
Strategy Config (DB)              Run Config (DB)                 Resolved Config (Runtime)
─────────────────────             ─────────────────               ────────────────────────
generationModel: deepseek-chat    ─── NOT COPIED ───────────────→ gpt-4.1-mini (DEFAULT)
judgeModel: deepseek-chat         ─── NOT COPIED ───────────────→ gpt-4.1-nano (DEFAULT)
iterations: 3                     ─── NOT COPIED ───────────────→ maxIterations: 15 (DEFAULT)
agentModels: {}                   ─── NOT COPIED ───────────────→ undefined (DEFAULT)
budgetCaps: {gen:0.2,...}         ─── NOT COPIED ───────────────→ DEFAULT budgetCaps
enabledAgents: [6 agents]    ──── COPIED ──────────────────────→ [6 agents] ✓
singleArticle: false         ──── COPIED ──────────────────────→ false ✓
```

**Root cause location:** `src/lib/services/evolutionActions.ts:225-248`

```typescript
// Build run config from strategy's agent selection + pipeline mode
const runConfig: Record<string, unknown> = {};
if (strategyConfig?.enabledAgents) {
  // ... copies enabledAgents
}
if (strategyConfig?.singleArticle) {
  runConfig.singleArticle = true;
}
// ← MISSING: iterations → maxIterations, generationModel, judgeModel, agentModels, budgetCaps
```

**Impact on all 7 entry points:**

| Entry Point | Creates Runs? | Reads run.config? | Uses preparePipelineRun? |
|-------------|:---:|:---:|:---:|
| queueEvolutionRunAction | YES | YES (strategy) | NO |
| triggerEvolutionRunAction | NO | YES (run JSONB) | YES |
| Cron Runner (evolution-runner route) | NO | YES (run JSONB) | YES |
| Batch Runner (evolution-runner.ts) | NO | YES (run JSONB) | YES |
| Local CLI (run-evolution-local.ts) | Optional | NO (CLI flags) | NO |
| Batch Experiment (run-batch.ts) | YES | NO (JSON config) | YES |
| Admin Batch Dispatch | NO | N/A (triggers GH Actions) | N/A |

All production paths (trigger, cron, batch runner) read config from `evolution_runs.config` JSONB, which only contains `enabledAgents`/`singleArticle`. The local CLI and batch experiment runner are unaffected because they construct config directly from CLI flags / JSON files.

### Finding 2: Off-by-One in Iteration Counting

**Pipeline loop (pipeline.ts:865-1010):**

```typescript
for (let i = ctx.state.iteration; i < ctx.payload.config.maxIterations; i++) {
  ctx.state.startNewIteration();  // state.iteration += 1 (BEFORE shouldStop)
  // ...
  const [shouldStop, reason] = supervisor.shouldStop(ctx.state, availableBudget);
  // shouldStop checks: state.iteration >= maxIterations
  if (shouldStop) { break; }
  // ...agents execute here...
}
```

**Trace for maxIterations=3:**

| Loop i | state.iteration after startNewIteration | shouldStop(3 >= 3?) | Agents run? |
|:------:|:---------------------------------------:|:-------------------:|:-----------:|
| 0 | 1 | 1 >= 3? NO | YES |
| 1 | 2 | 2 >= 3? NO | YES |
| 2 | 3 | 3 >= 3? YES → BREAK | NO |

Result: Only **2 actual iterations** for maxIterations=3.

**Checkpoint resume impact:** When resuming from iteration=2 with maxIterations=3, the loop enters at i=2, increments to 3, shouldStop fires, and the run ends immediately without executing any agents.

### Finding 3: Field Name Mismatch (iterations vs maxIterations)

Two different type interfaces use different names for the same concept:

| Interface | Field | Location |
|-----------|-------|----------|
| `EvolutionRunConfig` (runtime) | `maxIterations` | types.ts:469 |
| `StrategyConfig` (DB) | `iterations` | strategyConfig.ts:16 |

The mapping exists in `extractStrategyConfig()` (strategyConfig.ts:143):
```typescript
iterations: runConfig.maxIterations ?? 15
```

And the reverse in `run-batch.ts:125`:
```typescript
maxIterations: run.iterations
```

But `queueEvolutionRunAction` does NOT perform this mapping when writing to the run config JSONB. The cost estimator (evolutionActions.ts:197) correctly does `maxIterations: strategyConfig.iterations`, but this is only used for estimation display — not execution.

### Finding 4: Cost Estimation vs Execution Mismatch

The cost estimator correctly reads `iterations` from strategy config:
```typescript
// evolutionActions.ts:197 (cost estimation — CORRECT)
maxIterations: strategyConfig.iterations,
```

But the actual execution ignores the strategy's iterations. This creates a **validation illusion** — the admin UI shows accurate cost estimates for the strategy's iteration count, but the pipeline runs with default 15 iterations using different (more expensive) models.

For run 97fca15e:
- Estimated cost: $0.0632 (based on strategy: 3 iters, deepseek-chat)
- Actual execution: 12 iterations with gpt-4.1-mini/nano (much more expensive)
- Hit per-agent budget cap before reaching default maxIterations of 15

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/reference.md
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/strategy_experiments.md
- docs/evolution/cost_optimization.md
- docs/evolution/agents/tree_search.md
- docs/evolution/agents/generation.md
- docs/evolution/agents/overview.md
- docs/evolution/rating_and_comparison.md

### Previous Research
- docs/planning/debug_prod_evolution_run_20260212/debug_prod_evolution_run_20260212_research.md — same config gap identified for run 50140d27

## Code Files Read
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator, for-loop, shouldStop call
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor, shouldStop(), supervisorConfigFromRunConfig
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, startNewIteration(), iteration counter
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig()
- `src/lib/evolution/index.ts` — preparePipelineRun(), createDefaultAgents()
- `src/lib/evolution/types.ts` — EvolutionRunConfig interface
- `src/lib/evolution/core/strategyConfig.ts` — StrategyConfig type, extractStrategyConfig()
- `src/lib/services/evolutionActions.ts` — queueEvolutionRunAction, triggerEvolutionRunAction
- `src/lib/services/strategyRegistryActions.ts` — Strategy CRUD, presets
- `src/app/api/cron/evolution-runner/route.ts` — Cron runner
- `scripts/evolution-runner.ts` — Batch runner
- `scripts/run-evolution-local.ts` — Local CLI runner
- `scripts/run-batch.ts` — Batch experiment runner
- `src/app/admin/quality/strategies/page.tsx` — Strategy form UI
