# Sanity Check Cost Infra and Add Cost Estimate to Start Pipeline Research

## User Goal
On the evolution dashboard, when creating a new "strategy" or starting a pipeline run, display the projected cost prior to saving — either automatically or via a "Estimate Cost" button.

## Problem Statement
Sanity check the existing cost tracking infrastructure in the evolution pipeline to ensure it works correctly end-to-end. Add a cost estimate button to the "Start Run" UI so users can see an estimated cost before launching a pipeline run, leveraging the existing costEstimator.ts module and historical baseline data.

## High Level Summary

The cost infrastructure has three distinct layers: (1) **pricing** (`llmPricing.ts` — static per-model token prices), (2) **estimation** (`costEstimator.ts` — data-driven predictions from `agent_cost_baselines` table), and (3) **tracking** (`costTracker.ts` — runtime budget enforcement with FIFO reservations). The estimation layer works end-to-end but is only called from `scripts/run-batch.ts` (CLI). **No server action exposes `estimateRunCost` to the UI, and no frontend component currently shows a pre-run cost estimate.** The "Start Run" card accepts `promptId + strategyId + budgetCapUsd` and submits without showing projected cost. Additionally, `refreshAgentCostBaselines()` has no scheduled caller, so the `agent_cost_baselines` table may be empty, causing estimates to always fall back to heuristic mode.

## Detailed Findings

### 1. Cost Estimation Module (`src/lib/evolution/core/costEstimator.ts`)

**Functions:**
- `estimateRunCostWithAgentModels(config, textLength)` → `RunCostEstimate { totalUsd, perAgent, perIteration, confidence }`
- `estimateRunCost(config, textLength)` — wrapper using `EvolutionRunConfig`
- `estimateAgentCost(agentName, model, textLength, callMultiplier)` — single agent
- `getAgentBaseline(agentName, model)` — reads `agent_cost_baselines` table (requires ≥50 samples)
- `refreshAgentCostBaselines(lookbackDays)` — aggregates `llmCallTracking` into baselines (**currently no caller**)
- `computeCostPrediction(estimated, actualCosts)` — delta analysis (**currently no caller**)

**Estimation logic:**
- With baseline: `baseline.avgCostUsd × (textLength / baseline.avgTextLength) × callMultiplier`
- Without baseline: heuristic `calculateLLMCost(model, textLength/4 + 200, textLength/4)`
- Confidence: `high` (≥2 baselines from generation+calibration), `medium` (≥1), `low` (0)

**Per-agent call multipliers:**
| Agent | Calls/Iteration | Phase |
|-------|----------------|-------|
| generation | 3 | all |
| evolution | 3 | competition |
| reflection | 3 | competition |
| debate | 4 | competition |
| iterativeEditing | 6 | competition |
| calibration | 18 (exp) / 30 (comp) | both |
| tournament | 50 | competition |

### 2. Cost Tracker (`src/lib/evolution/core/costTracker.ts`)

Runtime budget enforcement only (not estimation). `CostTrackerImpl`:
- `reserveBudget(agentName, estimate)` — checks `(agentSpent + reserved + estimate×1.3) ≤ agentCap` and total cap
- `recordSpend(agentName, actual)` — releases one FIFO reservation
- `getAllAgentCosts()` → `Record<string, number>` for persistence at run end

### 3. LLM Pricing (`src/config/llmPricing.ts`)

Static pricing table for 30+ models. Key defaults:
- `gpt-4.1-mini`: $0.40/$1.60 per 1M tokens (default generation model)
- `gpt-4.1-nano`: $0.10/$0.40 per 1M tokens (default judge model)
- `deepseek-chat`: $0.14/$0.28 per 1M tokens

`calculateLLMCost(model, promptTokens, completionTokens, reasoningTokens)` → USD

### 4. Start Run UI (`src/app/admin/quality/evolution/page.tsx`)

**`StartRunCard` component (lines ~113-201):**
- Dropdowns: prompt selector, strategy selector
- Input: budget (default $5.00)
- Submit: `queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd })`
- **No cost estimation displayed anywhere in this component**

