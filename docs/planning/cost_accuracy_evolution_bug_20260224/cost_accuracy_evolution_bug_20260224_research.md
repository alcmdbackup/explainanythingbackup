# Cost Accuracy Evolution Bug Research

## Problem Statement
The Cost Accuracy tab in Ratings Optimization > Cost Accuracy > Per Agent Accuracy has a bug where many agents show one of either estimated or actual cost as zero while the other is non-zero. This shouldn't be possible — if an agent has an estimated cost, it should also have an actual cost (and vice versa).

## Requirements (from GH Issue #560)
There are many agents where one of either estimated or actual is zero, but the other is not. This shouldn't be possible.

## High Level Summary

The root cause is a **key-set mismatch** in `computeCostPrediction()` (`costEstimator.ts:383-388`). This function only iterates over the 7 hardcoded estimated agent keys, silently dropping any agents that actually ran but weren't in the estimator. Additionally, `estimateRunCostWithAgentModels()` always estimates all 7 agents regardless of `enabledAgents`, so disabled agents get estimated > 0 but actual = 0.

Two distinct bugs:
1. **Agents with actual cost but no estimate (silently dropped)**: `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `metaReview`, `flowCritique`, `proximity` — these run in production but are NOT estimated. Their actual costs are invisible in the per-agent table.
2. **Agents estimated but not run (false estimates)**: When a strategy disables agents (e.g., `evolution`, `debate`), the estimator still projects non-zero cost for them. Result: estimated > 0, actual = 0.

## Root Cause Analysis

### Bug 1: `computeCostPrediction` only iterates estimated keys

**File**: `evolution/src/lib/core/costEstimator.ts` lines 382-388

```typescript
const perAgent: Record<string, { estimated: number; actual: number }> = {};
for (const agent of Object.keys(estimated.perAgent)) {  // ← only 7 estimated keys
  perAgent[agent] = {
    estimated: estimated.perAgent[agent] ?? 0,
    actual: perAgentCosts[agent] ?? 0,  // ← 0 if agent ran but wasn't estimated
  };
}
// Agents in perAgentCosts NOT in estimated.perAgent → silently dropped
```

**Fix**: Iterate the **union** of estimated and actual agent names.

### Bug 2: Estimator hardcodes 7 agents, ignores `enabledAgents`

**File**: `evolution/src/lib/core/costEstimator.ts` lines 163-203

The estimator always estimates these 7 agents:
- `generation`, `evolution`, `reflection`, `debate`, `iterativeEditing`, `calibration`, `tournament`

Missing from estimates (but tracked in actuals):
- `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `metaReview`, `flowCritique`, `proximity`

The `RunCostConfig` interface (line 49-56) does NOT include `enabledAgents`, so the estimator cannot know which agents are disabled.

**File**: `evolution/src/services/evolutionActions.ts` lines 183-189

The caller passes only `generationModel`, `judgeModel`, `maxIterations`, `agentModels` — never `enabledAgents`.

### Data Flow Summary

```
1. Strategy selected → estimateRunCostWithAgentModels() produces perAgent with 7 keys
2. Estimate stored in evolution_runs.cost_estimate_detail (JSONB)
3. Pipeline runs → agents tracked in evolution_agent_invocations (12+ agent names)
4. On completion → persistCostPrediction() in metricsWriter.ts:
   a. Queries invocations → builds perAgentCosts (Record<string, number>) — all agents
   b. Calls computeCostPrediction(estimated, actualTotalUsd, perAgentCosts)
   c. computeCostPrediction iterates only estimated.perAgent keys (7)
   d. Writes cost_prediction to evolution_runs (JSONB)
5. getCostAccuracyOverviewAction reads cost_prediction.perAgent → aggregates per agent
6. CostAccuracyPanel displays the (incomplete) per-agent accuracy table
```

### Agent Name Verification

All agent names are consistent (camelCase) between estimator and actual tracking:

