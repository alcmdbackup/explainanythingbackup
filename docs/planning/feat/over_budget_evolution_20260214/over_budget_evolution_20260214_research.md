# Over Budget Evolution Research

## Problem Statement
Debug why evolution run [232a26c2] is over budget. The pipeline's budget enforcement mechanism (CostTracker with per-agent caps and global cap) should prevent runs from exceeding their budget, but this run appears to have spent more than allocated.

## Requirements (from GH Issue #427)
Investigate run 232a26c2, find where budget enforcement failed, and fix the root cause.

## High Level Summary

Run `232a26c2-4546-441e-9e97-1aea81dd3de4` paused at iteration 11 with error:
> "Budget exceeded for pairwise: spent $1.0504, cap $1.0000"

The root cause is a **missing budget cap for the `pairwise` agent**. The Tournament agent delegates all comparisons to `PairwiseRanker` (whose `name` is `"pairwise"`), but `"pairwise"` is not listed in the `budgetCaps` config. It falls back to the default 20% cap ($1.00 on a $5.00 budget), which is too low for the volume of tournament comparisons. Additionally, the tournament's own cost shows as $0 in agent invocations because all spending is attributed to `"pairwise"`.

### Key Findings

1. **Agent name mismatch**: `PairwiseRanker.name = 'pairwise'` (pairwiseRanker.ts:150), but `budgetCaps` has `tournament: 0.20` — not `pairwise`. The cost tracker's fallback (`budgetCaps[agentName] ?? 0.20`) gives `pairwise` a default 20% cap.

2. **Tournament cost invisibility**: Tournament delegates all LLM calls to PairwiseRanker, so `costTracker.getAgentCost('tournament')` returns $0 while `costTracker.getAgentCost('pairwise')` accumulates all comparison costs.

3. **Run data**:
   - Status: `paused` (budget exceeded pauses, not fails)
   - Budget cap: $5.00, config: `{}` (all defaults)
   - Iterations completed: 11 (7 EXPANSION + 4 COMPETITION)
   - Total LLM calls: 1,000
   - Total actual cost (from llmCallTracking): $3.17

4. **Cost by agent (from llmCallTracking, tight time window 06:05–06:35)**:
   | Agent | Calls | Cost | Cap (% × $5) |
   |-------|-------|------|---------------|
   | calibration | 142 | $0.5115 | $0.75 (15%) ✅ |
   | pairwise | 236 | $1.0504 | $1.00 (20% default) ❌ |
   | iterativeEditing | 62 | $0.1332 | $0.25 (5%) |
   | generation | 81 | $0.0291 | $1.00 (20%) |
   | sectionDecomposition | 56 | $0.0193 | $0.50 (10%) |
   | debate | 24 | $0.0202 | $0.25 (5%) |
   | evolution | 22 | $0.0111 | $0.50 (10%) |
   | reflection | 18 | $0.0070 | $0.25 (5%) |
   | seed_title + seed_article | 4 | $0.0005 | — |

5. **Calibration is NOT over budget**: Initial analysis showed $1.57 across 418 calls, but that was an artifact of two issues:
   - The LLM tracking query used `NOW()` as end time (run has no `completed_at`), capturing stale calls
   - Invocation `cost_usd` values are **cumulative** (from `getAgentCost(this.name)`), not per-invocation
   - Tight-window query: 142 calls, $0.5115 total — well within the $0.75 cap
   - Two other paused runs (482250e9, 93559f22) with null `completed_at` also existed in the time range

6. **Invocation costs are cumulative**: `evolution_agent_invocations.cost_usd` reports `costTracker.getAgentCost(this.name)` which is the running total, not the delta. Confirmed via delta analysis:
   - iter 1: $0.0407 (delta: $0.0407)
   - iter 2: $0.1178 (delta: $0.0772)
   - iter 7: $0.5115 (delta: $0.0731)
   - Final cumulative matches LLM tracking exactly: $0.5115

## Run Timeline

### EXPANSION Phase (Iterations 1–7)
- 3 agents per iteration: generation, calibration, proximity
- Calibration costs grow each iteration as pool grows (more opponents per new entrant)
- No budget errors during EXPANSION

### COMPETITION Phase (Iterations 8–11)
- 9 agents per iteration: generation, reflection, iterativeEditing, sectionDecomposition, debate, evolution, tournament, proximity, meta_review
- Tournament invocations all show cost_usd = 0 (costs tracked under "pairwise" instead)
- iterativeEditing consistently fails (success=false) but still incurs costs
- sectionDecomposition also consistently fails
- Run pauses at iteration 11 during pairwise comparison

## Budget Enforcement Architecture

### How it should work
1. `preparePipelineRun()` calls `computeEffectiveBudgetCaps()` to redistribute budget
2. `CostTrackerImpl` initialized with `budgetCapUsd` and effective `budgetCaps`
3. Before each LLM call: `reserveBudget(agentName, estimate)` checks:
   - Per-agent: `agentSpent + reserved + estimate*1.3 > agentCap` → BudgetExceededError
   - Global: `totalSpent + totalReserved + estimate*1.3 > budgetCapUsd` → BudgetExceededError
4. After LLM call: `recordSpend(agentName, actualCost)` reconciles reservation