**`QueueDialog` component (lines ~205-272):**
- Legacy: queues by `explanationId` + `budgetCapUsd`
- **Also no cost estimation**

### 5. Server Actions for Evolution

**`queueEvolutionRunAction`** (`src/lib/services/evolutionActions.ts` lines ~66-147):
- Accepts `{ explanationId?, budgetCapUsd?, promptId?, strategyId? }`
- Resolves budget: `input.budgetCapUsd ?? strategy.config.budgetCapUsd ?? 5.00`
- Inserts `content_evolution_runs` row with `status: 'pending'`
- **Does not call any estimation function**

**`triggerEvolutionRunAction`** (`src/lib/services/evolutionActions.ts` lines ~314-388):
- Fetches run + strategy, fetches article content
- Merges config: `resolveConfig({ ...strategy.config, ...run.config, budgetCapUsd })`
- Calls `preparePipelineRun()` → `executeFullPipeline()`
- **Does not record or return a cost estimate**

### 6. Strategy System

**`strategyRegistryActions.ts`:**
- `getStrategiesAction({ status?, isPredefined?, pipelineType?, limit? })` → strategy list for dropdown
- `createStrategyAction({ name, description?, config, pipelineType? })` → dedup by SHA-256 hash
- 3 presets: Economy ($1/minimal/2-iter), Balanced ($3/full/3-iter), Quality ($5/full/5-iter)

**`StrategyConfig` fields** (`src/lib/evolution/core/strategyConfig.ts`):
- `generationModel`, `judgeModel`, `agentModels?`, `iterations`, `budgetCaps`
- These fields are sufficient for `estimateRunCostWithAgentModels()`

### 7. Cost Data Flow (End-to-End)

```
LLM call → llms.ts → calculateLLMCost() → llmCallTracking.estimated_cost_usd
                                                    ↓
[No scheduled caller] refreshAgentCostBaselines() ← llmCallTracking (evolution_*)
                                                    ↓
agent_cost_baselines (agent_name, model, avg_cost_usd, sample_size)
                                                    ↓
estimateRunCost() → getAgentBaseline() → scale by text length → RunCostEstimate
                                                    ↓
Currently: ONLY scripts/run-batch.ts uses this
Needed: server action + StartRunCard integration
```

### 8. Database Tables

| Table | Purpose | Populated By |
|-------|---------|-------------|
| `llmCallTracking` | Every LLM call with token counts and cost | `llms.ts` on every call |
| `agent_cost_baselines` | Historical averages per (agent, model) | `refreshAgentCostBaselines()` (not scheduled) |
| `evolution_run_agent_metrics` | Per-agent cost after run completion | `persistAgentMetrics()` at run end |
| `content_evolution_runs.estimated_cost_usd` | Pre-run prediction column | **Currently unpopulated** |

### 9. Existing Callers of Cost Estimation

| Caller | Function Used | Context |
|--------|--------------|---------|
| `scripts/run-batch.ts` | `estimateRunCostWithAgentModels()` | CLI batch planning, budget filtering |
| None (frontend) | — | No server action exposes estimation |
| None (cron) | `refreshAgentCostBaselines()` | Never called automatically |
| None (post-run) | `computeCostPrediction()` | Never called |

### 10. Strategy Editor UI (`src/app/admin/quality/strategies/page.tsx`)

**`StrategyDialog` component (lines ~90-298):**
- Preset selector buttons (Economy/Balanced/Quality/Blank) — create mode only
- Form fields:
  - `name` (text input)
  - `description` (textarea)
  - `pipelineType` (select: full/minimal/batch)
  - `generationModel` (select: 7 model options)
  - `judgeModel` (select: same 7 options)
  - `iterations` (number: 1-50)
  - `budgetCap` — generation % only (number: 0.01-1.00)
- Submit calls `createStrategyAction({ name, description, config, pipelineType })`
- **No cost estimate shown when creating/editing a strategy**

### 11. Pipeline Finalization Cost Writes (`src/lib/evolution/core/pipeline.ts`)