| Agent Class | `name` property | In estimator? | In invocations? |
|---|---|---|---|
| GenerationAgent | `generation` | Yes | Yes |
| EvolutionAgent | `evolution` | Yes | Yes |
| ReflectionAgent | `reflection` | Yes | Yes |
| DebateAgent | `debate` | Yes | Yes |
| IterativeEditingAgent | `iterativeEditing` | Yes | Yes |
| CalibrationRanker | `calibration` | Yes | Yes |
| Tournament | `tournament` | Yes | Yes |
| TreeSearchAgent | `treeSearch` | **No** | Yes |
| OutlineGenerationAgent | `outlineGeneration` | **No** | Yes |
| SectionDecompositionAgent | `sectionDecomposition` | **No** | Yes |
| MetaReviewAgent | `metaReview` | **No** | Yes |
| ProximityAgent | `proximity` | **No** | Yes |
| FlowCritique (pipeline) | `flowCritique` | **No** | Yes |

---

## Round 2 Research: Deep Dive

### Missing Agent LLM Call Profiles

For adding estimates for the 5 missing agents that make LLM calls:

| Agent | LLM calls per iteration | Models used | Notes |
|---|---|---|---|
| `treeSearch` | ~60 calls (27 gen + 6 re-critique + 27 judge) | generationModel + judgeModel | Most expensive missing agent. Has its own `estimateCost()` heuristic internally |
| `outlineGeneration` | 6 calls (3 gen + 3 judge) | generationModel + judgeModel | Step pipeline: outline→score→expand→score→polish→score |
| `sectionDecomposition` | ~20 calls (10 gen + 10 judge) | generationModel + judgeModel | Per-section critique→edit→judge loops, ~5 sections × 2 cycles |
| `flowCritique` | N calls (1 per uncritiqued variant) | generationModel only | Pool size typically 15-25 in COMPETITION |
| `proximity` | **0 calls** | None | Uses local word-trigram cosine similarity, no API. `estimateCost()` returns 0 |
| `metaReview` | **0 calls** | None | Computation-only (ordinal analysis), no LLM |

### enabledAgents Propagation Chain

```
Admin creates strategy
  → StrategyConfig { enabledAgents: AgentName[] } stored in evolution_strategy_configs.config (JSONB)

queueEvolutionRunAction()
  → fetches strategy.config as StrategyConfig          ← enabledAgents IS available in scope
  → calls estimateRunCostWithAgentModels({              ← enabledAgents NOT passed
      generationModel, judgeModel, maxIterations, agentModels
    })
  → estimator adds ALL 7 agents regardless

  → later calls buildRunConfig(strategyConfig)          ← enabledAgents IS correctly threaded here
  → stores enabledAgents in evolution_runs.config       ← correct at pipeline run time
```

**Key constants from `budgetRedistribution.ts`**:
- `REQUIRED_AGENTS`: `['generation', 'calibration', 'tournament', 'proximity']`
- `OPTIONAL_AGENTS`: `['reflection', 'iterativeEditing', 'treeSearch', 'sectionDecomposition', 'debate', 'evolution', 'outlineGeneration', 'metaReview', 'flowCritique']`
- `SINGLE_ARTICLE_DISABLED`: `['generation', 'outlineGeneration', 'evolution']`

The `computeEffectiveBudgetCaps()` function already implements the correct filtering logic and is reusable.

### Existing Test Coverage & Gaps

**Critical finding**: The test `'excludes agents in perAgentCosts that are not in estimated.perAgent'` in `costEstimator.test.ts` **explicitly asserts the buggy behavior as correct**. This test must be inverted.