### What went wrong
- Tournament calls PairwiseRanker, which uses `this.name` = `"pairwise"` for LLM calls
- `budgetCaps` has no entry for `"pairwise"`, so fallback is 0.20 (20%)
- Per-agent cap = 0.20 × $5.00 = $1.00
- Pairwise hit $1.0504 → BudgetExceededError
- The run was paused correctly (BudgetExceededError → pause, not fail)
- But the real issue is that `pairwise` shouldn't have its own cap — those costs should be attributed to `tournament` or `calibration`

### Calibration overspend — RESOLVED (no gap)
CalibrationRanker uses its own `name = 'calibration'` for LLM calls. Initial analysis suggested $1.57 spend against a $0.75 cap, but this was a data query artifact:
- Tight-window query: 142 calls, $0.5115 — within the $0.75 (15%) cap
- Budget enforcement is working correctly for calibration
- The original broad query included LLM calls from outside this run's actual execution window

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/evolution/cost_optimization.md
- docs/evolution/reference.md
- docs/evolution/architecture.md
- docs/evolution/strategy_experiments.md
- docs/evolution/data_model.md
- docs/evolution/agents/overview.md
- docs/evolution/visualization.md
- docs/evolution/agents/generation.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/agents/tree_search.md

## Code Files Read
- src/lib/evolution/core/costTracker.ts — CostTrackerImpl with FIFO reservation queue
- src/lib/evolution/core/pipeline.ts — Pipeline orchestrator, budget checking, agent execution
- src/lib/evolution/core/supervisor.ts — PoolSupervisor, shouldStop(), phase transitions
- src/lib/evolution/core/llmClient.ts — Budget-enforced LLM client wrapper
- src/lib/evolution/core/budgetRedistribution.ts — computeEffectiveBudgetCaps()
- src/lib/evolution/config.ts — DEFAULT_EVOLUTION_CONFIG, budgetCaps
- src/lib/evolution/types.ts — CostTracker interface, BudgetExceededError
- src/lib/evolution/index.ts — preparePipelineRun(), createDefaultAgents()
- src/lib/evolution/agents/pairwiseRanker.ts — PairwiseRanker (name='pairwise'), comparePair()
- src/lib/evolution/agents/tournament.ts — Tournament delegates to PairwiseRanker
- src/lib/evolution/agents/calibrationRanker.ts — CalibrationRanker (name='calibration')
- src/lib/evolution/comparison.ts — compareWithBiasMitigation()
- src/lib/services/evolutionActions.ts — Server actions for run data
- src/lib/services/evolutionVisualizationActions.ts — Budget and timeline actions
- .claude/hooks/check-workflow-ready.sh — Workflow enforcement hook

## Database Queries Run
- content_evolution_runs: Full run details for 232a26c2
- evolution_agent_invocations: Per-iteration agent execution costs (confirmed cumulative)
- llmCallTracking: Per-call cost tracking grouped by agent (broad + tight window queries)
- content_evolution_runs: Concurrent run check (found 2 other paused runs in time window)

## Conclusions

### Single root cause: Missing `pairwise` budget cap
The `PairwiseRanker` agent (name='pairwise') is used by Tournament but has no entry in `budgetCaps`. It gets the default 20% fallback cap ($1.00), which is insufficient for tournament comparison volume. Meanwhile, the `tournament` entry in `budgetCaps` (also 20%) goes completely unused — tournament never makes direct LLM calls.

### No calibration budget enforcement gap
The calibration agent's actual spend ($0.51) is well within its 15% cap ($0.75). The initial $1.57 figure was a query artifact from using an open-ended time window on a paused (never-completed) run.

### Budget enforcement mechanism is sound
The CostTracker's reservation + FIFO reconciliation system works correctly. The problem is purely a configuration issue — the agent name used for budget tracking doesn't match the agent name in `budgetCaps`.

### Parallel run cost attribution (llmCallTracking has no run_id)

Three data sources exist for evolution costs, with different run-isolation properties:

| Data Source | Has `run_id` | Isolation | Used For |
|---|---|---|---|
| `llmCallTracking` | **No** | Time-window only | Dashboard cost breakdown (`getEvolutionCostBreakdownAction` in evolutionActions.ts:619) |
| `evolution_agent_invocations` | **Yes** | Per-run | Per-iteration agent costs (cumulative `cost_usd`) |
| `evolution_run_agent_metrics` | **Yes** | Per-run | Final per-agent cost totals (from CostTracker, written by `persistAgentMetrics` in pipeline.ts:243) |

**In-memory `CostTracker` is accurate** — scoped to a single run. The problem is the **query/dashboard layer**:
- `getEvolutionCostBreakdownAction` (evolutionActions.ts:619-675) queries `llmCallTracking` using time windows (`started_at` to `completed_at`)
- Paused runs with NULL `completed_at` use `NOW()` as upper bound (line 646-648)
- `getEvolutionRunTimelineAction` (evolutionVisualizationActions.ts:380-425) uses checkpoint boundaries but still time-based
- Overlapping runs with `call_source LIKE 'evolution_%'` contaminate each other's results

**Fix options:**
1. **Add `run_id` to `llmCallTracking`** — Thread run ID through `saveLlmCallTracking()` for exact per-call attribution
2. **Use existing run-scoped tables** — Switch dashboard queries to `evolution_run_agent_metrics` (already has `run_id` + `CostTracker.getAllAgentCosts()` data)