**Where costs are persisted at run completion:**
1. `content_evolution_runs.total_cost_usd` — set via `costTracker.getTotalSpent()` (line ~898)
2. `evolution_run_agent_metrics.cost_usd` — per-agent cost via `persistAgentMetrics()` (line ~264)
3. `strategy_configs` aggregates — updated via `update_strategy_aggregates` RPC with `p_cost_usd` (line ~139)
4. `hall_of_fame_entries.total_cost_usd` — run cost split evenly across top 3 variants (line ~580)

**`content_evolution_runs.estimated_cost_usd` column is NEVER written** — exists in schema but unused.

**`STRATEGY_TO_AGENT` mapping** (lines ~218-239): Maps variant strategy names → agent names for cost attribution:
- `structural_transform/lexical_simplify/grounding_enhance` → `generation`
- `mutate_clarity/mutate_structure/crossover/creative_exploration` → `evolution`
- `debate_synthesis` → `debate`
- `critique_edit_*` → `iterativeEditing`
- `section_decomposition_*` → `sectionDecomposition`

### 12. Server Action Patterns (for new actions)

**Enhanced pattern** (from `strategyRegistryActions.ts`):
```
const _actionName = withLogging(async (params): Promise<ActionResult<T>> => {
  try {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    // ... business logic
    return { success: true, data: result, error: null };
  } catch (error) {
    return { success: false, data: null, error: handleError(error, 'actionName') };
  }
}, 'actionName');

export const actionName = serverReadRequestId(_actionName);
```

### 13. Test Patterns

**costEstimator.test.ts:**
- Mocks `createSupabaseServiceClient` with chain: `from().select().eq().single()`
- Tests heuristic fallback (no baseline), text-length scaling (2x text → 2x cost), call multiplier, 50-sample minimum
- Tests `RunCostEstimate` structure: `perAgent` keys, `totalUsd` sum, confidence levels
- Tests `computeCostPrediction`: delta/percent calculation, per-agent breakdown

**costTracker.test.ts:**
- Pure unit test, no mocks. Creates `CostTrackerImpl` directly
- Tests reservation margin (1.3x), per-agent caps, total budget, FIFO queue, concurrent reservations

**llmPricing.test.ts:**
- Pure function tests. Exact match, prefix fallback, unknown model default
- Formula-documented assertions: `(tokens/1M × price) = expected`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_framework.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/comparison_infrastructure.md

## Code Files Read
- `src/lib/evolution/core/costEstimator.ts` — estimation module (full read)
- `src/lib/evolution/core/costTracker.ts` — runtime budget enforcement (full read)
- `src/lib/evolution/core/costEstimator.test.ts` — estimation tests
- `src/lib/evolution/core/costTracker.test.ts` — tracker tests
- `src/lib/evolution/config.ts` — default config + resolveConfig
- `src/lib/evolution/types.ts` — all shared types
- `src/lib/evolution/index.ts` — public API + factories
- `src/lib/evolution/core/llmClient.ts` — LLM client with budget reservation
- `src/lib/evolution/core/pipeline.ts` — persistAgentMetrics, finalizePipelineRun
- `src/config/llmPricing.ts` — pricing table + calculateLLMCost
- `src/config/batchRunSchema.ts` — batch cost fields
- `src/lib/services/evolutionActions.ts` — queue/trigger actions
- `src/lib/services/strategyRegistryActions.ts` — strategy CRUD
- `src/lib/services/eloBudgetActions.ts` — dashboard cost analytics
- `src/lib/services/costAnalytics.ts` — admin cost analytics
- `src/lib/services/llms.ts` — LLM call tracking
- `src/app/admin/quality/evolution/page.tsx` — StartRunCard, QueueDialog, VariantPanel, AgentCostChart
- `src/app/admin/quality/strategies/page.tsx` — StrategyDialog, strategy CRUD UI
- `src/app/admin/quality/optimization/page.tsx` — optimization dashboard (read-only analytics)
- `src/lib/evolution/core/strategyConfig.ts` — StrategyConfig type, hashStrategyConfig, labelStrategyConfig
- `src/config/llmPricing.test.ts` — pricing test patterns
- `supabase/migrations/20260205000003_add_agent_cost_baselines.sql` — baselines schema