| Test file | Tests | Bug scenario covered? |
|---|---|---|
| `costEstimator.test.ts` | 8 tests for `computeCostPrediction` | **No** — asserts actual-only agents are correctly EXCLUDED |
| `costAnalyticsActions.test.ts` | 2 tests for `getCostAccuracyOverviewAction` | **No** — mock data only includes matching agents |
| `metricsWriter.test.ts` | 2 tests for `persistCostPrediction` | **No** — test invocations match estimate agents exactly |
| `pipeline.test.ts` | 2 cost_prediction tests | **No** — only checks that prediction was written, not per-agent content |
| `CostAccuracyPanel.test.tsx` | 3 tests | **No** — mock data only includes `generation` and `calibration` |
| Integration test | 2 tests for `computeCostPrediction` | **No** — tests matching or estimate-only agents, never actual-only |

### Pipeline Completion Flow

```
executeFullPipeline completes
  → finalizePipelineRun() (pipeline.ts:119-177)
    → Promise.all([
        persistSummary,
        persistVariants,
        persistAgentMetrics,        ← uses in-memory costTracker (session-only)
        persistCostPredictionBlock, ← queries DB (all continuations)
        linkStrategyConfig
      ])
    → persistCostPredictionBlock:
        1. Reads evolution_runs.cost_estimate_detail
        2. If null → silently skips (no log, no error)
        3. If exists → calls persistCostPrediction(supabase, runId, detail, ctx, logger)
```

**Continuation edge case**: `persistCostPrediction` reads from `evolution_agent_invocations` (DB) which accumulates across all continuations — correct. But `persistAgentMetrics` uses `ctx.costTracker.getAllAgentCosts()` which only has current-segment costs after resume (separate bug, out of scope).

---

## Round 3 Research: Scope & Schema Constraints

### Pre-Run Estimate UI (StartRunCard)

The StartRunCard in `src/app/admin/quality/evolution/page.tsx` (lines 314-334) shows a **user-facing per-agent breakdown** with horizontal bar charts and dollar amounts for each estimated agent. This is a collapsible "Show details" section visible to admins before queueing a run.

**Impact**: The pre-run estimate is also buggy — it shows costs for disabled agents and omits enabled-but-unestimated agents. However, this is fixed automatically once the estimator respects `enabledAgents` — the UI iterates `estimate.perAgent` dynamically with no hardcoded agent list.

### Pairwise Agent Cost Routing

`pairwise` will **never** appear as its own row in the per-agent accuracy table:
- Tournament routes ALL pairwise LLM calls via `agentNameOverride='tournament'` (tournament.ts line 194)
- CalibrationRanker does NOT use PairwiseRanker — uses standalone `compareWithBiasMitigation` from `comparison.ts`
- `'pairwise'` never appears in `evolution_agent_invocations.agent_name`
- No mismatch risk from the pairwise cost routing

### Affected UI Surfaces

| Surface | Reads `cost_prediction.perAgent`? | Affected? |
|---|---|---|
| `CostAccuracyPanel` (optimization dashboard) | Yes — via `getCostAccuracyOverviewAction` | **Yes** |
| `StartRunCard` per-agent breakdown | Reads `estimate.perAgent` (pre-queue) | **Yes** (inflated estimates) |
| Budget tab "Estimate vs Final" (run detail) | Yes — via `prediction.perAgent` | **Yes** (same data) |
| `StrategyDetailRow` accuracy | No — uses run-level `estimated_cost_usd` vs `total_cost_usd` | **No** |
| `getOptimizationSummaryAction` | No — uses `evolution_run_agent_metrics` | **No** |
| `getStrategyAccuracyAction` | No — uses run-level scalars only | **No** |

### Schema Constraints

Both Zod schemas use `z.record()` — **no fixed agent keys required**:
- `RunCostEstimateSchema.perAgent`: `z.record(z.number())` — any string keys
- `CostPredictionSchema.perAgent`: `z.record(z.object({estimated, actual}))` — any string keys
- DB columns: free-form JSONB with no CHECK constraints

**Old runs are safe**: Adding new agent keys to future estimates won't break old runs. The Zod schemas are extensible, the UI iterates JSONB keys dynamically, and old `cost_estimate_detail` is frozen at queue time.

### `estimateRunCost` Wrapper

The `estimateRunCost()` wrapper in `costEstimator.ts` (line 235-244) is a **test-only** backward-compat function. No production code uses it. Both production call sites go directly to `estimateRunCostWithAgentModels`. It also silently drops `agentModels` — irrelevant to the fix since we won't touch it.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/cost_optimization.md — CostTracker, cost attribution, persistCostPrediction flow
- evolution/docs/evolution/reference.md — Budget caps, per-agent %, CostTracker enforcement, invocation lifecycle
- evolution/docs/evolution/architecture.md — Pipeline phases, agent dispatch, checkpoint/resume
- evolution/docs/evolution/data_model.md — evolution_agent_invocations schema, two-phase invocation lifecycle
- evolution/docs/evolution/agents/overview.md — AgentBase framework, all 12 agents listed
- evolution/docs/evolution/visualization.md — CostAccuracyPanel, getCostAccuracyOverviewAction, per-agent display
- evolution/docs/evolution/rating_and_comparison.md — Tournament cost routing via agentNameOverride
- docs/feature_deep_dives/metrics_analytics.md — General metrics aggregation patterns

## Code Files Read
- `evolution/src/lib/core/costEstimator.ts` — Root cause: `computeCostPrediction()` line 383; `estimateRunCostWithAgentModels()` hardcodes 7 agents; `RunCostConfig` lacks `enabledAgents`; baseline system via `getAgentBaseline()`/`refreshAgentCostBaselines()`
- `evolution/src/lib/core/metricsWriter.ts` — `persistCostPrediction()` queries invocations correctly; `persistAgentMetrics()` uses in-memory tracker (continuation-fragile); `STRATEGY_TO_AGENT` mapping
- `evolution/src/services/costAnalyticsActions.ts` — `getCostAccuracyOverviewAction` aggregates `cost_prediction.perAgent` faithfully; per-agent loop at lines 134-157
- `evolution/src/services/evolutionActions.ts` — Both `estimateRunCostAction` (line 113) and `queueEvolutionRunAction` (line 183) call estimator without `enabledAgents` despite it being in scope
- `evolution/src/lib/core/budgetRedistribution.ts` — `REQUIRED_AGENTS`, `OPTIONAL_AGENTS`, `computeEffectiveBudgetCaps()` — reusable filtering logic
- `evolution/src/lib/core/strategyConfig.ts` — `StrategyConfig` interface includes `enabledAgents?: AgentName[]`
- `evolution/src/lib/types.ts` — `EvolutionRunConfig` also has `enabledAgents`; `estimateRunCost()` wrapper also drops it
- `src/app/admin/quality/optimization/_components/CostAccuracyPanel.tsx` — UI sorts by |deltaPercent|, shows avgEstimated/avgActual/delta
- `evolution/src/lib/agents/treeSearchAgent.ts` — ~60 LLM calls per iteration (gen + judge models)
- `evolution/src/lib/agents/outlineGenerationAgent.ts` — 6 LLM calls per iteration (3 gen + 3 judge)
- `evolution/src/lib/agents/sectionDecompositionAgent.ts` — ~20 LLM calls per iteration (gen + judge)
- `evolution/src/lib/agents/proximityAgent.ts` — Zero LLM cost (local trigram cosine similarity)
- `evolution/src/lib/core/pipeline.ts` — `finalizePipelineRun()` flow; `runFlowCritiques()` is flowCritique entry point
- `evolution/src/lib/core/costEstimator.test.ts` — Test at line 329 asserts buggy behavior as correct
- `evolution/src/services/costAnalyticsActions.test.ts` — No test for agent mismatch scenario
- `evolution/src/lib/core/metricsWriter.test.ts` — No test for invocations with agents outside estimate
- `evolution/src/lib/core/pipeline.test.ts` — Cost prediction tests don't check per-agent values
- `src/app/admin/quality/optimization/_components/CostAccuracyPanel.test.tsx` — Mock data only uses 2 agents
- `src/app/admin/quality/evolution/page.tsx` — StartRunCard shows per-agent estimate breakdown with bar charts (lines 314-334)
- `evolution/src/lib/agents/pairwiseRanker.ts` — `readonly name = 'pairwise'`, but Tournament overrides via `agentNameOverride`
- `evolution/src/lib/agents/tournament.ts` — Always passes `this.name` ('tournament') as agentNameOverride to pairwise
- `evolution/src/lib/agents/calibrationRanker.ts` — Does NOT use PairwiseRanker, calls comparison.ts directly
- `evolution/src/services/eloBudgetActions.ts` — `getOptimizationSummaryAction` uses `evolution_run_agent_metrics`, not `cost_prediction`
- `src/app/admin/quality/strategies/page.tsx` — `StrategyDetailRow` shows run-level accuracy only, no per-agent

## Key Findings

1. **`computeCostPrediction()` iterates only `estimated.perAgent` keys** — agents that ran but weren't estimated are silently dropped from `cost_prediction.perAgent`
2. **Estimator hardcodes 7 agents, ignores `enabledAgents`** — disabled agents get non-zero estimates; 5 missing agents get no estimate
3. **`RunCostConfig` interface lacks `enabledAgents`** — no way to filter by active agents
4. **Agent names are consistent** — no camelCase/naming mismatch between systems
5. **The `costAnalyticsActions` aggregation is correct** — data is wrong at the source in `computeCostPrediction`
6. **Existing test explicitly asserts buggy behavior** — `costEstimator.test.ts` line 329 verifies actual-only agents are excluded
7. **No test anywhere covers the actual-only agent scenario** — the root cause is untested except in the "wrong direction"
8. **`enabledAgents` is in scope at both call sites** but never forwarded — `strategyConfig.enabledAgents` is available in `queueEvolutionRunAction` and `estimateRunCostAction`
9. **`computeEffectiveBudgetCaps()` has reusable filtering logic** — same REQUIRED/OPTIONAL agent classification needed by the estimator
10. **4 agents need cost estimates added**: `treeSearch` (~60 calls), `outlineGeneration` (6 calls), `sectionDecomposition` (~20 calls), `flowCritique` (N per pool variant). `proximity` and `metaReview` have zero LLM cost
11. **Pre-run estimate UI also affected** — StartRunCard shows per-agent bar charts to admins; inflated by disabled agents
12. **`pairwise` never appears in invocations** — Tournament routes all costs via `agentNameOverride`; no risk of phantom `pairwise` rows
13. **Only 3 UI surfaces affected** — `CostAccuracyPanel`, `StartRunCard` breakdown, Budget tab "Estimate vs Final". Strategy accuracy and optimization summary are NOT affected
14. **Schemas are fully extensible** — `z.record()` with no fixed keys. Adding new agent keys to estimates is safe for old and new runs
15. **`estimateRunCost()` wrapper is test-only** — no production code path, can be ignored

## Open Questions (Resolved)

1. ~~Should we add estimates for missing agents?~~ **Yes** — add estimates for `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique`. Skip `proximity` and `metaReview` (zero LLM cost).
2. ~~Should existing cost_prediction data be backfilled?~~ **No** — fix going forward. The `computeCostPrediction` union-key fix will naturally correct future runs. Historical data would require re-running the prediction computation.
3. ~~Should proximity be excluded?~~ **Yes** — `estimateCost()` returns 0, uses local computation only.
4. ~~Does `pairwise` cause phantom rows?~~ **No** — Tournament overrides agent name for all pairwise calls.
5. ~~Are other UI surfaces affected?~~ **No** — only `CostAccuracyPanel`, `StartRunCard` breakdown, and Budget tab comparison.
